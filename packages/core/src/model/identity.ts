import type { JsonPointer } from '../ids/pointer.js';
import { compareCodeUnits } from '../ids/sorted.js';

/** Canonical, absolute document URI: file:///abs/x.yaml, git://<sha>/<path>, snapshot://<hash>/<path>, https://host/x.yaml */
export type DocumentUri = string & { readonly __brand: 'DocumentUri' };
/** `${DocumentUri}#${pointer-body}`, or `${id}~merged` for synthetic allOf merges. */
export type SchemaNodeId = string & { readonly __brand: 'SchemaNodeId' };
/** "GET /users/{}/posts/{}" — upper-case method + template path with parameter names erased. */
export type OperationKey = string & { readonly __brand: 'OperationKey' };
/** "CG-REQ-020" */
export type RuleId = string & { readonly __brand: 'RuleId' };
/** "query:limit", "header:x-request-id", "path:#1" */
export type ParameterKey = string & { readonly __brand: 'ParameterKey' };
/** "200" | "4XX" | "default" */
export type StatusKey = string & { readonly __brand: 'StatusKey' };
/** "application/json", "multipart/form-data", "text/plain;charset=utf-8" */
export type MediaTypeKey = string & { readonly __brand: 'MediaTypeKey' };

/** 1-based line and column (UTF-16 code units); 0-based UTF-16 offset. */
export interface SourcePosition {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

/** Points at a value in a source document. `range` is absent only for synthetic elements. */
export interface SourceRef {
  readonly uri: DocumentUri;
  readonly pointer: JsonPointer;
  readonly range?: SourceRange;
}

/** A located element that may have been reached through $ref hops. */
export interface Traced {
  /** Definition site: where the element's content is written. */
  readonly source: SourceRef;
  /** $ref sites from the use site to the definition, outermost first; empty if inline. */
  readonly via: readonly SourceRef[];
}

// ---------------------------------------------------------------------------
// Constructors / normalizers for identity values
// ---------------------------------------------------------------------------

export function documentUri(value: string): DocumentUri {
  if (value.length === 0) throw new RangeError('DocumentUri must not be empty');
  return value as DocumentUri;
}

export function schemaNodeId(uri: DocumentUri, pointer: JsonPointer): SchemaNodeId {
  return `${uri}${pointer}` as SchemaNodeId;
}

export function mergedSchemaNodeId(id: SchemaNodeId): SchemaNodeId {
  return `${id}~merged` as SchemaNodeId;
}

const RULE_ID = /^CG-(API|SRV|REQ|RES|SCHEMA|AUTH)-\d{3}$/;

export function isRuleId(value: string): value is RuleId {
  return RULE_ID.test(value);
}

export function ruleId(value: string): RuleId {
  if (!isRuleId(value)) throw new RangeError(`Invalid rule id: ${value}`);
  return value;
}

/** Replaces every `{name}` template expression with `{}` (whole or mixed segments). */
export function erasePathTemplateNames(path: string): string {
  return path.replace(/\{[^{}/]*\}/g, '{}');
}

export function operationKey(method: string, path: string): OperationKey {
  return `${method.toUpperCase()} ${erasePathTemplateNames(path)}` as OperationKey;
}

/** Parameter identity: header names are case-insensitive; path parameters are positional. */
export function parameterKey(location: string, name: string, pathPosition?: number): ParameterKey {
  if (location === 'path') {
    if (pathPosition === undefined) throw new RangeError('path parameters need a position');
    return `path:#${pathPosition}` as ParameterKey;
  }
  return `${location}:${location === 'header' ? name.toLowerCase() : name}` as ParameterKey;
}

const STATUS_CODE = /^[1-5]\d\d$/;
const STATUS_RANGE = /^[1-5]XX$/;

/** Normalizes a response key ("2xx" → "2XX"). Returns undefined for invalid keys. */
export function statusKey(raw: string): StatusKey | undefined {
  const value = raw.trim();
  if (value === 'default') return value as StatusKey;
  const upper = value.toUpperCase();
  if (STATUS_CODE.test(upper) || STATUS_RANGE.test(upper)) return upper as StatusKey;
  return undefined;
}

export type StatusClass = 'informational' | 'success' | 'redirect' | 'client-error' | 'server-error' | 'default';

export function statusClassOf(key: StatusKey): StatusClass {
  switch (key.charAt(0)) {
    case '1':
      return 'informational';
    case '2':
      return 'success';
    case '3':
      return 'redirect';
    case '4':
      return 'client-error';
    case '5':
      return 'server-error';
    default:
      return 'default';
  }
}

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Normalizes a media type: lower-case type/subtype and parameter names, trims
 * whitespace, lower-cases the `charset` value, sorts parameters.
 * Returns undefined for syntactically invalid media types.
 */
export function mediaTypeKey(raw: string): MediaTypeKey | undefined {
  const [essence = '', ...rawParams] = raw.split(';');
  const [type, subtype, extra] = essence.trim().toLowerCase().split('/');
  if (extra !== undefined || type === undefined || subtype === undefined) return undefined;
  if (!TOKEN.test(type) || !TOKEN.test(subtype)) return undefined;
  const params: string[] = [];
  for (const p of rawParams) {
    if (p.trim() === '') continue;
    const eq = p.indexOf('=');
    if (eq === -1) return undefined;
    const name = p.slice(0, eq).trim().toLowerCase();
    let value = p.slice(eq + 1).trim();
    if (!TOKEN.test(name) || value === '') return undefined;
    if (name === 'charset') value = value.replace(/^"(.*)"$/, '$1').toLowerCase();
    params.push(`${name}=${value}`);
  }
  params.sort(compareCodeUnits);
  return [`${type}/${subtype}`, ...params].join(';') as MediaTypeKey;
}
