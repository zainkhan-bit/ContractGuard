import type { ApiContract, RuleDefinition } from '@zainkhan-bit/contractguard-core';
import { areaOf, assessed, defineRule, DEFAULT_SEVERITY, overridden, reasoning } from './define.js';
import { typeParams } from './req.js';

const UNDETERMINED_MEDIUM = ['high', 'medium', 'medium'] as const;
const UNDETERMINED_HIGH = ['high', 'medium', 'high'] as const;

export const SCHEMA_RULES: readonly RuleDefinition[] = [
  defineRule({
    id: 'CG-SCHEMA-001',
    name: 'Incompatible type change',
    summary: 'The base and candidate type sets are disjoint.',
    handles: ['schema.typeChanged'],
    severity: ['critical', 'high', 'medium'],
    messages: {
      message: 'Type of {where} changed incompatibly ({from} → {to}).',
      explanation: 'No value valid before is valid now, in either direction.',
      resolution: 'Keep the previous type, introduce a new field instead, or release as a new major version.',
    },
    rationale: 'Disjoint types break both senders and readers.',
    examples: [
      ['string → object', true],
      ['array → string', true],
      ['integer → number', false],
    ],
    assess: (c) =>
      c.facts.relation === 'disjoint' ? assessed(areaOf(c), 'incomparable', 'structural', typeParams(c)) : null,
  }),
  defineRule({
    id: 'CG-SCHEMA-002',
    name: 'Schema representation changed (equivalent)',
    summary: 'The schema is spelled differently but means the same.',
    handles: ['schema.representationChanged'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Representation of {where} changed ({what}) without changing its meaning.',
      explanation: 'Validation behaviour is unchanged.',
      resolution: 'No action needed.',
    },
    rationale: 'Reported only on request, for review.',
    examples: [
      ['3.0 nullable → 3.1 type array', true],
      ['Any semantic change', false],
    ],
    assess: (c, ctx) =>
      ctx.includeEquivalentChanges ? assessed(areaOf(c), 'equivalent', 'structural', { what: c.facts.what }) : null,
  }),
  defineRule({
    id: 'CG-SCHEMA-900',
    name: 'Unsupported schema construct changed',
    summary: 'A schema keyword ContractGuard does not analyze changed.',
    handles: ['schema.unsupportedChanged', 'schema.propertyAdded', 'schema.propertyRemoved'],
    severity: UNDETERMINED_MEDIUM,
    messages: {
      message: '{what} changed in {where} and was not analyzed.',
      explanation: 'ContractGuard v1 does not evaluate these keywords, so the compatibility impact is unknown.',
      resolution: 'Review the change manually.',
    },
    rationale: 'Unknown impact is reported as undetermined rather than guessed.',
    limitations: ['By definition.'],
    examples: [
      ['if/then/else edited', true],
      ['not added', true],
      ['Unsupported keyword present but unchanged', false],
    ],
    assess: (c) => {
      if (c.kind === 'schema.unsupportedChanged') {
        if (c.facts.keywords.includes('callbacks') && c.subject.site.kind === 'operation') return null; // API-007
        return assessed(areaOf(c), 'unknown', 'structural', { what: `\`${c.facts.keywords.join('`, `')}\`` });
      }
      return c.facts.parentHasUnevaluatedProperties
        ? assessed(areaOf(c), 'unknown', 'structural', {
            what: `Property "${c.facts.property}" under unevaluated/pattern properties`,
          })
        : null;
    },
  }),
  defineRule({
    id: 'CG-SCHEMA-901',
    name: 'Composition not analyzable',
    summary: 'Composition branches could not be matched reliably.',
    handles: ['schema.compositionUnanalyzable'],
    severity: UNDETERMINED_MEDIUM,
    messages: {
      message: 'Composition in {where} could not be analyzed: {reason}.',
      explanation: 'Branches could not be paired between versions, so branch-level changes are unknown.',
      resolution: 'Name branches with $ref or title so they can be matched, or review manually.',
    },
    rationale: 'Ambiguous matches would produce unreliable findings.',
    examples: [
      ['Two anonymous oneOf branches changed with equal similarity', true],
      ['Branches matched unambiguously', false],
    ],
    assess: (c) => assessed(areaOf(c), 'unknown', 'structural', { reason: c.facts.reason }),
  }),
  defineRule({
    id: 'CG-SCHEMA-902',
    name: 'Analysis budget exceeded',
    summary: 'Schema comparison stopped at the configured limit.',
    handles: ['schema.budgetExceeded'],
    severity: UNDETERMINED_HIGH,
    messages: {
      message: 'Schema analysis stopped at {where} ({limit} reached).',
      explanation: 'Deeper changes were not compared.',
      resolution: 'Raise limits.{limit} in the configuration, or split the specification.',
    },
    rationale: 'Incomplete analysis must be visible.',
    examples: [
      ['maxSchemaPairs: 10 on a large fixture', true],
      ['Normal fixture', false],
    ],
    assess: (c) => assessed(areaOf(c), 'unknown', 'structural', { limit: c.facts.limit }),
  }),
  defineRule({
    id: 'CG-SCHEMA-903',
    name: 'Unresolved reference in compared schema',
    summary: 'A compared schema contains a reference that could not be resolved.',
    handles: ['schema.unresolvedReference'],
    severity: UNDETERMINED_HIGH,
    messages: {
      message: 'Reference {raw} in {where} could not be resolved.',
      explanation: 'The referenced schema is unknown, so the comparison is incomplete.',
      resolution: 'Fix the reference.',
    },
    rationale: 'Only reachable with allowInvalidSpec.',
    examples: [
      ['$ref to a missing file', true],
      ['All references resolve', false],
    ],
    assess: (c) => assessed(areaOf(c), 'unknown', 'structural', { raw: c.facts.raw }),
  }),
];

/** Operations whose base security requirements use a scheme. */
function operationsUsing(contract: ApiContract, scheme: string): string[] {
  const out: string[] = [];
  for (const op of contract.operations.values()) {
    if (op.security.alternatives.some((alt) => alt.has(scheme))) out.push(op.key);
  }
  return out;
}

export const AUTH_RULES: readonly RuleDefinition[] = [
  defineRule({
    id: 'CG-AUTH-001',
    name: 'Authentication requirement tightened',
    summary: 'Some baseline credential no longer works, or anonymous access was removed.',
    handles: ['security.alternativesChanged'],
    severity: ['critical', 'high', 'medium'],
    messages: {
      message: 'Authentication of {operation} is stricter: {what}.',
      explanation: 'Consumers using the affected credentials (or none) will be rejected.',
      resolution: 'Keep accepting the previous credentials during a transition.',
    },
    rationale: 'Requests authenticated the old way become unauthorized.',
    limitations: ['Credentials consumers actually hold are unknown.'],
    examples: [
      ['security [] → [{bearer: []}]', true],
      ['[{apiKey}, {oauth: [read]}] → [{oauth: [read]}]', true],
      ['Scheme renamed with an identical definition', false],
      ['Alternative added', false],
    ],
    assess: (c) => {
      const covered = new Set(c.facts.scopeAdditions.map((s) => s.alternative));
      const hard = c.facts.unsatisfiedBaseAlternatives.filter((i) => !covered.has(i));
      if (!c.facts.anonymousRemoved && hard.length === 0) return null;
      const what = c.facts.anonymousRemoved
        ? 'anonymous access is no longer allowed'
        : `${hard.length} previously accepted credential option(s) no longer work`;
      return assessed('credentials', 'narrows', 'structural', { operation: c.subject.operationKey ?? '', what });
    },
  }),
  defineRule({
    id: 'CG-AUTH-002',
    name: 'Additional scopes required',
    summary: 'The same schemes are required, with more scopes.',
    handles: ['security.alternativesChanged'],
    severity: ['critical', 'high', 'medium'],
    messages: {
      message: '{operation} now requires additional scopes: {scopes}.',
      explanation: 'Tokens without the new scopes will be rejected; existing tokens may already carry them.',
      resolution: 'Make sure consumers request the new scopes before enforcing them.',
    },
    rationale: 'Whether tokens already carry the scope depends on the consumer.',
    examples: [
      ['oauth [read] → [read, write]', true],
      ['Scope removed', false],
    ],
    assess: (c) => {
      const covered = new Set(c.facts.scopeAdditions.map((s) => s.alternative));
      const onlyScopes =
        !c.facts.anonymousRemoved &&
        c.facts.scopeAdditions.length > 0 &&
        c.facts.unsatisfiedBaseAlternatives.every((i) => covered.has(i));
      if (!onlyScopes) return null;
      const scopes = [...new Set(c.facts.scopeAdditions.flatMap((s) => s.scopes.map((x) => `${s.scheme}:${x}`)))];
      return overridden(
        assessed('credentials', 'narrows', 'value-space', { operation: c.subject.operationKey ?? '', scopes }),
        'potentially-breaking',
        'consumer-dependent',
        'Tokens may already carry the additional scopes.',
      );
    },
  }),
  defineRule({
    id: 'CG-AUTH-003',
    name: 'Authentication relaxed',
    summary: 'Every baseline credential still works and more are accepted.',
    handles: ['security.alternativesChanged'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Authentication of {operation} was relaxed.',
      explanation: 'Existing consumers keep working.',
      resolution: 'Review the security implications of relaxed authentication.',
    },
    rationale: 'More accepted credentials widen accepted requests.',
    examples: [
      ['Anonymous access allowed', true],
      ['Alternative added', true],
      ['Alternative removed', false],
    ],
    assess: (c) =>
      c.facts.relaxed
        ? assessed('credentials', 'widens', 'structural', { operation: c.subject.operationKey ?? '' }, [
            reasoning('Review the security implications of relaxed authentication.'),
          ])
        : null,
  }),
  defineRule({
    id: 'CG-AUTH-004',
    name: 'Security scheme changed incompatibly',
    summary: "A scheme's type, apiKey name/location, HTTP scheme or OpenID Connect URL changed.",
    handles: ['securityScheme.changed'],
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'Security scheme "{scheme}" changed incompatibly ({fields}).',
      explanation:
        'Consumers send credentials the old way; the provider expects them differently. Used by: {operations}.',
      resolution: 'Introduce a new scheme alongside the old one instead of changing it in place.',
    },
    rationale: 'Credentials are sent according to the scheme definition.',
    examples: [
      ['apiKey header X-API-Key → X-Api-Token', true],
      ['http basic → http bearer', true],
      ['bearerFormat change only', false],
    ],
    assess: (c, ctx) => {
      const fields = c.facts.fields.filter((f) => !f.startsWith('flows') && f !== 'bearerFormat');
      if (!c.facts.incompatible || fields.length === 0) return null;
      const used = operationsUsing(ctx.base, c.facts.scheme);
      return assessed('credentials', 'incomparable', 'structural', {
        scheme: c.facts.scheme,
        fields,
        operations: used.length === 0 ? 'no operation' : used,
      });
    },
  }),
  defineRule({
    id: 'CG-AUTH-005',
    name: 'OAuth2 flow changed',
    summary:
      'An OAuth2 flow was removed, its URLs changed or declared scopes removed (or only descriptive fields changed).',
    handles: ['securityScheme.changed'],
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'Security scheme "{scheme}" changed ({fields}).',
      explanation: '{explanation}',
      resolution: '{resolution}',
    },
    rationale: 'Token acquisition depends on flow definitions.',
    examples: [
      ['authorizationCode flow removed', true],
      ['tokenUrl host changed', true],
      ['Scope description edited', false],
    ],
    assess: (c) => {
      const flows = c.facts.fields.filter((f) => f.startsWith('flows'));
      if (flows.length > 0) {
        return assessed('credentials', 'incomparable', 'behavioral', {
          scheme: c.facts.scheme,
          fields: flows,
          explanation: 'Consumers obtaining tokens through the changed flow may fail.',
          resolution: 'Keep the previous flow endpoints working during a transition.',
        });
      }
      const descriptive = c.facts.fields.filter((f) => f === 'bearerFormat');
      return descriptive.length > 0
        ? assessed('credentials', 'equivalent', 'behavioral', {
            scheme: c.facts.scheme,
            fields: descriptive,
            explanation: 'Descriptive fields do not change how credentials are sent.',
            resolution: 'No action needed.',
          })
        : null;
    },
  }),
  defineRule({
    id: 'CG-AUTH-006',
    name: 'Security scheme renamed',
    summary: 'A security scheme was renamed with an identical definition.',
    handles: ['securityScheme.renamed'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Security scheme "{from}" was renamed to "{to}".',
      explanation: 'Scheme names are not sent on the wire.',
      resolution: 'No action needed.',
    },
    rationale: 'Identical definitions authenticate identically.',
    examples: [
      ['ApiKeyAuth → apiKey with identical definition', true],
      ['Definition changed (→ AUTH-004)', false],
    ],
    assess: (c) => assessed('credentials', 'equivalent', 'structural', { from: c.facts.from, to: c.facts.to }),
  }),
];
