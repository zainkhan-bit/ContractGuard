import {
  DEFAULT_LIMITS,
  type ApiContract,
  type ChangeKind,
  type CompatibilityFinding,
  type ContractChange,
  type RuleDefinition,
  type RuleExample,
  type RuleOptionSpec,
  type SeverityProfile,
} from '@zainkhan-bit/contractguard-core';
import { evaluate, RuleRegistry, type EvaluateOptions } from './compat/evaluate.js';
import { diffContracts } from './diff/contract-diff.js';
import { RULES, RULESET_VERSION } from './rules/index.js';

/** The default registry over the v1 catalog. */
export const DEFAULT_REGISTRY: RuleRegistry = new RuleRegistry(RULES);

export interface CheckOptions extends EvaluateOptions {
  readonly maxSchemaPairs?: number;
  readonly registry?: RuleRegistry;
}

export interface CheckResult {
  readonly findings: readonly CompatibilityFinding[];
  /** The perspective-neutral changes the findings were derived from. */
  readonly changes: readonly ContractChange[];
  readonly schemaPairs: number;
  readonly rulesetVersion: string;
}

/** Diff two canonical contracts and classify the changes (§9 + §10). Pure and deterministic. */
export function checkCompatibility(base: ApiContract, candidate: ApiContract, options: CheckOptions = {}): CheckResult {
  const diff = diffContracts(base, candidate, {
    limits: { maxSchemaPairs: options.maxSchemaPairs ?? DEFAULT_LIMITS.maxSchemaPairs },
  });
  const findings = evaluate(diff.changes, base, candidate, options.registry ?? DEFAULT_REGISTRY, options);
  return { findings, changes: diff.changes, schemaPairs: diff.schemaPairs, rulesetVersion: RULESET_VERSION };
}

/** Everything `contractguard explain <rule>` shows. */
export interface RuleExplanation {
  readonly id: string;
  readonly name: string;
  readonly area: string;
  readonly summary: string;
  readonly rationale: string;
  readonly limitations: readonly string[];
  readonly examples: readonly RuleExample[];
  readonly handles: readonly ChangeKind[];
  readonly direction?: string;
  readonly severityProfile: SeverityProfile;
  readonly overridable: RuleDefinition['overridable'];
  readonly options: readonly RuleOptionSpec[];
  readonly messages: RuleDefinition['messages'];
}

export function explainRule(id: string, registry: RuleRegistry = DEFAULT_REGISTRY): RuleExplanation | undefined {
  const r = registry.byId(id.toUpperCase());
  if (r === undefined) return undefined;
  return {
    id: r.id,
    name: r.name,
    area: r.area,
    summary: r.summary,
    rationale: r.docs.rationale,
    limitations: r.docs.limitations,
    examples: r.docs.examples,
    handles: r.handles,
    ...(r.direction === undefined ? {} : { direction: r.direction }),
    severityProfile: r.severityProfile,
    overridable: r.overridable,
    options: r.options ?? [],
    messages: r.messages,
  };
}
