import {
  DEFAULT_CLASSIFICATION_POLICY,
  InternalError,
  classificationRank,
  compareCodeUnits,
  downgradeSeverity,
  isValidClassificationBasis,
  schemaPathKey,
  severityRank,
  sha256Hex,
  siteKey,
  type ApiContract,
  type Basis,
  type ChangeKind,
  type ChangeSubject,
  type Classification,
  type ClassificationPolicy,
  type CompatibilityFinding,
  type CompatibilityPerspective,
  type ContractChange,
  type EvidenceItem,
  type IgnoreEntry,
  type Operation,
  type ResolvedRuleOptions,
  type RuleAssessment,
  type RuleContext,
  type RuleDefinition,
  type RuleOverride,
  type Severity,
  type SourceRef,
} from '@zainkhan-bit/contractguard-core';
import { PROVIDER_BACKWARD } from './perspectives.js';
import { describeSubject, interpolate } from './text.js';

export interface EvaluateOptions {
  readonly perspective?: CompatibilityPerspective;
  readonly policy?: ClassificationPolicy;
  /** Per-rule configuration (keyed by rule id). */
  readonly overrides?: ReadonlyMap<string, RuleOverride>;
  /** Rule ids that do not run. */
  readonly disabled?: ReadonlySet<string>;
  /** Suppressions; matched findings stay in the result with status "suppressed". */
  readonly ignore?: readonly IgnoreEntry[];
  /** Today's date (YYYY-MM-DD) for ignore expiry. Passed in so evaluation stays deterministic. */
  readonly today?: string;
  readonly honorExtensibleEnum?: boolean;
  readonly includeEquivalentChanges?: boolean;
}

/** Precomputed kind → rules index; rules sorted by id. */
export class RuleRegistry {
  readonly rules: readonly RuleDefinition[];
  readonly #byKind = new Map<ChangeKind, RuleDefinition[]>();
  readonly #byId = new Map<string, RuleDefinition>();

  constructor(rules: readonly RuleDefinition[]) {
    this.rules = [...rules].sort((a, b) => compareCodeUnits(a.id, b.id));
    for (const rule of this.rules) {
      if (this.#byId.has(rule.id)) throw new InternalError(`Duplicate rule id ${rule.id}`);
      this.#byId.set(rule.id, rule);
      for (const kind of rule.handles) {
        const list = this.#byKind.get(kind);
        if (list === undefined) this.#byKind.set(kind, [rule]);
        else list.push(rule);
      }
    }
  }

  byKind(kind: ChangeKind): readonly RuleDefinition[] {
    return this.#byKind.get(kind) ?? [];
  }

  byId(id: string): RuleDefinition | undefined {
    return this.#byId.get(id);
  }
}

/** The value that distinguishes findings of one rule at one site and schema path (§10.7). */
export function fingerprintDiscriminator(change: ContractChange): string {
  switch (change.kind) {
    case 'schema.propertyAdded':
    case 'schema.propertyRemoved':
    case 'schema.requiredChanged':
    case 'schema.accessChanged':
      return change.facts.property;
    case 'schema.constraintChanged':
      return change.facts.keyword;
    case 'schema.variantAdded':
    case 'schema.variantRemoved':
      return change.facts.composition;
    case 'schema.unsupportedChanged':
      return change.facts.keywords.join(',');
    case 'securityScheme.changed':
      return change.facts.scheme;
    case 'securityScheme.renamed':
      return change.facts.from;
    case 'path.parameterRenamed':
      return String(change.facts.position);
    default:
      return '';
  }
}

export function fingerprintOf(ruleId: string, perspective: string, change: ContractChange): string {
  const s = change.subject;
  return sha256Hex(
    JSON.stringify([
      'cg-fp-v1',
      ruleId,
      perspective,
      s.operationKey ?? '',
      siteKey(s.site),
      schemaPathKey(s.schemaPath),
      fingerprintDiscriminator(change),
    ]),
  ).slice(0, 32);
}

/** §10.5: profile by classification, one-level downgrade for deprecated base operations, config wins. */
export function computeSeverity(
  rule: RuleDefinition,
  classification: Classification,
  deprecatedInBase: boolean,
  override: Severity | undefined,
): Severity {
  let base: Severity;
  switch (classification) {
    case 'breaking':
      base = rule.severityProfile.breaking;
      break;
    case 'potentially-breaking':
      base = rule.severityProfile.potentiallyBreaking;
      break;
    case 'undetermined':
      base = rule.severityProfile.undetermined;
      break;
    case 'non-breaking':
    case 'informational':
      base = 'info';
      break;
  }
  if ((classification === 'breaking' || classification === 'potentially-breaking') && deprecatedInBase) {
    base = downgradeSeverity(base, 'low');
  }
  return override !== undefined && rule.overridable.severity ? override : base;
}

function resolveOptions(rule: RuleDefinition, override: RuleOverride | undefined): ResolvedRuleOptions {
  const out: Record<string, boolean | string | number> = {};
  for (const spec of rule.options ?? []) {
    const v = override?.options?.[spec.name];
    out[spec.name] = typeof v === typeof spec.default ? (v as boolean | string | number) : spec.default;
  }
  return out;
}

function operationOf(contract: ApiContract, change: ContractChange): Operation | undefined {
  const key = change.subject.operationKey;
  return key === undefined ? undefined : contract.operations.get(key);
}

function matchesIgnore(entry: IgnoreEntry, finding: CompatibilityFinding, today: string | undefined): boolean {
  if (entry.expires !== undefined && today !== undefined && entry.expires < today) return false;
  if (entry.rule !== undefined && entry.rule !== finding.ruleId) return false;
  if (entry.fingerprint !== undefined && entry.fingerprint !== finding.fingerprint) return false;
  const s = finding.subject;
  if (entry.operation !== undefined) {
    const spelled = s.method === undefined || s.path === undefined ? undefined : `${s.method} ${s.path}`;
    if (entry.operation !== s.operationKey && entry.operation !== spelled) return false;
  }
  if (entry.path !== undefined && entry.path !== s.path) return false;
  return (
    entry.rule !== undefined ||
    entry.fingerprint !== undefined ||
    entry.operation !== undefined ||
    entry.path !== undefined
  );
}

function sameEvidence(a: EvidenceItem, b: EvidenceItem): boolean {
  return a.kind === b.kind && a.text === b.text;
}

function sortFindings(findings: CompatibilityFinding[]): CompatibilityFinding[] {
  return findings.sort(
    (a, b) =>
      classificationRank(a.classification) - classificationRank(b.classification) ||
      severityRank(a.severity) - severityRank(b.severity) ||
      compareCodeUnits(a.subject.operationKey ?? '', b.subject.operationKey ?? '') ||
      compareCodeUnits(a.ruleId, b.ruleId) ||
      compareCodeUnits(a.fingerprint, b.fingerprint),
  );
}

/**
 * Classifies perspective-neutral changes with the rule catalog (§10.2). Deterministic: same inputs,
 * same findings in the same order.
 */
export function evaluate(
  changes: readonly ContractChange[],
  base: ApiContract,
  candidate: ApiContract,
  registry: RuleRegistry,
  options: EvaluateOptions = {},
): CompatibilityFinding[] {
  const perspective = options.perspective ?? PROVIDER_BACKWARD;
  const policy = options.policy ?? DEFAULT_CLASSIFICATION_POLICY;
  const byFingerprint = new Map<string, CompatibilityFinding>();
  const fallbackAnchor: SourceRef = { uri: candidate.source.rootUri, pointer: '#' as SourceRef['pointer'] };

  for (const change of changes) {
    for (const rule of registry.byKind(change.kind)) {
      if (rule.direction !== undefined && change.subject.direction !== rule.direction) continue;
      if (options.disabled?.has(rule.id) === true) continue;
      const override = options.overrides?.get(rule.id);
      const ctx: RuleContext = {
        perspective,
        policy,
        options: resolveOptions(rule, override),
        base,
        candidate,
        honorExtensibleEnum: options.honorExtensibleEnum ?? true,
        includeEquivalentChanges: options.includeEquivalentChanges ?? false,
      };
      const a: RuleAssessment | null = rule.assess(change, ctx);
      if (a === null) continue;

      const role = perspective.roleOf(a.area);
      const table = perspective.classify({ role, effect: a.effect, strength: a.strength }, policy);
      let classification: Classification = a.classificationOverride?.classification ?? table.classification;
      let basis: Basis = a.classificationOverride?.basis ?? table.basis;
      let originalClassification: Classification | undefined;
      if (
        override?.classification !== undefined &&
        rule.overridable.classification &&
        override.classification !== classification
      ) {
        originalClassification = classification;
        classification = override.classification;
        basis = classification === 'undetermined' ? 'indeterminate' : 'policy-dependent';
      }
      const deprecatedInBase = operationOf(base, change)?.deprecated === true;
      const unforcedSeverity = computeSeverity(rule, classification, deprecatedInBase, undefined);
      const severity = computeSeverity(rule, classification, deprecatedInBase, override?.severity);

      const op = operationOf(candidate, change) ?? operationOf(base, change);
      const subject: ChangeSubject & { method?: Operation['method']; path?: string } = {
        ...change.subject,
        ...(op === undefined ? {} : { method: op.method, path: op.path }),
      };
      // Rules refer to operations by key (`GET /users/{}`); messages show the declared path.
      const params = {
        ...a.params,
        ...(op !== undefined && 'operation' in a.params ? { operation: `${op.method} ${op.path}` } : {}),
        where: describeSubject(subject),
      };
      const evidence: EvidenceItem[] = [...a.evidence];
      if (change.base.location !== undefined) {
        evidence.push({ kind: 'base-source', text: 'Baseline definition', location: change.base.location });
      }
      if (change.candidate.location !== undefined) {
        evidence.push({ kind: 'candidate-source', text: 'Candidate definition', location: change.candidate.location });
      }
      for (const v of change.candidate.via ?? [])
        evidence.push({ kind: 'reference-chain', text: 'Reached via $ref', location: v });
      evidence.push(
        a.classificationOverride === undefined
          ? {
              kind: 'reasoning',
              text: `${perspective.id}: ${table.tableCell} → ${table.classification} (${table.basis})`,
            }
          : { kind: 'policy', text: a.classificationOverride.justification },
      );
      if (originalClassification !== undefined) {
        evidence.push({
          kind: 'policy',
          text: `Classification overridden by configuration (was ${originalClassification})`,
        });
      }

      const fingerprint = fingerprintOf(rule.id, perspective.id, change);
      const baseFinding: CompatibilityFinding = {
        fingerprint,
        ruleId: rule.id,
        ruleName: rule.name,
        classification,
        severity,
        basis,
        perspective: perspective.id,
        assessment: { role, effect: a.effect, strength: a.strength },
        subject,
        location: {
          ...(change.base.location === undefined ? {} : { base: change.base.location }),
          ...(change.candidate.location === undefined ? {} : { candidate: change.candidate.location }),
          anchor: change.candidate.location ?? change.base.location ?? fallbackAnchor,
        },
        ...(change.base.value === undefined ? {} : { previous: change.base.value }),
        ...(change.candidate.value === undefined ? {} : { current: change.candidate.value }),
        message: interpolate(rule.messages.message, params),
        explanation: interpolate(rule.messages.explanation, params),
        evidence,
        resolution: interpolate(rule.messages.resolution, params),
        overridable: { ...rule.overridable, suppressible: true },
        causeKey: change.causeKey,
        status: 'active',
        ...(originalClassification !== undefined || severity !== unforcedSeverity
          ? {
              overrides: {
                ...(originalClassification === undefined ? {} : { originalClassification }),
                ...(severity === unforcedSeverity ? {} : { originalSeverity: unforcedSeverity }),
                by: `rules.${rule.id}`,
              },
            }
          : {}),
      };
      const ignored = options.ignore?.find((e) => matchesIgnore(e, baseFinding, options.today));
      const finding: CompatibilityFinding =
        ignored === undefined
          ? baseFinding
          : {
              ...baseFinding,
              status: 'suppressed',
              suppression: {
                reason: ignored.reason,
                ...(ignored.expires === undefined ? {} : { expires: ignored.expires }),
                configPointer: ignored.configPointer,
              },
            };

      if (!isValidClassificationBasis(finding.classification, finding.basis)) {
        throw new InternalError(`${rule.id}: invalid classification/basis ${finding.classification}/${finding.basis}`);
      }
      const existing = byFingerprint.get(fingerprint);
      if (existing === undefined) byFingerprint.set(fingerprint, finding);
      else {
        // Same rule, subject and discriminator: merge, keeping the worse classification.
        const worse =
          classificationRank(finding.classification) < classificationRank(existing.classification) ? finding : existing;
        const merged = [...existing.evidence];
        for (const e of finding.evidence) if (!merged.some((m) => sameEvidence(m, e))) merged.push(e);
        byFingerprint.set(fingerprint, { ...worse, evidence: merged });
      }
    }
  }
  return sortFindings([...byFingerprint.values()]);
}
