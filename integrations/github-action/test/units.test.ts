import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  diagnostic,
  documentUri,
  type AnalysisResult,
  type CompatibilityFinding,
} from '@zainkhan-bit/contractguard-core';
import { ANNOTATIONS_PER_TYPE, diagnosticAnnotations, findingAnnotations, workspacePath } from '../src/annotations.js';
import { COMMENT_MARKER, commentBody, MAX_COMMENT_CHARS, upsertComment } from '../src/comment.js';
import { readContext } from '../src/context.js';
import { ensureBaseCommit } from '../src/git.js';
import {
  appendSummary,
  command,
  escapeData,
  escapeProperty,
  getBooleanInput,
  getInput,
  getListInput,
  InputError,
  setOutputs,
  stopCommands,
  type RunnerIo,
} from '../src/runner.js';
import { fakeGitHub, fakeRunner, git, prEvent, sandbox, SPEC, tempDir } from './helpers.js';

const io = (env: Record<string, string>): RunnerIo & { out: () => string } => {
  let out = '';
  return {
    env,
    write: (t) => {
      out += t;
    },
    out: () => out,
  };
};

describe('runner protocol', () => {
  it('reads inputs the way the runner names them', () => {
    const r = io({
      'INPUT_FAIL-ON': ' breaking, potentially-breaking ',
      INPUT_SPECS: 'a.yaml\n# comment\n\nb.yaml',
      INPUT_COMMENT: 'TRUE',
    });
    expect(getInput(r, 'fail-on')).toBe('breaking, potentially-breaking');
    expect(getListInput(r, 'fail-on')).toEqual(['breaking', 'potentially-breaking']);
    expect(getListInput(r, 'specs')).toEqual(['a.yaml', 'b.yaml']);
    expect(getBooleanInput(r, 'comment', false)).toBe(true);
    expect(getBooleanInput(r, 'summary', true)).toBe(true);
    expect(() => getBooleanInput(io({ INPUT_COMMENT: 'maybe' }), 'comment', false)).toThrow(InputError);
    expect(getBooleanInput(io({ INPUT_COMMENT: 'off' }), 'comment', true)).toBe(false);
  });

  it('escapes workflow command data and properties', () => {
    expect(escapeData('50%\r\nnext')).toBe('50%25%0D%0Anext');
    expect(escapeProperty('a:b,c')).toBe('a%3Ab%2Cc');
    expect(command('error', { file: 'api.yaml', line: 3, title: 'x, y' }, 'm\nn')).toBe(
      '::error file=api.yaml,line=3,title=x%2C y::m%0An\n',
    );
    expect(command('notice', {}, 'hi')).toBe('::notice::hi\n');
  });

  it('stop-commands uses a random token and resumes', () => {
    const r = io({});
    stopCommands(r)();
    const [stop, resume] = r.out().trim().split('\n');
    const token = stop?.replace('::stop-commands::', '');
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(resume).toBe(`::${token ?? ''}::`);
  });

  it('writes outputs with a heredoc delimiter, falls back to the log outside a runner', async () => {
    const f = fakeRunner(tempDir(), { name: 'push', payload: {} });
    await setOutputs(f, { result: 'passed', multi: 'a\nb' });
    expect(f.outputs()).toEqual({ result: 'passed', multi: 'a\nb' });
    expect(await appendSummary(f, '# hi')).toBe(true);
    expect(f.summary()).toBe('# hi\n');
    const bare = io({});
    await setOutputs(bare, { result: 'failed' });
    expect(bare.out()).toBe('output result=failed\n');
    expect(await appendSummary(bare, 'x')).toBe(false);
  });
});

describe('event context', () => {
  const ctx = async (
    name: string,
    payload: unknown,
    env: Record<string, string> = {},
    baseRef = '',
  ): ReturnType<typeof readContext> => {
    const f = fakeRunner(tempDir(), { name, payload }, {}, env);
    return readContext(f, baseRef);
  };

  it('pull_request: base commit, PR number, comments allowed', async () => {
    const c = await ctx(prEvent('a'.repeat(40)).name, prEvent('a'.repeat(40)).payload);
    expect(c).toMatchObject({
      base: 'a'.repeat(40),
      baseSource: 'pull_request',
      prNumber: 7,
      canComment: true,
      headSha: 'e'.repeat(40),
    });
  });

  it('fork and Dependabot pull requests cannot comment', async () => {
    const fork = prEvent('a'.repeat(40), { headRepo: 'someone/api' });
    expect((await ctx(fork.name, fork.payload)).canComment).toBe(false);
    const own = prEvent('a'.repeat(40));
    expect((await ctx(own.name, own.payload, { GITHUB_ACTOR: 'dependabot[bot]' })).canComment).toBe(false);
  });

  it('pull_request_target warns', async () => {
    const e = prEvent('a'.repeat(40));
    expect((await ctx('pull_request_target', e.payload)).warnings[0]).toContain('pull_request');
  });

  it('push uses "before", or HEAD^ for a new branch', async () => {
    expect((await ctx('push', { before: 'b'.repeat(40) })).base).toBe('b'.repeat(40));
    const created = await ctx('push', { before: '0'.repeat(40) });
    expect(created).toMatchObject({ base: 'HEAD^', baseSource: 'parent' });
    expect(created.prNumber).toBeUndefined();
  });

  it('base-ref overrides the event; other events need it', async () => {
    expect((await ctx('push', { before: 'b'.repeat(40) }, {}, 'origin/main')).base).toBe('origin/main');
    await expect(ctx('workflow_dispatch', {})).rejects.toThrow(/base-ref/);
    expect((await ctx('workflow_dispatch', {}, {}, 'v1.0.0')).baseSource).toBe('input');
  });

  it('survives a missing or unreadable event file', async () => {
    const f = fakeRunner(
      tempDir(),
      { name: 'push', payload: {} },
      {},
      { GITHUB_EVENT_PATH: join(tempDir(), 'missing.json') },
    );
    expect((await readContext(f, '')).base).toBe('HEAD^');
    const g = fakeRunner(tempDir(), { name: 'push', payload: {} }, {}, { GITHUB_EVENT_PATH: '' });
    expect((await readContext(g, 'main')).base).toBe('main');
  });
});

describe('base commit resolution', () => {
  it('fetches a missing base commit into a shallow clone', async () => {
    const s = sandbox([{ 'api.yaml': SPEC() }, { 'api.yaml': SPEC({ requiredAge: true }) }]);
    const logs: string[] = [];
    expect(await ensureBaseCommit(s.shas[0] as string, s.workspace, (l) => logs.push(l))).toBe(s.shas[0]);
    expect(logs[0]).toContain('Fetching base commit');
    // Already present now: no second fetch.
    expect(await ensureBaseCommit(s.shas[0] as string, s.workspace, (l) => logs.push(l))).toBe(s.shas[0]);
    expect(logs).toHaveLength(1);
  });

  it('fetches branches by name and the parent commit', async () => {
    const s = sandbox([{ 'api.yaml': SPEC() }, { 'api.yaml': SPEC({ tag: false }) }]);
    git(join(s.root, 'src'), 'branch', 'release');
    git(join(s.root, 'src'), 'push', '-q', join(s.root, 'origin.git'), 'release');
    expect(await ensureBaseCommit('origin/release', s.workspace, () => undefined)).toBe(s.shas[1]);
    expect(await ensureBaseCommit('HEAD^', s.workspace, () => undefined)).toBe(s.shas[0]);
  });

  it('fetches tags by name through the fallback refspec', async () => {
    const s = sandbox([{ 'api.yaml': SPEC() }, { 'api.yaml': SPEC({ tag: false }) }]);
    git(join(s.root, 'src'), 'tag', 'v1.0.0', s.shas[0] as string);
    git(join(s.root, 'src'), 'push', '-q', join(s.root, 'origin.git'), 'v1.0.0');
    const logs: string[] = [];
    expect(await ensureBaseCommit('v1.0.0', s.workspace, (l) => logs.push(l))).toBe(s.shas[0]);
    expect(logs[0]).toBe('Fetching v1.0.0 from origin');
  });

  it('rejects unsafe refs and reports unavailable ones', async () => {
    const s = sandbox([{ 'api.yaml': SPEC() }]);
    await expect(ensureBaseCommit('--upload-pack=touch x', s.workspace, () => undefined)).rejects.toThrow(
      /Invalid base/,
    );
    await expect(ensureBaseCommit('c'.repeat(40), s.workspace, () => undefined)).rejects.toThrow(/fetch-depth: 0/);
    await expect(ensureBaseCommit('no-such-branch', s.workspace, () => undefined)).rejects.toThrow(InputError);
  });
});

describe('sticky comment', () => {
  const api = (f: typeof fetch, extra: object = {}): Parameters<typeof upsertComment>[0] => ({
    apiUrl: 'https://api.github.test',
    repository: 'octo/api',
    token: 't',
    fetch: f,
    sleep: () => Promise.resolve(),
    ...extra,
  });

  it('creates, updates and leaves an identical comment alone', async () => {
    const gh = fakeGitHub([{ id: 1, body: 'unrelated' }]);
    const body = commentBody('report v1');
    expect(await upsertComment(api(gh.fetch), 7, body, () => undefined)).toBe('created');
    expect(await upsertComment(api(gh.fetch), 7, body, () => undefined)).toBe('unchanged');
    expect(await upsertComment(api(gh.fetch), 7, commentBody('report v2'), () => undefined)).toBe('updated');
    expect(gh.comments).toHaveLength(2);
    expect(gh.comments[1]?.body).toBe(`${COMMENT_MARKER}\nreport v2`);
    const posts = gh.calls.filter((c) => c.method !== 'GET');
    expect(posts.map((c) => c.method)).toEqual(['POST', 'PATCH']);
  });

  it('follows pagination to find the marked comment', async () => {
    const pages: Record<string, unknown[]> = {
      '1': [{ id: 1, body: 'x' }],
      '2': [{ id: 2, body: `${COMMENT_MARKER}\nold` }],
    };
    const calls: string[] = [];
    const f = ((input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${input}`);
      if ((init?.method ?? 'GET') === 'PATCH') return Promise.resolve(Response.json({}));
      const page = new URL(input).searchParams.get('page') ?? '1';
      const headers =
        page === '1'
          ? { link: '<https://api.github.test/repos/octo/api/issues/7/comments?per_page=100&page=2>; rel="next"' }
          : undefined;
      return Promise.resolve(Response.json(pages[page], headers === undefined ? {} : { headers }));
    }) as typeof fetch;
    expect(await upsertComment(api(f), 7, `${COMMENT_MARKER}\nnew`, () => undefined)).toBe('updated');
    expect(calls).toEqual([
      'GET https://api.github.test/repos/octo/api/issues/7/comments?per_page=100',
      'GET https://api.github.test/repos/octo/api/issues/7/comments?per_page=100&page=2',
      'PATCH https://api.github.test/repos/octo/api/issues/comments/2',
    ]);
  });

  it('retries 5xx and rate limits, honouring retry-after', async () => {
    const waits: number[] = [];
    const responses = [
      new Response('oops', { status: 502 }),
      new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
      new Response('You have exceeded a secondary rate limit', { status: 403 }),
      new Response('limit', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' } }),
      Response.json([]),
      Response.json({ id: 1 }, { status: 201 }),
    ];
    const f = (() => Promise.resolve(responses.shift() as Response)) as unknown as typeof fetch;
    const out = await upsertComment(
      api(f, { retries: 5, sleep: (ms: number) => (waits.push(ms), Promise.resolve()) }),
      7,
      'b',
      () => undefined,
    );
    expect(out).toBe('created');
    expect(waits).toEqual([1000, 2000, 4000, 1000]);
  });

  it('gives up after the retry budget and never throws', async () => {
    const f = (() => Promise.resolve(new Response('down', { status: 503 }))) as unknown as typeof fetch;
    const logs: string[] = [];
    expect(await upsertComment(api(f), 7, 'b', (l) => logs.push(l))).toBe('failed');
    expect(logs[0]).toContain('503');
    const boom = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
    expect(await upsertComment(api(boom), 7, 'b', () => undefined)).toBe('failed');
  });

  it('a read-only token is reported, not fatal', async () => {
    const f = (() =>
      Promise.resolve(
        new Response('Resource not accessible by integration', { status: 403 }),
      )) as unknown as typeof fetch;
    const logs: string[] = [];
    expect(await upsertComment(api(f), 7, 'b', (l) => logs.push(l))).toBe('skipped-readonly');
    expect(logs[0]).toContain('pull-requests: write');
  });

  it('truncates long bodies under the API limit', () => {
    const body = commentBody('x'.repeat(100_000), 'https://github.com/o/r/actions/runs/1');
    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('actions/runs/1');
  });
});

describe('annotations', () => {
  const ws = tempDir();
  const uri = documentUri(pathToFileURL(join(ws, 'api', 'openapi.yaml')).href);

  function finding(
    i: number,
    classification: CompatibilityFinding['classification'],
    status: CompatibilityFinding['status'] = 'active',
  ): CompatibilityFinding {
    return {
      fingerprint: String(i),
      ruleId: 'CG-REQ-001',
      classification,
      severity: 'high',
      status,
      subject: { method: 'post', path: '/pets' },
      location: {
        anchor: {
          uri,
          pointer: '#/paths',
          range: { start: { line: i + 1, column: 3, offset: 0 }, end: { line: i + 2, column: 1, offset: 0 } },
        },
      },
      message: `m${String(i)}`,
      explanation: 'e',
      resolution: 'r',
    } as unknown as CompatibilityFinding;
  }
  const result = (findings: CompatibilityFinding[], specId = 'api'): AnalysisResult =>
    ({ specId, findings, diagnostics: [] }) as unknown as AnalysisResult;

  it('maps workspace files and ignores everything else', () => {
    expect(workspacePath(uri, ws)).toBe('api/openapi.yaml');
    expect(workspacePath('git://abc/api.yaml', ws)).toBeUndefined();
    expect(workspacePath(pathToFileURL(join(tempDir(), 'x.yaml')).href, ws)).toBeUndefined();
    expect(workspacePath('file://%%bad', ws)).toBeUndefined();
  });

  it('respects the per-type limit with a "+N more" line', () => {
    const many = Array.from({ length: 15 }, (_, i) => finding(i, 'breaking'));
    const text = findingAnnotations(
      [
        result([
          ...many,
          finding(99, 'potentially-breaking'),
          finding(98, 'non-breaking'),
          finding(97, 'breaking', 'suppressed'),
        ]),
      ],
      ws,
    );
    const errors = text.split('\n').filter((l) => l.startsWith('::error'));
    expect(errors).toHaveLength(ANNOTATIONS_PER_TYPE);
    expect(errors.at(-1)).toContain('+6 more breaking');
    expect(text.split('\n').filter((l) => l.startsWith('::warning'))).toHaveLength(1);
    expect(errors[0]).toContain('file=api/openapi.yaml,line=1,col=3,endLine=2');
    expect(errors[0]).toContain('POST /pets: m0');
  });

  it('names the spec when there are several', () => {
    const text = findingAnnotations([result([finding(1, 'breaking')], 'a'), result([], 'b')], ws);
    expect(text).toContain('CG-REQ-001 · a');
  });

  it('turns diagnostics into errors and warnings', () => {
    const d = diagnostic('CGD-FS-001', 'File not found', {
      hint: 'check it',
      location: { uri, pointer: '#' as never },
    });
    const text = diagnosticAnnotations([{ ...d, side: 'base' }, diagnostic('CGD-CONFIG-112', 'Ignore expired')], ws);
    expect(text).toContain(
      '::error title=ContractGuard CGD-FS-001,file=api/openapi.yaml::[base] File not found (check it)',
    );
    expect(text).toContain('::warning title=ContractGuard CGD-CONFIG-112::Ignore expired');
  });
});

describe('packaging', () => {
  it('action.yml declares node24 and every input the code reads', () => {
    const yml = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');
    expect(yml).toContain('using: node24');
    const src = ['main.ts', 'context.ts']
      .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
      .join('\n');
    const read = [...src.matchAll(/(?:getInput|getBooleanInput|getListInput)\(io, '([\w-]+)'/g)].map((m) => m[1]);
    for (const name of new Set(read)) expect(yml, name).toMatch(new RegExp(`^  ${name ?? ''}:$`, 'm'));
  });
});
