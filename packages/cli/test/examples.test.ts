import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT, run, type CliIo } from '../src/index.js';

const EXAMPLES = fileURLToPath(new URL('../../../examples/', import.meta.url));
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function cli(args: readonly string[], cwd: string): Promise<{ code: number; out: string }> {
  let out = '';
  const io: CliIo = {
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: () => undefined },
    env: {},
    cwd,
    today: '2026-06-01',
    readStdin: () => Promise.resolve(''),
  };
  return { code: await run(args, io), out };
}

interface Report {
  readonly specId: string;
  readonly findings: readonly { readonly ruleId: string; readonly classification: string; readonly status: string }[];
}

const unique = (r: Report): string[] => [...new Set(r.findings.map((f) => `${f.ruleId}/${f.classification}`))];

describe('examples/breaking-changes (documented results)', () => {
  const dir = join(EXAMPLES, 'breaking-changes');
  const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8')) as Record<
    string,
    { exit: number; findings: string[] }
  >;

  it.each(Object.entries(cases))('%s', async (name, expected) => {
    const r = await cli(
      ['check', 'base.yaml', `${name}/candidate.yaml`, '--no-config', '--stdout', 'json', '-q', '-f', 'json'],
      dir,
    );
    const report = (JSON.parse(r.out) as Report[])[0] as Report;
    expect(unique(report).sort()).toEqual([...expected.findings].sort());
    expect(r.code).toBe(expected.exit);
  });
});

describe('examples/monorepo', () => {
  it('checks three services with split specs, filters and an accepted change', async () => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), 'cg-mono-')));
    dirs.push(d);
    cpSync(join(EXAMPLES, 'monorepo'), d, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e', '-c', 'commit.gpgsign=false', ...args], {
        cwd: d,
      });
    };
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    const edit = (rel: string, from: string, to: string): void => {
      const p = join(d, rel);
      const text = readFileSync(p, 'utf8');
      expect(text).toContain(from);
      writeFileSync(p, text.replace(from, to));
    };
    // users: a required property removed from the split schema file → breaking
    edit('services/users/schemas/user.yaml', 'required: [id, name]', 'required: [id]');
    edit('services/users/schemas/user.yaml', '  name: { type: string }\n', '');
    // users: an internal endpoint removed → excluded by filter
    edit(
      'services/users/openapi.yaml',
      "  /internal/users/reindex:\n    post:\n      responses:\n        '202': { description: Accepted. }\n",
      '',
    );
    // billing: a new invoice state → potentially breaking, accepted in rules.ignore
    edit('services/billing/openapi.yaml', 'enum: [draft, open, paid]', 'enum: [draft, open, paid, void]');
    // catalog: the experimental endpoint removed → excluded by tag
    edit(
      'services/catalog/openapi.yaml',
      "  /products/beta-search:\n    get:\n      tags: [experimental]\n      responses:\n        '200': { description: Results. }\n",
      '',
    );

    const r = await cli(['check', '--base-ref', 'main', '--stdout', 'json', '-q', '-f', 'json'], d);
    expect(r.code).toBe(EXIT.policyFailed);
    const reports = JSON.parse(r.out) as Report[];
    expect(reports.map((x) => x.specId)).toEqual(['users', 'billing', 'catalog']);
    const [users, billing, catalog] = reports as [Report, Report, Report];
    expect(unique(users)).toEqual(['CG-RES-001/breaking']);
    expect(billing.findings.map((f) => `${f.ruleId}:${f.status}`)).toEqual(['CG-RES-006:suppressed']);
    expect(catalog.findings).toEqual([]);
  });
});
