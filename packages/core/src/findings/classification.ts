/** What a change means for compatibility (ADR-10). */
export type Classification = 'breaking' | 'potentially-breaking' | 'non-breaking' | 'informational' | 'undetermined';
/** How much attention a finding deserves (ADR-10). Kept separate from classification. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
/** Why we believe the classification (ADR-10). */
export type Basis = 'contract-guaranteed' | 'consumer-dependent' | 'policy-dependent' | 'indeterminate';
/** Effect of a change on the set of valid instances (ADR-08). */
export type Effect = 'widens' | 'narrows' | 'incomparable' | 'equivalent' | 'unknown';
/** Kind of constraint affected (ADR-08). */
export type Strength = 'structural' | 'enumerated' | 'value-space' | 'additive' | 'behavioral';
/** Role of a contract area under a perspective: acceptance must not narrow, guarantee must not widen. */
export type Role = 'acceptance' | 'guarantee';

/** Ordered from most to least concerning (used for sorting and gating). */
export const CLASSIFICATIONS: readonly Classification[] = Object.freeze([
  'breaking',
  'potentially-breaking',
  'undetermined',
  'non-breaking',
  'informational',
]);

/** Ordered from most to least severe. */
export const SEVERITIES: readonly Severity[] = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);

export const BASES: readonly Basis[] = Object.freeze([
  'contract-guaranteed',
  'consumer-dependent',
  'policy-dependent',
  'indeterminate',
]);

export const EFFECTS: readonly Effect[] = Object.freeze(['widens', 'narrows', 'incomparable', 'equivalent', 'unknown']);

export const STRENGTHS: readonly Strength[] = Object.freeze([
  'structural',
  'enumerated',
  'value-space',
  'additive',
  'behavioral',
]);

/** 0 = most concerning. */
export function classificationRank(c: Classification): number {
  return CLASSIFICATIONS.indexOf(c);
}

/** 0 = most severe. */
export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

/** True if `s` is at least as severe as `threshold`. */
export function severityAtLeast(s: Severity, threshold: Severity): boolean {
  return severityRank(s) <= severityRank(threshold);
}

/** Lowers severity by one level, never below `floor`. */
export function downgradeSeverity(s: Severity, floor: Severity = 'low'): Severity {
  const next = Math.min(severityRank(s) + 1, severityRank(floor));
  return SEVERITIES[Math.max(next, severityRank(s))] as Severity;
}

/**
 * Valid (classification, basis) combinations (ADR-10):
 * undetermined ⇒ indeterminate; breaking ⇒ contract-guaranteed or policy-dependent.
 */
export function isValidClassificationBasis(c: Classification, b: Basis): boolean {
  switch (c) {
    case 'undetermined':
      return b === 'indeterminate';
    case 'breaking':
      return b === 'contract-guaranteed' || b === 'policy-dependent';
    case 'potentially-breaking':
      return true;
    case 'non-breaking':
    case 'informational':
      return b !== 'indeterminate';
  }
}
