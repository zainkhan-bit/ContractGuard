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
