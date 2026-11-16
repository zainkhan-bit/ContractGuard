export {
  diffContracts,
  effectiveResponse,
  sortChanges,
  type DiffOptions,
  type DiffResult,
} from './diff/contract-diff.js';
export { hiddenIn, projectUsage, type SchemaUsage } from './diff/project.js';
export {
  SchemaDiffer,
  type Access,
  type LocalChange,
  type PairChild,
  type PairDelta,
  type PropertyAccess,
  type SchemaDifferOptions,
} from './diff/schema-differ.js';
export {
  compareBound,
  compareLimit,
  compareMultipleOf,
  enumDifference,
  expandTypes,
  formatRelation,
  setRelation,
  typeAllowed,
  type ConstraintRelation,
} from './schema/relations.js';
export { SchemaSide, isUnresolved } from './schema/view.js';
export {
  checkCompatibility,
  DEFAULT_REGISTRY,
  explainRule,
  type CheckOptions,
  type CheckResult,
  type RuleExplanation,
} from './check.js';
export {
  computeSeverity,
  evaluate,
  fingerprintDiscriminator,
  fingerprintOf,
  RuleRegistry,
  type EvaluateOptions,
} from './compat/evaluate.js';
export { classifyByTable, CONSUMER_FORWARD, PROVIDER_BACKWARD } from './compat/perspectives.js';
export { describeSubject, interpolate, schemaPathText } from './compat/text.js';
export { RULES, RULESET_VERSION } from './rules/index.js';
export {
  assembleResult,
  DEFAULT_REPORT_POLICY,
  isGating,
  type AnalyzedSide,
  type AssembleInput,
  type ReportPolicy,
} from './result.js';
