import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { DocumentUri, SourceRef } from '../model/identity.js';
import type { Classification, Severity } from './classification.js';
import type { CompatibilityFinding, PerspectiveId } from './finding.js';

/** JSON report schema version (§7.9, §13.3). */
export const REPORT_VERSION = '1.0' as const;

export interface ContractSummary {
  readonly specVersion: string;
  readonly title: string;
  readonly apiVersion: string;
  readonly rootUri: DocumentUri;
  readonly revision?: string;
  readonly documentsSha256: readonly string[];
  readonly operationCount: number;
}

export interface CauseGroup {
  readonly causeKey: string;
  readonly location?: SourceRef;
  readonly title: string;
  readonly findingFingerprints: readonly string[];
  readonly worst: Classification;
}

export interface PolicyVerdict {
  readonly passed: boolean;
  readonly reasons: readonly { readonly fingerprint: string; readonly rule: string; readonly because: string }[];
  readonly undeterminedHandling: 'fail' | 'review' | 'ignore';
}

export interface AnalysisResult {
  readonly reportVersion: typeof REPORT_VERSION;
  readonly tool: { readonly name: 'contractguard'; readonly version: string; readonly rulesetVersion: string };
  readonly status: 'completed' | 'completed-degraded' | 'input-error';
  readonly perspective: PerspectiveId;
  readonly specId: string;
  /** Absent when the side failed to load (status 'input-error'). */
  readonly base?: ContractSummary;
  readonly candidate?: ContractSummary;
  /** Sorted (ADR-19). */
  readonly findings: readonly CompatibilityFinding[];
  readonly causes: readonly CauseGroup[];
  readonly diagnostics: readonly Diagnostic[];
  readonly summary: {
    readonly byClassification: Readonly<Record<Classification, number>>;
    readonly bySeverity: Readonly<Record<Severity, number>>;
    readonly suppressed: number;
    readonly affectedOperations: number;
  };
  readonly policy: PolicyVerdict;
  /** Omitted in deterministic mode. */
  readonly generatedAt?: string;
}
