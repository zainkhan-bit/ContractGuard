import { describe, expect, it } from 'vitest';
import { InternalError, assert, assertNever } from '../../src/errors.js';
import { fromPlainJson, type CanonicalJson } from '../../src/ids/canonical-json.js';
import { hashCanonical, sha256Hex, shortHash } from '../../src/ids/hash.js';
import { mulberry32, seedFromStrings } from '../../src/ids/prng.js';
import { compareCodeUnits, compareTuples, sortedMap, sortedSet, sortedUnique } from '../../src/ids/sorted.js';

const c = (value: unknown): CanonicalJson => {
  const r = fromPlainJson(value);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('sorted utilities', () => {
  it('compares by code units', () => {
    expect(compareCodeUnits('a', 'b')).toBe(-1);
    expect(compareCodeUnits('b', 'a')).toBe(1);
    expect(compareCodeUnits('a', 'a')).toBe(0);
    expect(compareCodeUnits('Z', 'a')).toBe(-1);
  });

  it('compares tuples lexicographically then by length', () => {
    expect(compareTuples([1, 2], [1, 3], (x, y) => x - y)).toBeLessThan(0);
    expect(compareTuples([1, 2], [1], (x, y) => x - y)).toBeGreaterThan(0);
    expect(compareTuples([], [], (x: number, y: number) => x - y)).toBe(0);
  });

  it('builds sorted maps and sets', () => {
    expect([
      ...sortedMap([
        ['b', 1],
        ['a', 2],
      ]).keys(),
    ]).toEqual(['a', 'b']);
    expect([...sortedSet(['b', 'a', 'b'])]).toEqual(['a', 'b']);
    expect(sortedUnique(['c', 'a', 'c'])).toEqual(['a', 'c']);
  });

  it('rejects duplicate map keys as an internal error', () => {
    expect(() =>
      sortedMap([
        ['a', 1],
        ['a', 2],
      ]),
    ).toThrow(InternalError);
  });
});

describe('hashing', () => {
  it('computes known SHA-256 digests', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes equal values identically regardless of key order or number spelling', () => {
    expect(hashCanonical(c({ a: 1, b: [1.0] }))).toBe(hashCanonical(c({ b: [1], a: 1.0 })));
    expect(hashCanonical(c({ a: 1 }))).not.toBe(hashCanonical(c({ a: 2 })));
  });

  it('truncates short hashes and validates length', () => {
    expect(shortHash(c('x'))).toHaveLength(32);
    expect(shortHash(c('x'), 8)).toHaveLength(8);
    expect(() => shortHash(c('x'), 7)).toThrow(RangeError);
    expect(() => shortHash(c('x'), 65)).toThrow(RangeError);
    expect(() => shortHash(c('x'), 9.5)).toThrow(RangeError);
  });
});

describe('prng', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('pins the sequence so generated tests stay stable across versions', () => {
    const r = mulberry32(1);
    expect(Array.from({ length: 3 }, () => r.nextInt(1000))).toEqual([627, 2, 527]);
  });

  it('validates nextInt bounds', () => {
    const r = mulberry32(7);
    expect(() => r.nextInt(0)).toThrow(RangeError);
    expect(() => r.nextInt(2.5)).toThrow(RangeError);
    expect(r.nextInt(1)).toBe(0);
  });

  it('derives stable seeds from strings without ambiguity', () => {
    expect(seedFromStrings('a', 'b')).toBe(seedFromStrings('a', 'b'));
    expect(seedFromStrings('a', 'b')).not.toBe(seedFromStrings('ab'));
    expect(seedFromStrings('a|b')).not.toBe(seedFromStrings('a', 'b'));
    expect(Number.isInteger(seedFromStrings('x'))).toBe(true);
  });
});

describe('errors', () => {
  it('assert throws InternalError only when false', () => {
    expect(() => {
      assert(true, 'fine');
    }).not.toThrow();
    expect(() => {
      assert(0, 'zero');
    }).toThrow('Assertion failed: zero');
    try {
      assert(false, 'x');
    } catch (e) {
      expect(e).toBeInstanceOf(InternalError);
      expect((e as InternalError).name).toBe('InternalError');
    }
  });

  it('assertNever reports the unexpected value', () => {
    expect(() => assertNever('surprise' as never, 'kind')).toThrow('Unexpected kind: "surprise"');
    expect(() => assertNever(1 as never)).toThrow('Unexpected value: 1');
  });

  it('InternalError carries details', () => {
    expect(new InternalError('m', { a: 1 }).details).toEqual({ a: 1 });
    expect(new InternalError('m').details).toBeUndefined();
  });
});
