import type { CanonicalJson } from '../ids/canonical-json.js';
import type {
  DocumentUri,
  MediaTypeKey,
  OperationKey,
  ParameterKey,
  SchemaNodeId,
  SourceRef,
  StatusClass,
  StatusKey,
  Traced,
} from './identity.js';
import type { OasDialect, SchemaEdge, SchemaGraph } from './schema.js';

/** Internal canonical model version (§7.9). Not a public serialization format. */
export const MODEL_VERSION = 1 as const;

export interface ApiContract {
  readonly modelVersion: typeof MODEL_VERSION;
  readonly spec: { readonly family: 'openapi'; readonly version: string; readonly dialect: OasDialect };
  readonly info: { readonly title: string; readonly version: string };
  /** Order preserved (order is meaningful for the default server). */
  readonly servers: readonly Server[];
  /** Sorted by (path, method). */
  readonly operations: ReadonlyMap<OperationKey, Operation>;
  readonly securitySchemes: ReadonlyMap<string, SecurityScheme>;
  readonly schemas: SchemaGraph;
  /** components.schemas name → node (display/grouping only). */
  readonly namedSchemas: ReadonlyMap<string, SchemaNodeId>;
  readonly unsupported: readonly UnsupportedFeature[];
  readonly source: ContractSource;
}

export interface UnsupportedFeature {
  readonly feature: 'callbacks' | 'webhooks' | (string & {});
  readonly source: SourceRef;
}

export interface ContractSource {
  readonly rootUri: DocumentUri;
  readonly documents: readonly { readonly uri: DocumentUri; readonly sha256: string; readonly bytes: number }[];
}

export interface ServerVariable {
  readonly default: string;
  readonly enum?: readonly string[];
}

export interface Server extends Traced {
  readonly urlTemplate: string;
  readonly variables: ReadonlyMap<string, ServerVariable>;
  /** Path component of urlTemplate with variables substituted by their defaults. */
  readonly basePath: string;
}

/** Open for OpenAPI 3.2 (QUERY, additionalOperations). */
export type HttpMethod = 'GET' | 'PUT' | 'POST' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'PATCH' | 'TRACE' | (string & {});

export type PathSegment =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'template'; readonly name: string; readonly position: number }
  | { readonly kind: 'mixed'; readonly raw: string; readonly names: readonly string[] };

export interface Operation extends Traced {
  readonly key: OperationKey;
  readonly method: HttpMethod;
  /** As declared, e.g. "/users/{userId}". */
  readonly path: string;
  readonly pathSegments: readonly PathSegment[];
  readonly operationId?: string;
  readonly tags: readonly string[];
  readonly deprecated: boolean;
  /** Path-item parameters merged; operation-level wins. */
  readonly parameters: ReadonlyMap<ParameterKey, Parameter>;
  readonly requestBody?: RequestBody;
  readonly responses: ReadonlyMap<StatusKey, Response>;
  readonly security: EffectiveSecurity;
  readonly extensions: ReadonlyMap<string, CanonicalJson>;
  readonly hasCallbacks: boolean;
}

/** Open for OpenAPI 3.2 ('querystring'). */
export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie' | (string & {});

export type SerializationStyle =
  'matrix' | 'label' | 'simple' | 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject';

export interface ParameterSerialization {
  readonly style: SerializationStyle;
  readonly explode: boolean;
  readonly allowReserved: boolean;
  /** Which values were written explicitly (for "representation only" evidence). */
  readonly explicit: { readonly style: boolean; readonly explode: boolean; readonly allowReserved: boolean };
}

export type ParameterValue =
  | { readonly kind: 'schema'; readonly schema: SchemaEdge }
  | { readonly kind: 'content'; readonly mediaType: MediaTypeKey; readonly content: MediaTypeContent };

export interface Parameter extends Traced {
  readonly key: ParameterKey;
  readonly name: string;
  readonly in: ParameterLocation;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly allowEmptyValue: boolean;
  readonly serialization: ParameterSerialization;
  readonly value: ParameterValue;
}

export interface RequestBody extends Traced {
  /** OpenAPI default: false. */
  readonly required: boolean;
  readonly content: ReadonlyMap<MediaTypeKey, MediaTypeContent>;
}

export interface EncodingSpec extends Traced {
  readonly contentType?: string;
  readonly headers: ReadonlyMap<string, Header>;
  readonly serialization?: ParameterSerialization;
}

export interface MediaTypeContent extends Traced {
  readonly mediaType: MediaTypeKey;
  readonly schema?: SchemaEdge;
  readonly encoding: ReadonlyMap<string, EncodingSpec>;
}

export interface Response extends Traced {
  readonly status: StatusKey;
  readonly statusClass: StatusClass;
  /** Key: lower-cased header name. The Content-Type header is ignored per OAS. */
  readonly headers: ReadonlyMap<string, Header>;
  readonly content: ReadonlyMap<MediaTypeKey, MediaTypeContent>;
}

export interface Header extends Traced {
  readonly name: string;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly value: ParameterValue;
}

export type OAuthFlowKind = 'implicit' | 'password' | 'clientCredentials' | 'authorizationCode' | (string & {});

export interface OAuthFlow {
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly refreshUrl?: string;
  readonly scopes: ReadonlySet<string>;
}

export type SecurityScheme = Traced & { readonly key: string; readonly fingerprint: string } & (
    | { readonly type: 'apiKey'; readonly name: string; readonly in: 'query' | 'header' | 'cookie' }
    | { readonly type: 'http'; readonly scheme: string; readonly bearerFormat?: string }
    | { readonly type: 'oauth2'; readonly flows: ReadonlyMap<OAuthFlowKind, OAuthFlow> }
    | { readonly type: 'openIdConnect'; readonly openIdConnectUrl: string }
    | { readonly type: 'mutualTLS' }
  );

/** One way to satisfy security: ALL listed schemes, each with the listed scopes. */
export type SecurityAlternative = ReadonlyMap<string, ReadonlySet<string>>;

export interface EffectiveSecurity {
  readonly origin: 'operation' | 'root' | 'none';
  /** OR of ANDs; sorted canonically. */
  readonly alternatives: readonly SecurityAlternative[];
  /** True if security is absent/[] or contains {}. */
  readonly anonymousAllowed: boolean;
  readonly source?: SourceRef;
}
