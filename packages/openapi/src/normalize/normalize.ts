import {
  MODEL_VERSION,
  ROOT_POINTER,
  compareCodeUnits,
  diagnostic,
  isCanonicalObject,
  sortedMap,
  stageFail,
  type AnalysisLimits,
  type ApiContract,
  type SchemaNodeId,
  type StageResult,
  type UnsupportedFeature,
} from '@zainkhan-bit/contractguard-core';
import type { DocumentSet } from '../resolve/resolver.js';
import type { DetectedVersion } from '../version/detect.js';
import { NormalizeContext, child, objectAt, str, type Loc } from './context.js';
import { OperationNormalizer, normalizeSecuritySchemes, normalizeServers } from './operations.js';
import { SchemaGraphBuilder } from './schema.js';

export interface NormalizeOptions {
  readonly limits: AnalysisLimits;
  readonly side?: 'base' | 'candidate';
}

/**
 * Turns a resolved document set into the canonical, version-independent ApiContract (§7, §8.7).
 * Version spelling differences live only here and in the schema builder.
 */
export function normalize(
  set: DocumentSet,
  version: DetectedVersion,
  options: NormalizeOptions,
): StageResult<ApiContract> {
  const ctx = new NormalizeContext(set, version.dialect, options.limits, options.side);
  const rootDoc = set.documents.get(set.root);
  const rootLoc: Loc = { uri: set.root, pointer: ROOT_POINTER };
  if (rootDoc === undefined || !isCanonicalObject(rootDoc.value)) {
    return stageFail([
      diagnostic(
        'CGD-SPEC-001',
        'Root document is not an object',
        options.side === undefined ? {} : { side: options.side },
      ),
    ]);
  }
  const root = rootDoc.value;
  const schemas = new SchemaGraphBuilder(ctx);

  const securitySchemes = normalizeSecuritySchemes(ctx, root, rootLoc);
  const rootSecurityList = root['security'];
  const operations = new OperationNormalizer(
    ctx,
    schemas,
    securitySchemes,
    rootSecurityList !== undefined && Array.isArray(rootSecurityList)
      ? { value: rootSecurityList, loc: child(rootLoc, 'security') }
      : undefined,
  ).operations(root, rootLoc);

  // Named component schemas (also normalizes unused components, so their errors surface).
  const named: [string, SchemaNodeId][] = [];
  const componentSchemas = objectAt(objectAt(root, 'components') ?? {}, 'schemas') ?? {};
  for (const name of Object.keys(componentSchemas)) {
    const edge = schemas.edgeAt(child(rootLoc, 'components', 'schemas', name));
    named.push([name, edge.target]);
  }
  schemas.drain();

  const unsupported: UnsupportedFeature[] = [];
  if (version.dialect === 'oas31' && Object.keys(objectAt(root, 'webhooks') ?? {}).length > 0) {
    unsupported.push({ feature: 'webhooks', source: ctx.source(child(rootLoc, 'webhooks')) });
  }
  for (const op of operations.values()) {
    if (op.hasCallbacks) unsupported.push({ feature: 'callbacks', source: op.source });
  }

  const info = objectAt(root, 'info') ?? {};
  const contract: ApiContract = {
    modelVersion: MODEL_VERSION,
    spec: { family: 'openapi', version: version.version, dialect: version.dialect },
    info: { title: str(info, 'title') ?? '', version: str(info, 'version') ?? '' },
    servers: normalizeServers(ctx, root, rootLoc),
    operations,
    securitySchemes,
    schemas: { nodes: new Map([...schemas.nodes].sort(([a], [b]) => compareCodeUnits(a, b))) },
    namedSchemas: sortedMap(named),
    unsupported,
    source: {
      rootUri: set.root,
      documents: [...set.documents.values()].map((d) => ({ uri: d.uri, sha256: d.sha256, bytes: d.bytes })),
    },
  };
  return { value: contract, diagnostics: ctx.diagnostics };
}
