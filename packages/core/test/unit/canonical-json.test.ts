import { describe, expect, it } from 'vitest';
import {
  canonicalObject,
  compareJson,
  fromPlainJson,
  isCanonicalArray,
  isCanonicalObject,
  isJsonNumber,
  jsonEquals,
  objectKeys,
  sortUniqueJson,
  stringifyCanonical,
  type CanonicalJson,
} from '../../src/ids/canonical-json.js';
import { JsonNumber } from '../../src/ids/decimal.js';

const c = (value: unknown): CanonicalJson => {
  const r = fromPlainJson(value);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('fromPlainJson', () => {
  it('converts nested data with sorted, frozen, null-prototype objects', () => {
    const v = c({ b: 1, a: [true, null, 'x', { z: 2.5 }] });
    expect(isCanonicalObject(v)).toBe(true);
    const obj = v as Record<string, CanonicalJson>;
    expect(Object.keys(obj)).toEqual(['a', 'b']);
    expect(Object.getPrototypeOf(obj)).toBeNull();
    expect(Object.isFrozen(obj)).toBe(true);
    expect(isJsonNumber(obj['b'])).toBe(true);
    expect(isCanonicalArray(obj['a'] as CanonicalJson)).toBe(true);
  });

  it('keeps __proto__ and constructor as plain data', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1}') as unknown;
    const v = c(input) as Record<string, CanonicalJson>;
    expect(Object.keys(v)).toEqual(['__proto__', 'constructor']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(stringifyCanonical(v)).toBe('{"__proto__":{"polluted":true},"constructor":1}');
  });

  it('accepts bigint and existing JsonNumber values', () => {
    expect(stringifyCanonical(c([10n, JsonNumber.parse('1.50')]))).toBe('[10,1.5]');
  });

  it.each([
    [undefined, 'unsupported type undefined', ''],
    [{ a: Number.NaN }, 'non-finite number', '/a'],
    [[1, () => 1], 'unsupported type function', '/1'],
    [{ s: Symbol('x') }, 'unsupported type symbol', '/s'],
  ])('rejects %o', (input, reason, path) => {
    const r = fromPlainJson(input);
    expect(r).toEqual({ ok: false, reason, path });
  });

  it('rejects cycles but allows shared (non-cyclic) references', () => {
    const shared = { x: 1 };
    expect(fromPlainJson({ a: shared, b: shared }).ok).toBe(true);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(fromPlainJson(cyclic)).toEqual({ ok: false, path: '/self', reason: 'cyclic structure' });
  });
});

describe('canonicalObject', () => {
  it('sorts by code units, not locale', () => {
    const obj = canonicalObject([
      ['b', 1 as unknown as CanonicalJson],
      ['B', null],
      ['a', null],
      ['é', null],
    ]);
    expect(Object.keys(obj)).toEqual(['B', 'a', 'b', 'é']);
    expect(objectKeys(obj)).toEqual(['B', 'a', 'b', 'é']);
  });

  it('last duplicate wins', () => {
    expect(
      stringifyCanonical(
        canonicalObject([
          ['k', 'first'],
          ['k', 'second'],
        ]),
      ),
    ).toBe('{"k":"second"}');
  });
});

describe('compareJson / jsonEquals', () => {
  it('orders by type rank', () => {
    const ordered = [null, false, true, c(-1), c(2), '', 'a', c([]), c([1]), c({}), c({ a: 1 })];
    const shuffled = [...ordered].reverse();
    expect(shuffled.sort(compareJson)).toEqual(ordered);
  });

  it('implements JSON Schema equality', () => {
    expect(jsonEquals(c(1), c(1.0))).toBe(true);
    expect(jsonEquals(c({ a: 1, b: 2 }), c({ b: 2, a: 1 }))).toBe(true);
    expect(jsonEquals(c([1, 2]), c([2, 1]))).toBe(false);
    expect(jsonEquals(c({ a: 1 }), c({ a: 1, b: 1 }))).toBe(false);
    expect(jsonEquals(c({ a: 1 }), c({ b: 1 }))).toBe(false);
    expect(jsonEquals(c({ a: 1 }), c({ a: 2 }))).toBe(false);
    expect(jsonEquals(c('1'), c(1))).toBe(false);
  });

  it('compares arrays lexicographically then by length', () => {
    expect(compareJson(c([1, 2]), c([1, 3]))).toBeLessThan(0);
    expect(compareJson(c([1]), c([1, 0]))).toBeLessThan(0);
  });
});

describe('sortUniqueJson', () => {
  it('sorts and deduplicates by value', () => {
    const out = sortUniqueJson([c('b'), c(1), c(1.0), c('a'), null, c('b')]);
    expect(out.map((v) => stringifyCanonical(v))).toEqual(['null', '1', '"a"', '"b"']);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('handles empty input', () => {
    expect(sortUniqueJson([])).toEqual([]);
  });
});

describe('stringifyCanonical', () => {
  it('serializes deterministically', () => {
    expect(stringifyCanonical(c({ z: [1.5e3, 'é"'], a: { y: false, x: null } }))).toBe(
      '{"a":{"x":null,"y":false},"z":[1500,"é\\""]}',
    );
    expect(stringifyCanonical(true)).toBe('true');
  });

  it('produces valid JSON for scientific numbers', () => {
    const text = stringifyCanonical(c([1e40, 2.5e-40]));
    expect(JSON.parse(text)).toEqual([1e40, 2.5e-40]);
  });
});
