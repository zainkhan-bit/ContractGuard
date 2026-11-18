import type { DiagnosticCategory, DiagnosticSeverity } from './types.js';

/**
 * Registry of diagnostic codes (`CGD-<AREA>-<NNN>`). Codes are immutable once released;
 * retired codes are never reused. Numbers ≥ 100 within an area are warnings/info by convention.
 */
export type DiagnosticCode =
  | 'CGD-FS-001'
  | 'CGD-FS-002'
  | 'CGD-FS-003'
  | 'CGD-FS-010'
  | 'CGD-FS-011'
  | 'CGD-FS-012'
  | 'CGD-FS-101'
  | 'CGD-PARSE-001'
  | 'CGD-PARSE-002'
  | 'CGD-PARSE-003'
  | 'CGD-PARSE-010'
  | 'CGD-PARSE-011'
  | 'CGD-PARSE-012'
  | 'CGD-PARSE-013'
  | 'CGD-PARSE-014'
  | 'CGD-PARSE-015'
  | 'CGD-LIMIT-001'
  | 'CGD-LIMIT-002'
  | 'CGD-LIMIT-003'
  | 'CGD-LIMIT-004'
  | 'CGD-LIMIT-005'
  | 'CGD-LIMIT-006'
  | 'CGD-LIMIT-010'
  | 'CGD-SPEC-001'
  | 'CGD-SPEC-002'
  | 'CGD-SPEC-003'
  | 'CGD-SPEC-004'
  | 'CGD-SPEC-005'
  | 'CGD-SPEC-101'
  | 'CGD-SPEC-105'
  | 'CGD-SPEC-106'
  | 'CGD-SPEC-107'
  | 'CGD-SPEC-110'
  | 'CGD-REF-001'
  | 'CGD-REF-002'
  | 'CGD-REF-004'
  | 'CGD-REF-010'
  | 'CGD-REF-011'
  | 'CGD-REF-012'
  | 'CGD-REF-013'
  | 'CGD-REF-014'
  | 'CGD-REF-015'
  | 'CGD-SEM-001'
  | 'CGD-SEM-002'
  | 'CGD-SEM-003'
  | 'CGD-SEM-004'
  | 'CGD-SEM-005'
  | 'CGD-SEM-106'
  | 'CGD-SEM-107'
  | 'CGD-SEM-120'
  | 'CGD-SEM-121'
  | 'CGD-UNSUP-101'
  | 'CGD-CONFIG-001'
  | 'CGD-CONFIG-002'
  | 'CGD-CONFIG-003'
  | 'CGD-CONFIG-010'
  | 'CGD-CONFIG-011'
  | 'CGD-CONFIG-014'
  | 'CGD-CONFIG-015'
  | 'CGD-CONFIG-112'
  | 'CGD-CONFIG-113'
  | 'CGD-INTEG-101'
  | 'CGD-INTERNAL-001';

export interface DiagnosticCodeInfo {
  readonly category: DiagnosticCategory;
  readonly severity: DiagnosticSeverity;
  readonly title: string;
}

export const DIAGNOSTIC_CODES: Readonly<Record<DiagnosticCode, DiagnosticCodeInfo>> = Object.freeze({
  'CGD-FS-001': { category: 'filesystem', severity: 'error', title: 'File not found' },
  'CGD-FS-002': { category: 'filesystem', severity: 'error', title: 'Not a regular file' },
  'CGD-FS-003': { category: 'filesystem', severity: 'error', title: 'File could not be read' },
  'CGD-FS-010': { category: 'filesystem', severity: 'error', title: 'git is not available' },
  'CGD-FS-011': { category: 'filesystem', severity: 'error', title: 'git revision or path not found' },
  'CGD-FS-012': { category: 'filesystem', severity: 'error', title: 'Invalid git reference' },
  'CGD-FS-101': { category: 'filesystem', severity: 'info', title: 'New specification: no baseline to compare' },
  'CGD-PARSE-001': { category: 'parse', severity: 'error', title: 'Syntax error' },
  'CGD-PARSE-002': { category: 'parse', severity: 'error', title: 'Invalid UTF-8' },
  'CGD-PARSE-003': { category: 'parse', severity: 'error', title: 'Duplicate key' },
  'CGD-PARSE-010': { category: 'parse', severity: 'error', title: 'Non-string mapping key' },
  'CGD-PARSE-011': { category: 'parse', severity: 'error', title: 'Non-finite or unrepresentable number' },
  'CGD-PARSE-012': { category: 'parse', severity: 'error', title: 'Unsupported YAML tag' },
  'CGD-PARSE-013': { category: 'parse', severity: 'error', title: 'Binary or non-JSON YAML value' },
  'CGD-PARSE-014': { category: 'parse', severity: 'error', title: 'Multiple YAML documents in one file' },
  'CGD-PARSE-015': { category: 'parse', severity: 'error', title: 'Number exponent out of range' },
  'CGD-LIMIT-001': { category: 'limit', severity: 'error', title: 'Document exceeds maxDocumentBytes' },
  'CGD-LIMIT-002': { category: 'limit', severity: 'error', title: 'Total input exceeds maxTotalBytes' },
  'CGD-LIMIT-003': { category: 'limit', severity: 'error', title: 'Nesting exceeds maxDepth' },
  'CGD-LIMIT-004': { category: 'limit', severity: 'error', title: 'Referenced documents exceed maxDocuments' },
  'CGD-LIMIT-005': { category: 'limit', severity: 'error', title: 'YAML alias limit exceeded' },
  'CGD-LIMIT-006': { category: 'limit', severity: 'error', title: 'Reference chain exceeds maxRefHops' },
  'CGD-LIMIT-010': { category: 'limit', severity: 'error', title: 'Analysis timed out' },
  'CGD-SPEC-001': { category: 'specification', severity: 'error', title: 'Missing or invalid OpenAPI version field' },
  'CGD-SPEC-002': { category: 'specification', severity: 'error', title: 'Unsupported OpenAPI version' },
  'CGD-SPEC-003': { category: 'specification', severity: 'error', title: 'Swagger 2.0 is not supported' },
  'CGD-SPEC-004': { category: 'specification', severity: 'warning', title: 'OpenAPI version written as a number' },
  'CGD-SPEC-005': {
    category: 'specification',
    severity: 'error',
    title: 'Document does not conform to the OpenAPI schema',
  },
  'CGD-SPEC-101': {
    category: 'specification',
    severity: 'warning',
    title: '$ref sibling keywords are ignored in OpenAPI 3.0',
  },
  'CGD-SPEC-105': { category: 'specification', severity: 'warning', title: 'Unknown HTTP method key ignored' },
  'CGD-SPEC-106': { category: 'specification', severity: 'warning', title: 'Header parameter ignored by OpenAPI' },
  'CGD-SPEC-107': {
    category: 'specification',
    severity: 'warning',
    title: 'Content entry that is not a media type ignored',
  },
  'CGD-SPEC-110': { category: 'specification', severity: 'warning', title: 'nullable without type has no effect' },
  'CGD-REF-001': { category: 'reference', severity: 'error', title: 'Unresolved reference' },
  'CGD-REF-002': { category: 'reference', severity: 'error', title: 'Invalid JSON pointer in reference' },
  'CGD-REF-004': { category: 'reference', severity: 'error', title: 'Circular reference without content' },
  'CGD-REF-010': { category: 'reference', severity: 'error', title: 'Remote references are disabled' },
  'CGD-REF-011': { category: 'reference', severity: 'error', title: 'Host not in allowedHosts' },
  'CGD-REF-012': { category: 'reference', severity: 'error', title: 'URI scheme not allowed' },
  'CGD-REF-013': { category: 'reference', severity: 'error', title: 'File reference outside references.root' },
  'CGD-REF-014': { category: 'reference', severity: 'error', title: 'Remote address is blocked' },
  'CGD-REF-015': { category: 'reference', severity: 'error', title: 'Remote document too large' },
  'CGD-SEM-001': { category: 'semantic', severity: 'error', title: 'Equivalent templated paths' },
  'CGD-SEM-002': { category: 'semantic', severity: 'error', title: 'Duplicate operationId' },
  'CGD-SEM-003': { category: 'semantic', severity: 'error', title: 'Path template and path parameters disagree' },
  'CGD-SEM-004': { category: 'semantic', severity: 'error', title: 'Unknown security scheme' },
  'CGD-SEM-005': { category: 'semantic', severity: 'error', title: 'Discriminator mapping target missing' },
  'CGD-SEM-106': { category: 'semantic', severity: 'warning', title: 'Required property not defined in closed schema' },
  'CGD-SEM-107': { category: 'semantic', severity: 'warning', title: 'Discriminator mapping resolved through a $ref' },
  'CGD-SEM-120': {
    category: 'semantic',
    severity: 'warning',
    title: 'allOf branches conflict (schema matches nothing)',
  },
  'CGD-SEM-121': {
    category: 'semantic',
    severity: 'warning',
    title: 'allOf combined with additionalProperties: false',
  },
  'CGD-UNSUP-101': { category: 'unsupported', severity: 'info', title: 'Construct not analyzed semantically' },
  'CGD-CONFIG-001': { category: 'configuration', severity: 'error', title: 'Unsupported configuration version' },
  'CGD-CONFIG-002': { category: 'configuration', severity: 'error', title: 'Invalid configuration value' },
  'CGD-CONFIG-003': { category: 'configuration', severity: 'error', title: 'Unknown configuration key' },
  'CGD-CONFIG-010': { category: 'configuration', severity: 'error', title: 'Unknown rule id' },
  'CGD-CONFIG-011': { category: 'configuration', severity: 'error', title: 'Rule classification is not overridable' },
  'CGD-CONFIG-014': { category: 'configuration', severity: 'error', title: 'Configuration file not found' },
  'CGD-CONFIG-015': { category: 'configuration', severity: 'error', title: 'Configuration file could not be parsed' },
  'CGD-CONFIG-112': { category: 'configuration', severity: 'warning', title: 'Ignore entry has expired' },
  'CGD-CONFIG-113': { category: 'configuration', severity: 'warning', title: 'Ignore entry expires soon' },
  'CGD-INTEG-101': { category: 'integration', severity: 'warning', title: 'GitHub API call failed' },
  'CGD-INTERNAL-001': { category: 'internal', severity: 'error', title: 'Internal error' },
});

export function isDiagnosticCode(value: string): value is DiagnosticCode {
  return Object.hasOwn(DIAGNOSTIC_CODES, value);
}
