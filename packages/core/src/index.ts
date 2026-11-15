/**
 * @contractguard/core — canonical contract model, findings, rule and perspective
 * contracts, diagnostics and deterministic utilities. No I/O.
 */

// Errors
export { InternalError, assert, assertNever } from './errors.js';

// Deterministic utilities
export { compareCodeUnits, compareTuples, sortedMap, sortedSet, sortedUnique } from './ids/sorted.js';
export {
  ROOT_POINTER,
  appendPointer,
  escapeToken,
  isAncestorOrSelf,
  parentPointer,
  parsePointer,
  pointerFromSegments,
  pointerFromUriFragment,
  pointerSegments,
  pointerToUriFragment,
  unescapeToken,
  type JsonPointer,
} from './ids/pointer.js';
export { JsonNumber, MAX_DECIMAL_EXPONENT, MAX_MULTIPLE_OF_EXPONENT_GAP, integerBound } from './ids/decimal.js';
export {
  canonicalObject,
  compareJson,
  fromPlainJson,
  isCanonicalArray,
  isCanonicalObject,
  isJsonNumber,
  jsonEquals,
  objectKeys,
  sortUniqueJson,
  stringifyCanonical,
  type CanonicalJson,
  type CanonicalObject,
  type FromPlainResult,
} from './ids/canonical-json.js';
export { hashCanonical, sha256Hex, shortHash } from './ids/hash.js';
export { mulberry32, seedFromStrings, type Prng } from './ids/prng.js';

// Model
export {
  documentUri,
  erasePathTemplateNames,
  isRuleId,
  mediaTypeKey,
  mergedSchemaNodeId,
  operationKey,
  parameterKey,
  ruleId,
  schemaNodeId,
  statusClassOf,
  statusKey,
  type DocumentUri,
  type MediaTypeKey,
  type OperationKey,
  type ParameterKey,
  type RuleId,
  type SchemaNodeId,
  type SourcePosition,
  type SourceRange,
  type SourceRef,
  type StatusClass,
  type StatusKey,
  type Traced,
} from './model/identity.js';
export * from './model/schema.js';
export * from './model/contract.js';

// Findings
export * from './findings/classification.js';
export * from './findings/changes.js';
export * from './findings/finding.js';
export * from './findings/result.js';

// Rules and perspectives
export * from './rules/rule.js';

// Configuration
export * from './config/config.js';

// Diagnostics
export * from './diagnostics/diagnostic.js';
export * from './diagnostics/codes.js';
