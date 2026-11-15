import type { ClassificationPolicy } from '../config/config.js';
import type { ChangeKind, ChangeOfKind, Direction } from '../findings/changes.js';
import type { Basis, Classification, Effect, Role, Severity, Strength } from '../findings/classification.js';
import type { EvidenceItem, PerspectiveId } from '../findings/finding.js';
import type { ApiContract } from '../model/contract.js';
import type { RuleId } from '../model/identity.js';

/** Contract areas that receive a role under a perspective (§10.3). */
export type ContractArea = 'operations' | 'request' | 'response' | 'credentials' | 'servers';

export const CONTRACT_AREAS: readonly ContractArea[] = Object.freeze([
  'credentials',
  'operations',
  'request',
  'response',
  'servers',
]);

export interface PerspectiveClassification {
  readonly classification: Classification;
  readonly basis: Basis;
  /** Human-readable identifier of the table cell that produced this result, e.g. "acceptance/narrows/structural". */
  readonly tableCell: string;
}

export interface CompatibilityPerspective {
  readonly id: PerspectiveId;
  readonly title: string;
  readonly description: string;
  roleOf(area: ContractArea): Role;
  classify(
    input: { readonly role: Role; readonly effect: Effect; readonly strength: Strength },
    policy: ClassificationPolicy,
  ): PerspectiveClassification;
}

export type RuleArea = 'API' | 'SRV' | 'REQ' | 'RES' | 'SCHEMA' | 'AUTH';

export interface SeverityProfile {
  readonly breaking: Severity;
  readonly potentiallyBreaking: Severity;
  readonly undetermined: Severity;
}

export type RuleParams = Readonly<Record<string, string | number | boolean | readonly string[]>>;

export interface RuleAssessment {
  readonly effect: Effect;
  readonly strength: Strength;
  readonly area: ContractArea;
  /** Rare: bypasses the perspective table; justification is mandatory (§10.4). */
  readonly classificationOverride?: {
    readonly classification: Classification;
    readonly basis: Basis;
    readonly justification: string;
  };
  readonly evidence: readonly EvidenceItem[];
  /** Fills message templates. */
  readonly params: RuleParams;
}

export interface RuleOptionSpec {
  readonly name: string;
  readonly type: 'boolean' | 'string' | 'number';
  readonly default: boolean | string | number;
  readonly description: string;
  readonly allowed?: readonly string[];
}

export type ResolvedRuleOptions = Readonly<Record<string, boolean | string | number>>;

export interface RuleMessages {
  /** One-line message template, e.g. "Request enum value(s) removed: {removed}". */
  readonly message: string;
  readonly explanation: string;
  readonly resolution: string;
}

export interface RuleExample {
  readonly title: string;
  readonly fires: boolean;
  readonly base: string;
  readonly candidate: string;
}

export interface RuleContext {
  readonly perspective: CompatibilityPerspective;
  readonly policy: ClassificationPolicy;
  readonly options: ResolvedRuleOptions;
  readonly base: ApiContract;
  readonly candidate: ApiContract;
  readonly honorExtensibleEnum: boolean;
}

export interface RuleDefinition<K extends ChangeKind = ChangeKind> {
  readonly id: RuleId;
  readonly name: string;
  readonly area: RuleArea;
  readonly summary: string;
  readonly handles: readonly K[];
  /** REQ rules: 'request'; RES rules: 'response'. */
  readonly direction?: Direction;
  /** Returns null when the rule does not apply to this change instance. */
  assess(change: ChangeOfKind<K>, ctx: RuleContext): RuleAssessment | null;
  readonly severityProfile: SeverityProfile;
  readonly overridable: { readonly classification: boolean; readonly severity: boolean };
  readonly options?: readonly RuleOptionSpec[];
  readonly messages: RuleMessages;
  readonly docs: {
    readonly rationale: string;
    readonly limitations: readonly string[];
    readonly examples: readonly RuleExample[];
  };
}
