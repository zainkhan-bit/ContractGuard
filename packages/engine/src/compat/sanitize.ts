import {
  canonicalObject,
  isCanonicalArray,
  isJsonNumber,
  objectKeys,
  type CanonicalJson,
  type ChangeSubject,
} from '@zainkhan-bit/contractguard-core';

/** Names that suggest a credential; values under them are never copied into findings (§16.2 T11). */
const SECRET_NAME =
  /pass(word|wd)?|secret|token|api[-_]?key|auth(orization)?|credential|private[-_]?key|session|cookie/i;
/** Longest string value copied into a finding. */
export const MAX_VALUE_CHARS = 200;
/** Most array items copied into a finding. */
export const MAX_VALUE_ITEMS = 50;
const MAX_DEPTH = 8;
export const REDACTED = '[redacted]';

/** Change kinds whose values are data from the specification (defaults, enum/const values), not structure. */
const DATA_VALUE_KINDS: ReadonlySet<string> = new Set(['schema.defaultChanged', 'schema.enumChanged']);

/**
 * True when the change carries data values (defaults, enum values) for something named like a secret
 * (property, parameter or header name). Structural values such as a parameter location are never redacted.
 */
export function isSecretContext(kind: string, subject: ChangeSubject): boolean {
  if (!DATA_VALUE_KINDS.has(kind)) return false;
  const names: string[] = subject.schemaPath.flatMap((s) => (s.kind === 'property' ? [s.name] : []));
  if (subject.site.kind === 'parameter') names.push(String(subject.site.key));
  if (subject.site.kind === 'responseHeader') names.push(subject.site.header);
  return names.some((n) => SECRET_NAME.test(n));
}

function truncate(s: string): string {
  return s.length <= MAX_VALUE_CHARS ? s : `${s.slice(0, MAX_VALUE_CHARS)}…`;
}

/**
 * A copy of a contract value that is safe to put in a report: long strings truncated, long arrays shortened,
 * values under secret-like keys redacted.
 */
export function safeValue(value: CanonicalJson, depth = 0): CanonicalJson {
  if (value === null || typeof value === 'boolean' || isJsonNumber(value)) return value;
  if (typeof value === 'string') return truncate(value);
  if (depth >= MAX_DEPTH) return '…';
  if (isCanonicalArray(value)) {
    const head = value.slice(0, MAX_VALUE_ITEMS).map((v) => safeValue(v, depth + 1));
    return value.length > MAX_VALUE_ITEMS ? [...head, `… (+${String(value.length - MAX_VALUE_ITEMS)} more)`] : head;
  }
  return canonicalObject(
    objectKeys(value).map(
      (k) => [k, SECRET_NAME.test(k) ? REDACTED : safeValue(value[k] as CanonicalJson, depth + 1)] as const,
    ),
  );
}

/** Message parameters: long strings are truncated so a huge enum value cannot flood a report. */
export function safeParams<T extends Record<string, unknown>>(params: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] =
      typeof v === 'string'
        ? truncate(v)
        : Array.isArray(v)
          ? (v as unknown[]).slice(0, MAX_VALUE_ITEMS).map((x) => (typeof x === 'string' ? truncate(x) : x))
          : v;
  }
  return out as T;
}
