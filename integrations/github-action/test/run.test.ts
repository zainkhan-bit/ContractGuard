import { existsSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMENT_MARKER } from '../src/comment.js';
import { run, VERSION } from '../src/main.js';
import { fakeGitHub, fakeRunner, prEvent, sandbox, SPEC, write } from './helpers.js';

const today = '2026-06-01';

/** Base commit = compatible spec; workspace = the PR's change (shallow clone of the last commit). */
function breakingPr(): ReturnType<typeof sandbox> {
  return sandbox([{ 'api/openapi.yaml': SPEC() }, { 'api/openapi.yaml': SPEC({ requiredAge: true, tag: false }) }]);
}

describe('pull_request', () => {
  it('a breaking change fails the job with annotations, summary, outputs and SARIF', async () => {
    const s = breakingPr();
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string), {
      specs: 'api/openapi.yaml',
      'sarif-file': 'out/cg.sarif',
    });
    const outcome = await run(r, { today });
    expect(outcome).toMatchObject({ result: 'failed', exitCode: 1 });
    const log = r.log();
    expect(log).toContain('::error title=Breaking change · CG-REQ-003,file=api/openapi.yaml,line=');
    expect(log).toContain('::warning title=Potentially breaking change · CG-RES-003');
    expect(log).toContain('::error title=ContractGuard::ContractGuard found 1 breaking change(s)');
    expect(log).toMatch(/::stop-commands::([\w-]+)\n[\s\S]*::\1::/);
    const out = r.outputs();
    expect(out).toMatchObject({ result: 'failed', breaking: '1', 'potentially-breaking': '1', undetermined: '0' });
    expect(out['fingerprints']).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(readFileSync(out['report-json'] as string, 'utf8')) as unknown[]).toHaveLength(1);
    const summary = r.summary();
    expect(summary).toContain('Policy failed');
    expect(summary).toContain(`https://github.com/octo/api/blob/${'e'.repeat(40)}/api/openapi.yaml#L`);
    expect(summary).toContain(
      `npx @zainkhan-bit/contractguard check git:${(s.shas[0] as string).slice(0, 12)}:api/openapi.yaml api/openapi.yaml`,
    );
    const sarif = JSON.parse(readFileSync(join(s.workspace, 'out', 'cg.sarif'), 'utf8')) as {
      runs: { results: unknown[] }[];
    };
    expect(sarif.runs[0]?.results.length).toBeGreaterThan(0);
  });

  it('a compatible change passes', async () => {
    const s = sandbox([
      { 'openapi.yaml': SPEC() },
      { 'openapi.yaml': SPEC().replace('title: Pets', 'title: Pets API') },
    ]);
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string), { specs: 'openapi.yaml' });
    expect(await run(r, { today })).toMatchObject({ result: 'passed', exitCode: 0 });
    expect(r.outputs()['result']).toBe('passed');
    expect(r.log()).not.toContain('::error');
  });

  it('identical files take the fast path', async () => {
    const s = sandbox([{ 'openapi.yaml': SPEC() }, { 'openapi.yaml': SPEC(), 'README.md': 'docs only' }]);
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string), { specs: 'openapi.yaml' });
    expect((await run(r, { today })).result).toBe('passed');
    expect(r.log()).toContain('openapi: no API changes');
  });

  it('policy inputs override the defaults', async () => {
    const s = breakingPr();
    const lenient = fakeRunner(s.workspace, prEvent(s.shas[0] as string), {
      specs: 'api/openapi.yaml',
      'min-severity': 'critical',
    });
    expect((await run(lenient, { today })).result).toBe('passed');
    const strict = fakeRunner(s.workspace, prEvent(s.shas[0] as string), {
      specs: 'api/openapi.yaml',
      'fail-on': 'breaking,potentially-breaking',
      undetermined: 'fail',
      summary: 'false',
      annotations: 'false',
    });
    expect((await run(strict, { today })).result).toBe('failed');
    expect(strict.summary()).toBe('');
    expect(strict.log()).not.toContain('::warning title=Potentially');
  });

  it('invalid inputs fail with a clear message', async () => {
    const s = breakingPr();
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string), {
      specs: 'api/openapi.yaml',
      'fail-on': 'braking',
    });
    expect(await run(r, { today })).toMatchObject({ result: 'input-error', exitCode: 1 });
    expect(r.log()).toContain('Input "fail-on" must be one of');
    expect(r.outputs()['result']).toBe('input-error');
  });
});

describe('sticky comment', () => {
  it('creates the comment, and a re-run leaves it unchanged (idempotent)', async () => {
    const s = breakingPr();
    const gh = fakeGitHub();
    const inputs = { specs: 'api/openapi.yaml', comment: 'true', token: 't0ken' };
    const first = await run(fakeRunner(s.workspace, prEvent(s.shas[0] as string), inputs), { today, fetch: gh.fetch });
    expect(first.comment).toBe('created');
    expect(gh.comments[0]?.body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(gh.comments[0]?.body).toContain('CG-REQ-003');
    const again = await run(fakeRunner(s.workspace, prEvent(s.shas[0] as string), inputs), { today, fetch: gh.fetch });
    expect(again.comment).toBe('unchanged');
    expect(gh.comments).toHaveLength(1);
    expect(gh.calls.some((c) => c.url.includes('/issues/7/comments'))).toBe(true);
  });

  it('fork PRs skip the comment with a notice and still fail on breaking changes', async () => {
    const s = breakingPr();
    const gh = fakeGitHub();
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string, { headRepo: 'fork/api' }), {
      specs: 'api/openapi.yaml',
      comment: 'true',
      token: 't',
    });
    const outcome = await run(r, { today, fetch: gh.fetch });
    expect(outcome).toMatchObject({ result: 'failed', comment: 'skipped-readonly' });
    expect(gh.calls).toHaveLength(0);
    expect(r.log()).toContain('::notice title=ContractGuard::Pull requests from forks');
  });

  it('no token, or a non-PR event, means no comment', async () => {
    const s = breakingPr();
    const noToken = await run(
      fakeRunner(s.workspace, prEvent(s.shas[0] as string), { specs: 'api/openapi.yaml', comment: 'true' }),
      { today },
    );
    expect(noToken.comment).toBe('skipped-readonly');
    const push = fakeRunner(
      s.workspace,
      { name: 'push', payload: { before: s.shas[0] } },
      { specs: 'api/openapi.yaml', comment: 'true', token: 't' },
    );
    expect((await run(push, { today })).comment).toBeUndefined();
    expect(push.log()).toContain('has no effect outside pull_request');
  });

  it('a failing comment API never changes the result', async () => {
    const s = sandbox([{ 'openapi.yaml': SPEC() }, { 'openapi.yaml': SPEC(), 'CHANGELOG.md': 'x' }]);
    const down = (() => Promise.resolve(new Response('x', { status: 500 }))) as unknown as typeof fetch;
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string), {
      specs: 'openapi.yaml',
      comment: 'true',
      token: 't',
    });
    expect(await run(r, { today, fetch: down, sleep: () => Promise.resolve() })).toMatchObject({
      result: 'passed',
      exitCode: 0,
      comment: 'failed',
    });
    expect(r.log()).toContain('::warning title=ContractGuard::Could not write the PR comment');
  });
});

describe('push, dispatch and configuration', () => {
  it('push compares with the previous commit', async () => {
    const s = breakingPr();
    const r = fakeRunner(s.workspace, { name: 'push', payload: { before: s.shas[0] } }, { specs: 'api/openapi.yaml' });
    expect((await run(r, { today })).result).toBe('failed');
  });

  it('first push of a branch compares with HEAD^', async () => {
    const s = breakingPr();
    const r = fakeRunner(
      s.workspace,
      { name: 'push', payload: { before: '0'.repeat(40) } },
      { specs: 'api/openapi.yaml' },
    );
    expect((await run(r, { today })).result).toBe('failed');
    expect(r.log()).toContain('::warning title=ContractGuard::This push created the branch');
  });

  it('workflow_dispatch needs base-ref', async () => {
    const s = breakingPr();
    const missing = fakeRunner(s.workspace, { name: 'workflow_dispatch', payload: {} }, { specs: 'api/openapi.yaml' });
    expect((await run(missing, { today })).result).toBe('input-error');
    const given = fakeRunner(
      s.workspace,
      { name: 'workflow_dispatch', payload: {} },
      { specs: 'api/openapi.yaml', 'base-ref': s.shas[0] as string },
    );
    expect((await run(given, { today })).result).toBe('failed');
  });

  it('uses .contractguard.yaml with git:@base: specs and a working directory', async () => {
    const config = `version: 1
specs:
  - id: pets
    base: "git:@base:services/pets/openapi.yaml"
    candidate: services/pets/openapi.yaml
policy:
  failOn: [breaking, potentially-breaking]
`;
    const s = sandbox([
      {
        'services/pets/openapi.yaml': SPEC(),
        'services/.contractguard.yaml': config.replaceAll('services/pets', 'pets'),
      },
      { 'services/pets/openapi.yaml': SPEC({ tag: false }) },
    ]);
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string), { 'working-directory': 'services' });
    expect((await run(r, { today })).result).toBe('failed');
    expect(r.summary()).toContain('ContractGuard · `pets`');
    expect(r.log()).toContain('file=services/pets/openapi.yaml');
  });

  it('missing configuration and specs is an input error with guidance', async () => {
    const s = sandbox([{ 'openapi.yaml': SPEC() }]);
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string));
    expect((await run(r, { today })).result).toBe('input-error');
    expect(r.log()).toContain('No .contractguard.yaml found');
  });

  it('configuration errors are annotated on the config file', async () => {
    const s = sandbox([
      {
        'openapi.yaml': SPEC(),
        '.contractguard.yaml':
          'version: 1\nspecs:\n  - {id: a, base: "git:@base:openapi.yaml", candidate: openapi.yaml}\npolcy: {}\n',
      },
    ]);
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string));
    expect((await run(r, { today })).result).toBe('input-error');
    expect(r.log()).toContain('::error title=ContractGuard CGD-CONFIG-003,file=.contractguard.yaml,line=4');
    expect(r.log()).toContain('could not start');
  });

  it('a spec that is new in this change passes; a missing candidate is an input error', async () => {
    const s = sandbox([{ 'README.md': 'x' }, { 'openapi.yaml': SPEC() }]);
    const added = fakeRunner(s.workspace, prEvent(s.shas[0] as string), { specs: 'openapi.yaml' });
    expect((await run(added, { today })).result).toBe('passed');
    expect(added.log()).toContain('openapi: new specification, nothing to compare yet.');
    expect(added.summary()).toContain('none (new specification)');
    const missingConfig = fakeRunner(s.workspace, prEvent(s.shas[0] as string), { config: 'nope.yaml' });
    expect((await run(missingConfig, { today })).result).toBe('input-error');
    const missing = fakeRunner(s.workspace, prEvent(s.shas[0] as string), { specs: 'other.yaml' });
    expect((await run(missing, { today })).result).toBe('input-error');
    expect(missing.outputs()['result']).toBe('input-error');
    expect(missing.log()).toContain('could not load a specification');
  });

  it('an unavailable base commit explains how to fix the checkout', async () => {
    const s = breakingPr();
    const r = fakeRunner(s.workspace, prEvent('c'.repeat(40)), { specs: 'api/openapi.yaml' });
    expect((await run(r, { today })).result).toBe('input-error');
    expect(r.log()).toContain('fetch-depth: 0');
  });

  it('unexpected errors are reported as internal errors', async () => {
    const s = breakingPr();
    write(s.workspace, {});
    const r = fakeRunner(
      s.workspace,
      prEvent(s.shas[0] as string),
      { specs: 'api/openapi.yaml' },
      { GITHUB_STEP_SUMMARY: join(s.workspace, 'no', 'such', 'dir', 'summary') },
    );
    expect((await run(r, { today })).result).toBe('input-error');
    expect(r.log()).toContain('Internal error');
    expect(existsSync(join(s.workspace, 'no'))).toBe(false);
  });

  it('has a version', () => {
    expect(VERSION).toBe('0.0.0-dev');
  });
});

describe('minimal environments', () => {
  it('runs without the optional runner variables', async () => {
    const s = breakingPr();
    write(s.workspace, {
      'cg/config.yaml':
        'version: 1\nspecs:\n  - {id: pets, base: "git:@base:../api/openapi.yaml", candidate: ../api/openapi.yaml}\n',
    });
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string), {
      config: 'cg/config.yaml',
      'sarif-file': join(s.root, 'abs.sarif'),
    });
    const dropped = new Set([
      'GITHUB_REPOSITORY',
      'GITHUB_RUN_ID',
      'RUNNER_TEMP',
      'GITHUB_SERVER_URL',
      'GITHUB_API_URL',
    ]);
    const env = Object.fromEntries(Object.entries(r.env).filter(([k]) => !dropped.has(k)));
    const outcome = await run({ ...r, env }, { today });
    expect(outcome.result).toBe('failed');
    expect(existsSync(join(s.root, 'abs.sarif'))).toBe(true);
    expect(r.outputs()['report-json']).toBe(
      join(realpathSync.native(s.workspace), '.contractguard', 'contractguard', 'report.json'),
    );
    expect(r.summary()).toContain('https://github.com/octo/api/blob/'); // repository from the event payload
  });

  it('a fork PR on pull_request_target still never comments', async () => {
    const s = breakingPr();
    const e = prEvent(s.shas[0] as string, { headRepo: 'fork/api' });
    const r = fakeRunner(
      s.workspace,
      { name: 'pull_request_target', payload: e.payload },
      { specs: 'api/openapi.yaml', comment: 'true', token: 't' },
    );
    const outcome = await run(r, { today, fetch: fakeGitHub().fetch });
    expect(outcome.comment).toBe('skipped-readonly');
    expect(r.log()).toContain('pull_request_target runs with a privileged token');
  });
});

describe('paths', () => {
  it.skipIf(process.platform === 'win32')(
    'a workspace reached through a symlink still gets file annotations',
    async () => {
      const s = breakingPr();
      const link = join(s.root, 'ws-link');
      symlinkSync(s.workspace, link, 'dir');
      const r = fakeRunner(link, prEvent(s.shas[0] as string), { specs: 'api/openapi.yaml' });
      expect((await run(r, { today })).result).toBe('failed');
      expect(r.log()).toContain('file=api/openapi.yaml,line=');
      expect(r.summary()).toContain('/blob/');
      expect(r.summary()).not.toContain(s.root);
    },
  );

  it('CRLF line endings in the checkout still take the fast path', async () => {
    const s = sandbox([{ 'openapi.yaml': SPEC() }, { 'openapi.yaml': SPEC(), 'CHANGELOG.md': 'x' }]);
    write(s.workspace, { 'openapi.yaml': SPEC().replaceAll('\n', '\r\n') });
    const r = fakeRunner(s.workspace, prEvent(s.shas[0] as string), { specs: 'openapi.yaml' });
    expect((await run(r, { today })).result).toBe('passed');
    expect(r.log()).toContain('openapi: no API changes');
  });
});
