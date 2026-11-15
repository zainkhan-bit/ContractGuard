import { JsonNumber } from './decimal.js';
import { compareCodeUnits } from './sorted.js';

/**
 * Canonical JSON value (§7.7): numbers are exact `JsonNumber`s, objects have a
 * null prototype and code-unit-sorted keys, everything is frozen.
 */
export type CanonicalJson = null | boolean | string | JsonNumber | readonly CanonicalJson[] | CanonicalObject;

export interface CanonicalObject {
  readonly [key: string]: CanonicalJson;
}

export function isJsonNumber(value: unknown): value is JsonNumber {
  return value instanceof JsonNumber;
}

export function isCanonicalArray(value: CanonicalJson): value is readonly CanonicalJson[] {
  return Array.isArray(value);
}

export function isCanonicalObject(value: CanonicalJson): value is CanonicalObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof JsonNumber);
}

/**
 * Creates a frozen, null-prototype object with sorted keys.
 * Keys such as "__proto__" and "constructor" are stored as ordinary own properties.
 */
export function canonicalObject(entries: Iterable<readonly [string, CanonicalJson]>): CanonicalObject {
  // Stable sort keeps insertion order among equal keys, so the last duplicate wins below.
  const sorted = [...entries].sort((a, b) => compareCodeUnits(a[0], b[0]));
  // A null-prototype object has no inherited `__proto__` setter: assignment creates an own property.
  const target = Object.create(null) as Record<string, CanonicalJson>;
  for (const [key, value] of sorted) target[key] = value;
  return Object.freeze(target);
}

/** Own enumerable string keys of a canonical object, sorted (they already are; this is defensive). */
export function objectKeys(value: CanonicalObject): string[] {
  return Object.keys(value).sort(compareCodeUnits);
}

/** Result of converting arbitrary JS data. */
export type FromPlainResult =
  | { readonly ok: true; readonly value: CanonicalJson }
  | { readonly ok: false; readonly path: string; readonly reason: string };

/**
 * Converts plain JS data (e.g. from JSON.parse or config objects) into canonical JSON.
 * Rejects undefined, functions, symbols, non-finite numbers and cyclic structures.
 */
export function fromPlainJson(input: unknown): FromPlainResult {
  const seen = new Set<object>();
  const convert = (value: unknown, path: string): FromPlainResult => {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
      return { ok: true, value };
    }
    if (typeof value === 'number') {
      const n = JsonNumber.fromNumber(value);
      return n === undefined ? { ok: false, path, reason: 'non-finite number' } : { ok: true, value: n };
    }
    if (typeof value === 'bigint') return { ok: true, value: JsonNumber.fromBigInt(value) };
    if (value instanceof JsonNumber) return { ok: true, value };
    if (typeof value !== 'object') return { ok: false, path, reason: `unsupported type ${typeof value}` };
    if (seen.has(value)) return { ok: false, path, reason: 'cyclic structure' };
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const items: CanonicalJson[] = [];
        for (let i = 0; i < value.length; i++) {
          const r = convert(value[i] as unknown, `${path}/${i}`);
          if (!r.ok) return r;
          items.push(r.value);
        }
        return { ok: true, value: Object.freeze(items) };
      }
      const entries: [string, CanonicalJson][] = [];
      for (const key of Object.keys(value)) {
        const r = convert((value as Record<string, unknown>)[key], `${path}/${key}`);
        if (!r.ok) return r;
        entries.push([key, r.value]);
      }
      return { ok: true, value: canonicalObject(entries) };
    } finally {
      seen.delete(value);
    }
  };
  return convert(input, '');
}

const TYPE_RANK = { null: 0, boolean: 1, number: 2, string: 3, array: 4, object: 5 } as const;

function rankOf(value: CanonicalJson): number {
  if (value === null) return TYPE_RANK.null;
  if (typeof value === 'boolean') return TYPE_RANK.boolean;
  if (typeof value === 'string') return TYPE_RANK.string;
  if (value instanceof JsonNumber) return TYPE_RANK.number;
  if (Array.isArray(value)) return TYPE_RANK.array;
  return TYPE_RANK.object;
}

/**
 * Total, deterministic order over canonical JSON:
 * null < booleans < numbers < strings < arrays < objects; within types by value.
 * Two values compare equal iff they are equal under JSON Schema equality.
 */
export function compareJson(a: CanonicalJson, b: CanonicalJson): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra !== rb) return ra - rb;
  if (a === null || b === null) return 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (typeof a === 'string' && typeof b === 'string') return compareCodeUnits(a, b);
  if (a instanceof JsonNumber && b instanceof JsonNumber) return a.compare(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = compareJson(a[i] as CanonicalJson, b[i] as CanonicalJson);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  const oa = a as CanonicalObject;
  const ob = b as CanonicalObject;
  const ka = objectKeys(oa);
  const kb = objectKeys(ob);
  const n = Math.min(ka.length, kb.length);
  for (let i = 0; i < n; i++) {
    const keyA = ka[i] as string;
    const keyB = kb[i] as string;
    const kc = compareCodeUnits(keyA, keyB);
    if (kc !== 0) return kc;
    const vc = compareJson(oa[keyA] as CanonicalJson, ob[keyB] as CanonicalJson);
    if (vc !== 0) return vc;
  }
  return ka.length - kb.length;
}

/** JSON Schema equality: numbers by value, objects key-order-independent, arrays order-sensitive. */
export function jsonEquals(a: CanonicalJson, b: CanonicalJson): boolean {
  return compareJson(a, b) === 0;
}

/** Sorts and de-duplicates values by JSON Schema equality. */
export function sortUniqueJson(values: Iterable<CanonicalJson>): readonly CanonicalJson[] {
  const sorted = [...values].sort(compareJson);
  const out: CanonicalJson[] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (out.length === 0 || compareJson(last as CanonicalJson, v) !== 0) out.push(v);
  }
  return Object.freeze(out);
}

/**
 * Deterministic serialization: sorted keys, numbers in canonical text, no whitespace.
 * Equal values (by `jsonEquals`) always serialize identically.
 */
export function stringifyCanonical(value: CanonicalJson): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof JsonNumber) return value.text;
  if (isCanonicalArray(value)) return `[${value.map((v) => stringifyCanonical(v)).join(',')}]`;
  const obj = value;
  return `{${objectKeys(obj)
    .map((k) => `${JSON.stringify(k)}:${stringifyCanonical(obj[k] as CanonicalJson)}`)
    .join(',')}}`;
}
