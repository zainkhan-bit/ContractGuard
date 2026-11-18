import {
  JSON_TYPES,
  compareJson,
  integerBound,
  jsonEquals,
  type Bound,
  type CanonicalJson,
  type JsonNumber,
  type JsonType,
  type SetRelation,
} from '@zainkhan-bit/contractguard-core';

/** Relation of the candidate's value space to the base's: tightened = candidate accepts less. */
export type ConstraintRelation = 'tightened' | 'relaxed' | 'incomparable';

/** Non-null types; `undefined` means unconstrained. `integer` is included whenever `number` is (§11.3). */
export function expandTypes(types: ReadonlySet<JsonType> | undefined): ReadonlySet<JsonType> {
  if (types === undefined) return new Set(JSON_TYPES.filter((t) => t !== 'null'));
  const out = new Set([...types].filter((t) => t !== 'null'));
  if (out.has('number')) out.add('integer');
  return out;
}

/** Relation between two sets, phrased as "the candidate set is a ... of the base set". */
export function setRelation<T>(base: ReadonlySet<T>, candidate: ReadonlySet<T>): SetRelation {
  const candidateHasAllBase = [...base].every((x) => candidate.has(x));
  const baseHasAllCandidate = [...candidate].every((x) => base.has(x));
  if (candidateHasAllBase && baseHasAllCandidate) return 'equal';
  if (candidateHasAllBase) return 'superset';
  if (baseHasAllCandidate) return 'subset';
  return [...base].some((x) => candidate.has(x)) ? 'overlapping' : 'disjoint';
}

/** Whether a keyword family applies: the family's type is allowed on at least one side. */
export function typeAllowed(types: ReadonlySet<JsonType> | undefined, ...family: readonly JsonType[]): boolean {
  const expanded = expandTypes(types);
  return family.some((t) => expanded.has(t));
}

/** Total order on lower bounds (min side) or upper bounds (max side): positive = a is tighter. */
function boundTightness(a: Bound, b: Bound, side: 'min' | 'max'): number {
  const c = a.value.compare(b.value);
  if (c !== 0) return side === 'min' ? c : -c;
  if (a.exclusive === b.exclusive) return 0;
  return a.exclusive ? 1 : -1;
}

/** The equivalent inclusive bound when only integers are admitted (x > 3 ≡ x ≥ 4; x ≤ 2.5 ≡ x ≤ 2). */
export function integerOnlyBound(bound: Bound | undefined, side: 'min' | 'max'): Bound | undefined {
  if (bound === undefined || (!bound.exclusive && bound.value.isInteger)) return bound;
  return { value: integerBound(bound.value, side, bound.exclusive), exclusive: false };
}

/** Compares an optional bound; undefined is unbounded. Returns undefined when equal. */
export function compareBound(
  base: Bound | undefined,
  candidate: Bound | undefined,
  side: 'min' | 'max',
  integerOnly = false,
): ConstraintRelation | undefined {
  if (integerOnly) {
    base = integerOnlyBound(base, side);
    candidate = integerOnlyBound(candidate, side);
  }
  if (base === undefined && candidate === undefined) return undefined;
  if (base === undefined) return 'tightened';
  if (candidate === undefined) return 'relaxed';
  const t = boundTightness(candidate, base, side);
  return t === 0 ? undefined : t > 0 ? 'tightened' : 'relaxed';
}

/** Compares optional lower/upper count limits (minLength, maxItems, ...). Missing values are passed as defaults. */
export function compareLimit(base: number, candidate: number, side: 'min' | 'max'): ConstraintRelation | undefined {
  if (base === candidate) return undefined;
  return (side === 'min' ? candidate > base : candidate < base) ? 'tightened' : 'relaxed';
}

/** multipleOf: candidate a multiple of base → tightened; base a multiple of candidate → relaxed. */
export function compareMultipleOf(
  base: JsonNumber | undefined,
  candidate: JsonNumber | undefined,
): ConstraintRelation | undefined {
  if (base === undefined && candidate === undefined) return undefined;
  if (base === undefined) return 'tightened';
  if (candidate === undefined) return 'relaxed';
  if (base.equals(candidate)) return undefined;
  if (candidate.isMultipleOf(base) === true) return 'tightened';
  if (base.isMultipleOf(candidate) === true) return 'relaxed';
  return 'incomparable';
}

/** Format chains, narrowest first; a format is narrower than every later member and than "no format" (§11.8). */
const FORMAT_CHAINS: readonly (readonly string[])[] = [
  ['int32', 'int64'],
  ['float', 'double'],
  ['uri', 'uri-reference'],
  ['uri', 'iri'],
  ['email', 'idn-email'],
];
const KNOWN_FORMATS = new Set([
  ...FORMAT_CHAINS.flat(),
  'date',
  'date-time',
  'time',
  'duration',
  'uuid',
  'hostname',
  'idn-hostname',
  'ipv4',
  'ipv6',
  'iri-reference',
  'json-pointer',
  'relative-json-pointer',
  'regex',
  'byte',
  'binary',
  'password',
]);

/** Relation of the candidate format's value space to the base's; undefined format = unconstrained. */
export function formatRelation(base: string | undefined, candidate: string | undefined): SetRelation | 'unknown' {
  if (base === candidate) return 'equal';
  if (base === undefined) return KNOWN_FORMATS.has(candidate as string) ? 'subset' : 'unknown';
  if (candidate === undefined) return KNOWN_FORMATS.has(base) ? 'superset' : 'unknown';
  if (!KNOWN_FORMATS.has(base) || !KNOWN_FORMATS.has(candidate)) return 'unknown';
  for (const chain of FORMAT_CHAINS) {
    const i = chain.indexOf(base);
    const j = chain.indexOf(candidate);
    if (i !== -1 && j !== -1) return j > i ? 'superset' : 'subset';
  }
  return 'disjoint';
}

/** Enum difference by JSON equality; both inputs are canonical-sorted. */
export function enumDifference(
  base: readonly CanonicalJson[],
  candidate: readonly CanonicalJson[],
): { readonly removed: CanonicalJson[]; readonly added: CanonicalJson[] } {
  const removed = base.filter((b) => !candidate.some((c) => jsonEquals(b, c)));
  const added = candidate.filter((c) => !base.some((b) => jsonEquals(b, c)));
  return { removed: removed.sort(compareJson), added: added.sort(compareJson) };
}
