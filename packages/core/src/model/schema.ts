import type { CanonicalJson } from '../ids/canonical-json.js';
import type { JsonNumber } from '../ids/decimal.js';
import type { SchemaNodeId, SourceRef, Traced } from './identity.js';

export type OasDialect = 'oas30' | 'oas31';

export type JsonType = 'null' | 'boolean' | 'object' | 'array' | 'number' | 'integer' | 'string';

export const JSON_TYPES: readonly JsonType[] = Object.freeze([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);

export interface SchemaGraph {
  readonly nodes: ReadonlyMap<SchemaNodeId, SchemaNode>;
}

export interface SchemaReference {
  /** "$ref" value as written. */
  readonly raw: string;
  /** Target location. */
  readonly resolved: SourceRef;
  /** Where the $ref is written. */
  readonly site: SourceRef;
  /** dynamicRef: resolved structurally; comparison marks it unsupported. */
  readonly kind: 'ref' | 'dynamicRef';
}

/** An edge to a schema node, remembering how it was reached. */
export interface SchemaEdge {
  readonly target: SchemaNodeId;
  readonly ref?: SchemaReference;
}

export interface PropertyEdge extends SchemaEdge {
  readonly name: string;
  readonly site: SourceRef;
}

export interface NullabilityInfo {
  /** Semantic result after applying dialect rules (§11.2, N8/N9). */
  readonly allowsNull: boolean | 'unconstrained';
  /** How it was expressed, for evidence and "representation-only" detection. */
  readonly origin: 'oas30-nullable' | 'type-includes-null' | 'enum-includes-null' | 'no-type' | 'not-nullable';
}

export interface Bound {
  readonly value: JsonNumber;
  readonly exclusive: boolean;
}

export interface NumericConstraints {
  readonly minimum?: Bound;
  readonly maximum?: Bound;
  readonly multipleOf?: JsonNumber;
  readonly format?: string;
}

export interface StringConstraints {
  readonly minLength?: number;
  readonly maxLength?: number;
  /** Compared as text only, never executed (§16, T9). */
  readonly pattern?: string;
  readonly format?: string;
  readonly contentMediaType?: string;
  readonly contentEncoding?: string;
}

export interface ArrayConstraints {
  readonly items?: SchemaEdge;
  readonly prefixItems?: readonly SchemaEdge[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems: boolean;
}

export type AdditionalProperties =
  | { readonly kind: 'any'; readonly origin: 'default' | 'explicit-true' | 'explicit-empty-schema' }
  | { readonly kind: 'none'; readonly origin: 'explicit-false' }
  | { readonly kind: 'schema'; readonly schema: SchemaEdge };

export interface ObjectConstraints {
  /** Sorted by name. */
  readonly properties: ReadonlyMap<string, PropertyEdge>;
  readonly required: ReadonlySet<string>;
  readonly additionalProperties: AdditionalProperties;
  readonly patternProperties: ReadonlyMap<string, SchemaEdge>;
  readonly minProperties?: number;
  readonly maxProperties?: number;
}

export type AllOfOrigin = 'allOf' | 'ref-sibling';

export interface Composition {
  readonly allOf: readonly SchemaEdge[];
  readonly allOfOrigins: readonly AllOfOrigin[];
  readonly anyOf: readonly SchemaEdge[];
  readonly oneOf: readonly SchemaEdge[];
  readonly not?: SchemaEdge;
}

export interface Discriminator {
  readonly propertyName: string;
  /** Explicit mapping plus implicit component-name mapping, resolved. */
  readonly mapping: ReadonlyMap<string, SchemaEdge>;
}

export interface UnsupportedKeyword {
  readonly keyword: string;
  /** Short hash of the keyword's canonical value, so value changes are detectable without the raw document. */
  readonly valueHash: string;
  readonly source: SourceRef;
}

export interface SchemaNode extends Traced {
  readonly id: SchemaNodeId;
  readonly dialect: OasDialect;
  /** 'any' = {} or true; 'never' = false or not:{} */
  readonly trivial?: 'any' | 'never';
  /** Allowed JSON types including 'null'; undefined = no type restriction. */
  readonly types?: ReadonlySet<JsonType>;
  readonly nullability: NullabilityInfo;
  /** enum and const folded (const x ≡ enum [x]); canonical-sorted, deduplicated. */
  readonly enumValues?: readonly CanonicalJson[];
  readonly enumOrigin?: 'enum' | 'const' | 'both';
  readonly numeric: NumericConstraints;
  readonly string: StringConstraints;
  readonly array: ArrayConstraints;
  readonly object: ObjectConstraints;
  readonly composition: Composition;
  readonly discriminator?: Discriminator;
  readonly access: { readonly readOnly: boolean; readonly writeOnly: boolean };
  readonly annotations: { readonly deprecated: boolean; readonly default?: CanonicalJson; readonly title?: string };
  /** Keywords present that the engine does not analyze semantically. */
  readonly unsupported: readonly UnsupportedKeyword[];
  /** x-* extensions. */
  readonly extensions: ReadonlyMap<string, CanonicalJson>;
}
