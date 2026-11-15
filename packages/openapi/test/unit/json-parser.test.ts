import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, parsePointer, stringifyCanonical, type JsonPointer } from '@contractguard/core';
import { parseJson } from '../../src/parse/json-parser.js';
import { codes, parseText } from '../helpers.js';

const ptr = (s: string): JsonPointer => parsePointer(s) as JsonPointer;

describe('parseJson (fast path)', () => {
  it('parses all JSON value kinds and escapes', () => {
    const r = parseJson(
      '{"s":"a\\"b\\\\c\\/d\\b\\f\\n\\r\\t\\u00e9\\ud83d\\ude00","n":-1.5e+2,"t":true,"f":false,"z":null,"a":[],"o":{}}',
      256,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(stringifyCanonical(r.value)).toBe(
      '{"a":[],"f":false,"n":-150,"o":{},"s":"a\\"b\\\\c/d\\b\\f\\n\\r\\té😀","t":true,"z":null}',
    );
  });

  it('handles whitespace, a BOM and scalar roots', () => {
    const r = parseJson('﻿  [ 1 , [ ] , { } ]  \n', 256);
    expect(r.ok && stringifyCanonical(r.value)).toBe('[1,[],{}]');
    expect(parseJson('"x"', 256).ok).toBe(true);
  });

  it.each([
    ['[1,]', 'Unexpected token'],
    ['{"a":1,}', 'Expected a string key'],
    ['{a:1}', 'Expected a string key'],
    ['{"a" 1}', 'Expected ":"'],
    ['[1 2]', 'Unexpected character'],
    ['"abc', 'Unterminated string'],
    ['"a\u0001"', 'Control character'],
    ['"\\x"', 'Invalid escape'],
    ['"\\u12"', 'Invalid \\u escape'],
    ['[01]', 'Unexpected character'],
    ['[-]', 'Unexpected token'],
    ['{} {}', 'Unexpected content'],
    ['[1', 'Unexpected end of input'],
  ])('reports syntax failure for %j', (text, message) => {
    const r = parseJson(text, 256);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.syntax && r.message).toContain(message);
  });

  it('reports duplicates, depth and exponent problems as semantic failures with pointers', () => {
    const dup = parseJson('{"a":{"b":1,"b":2}}', 256);
    expect(!dup.ok && !dup.syntax && [dup.code, dup.pointer]).toEqual(['CGD-PARSE-003', '#/a/b']);
    const deep = parseJson('{"a":[[[1]]]}', 3);
    expect(!deep.ok && !deep.syntax && [deep.code, deep.pointer]).toEqual(['CGD-LIMIT-003', '#/a/0/0']);
    const exp = parseJson('{"x":[1e99999999]}', 256);
    expect(!exp.ok && !exp.syntax && [exp.code, exp.pointer]).toEqual(['CGD-PARSE-015', '#/x/0']);
  });

  it('handles 100,000-level nesting without recursion', () => {
    const text = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    const r = parseJson(text, 1_000_000);
    expect(r.ok).toBe(true);
  });
});

describe('parseDocument routing', () => {
  it('uses the JSON path for strict JSON and reports semantic errors with positions', () => {
    const r = parseText('{\n  "a": 1,\n  "a": 2\n}');
    expect(codes(r.diagnostics)).toEqual(['CGD-PARSE-003']);
    expect(r.diagnostics[0]?.location?.range?.start).toMatchObject({ line: 3, column: 3 });
  });

  it('falls back to YAML for JSON-like YAML flow syntax', () => {
    const r = parseText('{a: 1, b: [1, 2,], c: "x"}');
    expect(stringifyCanonical(r.doc?.value ?? null)).toBe('{"a":1,"b":[1,2],"c":"x"}');
  });

  it('applies limits in the JSON path', () => {
    expect(codes(parseText('[[[[1]]]]', { ...DEFAULT_LIMITS, maxDepth: 2 }).diagnostics)).toEqual(['CGD-LIMIT-003']);
  });
});

describe('JSON path and YAML path agree on positions', () => {
  const value = fc.jsonValue({ maxDepth: 3 }).map((v) => JSON.parse(JSON.stringify(v)) as unknown);

  it('indexes the same pointers with the same ranges', () => {
    fc.assert(
      fc.property(value, fc.boolean(), (v, pretty) => {
        const text = JSON.stringify({ root: v }, null, pretty ? 2 : undefined);
        const fast = parseJson(text, 256);
        // Force the YAML path by prefixing a YAML comment line.
        const viaYaml = parseText(`# yaml\n${text}`);
        expect(fast.ok).toBe(true);
        if (!fast.ok || viaYaml.doc === undefined) return;
        expect(stringifyCanonical(fast.value)).toBe(stringifyCanonical(viaYaml.doc.value));
        const walk = (node: unknown, p: string): void => {
          const a = fast.index.rangeOf(ptr(p))?.value;
          const b = viaYaml.doc?.index.rangeOf(ptr(p))?.value;
          expect(a?.start.offset).toBe((b?.start.offset ?? 0) - 7);
          expect(a?.end.offset).toBe((b?.end.offset ?? 0) - 7);
          if (Array.isArray(node))
            node.forEach((x, i) => {
              walk(x, `${p}/${i}`);
            });
          else if (node !== null && typeof node === 'object') {
            for (const [k, x] of Object.entries(node)) walk(x, `${p}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`);
          }
        };
        walk({ root: v }, '#');
      }),
      { numRuns: 200 },
    );
  });
});
