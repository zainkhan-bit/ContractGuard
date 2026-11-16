import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adHocSpecId,
  configJsonSchema,
  didYouMean,
  discoverConfig,
  editDistance,
  loadConfiguration,
  parseSize,
} from '../src/index.js';
import { repo, tempDir, TODAY, write } from './helpers.js';

const SCHEMA_FILE = new URL('../schemas/config.v1.json', import.meta.url);

describe('config JSON Schema', () => {
  it('schemas/config.v1.json is up to date (UPDATE_GOLDEN=1 regenerates it)', () => {
    const text = `${JSON.stringify(configJsonSchema(), null, 2)}\n`;
    if (process.env['UPDATE_GOLDEN'] === '1') writeFileSync(SCHEMA_FILE, text);
    expect(readFileSync(SCHEMA_FILE, 'utf8').replaceAll('\r\n', '\n')).toBe(text);
  });

  it('has a stable $id and draft 2020-12', () => {
    const s = configJsonSchema();
    expect(s['$id']).toBe('https://contractguard.dev/schemas/config.v1.json');
    expect(s['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
  });
});

describe('helpers', () => {
  it('parseSize', () => {
    expect(parseSize(1024)).toBe(1024);
    expect(parseSize('5MiB')).toBe(5 * 1024 * 1024);
    expect(parseSize('512 KiB')).toBe(512 * 1024);
    expect(parseSize('lots')).toBeUndefined();
  });
  it('didYouMean / editDistance', () => {
    expect(editDistance('polcy', 'policy')).toBe(1);
    expect(didYouMean('polcy', ['policy', 'specs'])).toBe('policy');
    expect(didYouMean('zzzzzz', ['policy', 'specs'])).toBeUndefined();
  });
  it('adHocSpecId derives a readable id', () => {
    expect(adHocSpecId('api/openapi.yaml')).toMatch(/^[a-z0-9-]+$/);
  });
});

async function load(
  dir: string,
  yaml: string,
  extra: Partial<Parameters<typeof loadConfiguration>[0]> = {},
): ReturnType<typeof loadConfiguration> {
  write(dir, { '.contractguard.yaml': yaml });
  return loadConfiguration({ cwd: dir, today: TODAY, ...extra });
}

const codes = (r: { diagnostics: readonly { code: string }[] }): string[] => r.diagnostics.map((d) => d.code);

describe('loadConfiguration — errors', () => {
  it('unknown key → CONFIG-003 with did-you-mean and line:column', async () => {
    const r = await load(
      tempDir(),
      'version: 1\nspecs:\n  - {id: a, base: a.yaml, candidate: b.yaml}\npolcy:\n  failOn: [breaking]\n',
    );
    expect(r.value).toBeUndefined();
    const d = r.diagnostics.find((x) => x.code === 'CGD-CONFIG-003');
    expect(`${d?.message ?? ''} ${d?.hint ?? ''}`).toContain('"policy"');
    expect(d?.location?.range?.start.line).toBe(4);
  });

  it('wrong version → CONFIG-001', async () => {
    const r = await load(tempDir(), 'version: 2\nspecs: []\n');
    expect(codes(r)).toContain('CGD-CONFIG-001');
  });

  it('wrong type → CONFIG-002', async () => {
    const r = await load(
      tempDir(),
      'version: 1\nspecs:\n  - {id: a, base: a.yaml, candidate: b.yaml}\npolicy:\n  failOn: breaking\n',
    );
    expect(codes(r)).toContain('CGD-CONFIG-002');
  });

  it('duplicate spec ids', async () => {
    const r = await load(
      tempDir(),
      'version: 1\nspecs:\n  - {id: a, base: a.yaml, candidate: b.yaml}\n  - {id: a, base: c.yaml, candidate: d.yaml}\n',
    );
    expect(r.diagnostics.some((d) => d.message.includes('Duplicate spec id'))).toBe(true);
  });

  it('unknown rule id → CONFIG-010 with suggestion', async () => {
    const r = await load(
      tempDir(),
      'version: 1\nspecs:\n  - {id: a, base: a.yaml, candidate: b.yaml}\nrules:\n  disable: [CG-REQ-999]\n',
    );
    expect(codes(r)).toContain('CGD-CONFIG-010');
  });

  it('expired ignore entries warn (CONFIG-112)', async () => {
    const r = await load(
      tempDir(),
      'version: 1\nspecs:\n  - {id: a, base: a.yaml, candidate: b.yaml}\nrules:\n  ignore:\n    - {rule: CG-REQ-001, reason: "known gap, tracked in JIRA-1", expires: 2026-01-01}\n',
    );
    expect(r.value).toBeDefined();
    expect(codes(r)).toContain('CGD-CONFIG-112');
  });

  it('missing explicit file → CONFIG-014', async () => {
    const r = await loadConfiguration({ cwd: tempDir(), configPath: 'nope.yaml', today: TODAY });
    expect(codes(r)).toEqual(['CGD-CONFIG-014']);
  });

  it('no file and no ad-hoc specs → CONFIG-014', async () => {
    const r = await loadConfiguration({ cwd: tempDir(), configPath: false, today: TODAY });
    expect(codes(r)).toContain('CGD-CONFIG-014');
  });

  it('syntax error → CONFIG-015', async () => {
    const r = await load(tempDir(), 'version: 1\nspecs: [\n');
    expect(codes(r)).toContain('CGD-CONFIG-015');
  });

  it('unknown --spec id is suggested', async () => {
    const r = await load(tempDir(), 'version: 1\nspecs:\n  - {id: public, base: a.yaml, candidate: b.yaml}\n', {
      specIds: ['publc'],
    });
    expect(r.diagnostics[0]?.hint).toContain('public');
  });
});

describe('loadConfiguration — discovery, defaults and overrides', () => {
  it('discovers the file from a nested directory, stopping at the git root', async () => {
    const d = repo([
      {
        '.contractguard.yaml': 'version: 1\nspecs:\n  - {id: a, base: a.yaml, candidate: b.yaml}\n',
        'sub/deep/x.txt': '',
      },
    ]);
    expect(await discoverConfig(join(d, 'sub', 'deep'), d)).toBe(join(d, '.contractguard.yaml'));
    const r = await loadConfiguration({ cwd: join(d, 'sub', 'deep'), today: TODAY });
    expect(r.value?.baseDir).toBe(d);
    expect(r.value?.gitRoot).toBe(d);
  });

  it('ad-hoc comparison works without a file and applies CLI overrides', async () => {
    const r = await loadConfiguration({
      cwd: tempDir(),
      configPath: false,
      adHoc: { base: 'a.yaml', candidate: 'b.yaml' },
      overrides: {
        failOn: ['breaking', 'potentially-breaking'],
        minSeverity: 'high',
        deterministic: true,
        formats: ['json'],
      },
      today: TODAY,
    });
    expect(r.value?.config.specs).toHaveLength(1);
    expect(r.value?.config.policy.failOn).toEqual(['breaking', 'potentially-breaking']);
    expect(r.value?.config.policy.minSeverity).toBe('high');
    expect(r.value?.config.report.formats).toEqual(['json']);
  });

  it('CI defaults write JSON reports', async () => {
    const r = await loadConfiguration({
      cwd: tempDir(),
      configPath: false,
      adHoc: { base: 'a', candidate: 'b' },
      trust: { ci: true, allowRemoteReferences: false },
      today: TODAY,
    });
    expect(r.value?.config.report.formats).toEqual(['console', 'json']);
  });

  it('unknown perspective is a configuration error', async () => {
    const r = await loadConfiguration({
      cwd: tempDir(),
      configPath: false,
      adHoc: { base: 'a', candidate: 'b' },
      overrides: { perspective: 'consumer' },
      today: TODAY,
    });
    expect(r.value).toBeUndefined();
  });
});

describe('T8 trust boundary', () => {
  const yaml =
    'version: 1\nspecs:\n  - {id: a, base: a.yaml, candidate: b.yaml}\nreferences:\n  allowRemote: true\n  allowedHosts: [example.com]\n';

  it('allowRemote from a committed file is ignored in CI without the flag', async () => {
    const r = await load(tempDir(), yaml, { trust: { ci: true, allowRemoteReferences: false } });
    expect(r.value?.config.references.allowRemote).toBe(false);
    expect(r.value?.config.references.allowedHosts).toEqual([]);
    expect(r.diagnostics.some((d) => d.message.includes('--allow-remote-references'))).toBe(true);
  });

  it('is honoured in CI with --allow-remote-references, and locally', async () => {
    const ci = await load(tempDir(), yaml, { trust: { ci: true, allowRemoteReferences: true } });
    expect(ci.value?.config.references.allowRemote).toBe(true);
    const local = await load(tempDir(), yaml);
    expect(local.value?.config.references.allowedHosts).toEqual(['example.com']);
  });

  it('a references.root outside the repository is clamped to the repository in CI', async () => {
    const d = repo([{ 'x.txt': '' }]);
    const r = await load(
      d,
      'version: 1\nspecs:\n  - {id: a, base: a.yaml, candidate: b.yaml}\nreferences:\n  root: ../..\n',
      {
        trust: { ci: true, allowRemoteReferences: false },
      },
    );
    expect(r.value?.config.references.root).toBe(d);
  });
});
