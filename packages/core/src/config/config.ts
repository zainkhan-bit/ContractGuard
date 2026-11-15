import type { Classification, Severity } from '../findings/classification.js';
import type { PerspectiveId } from '../findings/finding.js';
import type { RuleId } from '../model/identity.js';

/** Policy knobs that change classification-table cells or rule overrides (§10.3–10.4). */
export interface ClassificationPolicy {
  readonly strictResponseValidation: boolean;
  readonly constraintTightening: 'potentially-breaking' | 'breaking';
  readonly responseEnumAdditions: 'potentially-breaking' | 'non-breaking' | 'breaking';
  readonly removedRequestParameters: 'non-breaking' | 'potentially-breaking';
  readonly closedResponseAdditions: 'potentially-breaking' | 'breaking';
}

export interface AnalysisLimits {
  readonly maxDocumentBytes: number;
  readonly maxTotalBytes: number;
  readonly maxDocuments: number;
  readonly maxDepth: number;
  readonly maxRefHops: number;
  readonly maxSchemaPairs: number;
  readonly timeoutMs: number;
}

export interface ReferencePolicy {
  /** Absolute directory; file references must resolve inside it. */
  readonly root: string;
  readonly allowRemote: boolean;
  readonly allowedHosts: readonly string[];
  readonly allowedSchemes: readonly ('https' | 'http')[];
  readonly fetchTimeoutMs: number;
  readonly maxRemoteBytes: number;
}

export interface RuleOverride {
  readonly severity?: Severity;
  readonly classification?: Classification;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface IgnoreEntry {
  readonly rule?: RuleId;
  readonly fingerprint?: string;
  readonly operation?: string;
  readonly path?: string;
  readonly reason: string;
  /** ISO date (YYYY-MM-DD). */
  readonly expires?: string;
  /** JSON pointer of this entry in the config file (for messages). */
  readonly configPointer: string;
}

/** A source specifier string as written ("api.yaml", "git:origin/main:api.yaml", "snapshot:x.json", URL, "-"). */
export type SourceSpecifierText = string;

export interface ResolvedSpecConfig {
  readonly id: string;
  readonly base: SourceSpecifierText;
  readonly candidate: SourceSpecifierText;
}

export type ReportFormat = 'console' | 'markdown' | 'json' | 'sarif';

/** Fully resolved configuration (all defaults applied). Produced by app/config, consumed by engine and app. */
export interface ResolvedConfiguration {
  readonly version: 1;
  readonly specs: readonly ResolvedSpecConfig[];
  readonly compatibility: { readonly perspective: PerspectiveId };
  readonly policy: {
    readonly failOn: readonly Classification[];
    readonly minSeverity: Severity;
    readonly undetermined: 'fail' | 'review' | 'ignore';
  };
  readonly analysis: ClassificationPolicy & {
    readonly includeEquivalentChanges: boolean;
    readonly honorExtensibleEnum: boolean;
    readonly allowInvalidSpec: boolean;
    readonly limits: AnalysisLimits;
  };
  readonly rules: {
    readonly disabled: ReadonlySet<RuleId>;
    readonly overrides: ReadonlyMap<RuleId, RuleOverride>;
    readonly ignore: readonly IgnoreEntry[];
  };
  readonly filters: {
    readonly include: readonly string[];
    readonly exclude: readonly string[];
    readonly excludeTags: readonly string[];
    readonly excludeExtensions: readonly string[];
  };
  readonly references: ReferencePolicy;
  readonly report: {
    readonly formats: readonly ReportFormat[];
    readonly outputDir: string;
    readonly groupBy: 'cause' | 'operation';
    readonly deterministic: boolean;
  };
}

/** The brief's name for the resolved configuration. */
export type AnalysisConfiguration = ResolvedConfiguration;

const MB = 1024 * 1024;

/** Defaults from §12.6 (the config loader in @contractguard/app applies these). */
export const DEFAULT_CLASSIFICATION_POLICY: ClassificationPolicy = Object.freeze({
  strictResponseValidation: false,
  constraintTightening: 'potentially-breaking',
  responseEnumAdditions: 'potentially-breaking',
  removedRequestParameters: 'non-breaking',
  closedResponseAdditions: 'potentially-breaking',
});

export const DEFAULT_LIMITS: AnalysisLimits = Object.freeze({
  maxDocumentBytes: 20 * MB,
  maxTotalBytes: 100 * MB,
  maxDocuments: 500,
  maxDepth: 256,
  maxRefHops: 64,
  maxSchemaPairs: 250_000,
  timeoutMs: 120_000,
});
