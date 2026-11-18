import {
  JsonNumber,
  ROOT_POINTER,
  compareCodeUnits,
  diagnostic,
  isCanonicalArray,
  parsePointer,
  stageOk,
  type CanonicalJson,
  type Diagnostic,
  type OasDialect,
  type StageResult,
} from '@zainkhan-bit/contractguard-core';
import type { ParsedDocument } from '../parse/parser.js';
import { locate } from '../resolve/resolver.js';

/** Port: structural validation of a root OpenAPI document (ADR-05). */
export interface SpecValidator {
  validate(doc: ParsedDocument, dialect: OasDialect, side?: 'base' | 'candidate'): Promise<StageResult<void>>;
}

interface OutputUnit {
  readonly valid?: boolean;
  readonly instanceLocation?: string;
  readonly absoluteKeywordLocation?: string;
  readonly keyword?: string;
}

interface ValidationOutput {
  readonly valid: boolean;
  readonly errors?: readonly OutputUnit[];
}

type ValidateFn = (schemaUri: string, instance: unknown, outputFormat: string) => Promise<ValidationOutput>;

const SCHEMA_URIS: Readonly<Record<OasDialect, string>> = {
  oas30: 'https://spec.openapis.org/oas/3.0/schema',
  oas31: 'https://spec.openapis.org/oas/3.1/schema-base',
};

/** Converts canonical JSON into plain JS objects (validators expect ordinary prototypes). */
export function toPlainJson(value: CanonicalJson): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof JsonNumber) return value.approx;
  if (isCanonicalArray(value)) return value.map(toPlainJson);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(out, key, {
      value: toPlainJson(value[key] as CanonicalJson),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

const KEYWORD_HINTS: Readonly<Record<string, string>> = {
  required: 'a required property is missing',
  additionalProperties: 'an unknown property is present',
  unevaluatedProperties: 'an unknown property is present',
  patternProperties: 'a property name or value does not match the allowed pattern',
  type: 'the value has the wrong type',
  enum: 'the value is not one of the allowed values',
  const: 'the value is not the allowed value',
  pattern: 'the value does not match the required pattern',
  oneOf: 'the value does not match exactly one allowed form',
  anyOf: 'the value does not match any allowed form',
  format: 'the value has an invalid format',
  minItems: 'the list has too few items',
  minProperties: 'the object has too few properties',
  uniqueItems: 'the list contains duplicates',
};

/**
 * Structural validation against the official OpenAPI schemas using @hyperjump/json-schema
 * (loaded lazily so packages that never validate do not pay for it).
 * Only the root document is validated against the full schema; referenced fragment
 * documents are checked while normalizing.
 */
export class HyperjumpSpecValidator implements SpecValidator {
  readonly #maxErrors: number;
  #validators: Partial<Record<OasDialect, ValidateFn>> = {};

  constructor(options: { readonly maxErrors?: number } = {}) {
    this.#maxErrors = options.maxErrors ?? 50;
  }

  async #validator(dialect: OasDialect): Promise<ValidateFn> {
    const cached = this.#validators[dialect];
    if (cached !== undefined) return cached;
    const mod = (dialect === 'oas30'
      ? await import('@hyperjump/json-schema/openapi-3-0')
      : await import('@hyperjump/json-schema/openapi-3-1')) as unknown as { validate: ValidateFn };
    this.#validators = { ...this.#validators, [dialect]: mod.validate };
    return mod.validate;
  }

  async validate(doc: ParsedDocument, dialect: OasDialect, side?: 'base' | 'candidate'): Promise<StageResult<void>> {
    const validate = await this.#validator(dialect);
    const output = await validate(SCHEMA_URIS[dialect], toPlainJson(doc.value), 'BASIC');
    if (output.valid) return stageOk(undefined);
    return { diagnostics: this.#toDiagnostics(doc, output.errors ?? [], side) };
  }

  #toDiagnostics(doc: ParsedDocument, errors: readonly OutputUnit[], side?: 'base' | 'candidate'): Diagnostic[] {
    // Keep the most specific error per instance location; drop composition noise when a
    // more precise keyword failed at the same or a deeper location.
    const byLocation = new Map<string, { keyword: string; schemaPath: string }>();
    for (const e of errors) {
      if (e.valid === true || e.instanceLocation === undefined) continue;
      const schemaPath = decodeURIComponent((e.absoluteKeywordLocation ?? '').split('#')[1] ?? '');
      const keyword = schemaPath.split('/').pop() ?? '';
      if (/^\d+$/.test(keyword)) continue;
      const existing = byLocation.get(e.instanceLocation);
      const generic = (k: string): boolean => k === 'oneOf' || k === 'anyOf' || k === '$ref' || k === 'allOf';
      if (existing === undefined || (generic(existing.keyword) && !generic(keyword))) {
        byLocation.set(e.instanceLocation, { keyword, schemaPath });
      }
    }
    const locations = [...byLocation.keys()].sort(compareCodeUnits);
    const deepest = locations.filter(
      (l) => !locations.some((o) => o !== l && o.startsWith(`${l}/`) && isGenericAt(byLocation, l)),
    );
    const sideOpt = side === undefined ? {} : { side };
    const out: Diagnostic[] = [];
    for (const loc of deepest.slice(0, this.#maxErrors)) {
      const info = byLocation.get(loc) as { keyword: string; schemaPath: string };
      const where = doc.index.nearestExisting(parsePointer(loc) ?? ROOT_POINTER);
      const hint = KEYWORD_HINTS[info.keyword];
      out.push(
        diagnostic('CGD-SPEC-005', `Invalid OpenAPI document at ${loc}: ${hint ?? `violates "${info.keyword}"`}`, {
          ...sideOpt,
          location: locate(doc, where),
          hint: `Schema rule: ${info.schemaPath}`,
        }),
      );
    }
    if (deepest.length > this.#maxErrors) {
      out.push(
        diagnostic('CGD-SPEC-005', `…and ${deepest.length - this.#maxErrors} more structural errors`, {
          ...sideOpt,
          location: locate(doc, ROOT_POINTER),
        }),
      );
    }
    return out;
  }
}

function isGenericAt(map: ReadonlyMap<string, { keyword: string }>, location: string): boolean {
  const k = map.get(location)?.keyword;
  return k === 'oneOf' || k === 'anyOf' || k === '$ref' || k === 'allOf';
}
