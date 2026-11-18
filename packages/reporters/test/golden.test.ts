import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from '@zainkhan-bit/contractguard-engine';
import type { AnalysisResult } from '@zainkhan-bit/contractguard-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderConsole } from '../src/console.js';
import { renderJson } from '../src/json.js';
import { renderMarkdown } from '../src/markdown.js';
import { renderSarif } from '../src/sarif.js';
import { build, SCENARIOS, SRC_ROOT } from './scenarios.js';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, 'golden');
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

/** Compares against a golden file (LF-normalized so Windows checkouts agree); UPDATE_GOLDEN=1 rewrites it. */
function golden(name: string, actual: string): void {
  const file = join(GOLDEN, name);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
}

type Validate = (uri: string, instance: unknown, mode: 'BASIC') => Promise<{ valid: boolean; errors?: unknown[] }>;
let validateReport: (doc: unknown) => Promise<{ valid: boolean; errors?: unknown[] }>;
let validateSarif: (doc: unknown) => Promise<{ valid: boolean; errors?: unknown[] }>;

beforeAll(async () => {
  const d2020 = (await import('@hyperjump/json-schema/draft-2020-12')) as unknown as {
    registerSchema: (schema: unknown, uri?: string) => void;
    validate: Validate;
  };
  const d04 = (await import('@hyperjump/json-schema/draft-04')) as unknown as {
    registerSchema: (schema: unknown, uri?: string) => void;
    validate: Validate;
  };
  const report = JSON.parse(readFileSync(join(here, '..', 'schemas', 'report.v1.json'), 'utf8')) as { $id: string };
  d2020.registerSchema(report);
  validateReport = (doc) => d2020.validate(report.$id, doc, 'BASIC');
  const sarif = JSON.parse(readFileSync(join(here, 'schemas', 'sarif-schema-2.1.0.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const sarifId = 'https://contractguard.test/sarif-schema-2.1.0.json';
  delete sarif['id'];
  d04.registerSchema({ ...sarif, id: sarifId }, sarifId);
  validateSarif = (doc) => d04.validate(sarifId, doc, 'BASIC');
}, 60_000);

const results = new Map<string, AnalysisResult>();
async function result(name: string): Promise<AnalysisResult> {
  let r = results.get(name);
  if (r === undefined) {
    const spec = SCENARIOS.find((s) => s.name === name);
    if (spec === undefined) throw new Error(name);
    r = await build(spec);
    results.set(name, r);
  }
  return r;
}

describe('golden reports', () => {
  it.each(SCENARIOS.map((s) => [s.name]))('%s', async (name) => {
    const r = await result(name);
    const groupBy = name === 'group-by-operation' ? 'operation' : 'cause';
    const base = { groupBy, deterministic: true, srcRoot: SRC_ROOT } as const;

    const json = renderJson([r], base);
    golden(`${name}.json`, json);
    const parsed: unknown = JSON.parse(json);
    const v = await validateReport(parsed);
    expect(v.valid, JSON.stringify(v.errors ?? null).slice(0, 2000)).toBe(true);

    golden(`${name}.md`, renderMarkdown([r], { ...base, linkBase: 'https://github.com/acme/api/blob/abc123/' }));
    golden(`${name}.txt`, renderConsole([r], { ...base, color: false, width: 100 }));

    const sarif = renderSarif([r], { ...base, rules: RULES, all: name === 'equivalent-included' });
    golden(`${name}.sarif`, sarif);
    const sv = await validateSarif(JSON.parse(sarif));
    expect(sv.valid, JSON.stringify(sv.errors ?? null).slice(0, 2000)).toBe(true);
  });

  it('renders several specs into one report and a coloured console', async () => {
    const rs = [await result('mixed-changes'), await result('servers')];
    const base = { groupBy: 'cause', deterministic: true, srcRoot: SRC_ROOT } as const;
    golden('multi-spec.md', renderMarkdown(rs, base));
    golden('multi-spec.txt', renderConsole(rs, { ...base, color: true, width: 80 }));
    const json = renderJson(rs, base);
    expect((await validateReport(JSON.parse(json))).valid).toBe(true);
    const sarif = JSON.parse(renderSarif(rs, { ...base, srcRoot: SRC_ROOT })) as {
      runs: { automationDetails: { id: string } }[];
    };
    expect(sarif.runs.map((x) => x.automationDetails.id)).toEqual([
      'contractguard/mixed-changes/',
      'contractguard/servers/',
    ]);
    expect((await validateSarif(sarif)).valid).toBe(true);
  });
});
