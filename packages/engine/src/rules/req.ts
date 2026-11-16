import type { ChangeOfKind, RuleContext, RuleDefinition } from '@contractguard/core';
import { expandTypes } from '../schema/relations.js';
import { assessed, assumption, defineRule, DEFAULT_SEVERITY, overridden, reasoning, show } from './define.js';

const BREAKING_HIGH = ['high', 'medium', 'medium'] as const;
const POTENTIAL_MEDIUM = ['high', 'medium', 'medium'] as const;

/** True when a candidate parameter's schema only admits primitive values (explode then has no effect). */
function primitiveParameter(c: ChangeOfKind<'parameter.serializationChanged'>, ctx: RuleContext): boolean {
  const site = c.subject.site;
  if (site.kind !== 'parameter' || c.subject.operationKey === undefined) return false;
  const p = ctx.candidate.operations.get(c.subject.operationKey)?.parameters.get(site.key);
  if (p?.value.kind !== 'schema') return false;
  const node = ctx.candidate.schemas.nodes.get(p.value.schema.target);
  if (node?.types === undefined) return false;
  const types = expandTypes(node.types);
  return !types.has('array') && !types.has('object');
}

export const REQ_RULES: readonly RuleDefinition[] = [
  // ------------------------------------------------------------------ structure
  defineRule({
    id: 'CG-REQ-001',
    name: 'New required request body property',
    summary: 'A property was added to a request schema and is required.',
    handles: ['schema.propertyAdded'],
    direction: 'request',
    severity: BREAKING_HIGH,
    messages: {
      message: 'New required property "{property}" in {where}.',
      explanation:
        'Existing consumers do not send "{property}", so a provider that enforces the candidate will reject their requests.',
      resolution: 'Make "{property}" optional (with a server-side default), or release as a new major version.',
    },
    rationale: 'Requests valid under the baseline lack the new required property.',
    limitations: ['A server-side default for missing values cannot be seen in the specification.'],
    examples: [
      ['POST body adds `currency` and `required: [currency]`', true],
      ['Nested object inside array items', true],
      ['Added optional property', false],
      ['Added required property that is readOnly', false],
      ['Same change in a response', false],
    ],
    assess: (c) =>
      c.facts.required && !c.facts.parentHasUnevaluatedProperties
        ? assessed('request', 'narrows', 'structural', { property: c.facts.property })
        : null,
  }),
  defineRule({
    id: 'CG-REQ-002',
    name: 'Request parameter became required',
    summary: 'An existing optional parameter is now required.',
    handles: ['parameter.requiredChanged'],
    severity: BREAKING_HIGH,
    messages: {
      message: '{where} became required.',
      explanation: 'Consumers that omit this parameter will be rejected.',
      resolution: 'Keep the parameter optional with a documented default, or release as a new major version.',
    },
    rationale: 'Requests that omitted an optional parameter become invalid.',
    examples: [
      ['Query `limit` required: false → true', true],
      ['required: true → false', false],
    ],
    assess: (c) => (!c.facts.from && c.facts.to ? assessed('request', 'narrows', 'structural') : null),
  }),
  defineRule({
    id: 'CG-REQ-003',
    name: 'Request body property became required',
    summary: 'An existing optional request property is now required.',
    handles: ['schema.requiredChanged'],
    direction: 'request',
    severity: BREAKING_HIGH,
    messages: {
      message: 'Property "{property}" became required in {where}.',
      explanation: 'Consumers that omit "{property}" will be rejected.',
      resolution: 'Keep "{property}" optional with a server-side default, or release as a new major version.',
    },
    rationale: 'Requests that omitted an optional property become invalid.',
    limitations: ['A server-side default for missing values cannot be seen in the specification.'],
    examples: [
      ['required: [a] → [a, b] with b defined on both sides', true],
      ['The property is readOnly', false],
      ['Response direction', false],
    ],
    assess: (c) =>
      !c.facts.from && c.facts.to ? assessed('request', 'narrows', 'structural', { property: c.facts.property }) : null,
  }),
  defineRule({
    id: 'CG-REQ-004',
    name: 'New required request parameter',
    summary: 'A new required query, header or cookie parameter.',
    handles: ['parameter.added'],
    severity: BREAKING_HIGH,
    messages: {
      message: 'New required {where}.',
      explanation: 'Existing consumers do not send this parameter, so their requests will be rejected.',
      resolution: 'Make the parameter optional with a default, or release as a new major version.',
    },
    rationale: 'Requests valid under the baseline lack the new required parameter.',
    examples: [
      ['Required header X-Tenant added', true],
      ['Optional parameter added', false],
      ['Parameter moved from query to header (→ REQ-007)', false],
    ],
    assess: (c) => (c.facts.required ? assessed('request', 'narrows', 'structural') : null),
  }),
  defineRule({
    id: 'CG-REQ-005',
    name: 'New optional request input',
    summary: 'An optional parameter or optional request property was added.',
    handles: ['parameter.added', 'schema.propertyAdded'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'New optional input in {where}{suffix}.',
      explanation: 'Existing consumers can keep omitting it.',
      resolution: 'No action needed.',
    },
    rationale: 'Optional additions widen what the provider accepts.',
    examples: [
      ['Optional `sort` query parameter added', true],
      ['Optional `note` property added to a POST body', true],
      ['Required parameter or property added', false],
      ['Response direction', false],
    ],
    assess: (c) => {
      if (c.kind === 'schema.propertyAdded') {
        if (c.subject.direction !== 'request' || c.facts.required || c.facts.parentHasUnevaluatedProperties)
          return null;
        return assessed('request', 'widens', 'additive', { suffix: `: "${c.facts.property}"` });
      }
      return c.facts.required ? null : assessed('request', 'widens', 'additive', { suffix: '' });
    },
  }),
  defineRule({
    id: 'CG-REQ-006',
    name: 'Request parameter removed',
    summary: 'A documented parameter no longer exists.',
    handles: ['parameter.removed'],
    severity: POTENTIAL_MEDIUM,
    classificationOverridable: true,
    messages: {
      message: '{where} was removed.',
      explanation:
        'Servers usually ignore unknown parameters, so requests still succeed, but any behaviour the parameter controlled is lost.',
      resolution: 'Confirm that consumers do not rely on the behaviour the parameter controlled.',
    },
    rationale: 'Removal is usually tolerated on the wire (A6), but the consequence is a policy decision.',
    limitations: ['Servers that reject unknown parameters cannot be described in OpenAPI.'],
    examples: [
      ['Query `filter` removed', true],
      ['Parameter moved to another location (→ REQ-007)', false],
    ],
    assess: (_c, ctx) =>
      overridden(
        assessed('request', 'widens', 'behavioral', {}, [assumption('Servers ignore unknown parameters (A6).')]),
        ctx.policy.removedRequestParameters,
        'policy-dependent',
        `removedRequestParameters: ${ctx.policy.removedRequestParameters}`,
      ),
  }),
  defineRule({
    id: 'CG-REQ-007',
    name: 'Request parameter location changed',
    summary: 'A parameter with the same name moved to a different location (query, header, path, cookie).',
    handles: ['parameter.locationChanged'],
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'Parameter moved from {fromIn} to {toIn} ({where}).',
      explanation: 'Consumers still send it in {fromIn}; the provider now reads it from {toIn}.',
      resolution: 'Accept the parameter in both locations during a transition.',
    },
    rationale: 'The value is no longer received where consumers send it.',
    limitations: ['Header names are case-insensitive; other locations are not.'],
    examples: [
      ['api_key query → header (required)', true],
      ['Optional parameter moved (potentially breaking)', true],
      ['Different name', false],
    ],
    assess: (c) =>
      c.facts.requiredAfter
        ? assessed('request', 'narrows', 'structural', { fromIn: c.facts.fromIn, toIn: c.facts.toIn })
        : assessed('request', 'incomparable', 'behavioral', { fromIn: c.facts.fromIn, toIn: c.facts.toIn }),
  }),
  defineRule({
    id: 'CG-REQ-008',
    name: 'Request parameter became optional',
    summary: 'A required parameter is now optional.',
    handles: ['parameter.requiredChanged'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: '{where} became optional.',
      explanation: 'Consumers that send it are unaffected.',
      resolution: 'No action needed.',
    },
    rationale: 'Relaxing a requirement widens accepted requests.',
    examples: [
      ['required: true → false', true],
      ['required: false → true', false],
    ],
    assess: (c) => (c.facts.from && !c.facts.to ? assessed('request', 'widens', 'structural') : null),
  }),
  defineRule({
    id: 'CG-REQ-009',
    name: 'Request parameter serialization changed',
    summary: 'The effective style, explode, allowReserved or content media type of a parameter changed.',
    handles: ['parameter.serializationChanged'],
    severity: BREAKING_HIGH,
    messages: {
      message: 'Serialization of {where} changed ({fields}).',
      explanation:
        'Consumers encode the value the old way (for example `a=1&a=2` vs `a=1,2`); the provider may misread it.',
      resolution: 'Keep the previous serialization, or accept both encodings.',
    },
    rationale: 'Serialization defines the bytes on the wire.',
    limitations: ['For primitive values, explode has no effect; such changes are suppressed.'],
    examples: [
      ['Query array explode: true → false', true],
      ['style: form → spaceDelimited', true],
      ['Absent style → explicit style: form (default)', false],
      ['explode changed on a primitive parameter', false],
    ],
    assess: (c, ctx) => {
      if (c.facts.fields.every((f) => f === 'explode') && primitiveParameter(c, ctx)) return null;
      return assessed('request', 'incomparable', 'structural', { fields: c.facts.fields.join(', ') });
    },
  }),
  defineRule({
    id: 'CG-REQ-010',
    name: 'Request body became required',
    summary: 'The request body is now required.',
    handles: ['requestBody.requiredChanged'],
    severity: BREAKING_HIGH,
    messages: {
      message: 'The request body of {operation} became required.',
      explanation: 'Consumers that send no body will be rejected.',
      resolution: 'Keep the body optional, or release as a new major version.',
    },
    rationale: 'Requests without a body become invalid.',
    examples: [
      ['requestBody.required absent → true', true],
      ['true → false', false],
    ],
    assess: (c) =>
      !c.facts.from && c.facts.to
        ? assessed('request', 'narrows', 'structural', { operation: c.subject.operationKey ?? '' })
        : null,
  }),
  defineRule({
    id: 'CG-REQ-011',
    name: 'Request body became optional',
    summary: 'The request body is no longer required.',
    handles: ['requestBody.requiredChanged'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'The request body of {operation} became optional.',
      explanation: 'Consumers that send a body are unaffected.',
      resolution: 'No action needed.',
    },
    rationale: 'Relaxing a requirement widens accepted requests.',
    examples: [
      ['true → false', true],
      ['false → true', false],
    ],
    assess: (c) =>
      c.facts.from && !c.facts.to
        ? assessed('request', 'widens', 'structural', { operation: c.subject.operationKey ?? '' })
        : null,
  }),
  defineRule({
    id: 'CG-REQ-012',
    name: 'Request body added',
    summary: 'The operation previously had no request body.',
    handles: ['requestBody.added'],
    severity: BREAKING_HIGH,
    messages: {
      message: 'A {kind} request body was added to {operation}.',
      explanation: 'Existing consumers send no body.',
      resolution: 'Make the body optional, or release as a new major version.',
    },
    rationale: 'A required body invalidates requests without one; an optional one does not.',
    examples: [
      ['Required JSON body added to POST /jobs', true],
      ['Optional body added (non-breaking)', true],
      ['Body existed on both sides', false],
    ],
    assess: (c) =>
      assessed('request', c.facts.required ? 'narrows' : 'widens', 'structural', {
        kind: c.facts.required ? 'required' : 'optional',
        operation: c.subject.operationKey ?? '',
      }),
  }),
  defineRule({
    id: 'CG-REQ-013',
    name: 'Request body removed',
    summary: 'The operation no longer documents a request body.',
    handles: ['requestBody.removed'],
    severity: POTENTIAL_MEDIUM,
    messages: {
      message: 'The request body of {operation} was removed.',
      explanation: 'The provider may ignore or reject bodies; whatever the body controlled is lost.',
      resolution: 'Confirm how the provider treats bodies that are still sent.',
    },
    rationale: 'Consumer impact depends on how the provider handles unexpected bodies.',
    limitations: ['Provider handling of unexpected bodies is not described by OpenAPI.'],
    examples: [
      ['JSON body removed from PUT /settings', true],
      ['A media type removed while the body remains (→ REQ-014)', false],
    ],
    assess: (c) => assessed('request', 'incomparable', 'behavioral', { operation: c.subject.operationKey ?? '' }),
  }),
  defineRule({
    id: 'CG-REQ-014',
    name: 'Request media type removed',
    summary: 'The request body no longer accepts a media type.',
    handles: ['mediaType.removed'],
    direction: 'request',
    severity: BREAKING_HIGH,
    messages: {
      message: 'Request media type {mediaType} is no longer accepted by {operation}.',
      explanation: 'Consumers sending {mediaType} will be rejected (typically 415).',
      resolution: 'Keep accepting {mediaType}, or release as a new major version.',
    },
    rationale: 'Consumers cannot send a payload in a media type the provider no longer accepts.',
    limitations: ['Content negotiation beyond the specification is unknown.'],
    examples: [
      ['application/xml removed', true],
      ['Charset parameter spelling normalized', false],
    ],
    assess: (c, ctx) => {
      const mt = c.facts.mediaType;
      const content =
        c.subject.operationKey === undefined
          ? undefined
          : ctx.candidate.operations.get(c.subject.operationKey)?.requestBody?.content;
      const ranges = [...(content?.keys() ?? [])].filter(
        (k) => k === '*/*' || (k.endsWith('/*') && mt.startsWith(k.slice(0, -1))),
      );
      return assessed(
        'request',
        'narrows',
        'structural',
        { mediaType: mt, operation: c.subject.operationKey ?? '' },
        ranges.length > 0 ? [reasoning(`The candidate still declares ${ranges.join(', ')}, which covers ${mt}.`)] : [],
      );
    },
  }),
  defineRule({
    id: 'CG-REQ-015',
    name: 'Request media type added',
    summary: 'The request body accepts a new media type.',
    handles: ['mediaType.added'],
    direction: 'request',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Request media type {mediaType} is now accepted by {operation}.',
      explanation: 'Existing consumers are unaffected.',
      resolution: 'No action needed.',
    },
    rationale: 'Additions widen accepted requests.',
    examples: [
      ['application/x-www-form-urlencoded added', true],
      ['No change', false],
    ],
    assess: (c) =>
      assessed('request', 'widens', 'structural', {
        mediaType: c.facts.mediaType,
        operation: c.subject.operationKey ?? '',
      }),
  }),

  // ------------------------------------------------------------------ schemas
  defineRule({
    id: 'CG-REQ-020',
    name: 'Request enum value removed',
    summary: 'A request value is restricted to fewer enumerated values.',
    handles: ['schema.enumChanged'],
    direction: 'request',
    severity: BREAKING_HIGH,
    messages: {
      message: '{where} no longer accepts {values}.',
      explanation: 'Consumers sending a removed value will be rejected.',
      resolution: 'Keep accepting the removed values, or release as a new major version.',
    },
    rationale: 'Requests using a removed value become invalid.',
    limitations: ['Whether consumers actually send the removed values is unknown.'],
    examples: [
      ['status enum [a, b, c] → [a, b]', true],
      ['const: x → const: y', true],
      ['Values reordered', false],
      ['[a, b] → [a, b, c]', false],
    ],
    assess: (c) => {
      const introduced = !c.facts.constrained[0] && c.facts.constrained[1];
      if (c.facts.removed.length === 0 && !introduced) return null;
      return assessed('request', 'narrows', 'enumerated', {
        values: introduced ? 'values outside the new enum' : show(c.facts.removed),
      });
    },
  }),
  defineRule({
    id: 'CG-REQ-021',
    name: 'Request enum value added',
    summary: 'A request value accepts more enumerated values (or the enum was removed).',
    handles: ['schema.enumChanged'],
    direction: 'request',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: '{where} now also accepts {values}.',
      explanation: 'Existing consumers are unaffected.',
      resolution: 'No action needed.',
    },
    rationale: 'Additional values widen accepted requests.',
    examples: [
      ['[a, b] → [a, b, c]', true],
      ['Enum removed entirely', true],
      ['Response direction', false],
    ],
    assess: (c) => {
      const dropped = c.facts.constrained[0] && !c.facts.constrained[1];
      if (c.facts.added.length === 0 && !dropped) return null;
      return assessed('request', 'widens', 'enumerated', { values: dropped ? 'any value' : show(c.facts.added) });
    },
  }),
  defineRule({
    id: 'CG-REQ-022',
    name: 'Request type narrowed',
    summary: 'The JSON types accepted in a request shrank.',
    handles: ['schema.typeChanged'],
    direction: 'request',
    severity: BREAKING_HIGH,
    messages: {
      message: '{where} accepts fewer types ({from} → {to}).',
      explanation: 'Consumers sending a value of a removed type will be rejected.',
      resolution: 'Keep accepting the removed types, or release as a new major version.',
    },
    rationale: 'Values of removed types become invalid.',
    examples: [
      ['type [string, integer] → string', true],
      ['number → integer', true],
      ['integer → number', false],
      ['Disjoint types (→ SCHEMA-001)', false],
    ],
    assess: (c) =>
      c.facts.relation === 'subset' || c.facts.relation === 'overlapping'
        ? assessed('request', 'narrows', 'structural', typeParams(c))
        : null,
  }),
  defineRule({
    id: 'CG-REQ-023',
    name: 'Request type widened',
    summary: 'The JSON types accepted in a request grew.',
    handles: ['schema.typeChanged'],
    direction: 'request',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: '{where} accepts more types ({from} → {to}).',
      explanation: 'Existing consumers are unaffected.',
      resolution: 'No action needed.',
    },
    rationale: 'Additional types widen accepted requests.',
    examples: [
      ['integer → number', true],
      ['type removed', true],
      ['Narrowing', false],
    ],
    assess: (c) =>
      c.facts.relation === 'superset' ? assessed('request', 'widens', 'structural', typeParams(c)) : null,
  }),
  defineRule({
    id: 'CG-REQ-024',
    name: 'Request value constraint tightened',
    summary: 'A numeric, length, size or uniqueness constraint on request values became stricter.',
    handles: ['schema.constraintChanged'],
    direction: 'request',
    severity: ['high', 'medium', 'medium'],
    classificationOverridable: true,
    messages: {
      message: '`{keyword}` became stricter in {where}.',
      explanation: 'Values that satisfied the old `{keyword}` may now be rejected.',
      resolution: 'Keep the previous limit, or confirm that no consumer sends values in the excluded range.',
    },
    rationale: 'Whether real values fall in the excluded range is unknown, so this is policy-dependent.',
    limitations: ['Real consumer values near the boundary are unknown.'],
    examples: [
      ['maxLength: 100 → 50', true],
      ['minimum: 0 → exclusiveMinimum: 0 (number)', true],
      ['multipleOf: 2 → 4', true],
      ['minimum: 1 ↔ exclusiveMinimum: 0 for type integer', false],
      ['maxLength: 50 → 100', false],
    ],
    assess: (c) =>
      c.facts.relation === 'relaxed'
        ? null
        : assessed('request', c.facts.relation === 'tightened' ? 'narrows' : 'incomparable', 'value-space', {
            keyword: c.facts.keyword,
          }),
  }),
  defineRule({
    id: 'CG-REQ-025',
    name: 'Request value constraint relaxed',
    summary: 'A request constraint became looser or a pattern was removed.',
    handles: ['schema.constraintChanged', 'schema.patternChanged'],
    direction: 'request',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: '{what} was relaxed in {where}.',
      explanation: 'All previously valid values remain valid.',
      resolution: 'No action needed.',
    },
    rationale: 'Looser constraints widen accepted requests.',
    examples: [
      ['maxItems: 10 → 20', true],
      ['pattern removed', true],
      ['Tightening', false],
    ],
    assess: (c) => {
      if (c.kind === 'schema.constraintChanged') {
        return c.facts.relation === 'relaxed'
          ? assessed('request', 'widens', 'value-space', { what: `\`${c.facts.keyword}\`` })
          : null;
      }
      return c.facts.from !== undefined && c.facts.to === undefined
        ? assessed('request', 'widens', 'value-space', { what: '`pattern`' })
        : null;
    },
  }),
  defineRule({
    id: 'CG-REQ-026',
    name: 'Request pattern added',
    summary: 'A regular-expression pattern now restricts a request string.',
    handles: ['schema.patternChanged'],
    direction: 'request',
    severity: ['high', 'medium', 'medium'],
    classificationOverridable: true,
    messages: {
      message: 'Pattern `{pattern}` now restricts {where}.',
      explanation: 'Strings that do not match the pattern will be rejected.',
      resolution: 'Confirm that consumers only send matching values.',
    },
    rationale: 'Patterns are compared as text and never executed, so the impact is policy-dependent.',
    limitations: ['A trivially permissive pattern (`.*`) is still flagged.'],
    examples: [
      ["pattern '^[A-Z]{3}$' added to currency", true],
      ['Pattern removed', false],
    ],
    assess: (c) =>
      c.facts.from === undefined && c.facts.to !== undefined
        ? assessed('request', 'narrows', 'value-space', { pattern: c.facts.to }, [
            reasoning('Patterns are compared as text only.'),
          ])
        : null,
  }),
  defineRule({
    id: 'CG-REQ-027',
    name: 'Request pattern changed',
    summary: 'A request string pattern was replaced by a different one.',
    handles: ['schema.patternChanged'],
    direction: 'request',
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'Pattern of {where} changed from `{from}` to `{to}`.',
      explanation: 'ContractGuard does not decide whether one regular expression accepts everything the other accepts.',
      resolution: 'Review whether every value matching `{from}` also matches `{to}`.',
    },
    rationale: 'Regex inclusion is undecidable in general for ECMA-262 patterns.',
    limitations: ['Regex language inclusion is not decided in v1.'],
    examples: [
      ['^[a-z]+$ → ^[a-z0-9]+$', true],
      ['Identical text', false],
    ],
    assess: (c) =>
      c.facts.from !== undefined && c.facts.to !== undefined
        ? assessed('request', 'unknown', 'value-space', { from: c.facts.from, to: c.facts.to })
        : null,
  }),
  defineRule({
    id: 'CG-REQ-028',
    name: 'Request format changed',
    summary: 'The `format` of a request value changed.',
    handles: ['schema.formatChanged'],
    direction: 'request',
    severity: ['medium', 'low', 'low'],
    messages: {
      message: 'Format of {where} changed ({from} → {to}).',
      explanation: 'A narrower format may reject values that were accepted before, if the provider validates formats.',
      resolution: 'Confirm that consumers send values valid for the new format.',
    },
    rationale: 'Format validation is optional in JSON Schema (A7).',
    limitations: ['Whether the provider validates `format` is unknown.'],
    examples: [
      ['int64 → int32', true],
      ['email added', true],
      ['date → date-time', true],
      ['int32 → int64', false],
    ],
    assess: (c) => {
      const params = { from: c.facts.from ?? 'none', to: c.facts.to ?? 'none' };
      switch (c.facts.relation) {
        case 'superset':
          return assessed('request', 'widens', 'value-space', params);
        case 'unknown':
          return assessed('request', 'unknown', 'value-space', params);
        case 'equal':
          return null;
        default:
          return overridden(
            assessed('request', c.facts.relation === 'subset' ? 'narrows' : 'incomparable', 'value-space', params),
            'potentially-breaking',
            'consumer-dependent',
            'Whether the provider validates `format` is unknown (A7).',
          );
      }
    },
  }),
  defineRule({
    id: 'CG-REQ-029',
    name: 'Request property disallowed',
    summary: 'A property old requests could send is now rejected.',
    handles: ['schema.propertyRemoved', 'schema.additionalPropertiesChanged'],
    direction: 'request',
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: '{what} is no longer allowed in {where}.',
      explanation: 'Consumers that send it will be rejected by a provider that enforces the candidate schema.',
      resolution: 'Keep the property defined (and ignore it), or keep the schema open.',
    },
    rationale: 'A closed schema rejects undefined properties.',
    limitations: ['A parent with unevaluatedProperties is reported by SCHEMA-900 instead.'],
    examples: [
      ['Closed schema drops `nickname`', true],
      ['additionalProperties: true → false', true],
      ['Removal from an open schema (→ REQ-030)', false],
    ],
    assess: (c) => {
      if (c.kind === 'schema.additionalPropertiesChanged') {
        if (c.facts.from !== 'any' || c.facts.to === 'any') return null;
        return assessed(
          'request',
          c.facts.to === 'none' ? 'narrows' : 'incomparable',
          c.facts.to === 'none' ? 'structural' : 'value-space',
          {
            what: 'Any additional property',
          },
        );
      }
      if (c.facts.parentHasUnevaluatedProperties) return null;
      const to = c.facts.parentAdditionalProperties.candidate;
      if (to === 'any') return null;
      return assessed(
        'request',
        to === 'none' ? 'narrows' : 'incomparable',
        to === 'none' ? 'structural' : 'value-space',
        {
          what: `Property "${c.facts.property}"`,
        },
      );
    },
  }),
  defineRule({
    id: 'CG-REQ-030',
    name: 'Request property removed from open schema',
    summary: 'A property was removed from a request schema that still allows additional properties.',
    handles: ['schema.propertyRemoved'],
    direction: 'request',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Property "{property}" is no longer documented in {where}.',
      explanation: 'The schema is open, so the property is still accepted; the provider may now ignore it.',
      resolution: 'Confirm that consumers do not rely on what the property controlled.',
    },
    rationale: 'In an open schema the removed property becomes unconstrained.',
    limitations: ['Server-side semantics for undocumented fields are unknown.'],
    examples: [
      ['Open schema drops `legacyId`', true],
      ['Closed schema (→ REQ-029)', false],
    ],
    assess: (c) =>
      c.facts.parentAdditionalProperties.candidate === 'any' && !c.facts.parentHasUnevaluatedProperties
        ? assessed('request', 'widens', 'structural', { property: c.facts.property }, [
            reasoning('The provider no longer documents this field; it may be ignored.'),
          ])
        : null,
  }),
  defineRule({
    id: 'CG-REQ-031',
    name: 'Request no longer accepts null',
    summary: 'A request value that allowed null no longer does.',
    handles: ['schema.nullabilityChanged'],
    direction: 'request',
    severity: BREAKING_HIGH,
    messages: {
      message: '{where} no longer accepts null.',
      explanation: 'Consumers sending null will be rejected.',
      resolution: 'Keep the value nullable, or release as a new major version.',
    },
    rationale: 'Requests sending null become invalid.',
    examples: [
      ['3.0 nullable: true removed', true],
      ["3.1 type [string, 'null'] → string", true],
      ["3.0 nullable string → 3.1 type [string, 'null'] (equivalent)", false],
    ],
    assess: (c) => (c.facts.from && !c.facts.to ? assessed('request', 'narrows', 'structural') : null),
  }),
  defineRule({
    id: 'CG-REQ-032',
    name: 'Request variant removed',
    summary: 'A oneOf/anyOf branch of a request schema has no counterpart in the candidate.',
    handles: ['schema.variantRemoved'],
    direction: 'request',
    severity: BREAKING_HIGH,
    messages: {
      message: 'A {composition} variant was removed from {where}.',
      explanation: 'Consumers sending payloads of the removed variant will be rejected.',
      resolution: 'Keep the variant, or release as a new major version.',
    },
    rationale: 'Payloads matching only the removed branch become invalid.',
    limitations: ['Branch matching is heuristic for unnamed inline branches.'],
    examples: [
      ['oneOf [Card, BankTransfer, Wallet] → [Card, BankTransfer]', true],
      ['Branch renamed but structurally identical', false],
    ],
    assess: (c) =>
      c.facts.composition === 'allOf'
        ? null
        : assessed('request', 'narrows', 'structural', { composition: c.facts.composition }),
  }),
  defineRule({
    id: 'CG-REQ-033',
    name: 'Request oneOf variant added without discriminator',
    summary: 'A oneOf branch was added to a request schema that has no discriminator.',
    handles: ['schema.variantAdded'],
    direction: 'request',
    severity: POTENTIAL_MEDIUM,
    messages: {
      message: 'A oneOf variant was added to {where} without a discriminator.',
      explanation: 'Payloads that match both the new and an existing branch become invalid under oneOf exclusivity.',
      resolution: 'Add a discriminator, or make sure the new branch cannot overlap existing ones.',
    },
    rationale: 'oneOf requires exactly one matching branch.',
    limitations: ['Branch overlap is not computed in v1.'],
    examples: [
      ['oneOf [A, B] → [A, B, C] without discriminator', true],
      ['With discriminator (→ REQ-034)', false],
      ['anyOf (→ REQ-034)', false],
    ],
    assess: (c) =>
      c.facts.composition === 'oneOf' && !c.facts.hasDiscriminator
        ? overridden(
            assessed('request', 'incomparable', 'structural'),
            'potentially-breaking',
            'consumer-dependent',
            'Payloads matching both the new and an existing branch become invalid under oneOf exclusivity.',
          )
        : null,
  }),
  defineRule({
    id: 'CG-REQ-034',
    name: 'Request composition widened',
    summary: 'An anyOf branch, a discriminated oneOf branch was added, or a non-mergeable allOf branch removed.',
    handles: ['schema.variantAdded', 'schema.variantRemoved'],
    direction: 'request',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'The {composition} composition of {where} accepts more payloads.',
      explanation: 'Existing consumers are unaffected.',
      resolution: 'No action needed.',
    },
    rationale: 'More alternatives (or fewer conjuncts) widen accepted requests.',
    examples: [
      ['anyOf [A] → [A, B]', true],
      ['Variant removed', false],
    ],
    assess: (c) => {
      const widens =
        c.kind === 'schema.variantAdded'
          ? c.facts.composition === 'anyOf' || (c.facts.composition === 'oneOf' && c.facts.hasDiscriminator)
          : c.facts.composition === 'allOf';
      return widens ? assessed('request', 'widens', 'structural', { composition: c.facts.composition }) : null;
    },
  }),
  defineRule({
    id: 'CG-REQ-035',
    name: 'Request discriminator value removed',
    summary: 'A discriminator mapping value of a request schema was removed.',
    handles: ['schema.discriminatorMappingChanged'],
    direction: 'request',
    severity: BREAKING_HIGH,
    messages: {
      message: 'Discriminator values {values} are no longer accepted in {where}.',
      explanation: 'Consumers sending a removed discriminator value will be rejected.',
      resolution: 'Keep the mapping entries, or release as a new major version.',
    },
    rationale: 'A removed mapping value can no longer select a variant.',
    examples: [
      ['mapping {card, wallet} → {card}', true],
      ['Mapping added', false],
    ],
    assess: (c) =>
      c.facts.removed.length > 0 ? assessed('request', 'narrows', 'enumerated', { values: c.facts.removed }) : null,
  }),
  defineRule({
    id: 'CG-REQ-036',
    name: 'Request default value changed',
    summary: 'The default of a request parameter or property changed.',
    handles: ['schema.defaultChanged'],
    direction: 'request',
    severity: POTENTIAL_MEDIUM,
    messages: {
      message: 'Default of {where} changed.',
      explanation: 'Consumers that omit the value get different behaviour if the provider applies defaults.',
      resolution: 'Keep the previous default, or announce the behaviour change.',
    },
    rationale: 'Defaults define behaviour for omitted values.',
    limitations: ['Whether the provider applies defaults is outside the specification.'],
    examples: [
      ['limit default 20 → 50', true],
      ['Default added where none existed', false],
    ],
    assess: (c, ctx) => {
      if (c.base.value === undefined)
        return ctx.includeEquivalentChanges ? assessed('request', 'equivalent', 'behavioral') : null;
      return assessed('request', 'incomparable', 'behavioral');
    },
  }),
  defineRule({
    id: 'CG-REQ-037',
    name: 'Request property became read-only',
    summary: 'A request property gained readOnly.',
    handles: ['schema.accessChanged'],
    direction: 'request',
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'Property "{property}" became read-only in {where}.',
      explanation: 'OpenAPI says read-only properties should not be sent; providers may reject or ignore them.',
      resolution: 'Keep the property writable, or confirm that the provider ignores it.',
    },
    rationale: 'Provider handling of read-only properties in requests differs.',
    limitations: ['Servers differ on whether they reject or ignore read-only properties.'],
    examples: [
      ['id gains readOnly: true', true],
      ['readOnly removed', false],
    ],
    assess: (c) =>
      !c.facts.readOnly[0] && c.facts.readOnly[1]
        ? assessed('request', 'narrows', c.facts.requiredInBase ? 'structural' : 'behavioral', {
            property: c.facts.property,
          })
        : null,
  }),
  defineRule({
    id: 'CG-REQ-038',
    name: 'Request allOf constraint added',
    summary: 'A non-mergeable allOf branch was added to a request schema.',
    handles: ['schema.variantAdded'],
    direction: 'request',
    severity: POTENTIAL_MEDIUM,
    messages: {
      message: 'A new allOf constraint applies to {where}.',
      explanation: 'The constraint could not be merged and compared, so it may reject previously valid payloads.',
      resolution: 'Review the new constraint.',
    },
    rationale: 'A new conjunct can only narrow; its exact effect is not computed.',
    limitations: ['The content of the new constraint is not decided.'],
    examples: [
      ['allOf [Base] → [Base, {not: …}]', true],
      ['Mergeable allOf', false],
    ],
    assess: (c) =>
      c.facts.composition === 'allOf'
        ? overridden(
            assessed('request', 'narrows', 'structural'),
            'potentially-breaking',
            'indeterminate',
            'The added allOf branch could not be analyzed.',
          )
        : null,
  }),
];

function typeParams(c: ChangeOfKind<'schema.typeChanged'>): { from: string; to: string } {
  const text = (t: { readonly types: readonly string[] | 'any' }): string =>
    t.types === 'any' ? 'any' : t.types.length === 0 ? 'nothing' : t.types.join(' | ');
  return { from: text(c.facts.from), to: text(c.facts.to) };
}

export { typeParams };
