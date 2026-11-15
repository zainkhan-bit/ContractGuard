import type { CanonicalJson } from '../ids/canonical-json.js';
import type { ParameterLocation } from '../model/contract.js';
import type { MediaTypeKey, OperationKey, ParameterKey, SourceRef, StatusClass, StatusKey } from '../model/identity.js';
import type { AdditionalProperties, JsonType } from '../model/schema.js';

export type Direction = 'request' | 'response';

export type UsageSite =
  | { readonly kind: 'operation' }
  | { readonly kind: 'parameter'; readonly key: ParameterKey }
  | { readonly kind: 'requestBody'; readonly mediaType?: MediaTypeKey }
  | { readonly kind: 'response'; readonly status: StatusKey; readonly mediaType?: MediaTypeKey }
  | { readonly kind: 'responseHeader'; readonly status: StatusKey; readonly header: string }
  | { readonly kind: 'security' }
  | { readonly kind: 'servers' };

export type CompositionKind = 'oneOf' | 'anyOf' | 'allOf';

export type SchemaPathSegment =
  | { readonly kind: 'property'; readonly name: string }
  | { readonly kind: 'items' }
  | { readonly kind: 'additionalProperties' }
  | { readonly kind: 'variant'; readonly composition: CompositionKind; readonly matchKey: string }
  | { readonly kind: 'discriminatorMapping'; readonly value: string };

export interface ChangeSubject {
  readonly operationKey?: OperationKey;
  readonly site: UsageSite;
  /** Derived from site; absent for operation/servers-level changes. */
  readonly direction?: Direction;
  /** Empty when not inside a schema. */
  readonly schemaPath: readonly SchemaPathSegment[];
}

export interface LocatedValue<T = CanonicalJson> {
  /** Absent when the element does not exist on that side. */
  readonly value?: T;
  readonly location?: SourceRef;
  readonly via?: readonly SourceRef[];
}

export type SetRelation = 'equal' | 'subset' | 'superset' | 'overlapping' | 'disjoint';

export interface TypeSetFact {
  readonly types: readonly JsonType[] | 'any';
}

export type ConstraintKeyword =
  | 'minimum'
  | 'maximum'
  | 'multipleOf'
  | 'minLength'
  | 'maxLength'
  | 'minItems'
  | 'maxItems'
  | 'uniqueItems'
  | 'minProperties'
  | 'maxProperties'
  | 'contentMediaType'
  | 'contentEncoding';

export interface PropertyChangeFacts {
  readonly property: string;
  /** Required on the side where it exists. */
  readonly required: boolean;
  readonly parentAdditionalProperties: {
    readonly base: AdditionalProperties['kind'];
    readonly candidate: AdditionalProperties['kind'];
  };
  readonly parentHasUnevaluatedProperties: boolean;
}

export interface SecurityChangeFacts {
  /** Indexes of base alternatives with no satisfiable candidate alternative. */
  readonly unsatisfiedBaseAlternatives: readonly number[];
  readonly scopeAdditions: readonly { readonly scheme: string; readonly scopes: readonly string[] }[];
  readonly anonymousRemoved: boolean;
  readonly relaxed: boolean;
}

/** Common envelope of every change event. */
export interface ChangeOf<K extends string, F> {
  readonly kind: K;
  readonly subject: ChangeSubject;
  readonly base: LocatedValue;
  readonly candidate: LocatedValue;
  readonly facts: F;
  /** Definition-level location identity; used for root-cause grouping. */
  readonly causeKey: string;
}

type Empty = Readonly<Record<string, never>>;

/** Perspective-neutral change events produced by the diff engine (§7.6). */
export type ContractChange =
  | ChangeOf<'operation.removed', Empty>
  | ChangeOf<'operation.added', Empty>
  | ChangeOf<'operation.deprecated', { readonly deprecated: boolean }>
  | ChangeOf<'operation.operationIdChanged', Empty>
  | ChangeOf<
      'operation.probableRename',
      { readonly fromKey: OperationKey; readonly toKey: OperationKey; readonly evidence: 'operationId' | 'structural' }
    >
  | ChangeOf<'path.parameterRenamed', { readonly position: number; readonly from: string; readonly to: string }>
  | ChangeOf<'parameter.added' | 'parameter.removed', { readonly required: boolean; readonly in: ParameterLocation }>
  | ChangeOf<'parameter.requiredChanged', { readonly from: boolean; readonly to: boolean }>
  | ChangeOf<
      'parameter.locationChanged',
      { readonly fromIn: ParameterLocation; readonly toIn: ParameterLocation; readonly requiredAfter: boolean }
    >
  | ChangeOf<
      'parameter.serializationChanged',
      { readonly fields: readonly ('style' | 'explode' | 'allowReserved' | 'contentMediaType')[] }
    >
  | ChangeOf<'requestBody.added' | 'requestBody.removed', { readonly required: boolean }>
  | ChangeOf<'requestBody.requiredChanged', { readonly from: boolean; readonly to: boolean }>
  | ChangeOf<'mediaType.added' | 'mediaType.removed', { readonly mediaType: MediaTypeKey }>
  | ChangeOf<
      'response.added' | 'response.removed',
      { readonly status: StatusKey; readonly statusClass: StatusClass; readonly effectiveFallback?: StatusKey }
    >
  | ChangeOf<'response.bodyRemoved' | 'response.bodyAdded', Empty>
  | ChangeOf<'header.added' | 'header.removed', { readonly required: boolean }>
  | ChangeOf<'header.requiredChanged', { readonly from: boolean; readonly to: boolean }>
  | ChangeOf<
      'schema.typeChanged',
      { readonly from: TypeSetFact; readonly to: TypeSetFact; readonly relation: SetRelation }
    >
  | ChangeOf<'schema.nullabilityChanged', { readonly from: boolean; readonly to: boolean }>
  | ChangeOf<
      'schema.enumChanged',
      {
        readonly removed: readonly CanonicalJson[];
        readonly added: readonly CanonicalJson[];
        readonly extensible: boolean;
        /** Whether an enum is present on [base, candidate]; absent means unconstrained. */
        readonly constrained: readonly [boolean, boolean];
      }
    >
  | ChangeOf<
      'schema.constraintChanged',
      { readonly keyword: ConstraintKeyword; readonly relation: 'tightened' | 'relaxed' | 'incomparable' }
    >
  | ChangeOf<'schema.patternChanged', { readonly from?: string; readonly to?: string }>
  | ChangeOf<
      'schema.formatChanged',
      { readonly from?: string; readonly to?: string; readonly relation: SetRelation | 'unknown' }
    >
  | ChangeOf<'schema.propertyAdded' | 'schema.propertyRemoved', PropertyChangeFacts>
  | ChangeOf<'schema.requiredChanged', { readonly property: string; readonly from: boolean; readonly to: boolean }>
  | ChangeOf<
      'schema.additionalPropertiesChanged',
      { readonly from: AdditionalProperties['kind']; readonly to: AdditionalProperties['kind'] }
    >
  | ChangeOf<
      'schema.accessChanged',
      {
        readonly property: string;
        readonly readOnly: readonly [boolean, boolean];
        readonly writeOnly: readonly [boolean, boolean];
        readonly requiredInBase: boolean;
      }
    >
  | ChangeOf<
      'schema.variantAdded' | 'schema.variantRemoved',
      { readonly composition: CompositionKind; readonly hasDiscriminator: boolean }
    >
  | ChangeOf<
      'schema.discriminatorMappingChanged',
      { readonly removed: readonly string[]; readonly added: readonly string[] }
    >
  | ChangeOf<'schema.defaultChanged', Empty>
  | ChangeOf<'schema.unsupportedChanged', { readonly keywords: readonly string[] }>
  | ChangeOf<'schema.compositionUnanalyzable', { readonly reason: string }>
  | ChangeOf<'schema.budgetExceeded', { readonly limit: string }>
  | ChangeOf<'schema.unresolvedReference', { readonly raw: string }>
  | ChangeOf<'schema.representationChanged', { readonly what: string }>
  | ChangeOf<'security.alternativesChanged', SecurityChangeFacts>
  | ChangeOf<
      'securityScheme.changed',
      { readonly scheme: string; readonly fields: readonly string[]; readonly incompatible: boolean }
    >
  | ChangeOf<'securityScheme.renamed', { readonly from: string; readonly to: string }>
  | ChangeOf<'server.removed' | 'server.basePathChanged' | 'server.variableEnumNarrowed', Empty>;

export type ChangeKind = ContractChange['kind'];

/** Narrows a ContractChange by kind. */
export type ChangeOfKind<K extends ChangeKind> = Extract<ContractChange, { readonly kind: K }>;

/** Every change kind, sorted. Kept in sync with the union by a compile-time check in tests. */
export const CHANGE_KINDS: readonly ChangeKind[] = Object.freeze([
  'header.added',
  'header.removed',
  'header.requiredChanged',
  'mediaType.added',
  'mediaType.removed',
  'operation.added',
  'operation.deprecated',
  'operation.operationIdChanged',
  'operation.probableRename',
  'operation.removed',
  'parameter.added',
  'parameter.locationChanged',
  'parameter.removed',
  'parameter.requiredChanged',
  'parameter.serializationChanged',
  'path.parameterRenamed',
  'requestBody.added',
  'requestBody.removed',
  'requestBody.requiredChanged',
  'response.added',
  'response.bodyAdded',
  'response.bodyRemoved',
  'response.removed',
  'schema.accessChanged',
  'schema.additionalPropertiesChanged',
  'schema.budgetExceeded',
  'schema.compositionUnanalyzable',
  'schema.constraintChanged',
  'schema.defaultChanged',
  'schema.discriminatorMappingChanged',
  'schema.enumChanged',
  'schema.formatChanged',
  'schema.nullabilityChanged',
  'schema.patternChanged',
  'schema.propertyAdded',
  'schema.propertyRemoved',
  'schema.representationChanged',
  'schema.requiredChanged',
  'schema.typeChanged',
  'schema.unresolvedReference',
  'schema.unsupportedChanged',
  'schema.variantAdded',
  'schema.variantRemoved',
  'security.alternativesChanged',
  'securityScheme.changed',
  'securityScheme.renamed',
  'server.basePathChanged',
  'server.removed',
  'server.variableEnumNarrowed',
]);

/** Request vs response direction implied by a usage site. */
export function directionOf(site: UsageSite): Direction | undefined {
  switch (site.kind) {
    case 'parameter':
    case 'requestBody':
      return 'request';
    case 'response':
    case 'responseHeader':
      return 'response';
    case 'operation':
    case 'security':
    case 'servers':
      return undefined;
  }
}

/** Stable textual key of a usage site (used in fingerprints and ignore entries). */
export function siteKey(site: UsageSite): string {
  switch (site.kind) {
    case 'operation':
      return 'operation';
    case 'parameter':
      return `parameter:${site.key}`;
    case 'requestBody':
      return site.mediaType === undefined ? 'requestBody' : `requestBody:${site.mediaType}`;
    case 'response':
      return site.mediaType === undefined ? `response:${site.status}` : `response:${site.status}:${site.mediaType}`;
    case 'responseHeader':
      return `responseHeader:${site.status}:${site.header}`;
    case 'security':
      return 'security';
    case 'servers':
      return 'servers';
  }
}

/** Stable textual key of a schema path, e.g. "items/prop:address/prop:zip". */
export function schemaPathKey(path: readonly SchemaPathSegment[]): string {
  return path
    .map((s) => {
      switch (s.kind) {
        case 'property':
          return `prop:${encodeURIComponent(s.name)}`;
        case 'items':
          return 'items';
        case 'additionalProperties':
          return 'additionalProperties';
        case 'variant':
          return `${s.composition}:${encodeURIComponent(s.matchKey)}`;
        case 'discriminatorMapping':
          return `mapping:${encodeURIComponent(s.value)}`;
      }
    })
    .join('/');
}
