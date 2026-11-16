import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, createBaseline, loadConfiguration, validateSource } from '../src/index.js';
import { repo, spec, tempDir, TODAY, write } from './helpers.js';

const BASE = 'version: 1\nspecs:\n  - {id: a, base: a.yaml, candidate: b.yaml}\n';

describe('configuration details', () => {
  it('resolves rule overrides, ignore entries, references and report settings', async () => {
    const d = repo([{ 'x.txt': '' }]);
    write(d, {
      'cfg/contractguard.yaml': `${BASE}rules:
  disable: [CG-API-001]
  overrides:
    CG-RES-003: {severity: high}
  ignore:
    - {fingerprint: 0123456789abcdef0123456789abcdef, reason: "accepted by the API council", expires: 2026-06-20}
    - {rule: CG-REQ-003, operation: "POST /pets", path: "$.age", reason: "accepted by the API council"}
references:
  root: ..
  allowedSchemes: [https]
  fetchTimeoutMs: 2000
  maxRemoteBytes: 1MB
analysis:
  limits: {maxDocumentBytes: 2MB, timeoutMs: 5000}
report:
  formats: [markdown]
  outputDir: out
  groupBy: operation
  deterministic: true
`,
    });
    const r = await loadConfiguration({ cwd: d, configPath: 'cfg/contractguard.yaml', today: TODAY });
    const c = r.value?.config;
    expect(c?.rules.disabled.has('CG-API-001' as never)).toBe(true);
    expect(c?.rules.overrides.get('CG-RES-003' as never)?.severity).toBe('high');
    expect(c?.rules.ignore).toHaveLength(2);
    expect(c?.references.root).toBe(d);
    expect(c?.report.outputDir).toBe(join(d, 'cfg', 'out'));
    expect(c?.analysis.limits.maxDocumentBytes).toBe(2 * 1024 * 1024);
    expect(r.diagnostics.map((x) => x.code)).toContain('CGD-CONFIG-113'); // expires within 30 days
  });

  it('flags non-overridable classifications, unknown rule options and unknown ignore rules', async () => {
    const d = tempDir();
    write(d, {
      '.contractguard.yaml': `${BASE}rules:
  overrides:
    CG-REQ-003: {classification: non-breaking, options: {nope: true}}
    CG-NOPE-001: {severity: low}
  ignore:
    - {rule: CG-ZZZ-001, reason: "accepted by the API council"}
`,
    });
    const r = await loadConfiguration({ cwd: d, today: TODAY });
    const codes = r.diagnostics.map((x) => x.code);
    expect(codes).toContain('CGD-CONFIG-011');
    expect(codes).toContain('CGD-CONFIG-010');
    expect(r.diagnostics.some((x) => x.message.includes('has no option'))).toBe(true);
  });

  it('reads JSON configuration and reports nested unknown keys without a suggestion', async () => {
    const d = tempDir();
    write(d, {
      '.contractguard.json': JSON.stringify({
        version: 1,
        specs: [{ id: 'a', base: 'a', candidate: 'b' }],
        report: { fromat: 'x' },
      }),
    });
    const r = await loadConfiguration({ cwd: d, today: TODAY });
    expect(r.diagnostics[0]?.message).toContain('report.fromat');
  });

  it('an unreadable configuration path is CONFIG-015', async () => {
    const d = tempDir();
    write(d, { 'dir/.keep': '' });
    const r = await loadConfiguration({ cwd: d, configPath: 'dir', today: TODAY });
    expect(r.diagnostics[0]?.code).toBe('CGD-CONFIG-015');
  });

  it('size and number limits are validated', async () => {
    const d = tempDir();
    write(d, { '.contractguard.yaml': `${BASE}analysis:\n  limits: {maxDocumentBytes: 10TB}\n` });
    expect((await loadConfiguration({ cwd: d, today: TODAY })).value).toBeUndefined();
  });
});

describe('use cases', () => {
  it('validateSource reports bad specifiers, missing stdin and missing files', async () => {
    const d = tempDir();
    expect((await validateSource('git:-x:a.yaml', { cwd: d })).diagnostics[0]?.category).toBe('configuration');
    expect((await validateSource('-', { cwd: d })).diagnostics[0]?.code).toBe('CGD-FS-001');
    expect((await validateSource('nope.yaml', { cwd: d })).contract).toBeUndefined();
    expect((await validateSource('snapshot:nope.json', { cwd: d })).contract).toBeUndefined();
  });

  it('validateSource honours the config, a signal and a disabled validator', async () => {
    const d = tempDir();
    write(d, { 'bad.yaml': 'openapi: 3.1.0\ninfo: {title: t}\npaths: {}\n' });
    const loaded = await loadConfiguration({
      cwd: d,
      configPath: false,
      adHoc: { base: 'bad.yaml', candidate: 'bad.yaml' },
      today: TODAY,
    });
    const v = await validateSource('bad.yaml', {
      cwd: d,
      validator: false,
      signal: new AbortController().signal,
      ...(loaded.value === undefined ? {} : { loaded: loaded.value }),
    });
    expect(v.contract).toBeDefined();
  });

  it('createBaseline errors: bad specifier, missing stdin, invalid spec', async () => {
    const d = tempDir();
    write(d, { 'bad.yaml': 'openapi: 3.1.0\npaths: {}\n' });
    expect((await createBaseline('git:-x:a.yaml', { cwd: d, toolVersion: '1' })).value).toBeUndefined();
    expect((await createBaseline('-', { cwd: d, toolVersion: '1' })).value).toBeUndefined();
    expect((await createBaseline('bad.yaml', { cwd: d, toolVersion: '1' })).value).toBeUndefined();
    const fromStdin = await createBaseline('-', { cwd: d, toolVersion: '1', stdinText: spec(), validator: false });
    expect(fromStdin.value?.documents).toHaveLength(1);
  });

  it('analyze reports configuration errors and unloadable candidates', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    write(d, { '.contractguard.yaml': 'version: 1\nspecs: []\n' });
    expect((await analyze({ cwd: d, today: TODAY, toolVersion: '1' })).value).toBeUndefined();
    const r = await analyze({
      cwd: d,
      configPath: false,
      today: TODAY,
      toolVersion: '1',
      adHoc: { base: 'openapi.yaml', candidate: '-' },
    });
    expect(r.value?.outcome).toBe('input-error');
    const inc = await analyze({
      cwd: d,
      configPath: false,
      today: TODAY,
      toolVersion: '1',
      adHoc: { base: 'git:HEAD:openapi.yaml', candidate: 'openapi.yaml' },
      validator: false,
    });
    expect(inc.value?.outcome).toBe('passed');
  });

  it('include filters keep only matching operations; extension excludes drop flagged ones', async () => {
    const d = repo([{ 'openapi.yaml': spec() }]);
    write(d, {
      'openapi.yaml': spec({ requiredAge: true, tag: false }).replace(
        '    post:\n',
        '    post:\n      x-internal: true\n',
      ),
      '.contractguard.yaml': `version: 1
specs:
  - {id: p, base: "git:HEAD:openapi.yaml", candidate: openapi.yaml}
filters:
  include: ["*:/pets/**", "POST:/pets"]
  excludeExtensions: [x-internal]
`,
    });
    const r = await analyze({ cwd: d, today: TODAY, toolVersion: '1' });
    const ids = r.value?.results[0]?.findings.map((f) => f.ruleId) ?? [];
    expect(ids).toEqual(['CG-RES-003']);
  });
});
