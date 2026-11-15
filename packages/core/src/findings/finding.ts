import type { CanonicalJson } from '../ids/canonical-json.js';
import type { HttpMethod } from '../model/contract.js';
import type { RuleId, SourceRef } from '../model/identity.js';
import type { ChangeSubject } from './changes.js';
import type { Basis, Classification, Effect, Role, Severity, Strength } from './classification.js';

export type PerspectiveId = 'provider-backward' | 'consumer-forward' | (string & {});

export interface EvidenceItem {
  readonly kind: 'base-source' | 'candidate-source' | 'reference-chain' | 'reasoning' | 'assumption' | 'policy';
  /** Deterministic, template-generated text. */
  readonly text: string;
  readonly location?: SourceRef;
}

export interface FindingLocation {
  readonly base?: SourceRef;
  readonly candidate?: SourceRef;
  /** Best place to annotate (§13.5); always present. */
  readonly anchor: SourceRef;
}

export interface CompatibilityFinding {
  readonly fingerprint: string;
  readonly ruleId: RuleId;
  readonly ruleName: string;
  readonly classification: Classification;
  readonly severity: Severity;
  readonly basis: Basis;
  readonly perspective: PerspectiveId;
  readonly assessment: { readonly role?: Role; readonly effect: Effect; readonly strength: Strength };
  readonly subject: ChangeSubject & { readonly method?: HttpMethod; readonly path?: string };
  readonly location: FindingLocation;
  /** Previous contract value (truncated/redacted per §16.2 T11). */
  readonly previous?: CanonicalJson;
  /** New contract value. */
  readonly current?: CanonicalJson;
  readonly message: string;
  readonly explanation: string;
  /** At least one item. */
  readonly evidence: readonly EvidenceItem[];
  readonly resolution: string;
  readonly overridable: { readonly classification: boolean; readonly severity: boolean; readonly suppressible: true };
  readonly causeKey: string;
  readonly status: 'active' | 'suppressed';
  readonly overrides?: {
    readonly originalClassification?: Classification;
    readonly originalSeverity?: Severity;
    readonly by: string;
  };
  readonly suppression?: { readonly reason: string; readonly expires?: string; readonly configPointer: string };
}
