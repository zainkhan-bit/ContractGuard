import { InternalError } from '../errors.js';

/**
 * Locale-independent ordering by UTF-16 code units (ADR-19).
 * Never use `localeCompare` for anything that influences output.
 */
export function compareCodeUnits(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Lexicographic comparison of tuples using a per-element comparator. */
export function compareTuples<T>(a: readonly T[], b: readonly T[], compare: (x: T, y: T) => number): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const c = compare(a[i] as T, b[i] as T);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** Returns a new array of unique strings sorted by code units. */
export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

/**
 * Builds a Map whose iteration order is sorted by key (code units).
 * Duplicate keys are a programming error.
 */
export function sortedMap<V>(entries: Iterable<readonly [string, V]>): ReadonlyMap<string, V> {
  const collected = new Map<string, V>();
  for (const [key, value] of entries) {
    if (collected.has(key)) {
      throw new InternalError(`Duplicate key in sortedMap: ${key}`);
    }
    collected.set(key, value);
  }
  const keys = [...collected.keys()].sort(compareCodeUnits);
  return new Map(keys.map((k) => [k, collected.get(k) as V]));
}

/** Builds a Set whose iteration order is sorted by code units; duplicates are collapsed. */
export function sortedSet(values: Iterable<string>): ReadonlySet<string> {
  return new Set(sortedUnique(values));
}
