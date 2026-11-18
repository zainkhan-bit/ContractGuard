import { JsonNumber, type AnalysisResult } from '@zainkhan-bit/contractguard-core';
import { describe, expect, it } from 'vitest';
import { renderConsole, wrap } from '../src/console.js';
import { renderJson } from '../src/json.js';
import { GITHUB_SUMMARY_LIMIT, renderMarkdown } from '../src/markdown.js';
import { renderSarif } from '../src/sarif.js';
import { displayPath, locationLink, locationText, toJsonText, verdictText } from '../src/shared.js';
import { build, largeSpecs, one, SCENARIOS, SRC_ROOT } from './scenarios.js';

const bytes = (s: string): number => new TextEncoder().encode(s).length;
const opts = { groupBy: 'cause', deterministic: true, srcRoot: SRC_ROOT } as const;

describe('toJsonText', () => {
  it('sorts keys, serializes Map/Set/JsonNumber/bigint and drops undefined', () => {
    const v = {
      b: new Set(['z', 'a']),
      a: new Map([
        ['y', 1],
        ['x', undefined],
      ]),
      m: new Map([
        [2, 'two'],
        [1, 'one'],
      ]),
      n: JsonNumber.parse('1.50e2'),
      big: 10n,
      nan: Number.NaN,
      gone: undefined,
      fn: () => 1,
      arr: [undefined, null, true],
      empty: {},
      none: [],
    };
    expect(toJsonText(v, 0)).toBe(
      '{"a":{"y":1},"arr":[null,null,true],"b":["a","z"],"big":10,"empty":{},"m":[[1,"one"],[2,"two"]],"n":150,"nan":null,"none":[]}',
    );
    expect(toJsonText(undefined)).toBe('null');
    expect(toJsonText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
  });
});

describe('paths and links', () => {
  it('relativizes file URIs against POSIX and Windows roots', () => {
    expect(displayPath('file:///repo/api/openapi.yaml', 'file:///repo')).toBe('api/openapi.yaml');
    expect(displayPath('file:///repo/api/openapi.yaml', '/repo/')).toBe('api/openapi.yaml');
    expect(displayPath('file:///C:/work/repo/api%20v2/x.yaml', 'C:\\work\\repo')).toBe('api v2/x.yaml');
    expect(displayPath('file:///elsewhere/x.yaml', 'file:///repo')).toBe('/elsewhere/x.yaml');
    expect(displayPath('https://example.com/api.yaml', 'file:///repo')).toBe('https://example.com/api.yaml');
    expect(locationText(undefined)).toBe('');
    expect(locationText({ uri: 'file:///repo/a.yaml', pointer: '#' } as never, 'file:///repo')).toBe('a.yaml');
  });

  it('builds links only for file locations when linkBase is set', () => {
    const ref = {
      uri: 'file:///repo/a b/x.yaml',
      pointer: '#',
      range: { start: { line: 3, column: 1, offset: 0 }, end: { line: 3, column: 2, offset: 1 } },
    } as never;
    expect(locationLink(ref, { ...opts, linkBase: 'https://gh/blob/sha' })).toBe('https://gh/blob/sha/a%20b/x.yaml#L3');
    expect(locationLink(ref, opts)).toBeUndefined();
    expect(
      locationLink({ uri: 'https://x/y.yaml', pointer: '#' } as never, { ...opts, linkBase: 'https://gh/' }),
    ).toBeUndefined();
    expect(locationLink(undefined, { ...opts, linkBase: 'https://gh/' })).toBeUndefined();
  });
});

describe('renderers', () => {
  it('keeps the Markdown job summary under the 1 MiB cap, dropping low-priority sections first', async () => {
    const { base, candidate } = largeSpecs(1500);
    const r = await build({ name: 'large', base: one(base), candidate: one(candidate) });
    const full = renderMarkdown([r], { ...opts, maxBytes: Number.MAX_SAFE_INTEGER });
    expect(bytes(full)).toBeGreaterThan(GITHUB_SUMMARY_LIMIT);
    const capped = renderMarkdown([r], opts);
    expect(bytes(capped)).toBeLessThanOrEqual(GITHUB_SUMMARY_LIMIT);
    expect(capped).toContain('Omitted to fit GitHub');
    expect(capped).toContain('### ❌ Breaking');
    const tiny = renderMarkdown([r], { ...opts, maxBytes: 600 });
    expect(bytes(tiny)).toBeLessThanOrEqual(600);
    expect(tiny.endsWith('_…truncated._\n')).toBe(true);
    const limited = renderMarkdown([r], { ...opts, maxFindings: 2, maxBytes: Number.MAX_SAFE_INTEGER });
    expect(limited).toContain('more (see the JSON report)');
    const json = renderJson([r], opts);
    expect((JSON.parse(json) as AnalysisResult[])[0]?.findings.length).toBe(r.findings.length);
  }, 60_000);

  it('limits and wraps console output', async () => {
    const spec = SCENARIOS.find((s) => s.name === 'mixed-changes');
    const r = await build(spec as never);
    const text = renderConsole([r], { ...opts, color: false, width: 60, maxFindings: 1, verbose: true });
    expect(text).toContain('more breaking group(s)');
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(100);
    expect(wrap('a b c d e f', 6, '  ')).toBe('a b\n  c d\n  e f');
    expect(renderConsole([r], { ...opts, color: true, width: 20 })).toContain('\u001b[31m');
  });

  it('includes non-gating notes only with all, and keeps generatedAt unless deterministic', async () => {
    const spec = SCENARIOS.find((s) => s.name === 'mixed-changes');
    const r = { ...(await build(spec as never)), generatedAt: '2026-11-16T10:00:00.000Z' };
    expect(renderJson([r], { deterministic: false })).toContain('generatedAt');
    expect(renderJson([r], { deterministic: true })).not.toContain('generatedAt');
    const notes = (all: boolean): number =>
      (
        JSON.parse(renderSarif([r], { ...opts, all })) as { runs: { results: { level: string }[] }[] }
      ).runs[0]?.results.filter((x) => x.level === 'note').length ?? 0;
    expect(notes(false)).toBe(0);
    expect(notes(true)).toBeGreaterThan(0);
    const custom = JSON.parse(renderSarif([r], { ...opts, helpUriBase: 'https://docs/rules/' })) as {
      runs: { tool: { driver: { rules: { helpUri: string }[] } } }[];
    };
    expect(custom.runs[0]?.tool.driver.rules[0]?.helpUri).toMatch(/^https:\/\/docs\/rules\/CG-/);
  });

  it('states the verdict', async () => {
    const undetermined = await build(SCENARIOS.find((s) => s.name === 'undetermined') as never);
    expect(verdictText(undetermined)).toBe('Policy failed: 1 undetermined finding');
    const strict = await build(SCENARIOS.find((s) => s.name === 'mixed-strict-policy') as never);
    expect(verdictText(strict)).toBe('Policy failed: 3 breaking changes, 4 potentially breaking changes');
    expect(verdictText(await build(SCENARIOS.find((s) => s.name === 'identical') as never))).toBe('Policy passed');
  });
});
