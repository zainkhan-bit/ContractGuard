import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareJson,
  fromPlainJson,
  jsonEquals,
  stringifyCanonical,
  type CanonicalJson,
} from '../../src/ids/canonical-json.js';
import { JsonNumber } from '../../src/ids/decimal.js';
import { hashCanonical } from '../../src/ids/hash.js';
import {
  parsePointer,
  pointerFromSegments,
  pointerFromUriFragment,
  pointerSegments,
  pointerToUriFragment,
} from '../../src/ids/pointer.js';

const RUNS = { numRuns: 300 };

describe('pointer properties', () => {
  const segment = fc.string({ unit: 'binary', maxLength: 12 });

  it('segments round-trip through pointers', () => {
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 6 }), (segs) => {
        expect(pointerSegments(pointerFromSegments(segs))).toEqual(segs);
      }),
      RUNS,
    );
  });

  it('pointers round-trip through URI fragments', () => {
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 6 }), (segs) => {
        const ptr = pointerFromSegments(segs);
        expect(parsePointer(ptr)).toBe(ptr);
        expect(pointerFromUriFragment(pointerToUriFragment(ptr))).toBe(ptr);
      }),
      RUNS,
    );
  });
});

/** Reference model: exact rational comparison via BigInt for decimals with bounded exponents. */
function referenceCompare(a: { m: bigint; e: number }, b: { m: bigint; e: number }): number {
  const e = Math.min(a.e, b.e);
  const x = a.m * 10n ** BigInt(a.e - e);
  const y = b.m * 10n ** BigInt(b.e - e);
  return x === y ? 0 : x < y ? -1 : 1;
}

const decimal = fc.record({
  m: fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }),
  e: fc.integer({ min: -40, max: 40 }),
});

const toText = ({ m, e }: { m: bigint; e: number }): string => `${m.toString()}e${e}`;

describe('decimal properties', () => {
  it('comparison agrees with exact BigInt arithmetic', () => {
    fc.assert(
      fc.property(decimal, decimal, (a, b) => {
        const na = JsonNumber.parse(toText(a));
        const nb = JsonNumber.parse(toText(b));
        expect(na?.compare(nb as JsonNumber)).toBe(referenceCompare(a, b));
      }),
      RUNS,
    );
  });

  it('canonical text re-parses to an equal number with the same text', () => {
    fc.assert(
      fc.property(decimal, (a) => {
        const n = JsonNumber.parse(toText(a)) as JsonNumber;
        const again = JsonNumber.parse(n.text) as JsonNumber;
        expect(again.text).toBe(n.text);
        expect(again.equals(n)).toBe(true);
      }),
      RUNS,
    );
  });

  it('canonical text is valid JSON number syntax', () => {
    fc.assert(
      fc.property(decimal, (a) => {
        const text = (JsonNumber.parse(toText(a)) as JsonNumber).text;
        expect(text).toMatch(/^-?(0|[1-9]\d*)(\.\d+)?(e[+-]\d+)?$/);
      }),
      RUNS,
    );
  });

  it('isMultipleOf agrees with BigInt arithmetic', () => {
    const small = fc.record({
      m: fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }),
      e: fc.integer({ min: -6, max: 6 }),
    });
    const positive = fc.record({ m: fc.bigInt({ min: 1n, max: 10n ** 6n }), e: fc.integer({ min: -6, max: 6 }) });
    fc.assert(
      fc.property(small, positive, (a, b) => {
        const e = Math.min(a.e, b.e);
        const x = a.m * 10n ** BigInt(a.e - e);
        const y = b.m * 10n ** BigInt(b.e - e);
        const na = JsonNumber.parse(toText(a)) as JsonNumber;
        const nb = JsonNumber.parse(toText(b)) as JsonNumber;
        expect(na.isMultipleOf(nb)).toBe(x % y === 0n);
      }),
      RUNS,
    );
  });
});

const jsonValue = fc.jsonValue({ maxDepth: 4 });

function shuffleKeys(value: unknown, rng: () => number): unknown {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, rng));
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(() => rng() - 0.5);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      Object.defineProperty(out, k, {
        value: shuffleKeys(v, rng),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

const canon = (v: unknown): CanonicalJson => {
  const r = fromPlainJson(v);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('canonical JSON properties', () => {
  it('serialization and hashing are independent of key order', () => {
    fc.assert(
      fc.property(jsonValue, fc.integer(), (value, seed) => {
        let s = seed;
        const rng = (): number => {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          return s / 0x7fffffff;
        };
        const a = canon(value);
        const b = canon(shuffleKeys(value, rng));
        expect(stringifyCanonical(a)).toBe(stringifyCanonical(b));
        expect(hashCanonical(a)).toBe(hashCanonical(b));
        expect(jsonEquals(a, b)).toBe(true);
      }),
      RUNS,
    );
  });

  it('equal serialization ⇔ equality, and the order is a total preorder', () => {
    fc.assert(
      fc.property(jsonValue, jsonValue, jsonValue, (x, y, z) => {
        const a = canon(x);
        const b = canon(y);
        const c = canon(z);
        expect(jsonEquals(a, b)).toBe(stringifyCanonical(a) === stringifyCanonical(b));
        expect(Math.sign(compareJson(a, b))).toBe(-Math.sign(compareJson(b, a)) || 0);
        if (compareJson(a, b) <= 0 && compareJson(b, c) <= 0) {
          expect(compareJson(a, c)).toBeLessThanOrEqual(0);
        }
      }),
      RUNS,
    );
  });

  it('canonical serialization round-trips through JSON.parse', () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const a = canon(value);
        expect(jsonEquals(canon(JSON.parse(stringifyCanonical(a))), a)).toBe(true);
      }),
      RUNS,
    );
  });
});
