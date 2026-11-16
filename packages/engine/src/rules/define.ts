import {
  ruleId,
  stringifyCanonical,
  type Basis,
  type CanonicalJson,
  type ChangeKind,
  type ChangeOfKind,
  type Classification,
  type ContractArea,
  type ContractChange,
  type Direction,
  type Effect,
  type EvidenceItem,
  type RuleArea,
  type RuleAssessment,
  type RuleContext,
  type RuleDefinition,
  type RuleExample,
  type RuleMessages,
  type RuleOptionSpec,
  type RuleParams,
  type Severity,
  type SeverityProfile,
  type Strength,
} from '@contractguard/core';

export interface RuleSpec<K extends ChangeKind> {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly handles: readonly K[];
  readonly direction?: Direction;
  /** Severities for breaking / potentially-breaking / undetermined outcomes. */
  readonly severity: readonly [breaking: Severity, potentiallyBreaking: Severity, undetermined: Severity];
  readonly classificationOverridable?: boolean;
  readonly options?: readonly RuleOptionSpec[];
  readonly messages: RuleMessages;
  readonly rationale: string;
  readonly limitations?: readonly string[];
  /** Catalog examples: [description, fires]. Executable versions live in the compatibility fixtures. */
  readonly examples: readonly (readonly [string, boolean])[];
  assess(change: ChangeOfKind<K>, ctx: RuleContext): RuleAssessment | null;
}

/** Builds a RuleDefinition; the area comes from the id (`CG-<AREA>-NNN`). */
export function defineRule<K extends ChangeKind>(spec: RuleSpec<K>): RuleDefinition {
  const id = ruleId(spec.id);
  const area = spec.id.split('-')[1] as RuleArea;
  const [breaking, potentiallyBreaking, undetermined] = spec.severity;
  const severityProfile: SeverityProfile = { breaking, potentiallyBreaking, undetermined };
  const examples: RuleExample[] = spec.examples.map(([title, fires]) => ({ title, fires, base: '', candidate: '' }));
  const def: RuleDefinition<K> = {
    id,
    name: spec.name,
    area,
    summary: spec.summary,
    handles: spec.handles,
    ...(spec.direction === undefined ? {} : { direction: spec.direction }),
    assess: (change, ctx) => spec.assess(change, ctx),
    severityProfile,
    overridable: { classification: spec.classificationOverridable ?? false, severity: true },
    ...(spec.options === undefined ? {} : { options: spec.options }),
    messages: spec.messages,
    docs: { rationale: spec.rationale, limitations: spec.limitations ?? [], examples },
  };
  return def as unknown as RuleDefinition;
}

/** A plain table-classified assessment. */
export function assessed(
  area: ContractArea,
  effect: Effect,
  strength: Strength,
  params: RuleParams = {},
  evidence: readonly EvidenceItem[] = [],
): RuleAssessment {
  return { area, effect, strength, params, evidence };
}

/** An assessment whose classification bypasses the table (§10.4) — always with a justification. */
export function overridden(
  base: RuleAssessment,
  classification: Classification,
  basis: Basis,
  justification: string,
): RuleAssessment {
  return { ...base, classificationOverride: { classification, basis, justification } };
}

export const reasoning = (text: string): EvidenceItem => ({ kind: 'reasoning', text });
export const assumption = (text: string): EvidenceItem => ({ kind: 'assumption', text });

/** The contract area of a schema-level change, from its direction. */
export function areaOf(change: ContractChange): ContractArea {
  return change.subject.direction === 'response'
    ? 'response'
    : change.subject.direction === 'request'
      ? 'request'
      : 'operations';
}

/** Short JSON rendering of values for messages. */
export function show(values: readonly CanonicalJson[]): string[] {
  return values.map((v) => (typeof v === 'string' ? v : stringifyCanonical(v)));
}

export const DEFAULT_SEVERITY = ['high', 'medium', 'medium'] as const;
