/**
 * @contractguard/openapi — loading, parsing with source maps, reference resolution,
 * validation and normalization of OpenAPI 3.0/3.1 documents.
 */
export { formatHintFromUri, type LoadContext, type LoadedSource, type SourceLoader } from './load/source.js';
export { FileSourceLoader, fileUri, isForbiddenWindowsPath, isPathInside } from './load/file-loader.js';
export { CompositeSourceLoader, MemorySourceLoader } from './load/memory-loader.js';
export { parseDocument, type ParseOptions, type ParsedDocument } from './parse/parser.js';
export type { OffsetRange, PointerIndex } from './parse/pointer-index.js';
export { detectVersion, type DetectedVersion } from './version/detect.js';
export {
  RemoteSourceLoader,
  createDefaultBlockList,
  isPublicAddress,
  type RemoteLoaderOptions,
} from './load/remote-loader.js';
export { walkReferences, type IdentifierSite, type RefSite, type WalkResult } from './resolve/walk.js';
export {
  hasUnresolved,
  locate,
  resolveReferences,
  siteKey,
  valueAt,
  type DocumentSet,
  type ResolveOptions,
  type ResolvedReference,
} from './resolve/resolver.js';
export { followReferences, type FollowOptions, type FollowedValue } from './resolve/follow.js';
export { HyperjumpSpecValidator, toPlainJson, type SpecValidator } from './validate/structural.js';
export { normalize, type NormalizeOptions } from './normalize/normalize.js';
export { basePathOf, pathSegments } from './normalize/operations.js';
export { loadContract, type LoadContractOptions, type LoadedContract } from './load-contract.js';
