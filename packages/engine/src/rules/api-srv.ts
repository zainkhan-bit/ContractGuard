import type { RuleDefinition } from '@contractguard/core';
import { assessed, assumption, DEFAULT_SEVERITY, defineRule, overridden, reasoning } from './define.js';

export const API_RULES: readonly RuleDefinition[] = [
  defineRule({
    id: 'CG-API-001',
    name: 'Operation removed',
    summary: 'An operation in the baseline has no counterpart in the candidate.',
    handles: ['operation.removed'],
    severity: ['critical', 'high', 'medium'],
    messages: {
      message: 'Operation {operation} was removed.',
      explanation:
        'Consumers that call {operation} will receive an error (typically 404 or 405) from a provider that implements the candidate.',
      resolution: 'Keep the operation (mark it deprecated first), or release the removal as a new major version.',
    },
    rationale: 'Removing an operation is the most direct way to break existing consumers.',
    limitations: ['The specification may differ from what the implementation still serves.'],
    examples: [
      ['DELETE /users/{id} removed', true],
      ['A method removed from a path that keeps other methods', true],
      ['A path parameter renamed ({id} → {userId})', false],
      ['The candidate adds methods to an existing path', false],
    ],
    assess: (c) => assessed('operations', 'narrows', 'structural', { operation: c.subject.operationKey ?? '' }),
  }),
  defineRule({
    id: 'CG-API-002',
    name: 'Operation added',
    summary: 'The candidate adds a new operation.',
    handles: ['operation.added'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Operation {operation} was added.',
      explanation: 'New operations do not affect existing consumers.',
      resolution: 'No action needed.',
    },
    rationale: 'Additions widen what the provider accepts.',
    examples: [
      ['New POST /orders', true],
      ['Operation present in both versions', false],
    ],
    assess: (c) => assessed('operations', 'widens', 'structural', { operation: c.subject.operationKey ?? '' }),
  }),
  defineRule({
    id: 'CG-API-003',
    name: 'Operation path changed (probable rename)',
    summary: 'A removed operation matches an added one by operationId or a case/trailing-slash difference.',
    handles: ['operation.probableRename'],
    severity: ['critical', 'high', 'medium'],
    messages: {
      message: 'Operation {from} appears to have moved to {to}.',
      explanation: 'Consumers still calling {from} will fail; the match was found by {evidenceKind}.',
      resolution: 'Keep {from} as a deprecated alias of {to}, or release the move as a new major version.',
    },
    rationale: 'A moved operation is a removal for existing consumers even when the functionality survives.',
    limitations: ['The match is a heuristic; it never hides the removal, it only explains it.'],
    examples: [
      ['GET /user/{id} (getUser) → GET /users/{id} (getUser)', true],
      ['/users/ → /users', true],
      ['Same operationId on a different method', false],
      ['Duplicate operationIds (no hint)', false],
    ],
    assess: (c) =>
      assessed(
        'operations',
        'narrows',
        'structural',
        {
          from: c.facts.fromKey,
          to: c.facts.toKey,
          evidenceKind: c.facts.evidence === 'operationId' ? 'operationId' : 'path similarity',
        },
        [
          reasoning(
            c.facts.evidence === 'operationId'
              ? 'Same unique operationId and method on both sides.'
              : 'Paths differ only by letter case or a trailing slash.',
          ),
        ],
      ),
  }),
  defineRule({
    id: 'CG-API-004',
    name: 'Operation deprecation changed',
    summary: 'The deprecated flag of an operation was toggled.',
    handles: ['operation.deprecated'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Operation {operation} is {state}.',
      explanation: 'Deprecation does not change the wire contract, but signals a planned removal.',
      resolution: 'Communicate the timeline to consumers.',
    },
    rationale: 'Deprecation is metadata; it is reported for visibility.',
    limitations: ['Deprecation and Sunset response headers are not interpreted.'],
    examples: [
      ['deprecated: true added', true],
      ['deprecated removed', true],
      ['Unchanged', false],
    ],
    assess: (c) =>
      assessed('operations', 'equivalent', 'behavioral', {
        operation: c.subject.operationKey ?? '',
        state: c.facts.deprecated ? 'now deprecated' : 'no longer deprecated',
      }),
  }),
  defineRule({
    id: 'CG-API-005',
    name: 'Path parameter renamed',
    summary: 'A path template variable changed name at the same position.',
    handles: ['path.parameterRenamed'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Path parameter {{from}} was renamed to {{to}}.',
      explanation: 'The URL on the wire is unchanged; only generated code that exposes the name is affected.',
      resolution: 'No wire change. Check generated SDKs if names matter.',
    },
    rationale: 'Template names are not sent on the wire.',
    limitations: ['SDK generators may expose the name.'],
    examples: [
      ['/users/{id} → /users/{userId}', true],
      ['A segment moved to a different position', false],
    ],
    assess: (c) => assessed('operations', 'equivalent', 'structural', { from: c.facts.from, to: c.facts.to }),
  }),
  defineRule({
    id: 'CG-API-006',
    name: 'operationId changed',
    summary: 'The same operation has a different operationId.',
    handles: ['operation.operationIdChanged'],
    severity: ['high', 'medium', 'medium'],
    classificationOverridable: true,
    options: [
      {
        name: 'sdkSensitive',
        type: 'boolean',
        default: false,
        description: 'Treat operationId changes as potentially breaking because generated SDK method names change.',
      },
    ],
    messages: {
      message: 'operationId of {operation} changed from "{from}" to "{to}".',
      explanation: 'The wire contract is unchanged, but generated SDK method names derived from operationId change.',
      resolution: 'Keep operationIds stable, or treat SDK regeneration as a breaking release for SDK users.',
    },
    rationale: 'operationId is a code-generation identity, not a wire identity.',
    examples: [
      ['getUser → fetchUser', true],
      ['operationId added where none existed', false],
    ],
    assess: (c, ctx) => {
      const a = assessed('operations', 'equivalent', 'behavioral', {
        operation: c.subject.operationKey ?? '',
        from: typeof c.base.value === 'string' ? c.base.value : '',
        to: typeof c.candidate.value === 'string' ? c.candidate.value : '',
      });
      return ctx.options['sdkSensitive'] === true
        ? overridden(a, 'potentially-breaking', 'policy-dependent', 'sdkSensitive: generated SDK method names change.')
        : a;
    },
  }),
  defineRule({
    id: 'CG-API-007',
    name: 'Callback definitions changed',
    summary: 'Callbacks on an operation differ; callbacks are not analyzed in v1.',
    handles: ['schema.unsupportedChanged'],
    severity: ['high', 'medium', 'low'],
    messages: {
      message: 'Callbacks of {operation} changed and were not analyzed.',
      explanation: 'ContractGuard v1 does not compare callback contents, so the impact is unknown.',
      resolution: 'Review the callback changes manually.',
    },
    rationale: 'Unknown impact is reported as undetermined rather than guessed.',
    limitations: ['Full callback analysis is planned after 1.0.'],
    examples: [
      ['Callbacks added or removed', true],
      ['Callbacks identical', false],
    ],
    assess: (c) =>
      c.facts.keywords.includes('callbacks') && c.subject.site.kind === 'operation'
        ? assessed('operations', 'unknown', 'behavioral', { operation: c.subject.operationKey ?? '' })
        : null,
  }),
];

const SERVER_JUSTIFICATION = 'Servers describe deployments; consumers may be configured with any of them (§10.4).';

export const SRV_RULES: readonly RuleDefinition[] = [
  defineRule({
    id: 'CG-SRV-001',
    name: 'Server removed',
    summary: 'A server URL present in the baseline is absent from the candidate.',
    handles: ['server.removed'],
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'Server {url} was removed.',
      explanation: 'Consumers configured with this server may no longer reach the API.',
      resolution: 'Keep the server entry while it is still deployed, or announce the change.',
    },
    rationale: 'The server list tells consumers where the API lives.',
    limitations: ['Actual deployments are unknown.'],
    examples: [
      ['https://eu.api.example.com removed', true],
      ['Servers reordered', false],
    ],
    assess: (c) =>
      overridden(
        assessed('servers', 'narrows', 'structural', { url: typeof c.base.value === 'string' ? c.base.value : '' }),
        'potentially-breaking',
        'consumer-dependent',
        SERVER_JUSTIFICATION,
      ),
  }),
  defineRule({
    id: 'CG-SRV-002',
    name: 'Server base path changed',
    summary: "A server's base path no longer exists in the candidate, so operation URLs move.",
    handles: ['server.basePathChanged'],
    severity: ['high', 'high', 'medium'],
    messages: {
      message: 'Base path of server {url} is no longer served by any candidate server.',
      explanation: 'Every operation URL under this base path moves; consumers using the old base path may fail.',
      resolution: 'Serve both base paths during a transition, or release as a new major version.',
    },
    rationale: 'Base paths are part of every operation URL.',
    limitations: ['Deployments often serve both versions.'],
    examples: [
      ['https://api.x.com/v1 → https://api.x.com/v2', true],
      ['Host change only (→ SRV-001)', false],
    ],
    assess: (c) =>
      overridden(
        assessed('servers', 'narrows', 'structural', { url: typeof c.base.value === 'string' ? c.base.value : '' }),
        'potentially-breaking',
        'consumer-dependent',
        SERVER_JUSTIFICATION,
      ),
  }),
  defineRule({
    id: 'CG-SRV-003',
    name: 'Server variable values narrowed',
    summary: "A server variable's enum lost values.",
    handles: ['server.variableEnumNarrowed'],
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'A server variable no longer allows some previously documented values.',
      explanation: 'Consumers configured with a removed value may no longer reach the API.',
      resolution: 'Keep the values while the corresponding deployments exist.',
    },
    rationale: 'Server variables select deployments.',
    limitations: ['Actual deployments are unknown.'],
    examples: [
      ['region: enum [us, eu] → [us]', true],
      ['Enum widened', false],
    ],
    assess: () =>
      overridden(
        assessed('servers', 'narrows', 'enumerated', {}, [
          assumption('Consumers may be configured with any documented value.'),
        ]),
        'potentially-breaking',
        'consumer-dependent',
        SERVER_JUSTIFICATION,
      ),
  }),
];
