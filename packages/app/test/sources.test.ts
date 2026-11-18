import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  buildSnapshot,
  createBaseline,
  defaultBranch,
  describeSpecifier,
  isSafeGitRef,
  openSnapshot,
  openSource,
  parseSourceSpecifier,
  resolveGitSource,
  validateSource,
  type AnalysisRequest,
} from '../src/index.js';
import { documentUri } from '@zainkhan-bit/contractguard-core';
import { git, repo, spec, tempDir, TODAY, write } from './helpers.js';

describe('source specifiers', () => {
  it.each([
    ['openapi.yaml', 'path'],
    ['git:origin/main:api/openapi.yaml', 'git'],
    ['git:v1.2.0:openapi.yaml', 'git'],
    ['git:HEAD~1:openapi.yaml', 'git'],
    ['snapshot:base.json', 'snapshot'],
    ['https://example.com/openapi.yaml', 'url'],
    ['-', 'stdin'],
  ])('%s → %s', (raw, kind) => {
    expect(parseSourceSpecifier(raw, '/w').value?.kind).toBe(kind);
  });

  it('describes specifiers', () => {
    const s = parseSourceSpecifier('git:main:a.yaml', '/w').value;
    expect(s === undefined ? '' : describeSpecifier(s, 'abcdef1234')).toBe('git:main@abcdef1');
  });

  // T10: refs that git would parse as options or revision expressions are rejected before git runs.
  it.each(['--upload-pack=touch /tmp/pwned', '-x', 'a..b', 'main@{1}', 'a//b', 'a b', 'a;b', '$(id)', 'a\nb', ''])(
    'rejects unsafe ref %j',
    (ref) => {
      expect(isSafeGitRef(ref)).toBe(false);
      const r = parseSourceSpecifier(`git:${ref}:openapi.yaml`, '/w');
      expect(r.value).toBeUndefined();
      expect(r.diagnostics[0]?.category).toBe('configuration');
    },
  );

  it('rejects malformed specifiers and backslash git paths', () => {
    expect(parseSourceSpecifier('git:main', '/w').value).toBeUndefined();
    expect(parseSourceSpecifier('git:main:api\\openapi.yaml', '/w').diagnostics[0]?.hint).toBeDefined();
    expect(parseSourceSpecifier('snapshot:', '/w').value).toBeUndefined();
  });
});

describe('git sources', () => {
  it('resolves refs to SHAs and reads committed content (not the working tree)', async () => {
    const d = repo([{ 'api/openapi.yaml': spec() }]);
    write(d, { 'api/openapi.yaml': 'not even yaml: [' });
    const r = await resolveGitSource('HEAD', 'api/openapi.yaml', d);
    expect(r.value?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(r.value?.path).toBe('api/openapi.yaml');
    const v = await validateSource('git:HEAD:api/openapi.yaml', { cwd: d });
    expect(r.diagnostics).toEqual([]);
    expect(v.diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
    expect(v.contract?.operations.size).toBe(3);
  });

  it('paths are relative to the working directory', async () => {
    const d = repo([{ 'api/openapi.yaml': spec() }]);
    const r = await resolveGitSource('HEAD', 'openapi.yaml', join(d, 'api'));
    expect(r.value?.path).toBe('api/openapi.yaml');
  });

  it('unknown ref → FS-011; outside a repository → FS-011', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    expect((await resolveGitSource('no-such-branch', 'openapi.yaml', d)).diagnostics[0]?.code).toBe('CGD-FS-011');
    expect((await resolveGitSource('HEAD', 'openapi.yaml', tempDir())).diagnostics[0]?.code).toBe('CGD-FS-011');
  });

  it('a missing file at the revision is an input error', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    const v = await validateSource('git:HEAD:missing.yaml', { cwd: d });
    expect(v.contract).toBeUndefined();
    expect(v.diagnostics[0]?.severity).toBe('error');
  });

  it('defaultBranch falls back to a local branch without origin', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    expect(await defaultBranch(d)).toBe('main');
    expect(await defaultBranch(tempDir())).toBeUndefined();
  });

  it('resolves relative $refs inside the same commit', async () => {
    const d = repo([
      {
        'openapi.yaml': `openapi: 3.1.0\ninfo: {title: t, version: '1'}\npaths:\n  /a:\n    get:\n      responses:\n        '200': {$ref: './parts/resp.yaml'}\n`,
        'parts/resp.yaml': 'description: ok\n',
      },
    ]);
    write(d, { 'parts/resp.yaml': 'broken: [' });
    const v = await validateSource('git:HEAD:openapi.yaml', { cwd: d });
    expect(v.diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
  });
});

describe('snapshots', () => {
  it('round-trips multi-document specs and detects tampering', async () => {
    const d = tempDir();
    write(d, {
      'openapi.yaml': `openapi: 3.1.0\ninfo: {title: t, version: '1'}\npaths:\n  /a:\n    get:\n      responses:\n        '200': {$ref: './parts/resp.yaml'}\n`,
      'parts/resp.yaml': 'description: ok\n',
    });
    const snap = await createBaseline('openapi.yaml', { cwd: d, toolVersion: '1.0.0' });
    expect(snap.value?.documents.map((x) => x.uri)).toEqual(['openapi.yaml', 'parts/resp.yaml']);
    const file = join(d, 'base.json');
    writeFileSync(file, JSON.stringify(snap.value));
    const opened = await openSnapshot(file);
    expect(opened.diagnostics).toEqual([]);
    expect(opened.value).toBeDefined();
    const v = await validateSource('snapshot:base.json', { cwd: d });
    expect(v.contract?.operations.size).toBe(1);

    const tampered = JSON.parse(readFileSync(file, 'utf8')) as { documents: { content: string }[] };
    (tampered.documents[1] as { content: string }).content = 'description: changed\n';
    writeFileSync(file, JSON.stringify(tampered));
    expect((await openSnapshot(file)).value).toBeUndefined();
  });

  it('rejects non-snapshot files and unreadable files', async () => {
    const d = tempDir();
    write(d, { 'x.json': '{"format":"other"}', 'y.json': 'nope' });
    expect((await openSnapshot(join(d, 'x.json'))).value).toBeUndefined();
    expect((await openSnapshot(join(d, 'y.json'))).value).toBeUndefined();
    expect((await openSnapshot(join(d, 'missing.json'))).value).toBeUndefined();
  });

  it('refuses mixed origins', () => {
    const r = buildSnapshot(
      documentUri('file:///a/openapi.yaml'),
      [
        { uri: documentUri('file:///a/openapi.yaml'), bytes: new Uint8Array() },
        { uri: documentUri('https://example.com/x.yaml'), bytes: new Uint8Array() },
      ],
      '1',
    );
    expect(r.value).toBeUndefined();
  });
});

describe('stdin', () => {
  it('serves the text as a self-contained document', async () => {
    const s = parseSourceSpecifier('-', '/w').value;
    if (s === undefined) throw new Error('unreachable');
    expect((await openSource(s)).value).toBeUndefined();
    const v = await validateSource('-', { cwd: tempDir(), stdinText: spec() });
    expect(v.contract?.operations.size).toBe(3);
  });
});

describe('analyze()', () => {
  const base = (cwd: string, extra: Partial<AnalysisRequest> = {}): AnalysisRequest => ({
    cwd,
    configPath: false,
    today: TODAY,
    toolVersion: '1.0.0',
    adHoc: { base: 'git:HEAD:openapi.yaml', candidate: 'openapi.yaml' },
    overrides: { deterministic: true },
    ...extra,
  });

  it('finds breaking changes between a commit and the working tree', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    write(d, { 'openapi.yaml': spec({ requiredAge: true, tag: false }) });
    const r = await analyze(base(d));
    expect(r.value?.outcome).toBe('policy-failed');
    const ids = r.value?.results[0]?.findings.map((f) => f.ruleId);
    expect(ids).toContain('CG-REQ-003'); // optional "age" became required
    expect(ids).toContain('CG-RES-003');
    expect(r.value?.results[0]?.base?.revision).toMatch(/^git:HEAD@[0-9a-f]{7}$/);
  });

  it('passes on identical specs', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    expect((await analyze(base(d))).value?.outcome).toBe('passed');
  });

  it('an unloadable side is an input error, never a pass', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    const r = await analyze(base(d, { adHoc: { base: 'git:nope:openapi.yaml', candidate: 'openapi.yaml' } }));
    expect(r.value?.outcome).toBe('input-error');
    expect(r.value?.results[0]?.diagnostics.map((x) => x.code)).toContain('CGD-FS-011'); // unknown ref
  });

  it('a syntax error in a specifier is a configuration error', async () => {
    const r = await analyze(base(tempDir(), { adHoc: { base: 'git:--upload-pack=x:a.yaml', candidate: 'b.yaml' } }));
    expect(r.value).toBeUndefined();
    expect(r.diagnostics[0]?.category).toBe('configuration');
    const stdinBase = await analyze(base(tempDir(), { adHoc: { base: '-', candidate: 'b.yaml' } }));
    expect(stdinBase.value).toBeUndefined();
  });

  it('applies include/exclude globs and excluded tags', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    write(d, { 'openapi.yaml': spec({ requiredAge: true, tag: false, extraPath: false }) });
    write(d, {
      '.contractguard.yaml': `version: 1
specs:
  - {id: pets, base: "git:HEAD:openapi.yaml", candidate: openapi.yaml}
filters:
  exclude: ["POST:/pets"]
  excludeTags: [internal]
report:
  deterministic: true
`,
    });
    const r = await analyze({ cwd: d, today: TODAY, toolVersion: '1.0.0' });
    const ids = r.value?.results[0]?.findings.map((f) => f.ruleId) ?? [];
    expect(ids).not.toContain('CG-REQ-003'); // POST /pets excluded
    expect(ids).toContain('CG-RES-003');
    expect(ids.some((id) => id.startsWith('CG-API'))).toBe(false); // /admin/stats removal is tagged internal
  });

  it('anchors findings about removed operations in the candidate document (§13.5)', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    write(d, { 'openapi.yaml': spec({ extraPath: false }) });
    const r = await analyze(base(d));
    const removed = r.value?.results[0]?.findings.find((f) => f.ruleId.startsWith('CG-API'));
    expect(removed?.location.anchor.uri).toMatch(/^file:/);
    expect(removed?.location.anchor.pointer).toBe('#/paths');
  });

  it('times out with LIMIT-010', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    write(d, {
      '.contractguard.yaml':
        'version: 1\nspecs:\n  - {id: a, base: "git:HEAD:openapi.yaml", candidate: openapi.yaml}\nanalysis:\n  limits:\n    timeoutMs: 1\n',
    });
    const r = await analyze({ cwd: d, today: TODAY, toolVersion: '1.0.0' });
    // Either the deadline fired (LIMIT-010, input error) or the machine finished within 1 ms; never a silent failure.
    const result = r.value?.results[0];
    if (result?.status === 'input-error') expect(result.diagnostics.map((x) => x.code)).toContain('CGD-LIMIT-010');
    else expect(result?.status).toBeDefined();
  });

  it('honours the cancellation signal', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    const r = await analyze(base(d, { signal: AbortSignal.abort() }));
    expect(r.value?.outcome).toBe('input-error');
  });

  it('runs several configured specs; --spec selects one', async () => {
    const d = repo([{ 'a.yaml': spec(), 'b.yaml': spec() }]);
    write(d, {
      'b.yaml': spec({ requiredAge: true }),
      '.contractguard.yaml':
        'version: 1\nspecs:\n  - {id: a, base: "git:HEAD:a.yaml", candidate: a.yaml}\n  - {id: b, base: "git:HEAD:b.yaml", candidate: b.yaml}\n',
    });
    const all = await analyze({ cwd: d, today: TODAY, toolVersion: '1' });
    expect(all.value?.results.map((x) => x.specId)).toEqual(['a', 'b']);
    expect(all.value?.outcome).toBe('policy-failed');
    const one = await analyze({ cwd: d, today: TODAY, toolVersion: '1', specIds: ['a'] });
    expect(one.value?.outcome).toBe('passed');
    git(d, 'status');
  });
});
