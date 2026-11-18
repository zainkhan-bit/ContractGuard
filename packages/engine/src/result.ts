import {
  CLASSIFICATIONS,
  REPORT_VERSION,
  SEVERITIES,
  classificationRank,
  compareCodeUnits,
  severityAtLeast,
  sortDiagnostics,
  type AnalysisResult,
  type ApiContract,
  type CauseGroup,
  type Classification,
  type CompatibilityFinding,
  type ContractSummary,
  type Diagnostic,
  type PerspectiveId,
  type PolicyVerdict,
  type ResolvedConfiguration,
  type Severity,
} from '@zainkhan-bit/contractguard-core';

export type ReportPolicy = ResolvedConfiguration['policy'];

/** §12.6 defaults. */
export const DEFAULT_REPORT_POLICY: ReportPolicy = Object.freeze({
  failOn: Object.freeze(['breaking'] as Classification[]),
  minSeverity: 'low',
  undetermined: 'review',
});

export interface AnalyzedSide {
  readonly contract: ApiContract;
  /** Human-readable revision (e.g. `git:origin/main@3f2a9c1`, `working tree`). */
  readonly revision?: string;
}

export interface AssembleInput {
  readonly specId: string;
  readonly perspective: PerspectiveId;
  readonly toolVersion: string;
  readonly rulesetVersion: string;
  /** Absent when that side failed to load (status becomes `input-error`). */
  readonly base?: AnalyzedSide;
  readonly candidate?: AnalyzedSide;
  readonly findings: readonly CompatibilityFinding[];
  readonly diagnostics: readonly Diagnostic[];
  /** True when errors were tolerated (`allowInvalidSpec`). */
  readonly degraded?: boolean;
  readonly policy?: ReportPolicy;
  /** ISO timestamp; omit for deterministic output. */
  readonly generatedAt?: string;
}

function summarize(side: AnalyzedSide | undefined): ContractSummary | undefined {
  if (side === undefined) return undefined;
  const c = side.contract;
  return {
    specVersion: c.spec.version,
    title: c.info.title,
    apiVersion: c.info.version,
    rootUri: c.source.rootUri,
    ...(side.revision === undefined ? {} : { revision: side.revision }),
    documentsSha256: c.source.documents.map((d) => d.sha256),
    operationCount: c.operations.size,
  };
}

/** Whether an active finding makes the policy fail. */
export function isGating(f: CompatibilityFinding, policy: ReportPolicy): boolean {
  if (f.status !== 'active' || !severityAtLeast(f.severity, policy.minSeverity)) return false;
  if (f.classification === 'undetermined')
    return policy.undetermined === 'fail' || policy.failOn.includes('undetermined');
  return policy.failOn.includes(f.classification);
}

function verdict(findings: readonly CompatibilityFinding[], policy: ReportPolicy, inputError: boolean): PolicyVerdict {
  const reasons = findings
    .filter((f) => isGating(f, policy))
    .map((f) => ({
      fingerprint: f.fingerprint,
      rule: f.ruleId,
      because: `${f.classification} (${f.severity}) matches fail-on [${policy.failOn.join(', ')}]${
        f.classification === 'undetermined' && policy.undetermined === 'fail' ? ' / undetermined: fail' : ''
      }`,
    }));
  return { passed: !inputError && reasons.length === 0, reasons, undeterminedHandling: policy.undetermined };
}

function causes(findings: readonly CompatibilityFinding[]): CauseGroup[] {
  const groups = new Map<string, CompatibilityFinding[]>();
  for (const f of findings) {
    if (f.status !== 'active') continue;
    const list = groups.get(f.causeKey);
    if (list === undefined) groups.set(f.causeKey, [f]);
    else list.push(f);
  }
  const out: CauseGroup[] = [...groups].map(([causeKey, fs]) => {
    const first = fs[0] as CompatibilityFinding;
    const worst = fs.reduce<Classification>(
      (w, f) => (classificationRank(f.classification) < classificationRank(w) ? f.classification : w),
      first.classification,
    );
    return {
      causeKey,
      location: first.location.anchor,
      title: `${first.ruleId} ${first.ruleName}`,
      findingFingerprints: fs.map((f) => f.fingerprint),
      worst,
    };
  });
  return out.sort(
    (a, b) => classificationRank(a.worst) - classificationRank(b.worst) || compareCodeUnits(a.causeKey, b.causeKey),
  );
}

/** Builds the canonical, versioned analysis result for one spec (§7.6, §13.3). Pure. */
export function assembleResult(input: AssembleInput): AnalysisResult {
  const policy = input.policy ?? DEFAULT_REPORT_POLICY;
  const inputError = input.base === undefined || input.candidate === undefined;
  const active = input.findings.filter((f) => f.status === 'active');
  const byClassification = Object.fromEntries(
    CLASSIFICATIONS.map((c) => [c, active.filter((f) => f.classification === c).length]),
  ) as Record<Classification, number>;
  const bySeverity = Object.fromEntries(
    SEVERITIES.map((s) => [s, active.filter((f) => f.severity === s).length]),
  ) as Record<Severity, number>;
  const affected = new Set(
    active
      .filter((f) => f.classification !== 'non-breaking' && f.classification !== 'informational')
      .flatMap((f) => (f.subject.operationKey === undefined ? [] : [f.subject.operationKey])),
  );
  const base = summarize(input.base);
  const candidate = summarize(input.candidate);
  return {
    reportVersion: REPORT_VERSION,
    tool: { name: 'contractguard', version: input.toolVersion, rulesetVersion: input.rulesetVersion },
    status: inputError ? 'input-error' : input.degraded === true ? 'completed-degraded' : 'completed',
    perspective: input.perspective,
    specId: input.specId,
    ...(base === undefined ? {} : { base }),
    ...(candidate === undefined ? {} : { candidate }),
    findings: input.findings,
    causes: causes(input.findings),
    diagnostics: sortDiagnostics([...input.diagnostics]),
    summary: {
      byClassification,
      bySeverity,
      suppressed: input.findings.length - active.length,
      affectedOperations: affected.size,
    },
    policy: verdict(input.findings, policy, inputError),
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
  };
}
