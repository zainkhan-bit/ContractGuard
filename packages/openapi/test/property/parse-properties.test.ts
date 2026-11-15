import fc from 'fast-check';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { fromPlainJson, stringifyCanonical, type CanonicalJson } from '@contractguard/core';
import { parseText } from '../helpers.js';

const canon = (v: unknown): CanonicalJson => {
  const r = fromPlainJson(v);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

// JSON-compatible values without -0 (JSON.stringify writes -0 as 0) and with string keys.
const value = fc
  .jsonValue({ maxDepth: 4, noUnicodeString: false })
  .map((v) => JSON.parse(JSON.stringify(v)) as unknown);

describe('parser properties', () => {
  it('JSON text parses to the same canonical value as JSON.parse', () => {
    fc.assert(
      fc.property(value, fc.boolean(), (v, pretty) => {
        const text = JSON.stringify(v, null, pretty ? 2 : undefined);
        const r = parseText(text);
        expect(r.diagnostics).toEqual([]);
        expect(stringifyCanonical(r.doc?.value ?? null)).toBe(stringifyCanonical(canon(v)));
      }),
      { numRuns: 300 },
    );
  });

  it('YAML rendering of the same data parses to the same canonical value', () => {
    fc.assert(
      fc.property(value, fc.constantFrom('PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE'), (v, defaultStringType) => {
        const text = stringify(v, { defaultStringType: defaultStringType as 'PLAIN', version: '1.2' });
        const r = parseText(text);
        expect(r.diagnostics).toEqual([]);
        expect(stringifyCanonical(r.doc?.value ?? null)).toBe(stringifyCanonical(canon(v)));
      }),
      { numRuns: 300 },
    );
  });

  it('every indexed object member points at a range inside the document', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer()), (obj) => {
        const text = JSON.stringify(obj, null, 2);
        const r = parseText(text);
        for (const key of Object.keys(obj)) {
          const ptr = `#/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
          const range = r.doc?.index.rangeOf(ptr as Parameters<NonNullable<typeof r.doc>['index']['rangeOf']>[0]);
          expect(range).toBeDefined();
          const v = range?.value;
          expect(text.slice(v?.start.offset, v?.end.offset)).toBe(String(obj[key]));
        }
      }),
      { numRuns: 200 },
    );
  });
});
