import type { RuleDefinition } from '@contractguard/core';
import { assessed, assumption, defineRule, DEFAULT_SEVERITY, overridden, reasoning, show } from './define.js';
import { typeParams } from './req.js';

const BREAKING_HIGH = ['high', 'medium', 'medium'] as const;
const LOW = ['high', 'low', 'low'] as const;

export const RES_RULES: readonly RuleDefinition[] = [
  defineRule({
    id: 'CG-RES-001',
    name: 'Required response property removed',
    summary: 'A required property was removed from a response schema.',
    handles: ['schema.propertyRemoved'],
    direction: 'response',
    severity: BREAKING_HIGH,
    messages: {
      message: 'Required property "{property}" was removed from {where}.',
      explanation: 'Consumers rely on "{property}" always being present; it may now be missing.',
      resolution: 'Keep returning "{property}" (deprecate it first), or release as a new major version.',
    },
    rationale: 'A guaranteed field is no longer guaranteed.',
    examples: [
      ['User.email (required) removed from a 200 body', true],
      ['Removed from a shared component (grouped by cause)', true],
      ['Request direction', false],
      ['Property moved into an allOf parent', false],
    ],
    assess: (c) =>
      c.facts.required && !c.facts.parentHasUnevaluatedProperties
        ? assessed('response', 'widens', 'structural', { property: c.facts.property })
        : null,
  }),
  defineRule({
    id: 'CG-RES-002',
    name: 'Response property became optional',
    summary: 'A required response property is now optional.',
    handles: ['schema.requiredChanged'],
    direction: 'response',
    severity: BREAKING_HIGH,
    messages: {
      message: 'Property "{property}" is no longer guaranteed in {where}.',
      explanation: 'Consumers that read "{property}" without checking for absence may fail.',
      resolution: 'Keep "{property}" required, or release as a new major version.',
    },
    rationale: 'A guaranteed field may now be absent.',
    examples: [
      ['required [id, email] → [id]', true],
      ['Request direction', false],
    ],
    assess: (c) =>
      c.facts.from && !c.facts.to ? assessed('response', 'widens', 'structural', { property: c.facts.property }) : null,
  }),
  defineRule({
    id: 'CG-RES-003',
    name: 'Optional response property removed',
    summary: 'An optional property was removed from a response schema.',
    handles: ['schema.propertyRemoved'],
    direction: 'response',
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'Optional property "{property}" was removed from {where}.',
      explanation: '{explanation}',
      resolution: 'Confirm that consumers do not read "{property}".',
    },
    rationale: 'In an open schema the field may now carry any value; in a closed one it can no longer appear.',
    limitations: ['Consumers that never read the field are unaffected.'],
    examples: [
      ['Optional avatarUrl removed from an open schema', true],
      ['Removed from a closed schema (non-breaking)', true],
      ['Required property (→ RES-001)', false],
    ],
    assess: (c) => {
      if (c.facts.required || c.facts.parentHasUnevaluatedProperties) return null;
      return c.facts.parentAdditionalProperties.candidate === 'none'
        ? assessed('response', 'narrows', 'value-space', {
            property: c.facts.property,
            explanation: 'The schema is closed, so the property can no longer appear.',
          })
        : assessed('response', 'widens', 'value-space', {
            property: c.facts.property,
            explanation: 'The property is no longer documented: it may be absent or carry any value.',
          });
    },
  }),
  defineRule({
    id: 'CG-RES-004',
    name: 'Property added to closed response schema',
    summary: 'A property was added to a response schema that promised no additional properties.',
    handles: ['schema.propertyAdded'],
    direction: 'response',
    severity: ['high', 'medium', 'medium'],
    classificationOverridable: true,
    messages: {
      message: 'Property "{property}" was added to closed {where}.',
      explanation:
        'The baseline promised no extra properties; strict validators will reject the new one, tolerant readers will not.',
      resolution: 'Confirm that consumers do not validate responses strictly.',
    },
    rationale: 'This is a policy decision, not a contract fact (§10.4).',
    limitations: ['Whether consumers validate strictly is unknown.'],
    examples: [
      ['additionalProperties: false schema gains createdAt', true],
      ['Open schema (→ RES-005)', false],
    ],
    assess: (c, ctx) =>
      c.facts.parentAdditionalProperties.base === 'none' && !c.facts.parentHasUnevaluatedProperties
        ? overridden(
            assessed('response', 'widens', 'additive', { property: c.facts.property }),
            ctx.policy.closedResponseAdditions,
            'policy-dependent',
            `The base schema promised no extra properties (closedResponseAdditions: ${ctx.policy.closedResponseAdditions}).`,
          )
        : null,
  }),
  defineRule({
    id: 'CG-RES-005',
    name: 'Response property added',
    summary: 'A property was added to an open response schema.',
    handles: ['schema.propertyAdded'],
    direction: 'response',
    severity: LOW,
    classificationOverridable: true,
    messages: {
      message: 'Property "{property}" was added to {where}.',
      explanation: 'The schema already allowed additional properties, so tolerant consumers are unaffected.',
      resolution: 'No action needed unless consumers validate responses strictly.',
    },
    rationale: 'Additions to open schemas were already allowed.',
    examples: [
      ['Open schema gains optional nickname', true],
      ['Gains a required property', true],
      ['Request direction', false],
    ],
    assess: (c) =>
      c.facts.parentAdditionalProperties.base !== 'none' && !c.facts.parentHasUnevaluatedProperties
        ? assessed('response', 'widens', 'additive', { property: c.facts.property })
        : null,
  }),
  defineRule({
    id: 'CG-RES-006',
    name: 'Response enum value added',
    summary: 'A response value may take new enumerated values (or the enum was removed).',
    handles: ['schema.enumChanged'],
    direction: 'response',
    severity: ['high', 'medium', 'medium'],
    classificationOverridable: true,
    messages: {
      message: '{where} may now return {values}.',
      explanation: 'Consumers that handle the enum exhaustively may not handle the new values.',
      resolution: 'Document the enum as extensible (x-extensible-enum) or make sure consumers have a fallback.',
    },
    rationale: 'Exhaustive-switch consumers break, tolerant ones do not (§10.4).',
    limitations: ['Exhaustive handling in consumers is unknown.'],
    examples: [
      ['status [active, suspended] → + deleted', true],
      ['Values reordered', false],
    ],
    assess: (c, ctx) => {
      const dropped = c.facts.constrained[0] && !c.facts.constrained[1];
      if (c.facts.added.length === 0 && !dropped) return null;
      const a = assessed('response', 'widens', 'enumerated', { values: dropped ? 'any value' : show(c.facts.added) });
      if (c.facts.extensible && ctx.honorExtensibleEnum) {
        return overridden(
          a,
          'non-breaking',
          'contract-guaranteed',
          'The enum is declared extensible (x-extensible-enum).',
        );
      }
      return overridden(
        a,
        ctx.policy.responseEnumAdditions,
        'policy-dependent',
        `responseEnumAdditions: ${ctx.policy.responseEnumAdditions}`,
      );
    },
  }),
  defineRule({
    id: 'CG-RES-007',
    name: 'Response enum value removed',
    summary: 'A response value is restricted to fewer enumerated values.',
    handles: ['schema.enumChanged'],
    direction: 'response',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: '{where} no longer returns {values}.',
      explanation: 'Consumers handle a subset of what they handled before.',
      resolution: 'No action needed.',
    },
    rationale: 'Fewer possible values narrow the response.',
    examples: [
      ['[a, b, c] → [a, b]', true],
      ['Request direction', false],
    ],
    assess: (c) => {
      const introduced = !c.facts.constrained[0] && c.facts.constrained[1];
      if (c.facts.removed.length === 0 && !introduced) return null;
      return assessed('response', 'narrows', 'enumerated', {
        values: introduced ? 'values outside the new enum' : show(c.facts.removed),
      });
    },
  }),
  defineRule({
    id: 'CG-RES-008',
    name: 'Response type widened',
    summary: 'A response value may have more JSON types.',
    handles: ['schema.typeChanged'],
    direction: 'response',
    severity: BREAKING_HIGH,
    messages: {
      message: '{where} may now be {to} (was {from}).',
      explanation: 'Consumers parsing the previous type may fail on values of the new types.',
      resolution: 'Keep the previous type, or release as a new major version.',
    },
    rationale: 'Values of new types were not guaranteed before.',
    examples: [
      ['integer → number', true],
      ['string → [string, integer]', true],
      ['number → integer', false],
    ],
    assess: (c) =>
      c.facts.relation === 'superset' || c.facts.relation === 'overlapping'
        ? assessed('response', 'widens', 'structural', typeParams(c))
        : null,
  }),
  defineRule({
    id: 'CG-RES-009',
    name: 'Response value may now be null',
    summary: 'A response value that was never null may now be null.',
    handles: ['schema.nullabilityChanged'],
    direction: 'response',
    severity: BREAKING_HIGH,
    messages: {
      message: '{where} may now be null.',
      explanation: 'Consumers that do not expect null may fail.',
      resolution: 'Keep the value non-null, or release as a new major version.',
    },
    rationale: 'null was not a possible value before.',
    examples: [
      ["type string → [string, 'null']", true],
      ['3.0 → 3.1 representation change only', false],
    ],
    assess: (c) => (!c.facts.from && c.facts.to ? assessed('response', 'widens', 'structural') : null),
  }),
  defineRule({
    id: 'CG-RES-010',
    name: 'Response type narrowed',
    summary: 'A response value has fewer possible JSON types.',
    handles: ['schema.typeChanged'],
    direction: 'response',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: '{where} now only returns {to} (was {from}).',
      explanation: 'Consumers handle a subset of what they handled before.',
      resolution: 'No action needed.',
    },
    rationale: 'Narrower responses are always handled.',
    examples: [
      ['[string, integer] → string', true],
      ['Widening', false],
    ],
    assess: (c) =>
      c.facts.relation === 'subset' ? assessed('response', 'narrows', 'structural', typeParams(c)) : null,
  }),
  defineRule({
    id: 'CG-RES-011',
    name: 'Response value constraint relaxed',
    summary: 'A constraint on response values became looser.',
    handles: ['schema.constraintChanged'],
    direction: 'response',
    severity: LOW,
    messages: {
      message: '`{keyword}` was relaxed in {where}.',
      explanation:
        'Values outside the previous limit may now be returned; consumer buffers or UI limits may not handle them.',
      resolution: 'Confirm that consumers handle the wider range.',
    },
    rationale: 'Consumer limits are unknown.',
    limitations: ['Consumer buffer sizes and UI limits are unknown.'],
    examples: [
      ['maxLength 50 → 255', true],
      ['maximum removed', true],
      ['Tightened', false],
    ],
    assess: (c) =>
      c.facts.relation === 'tightened'
        ? null
        : assessed('response', c.facts.relation === 'relaxed' ? 'widens' : 'incomparable', 'value-space', {
            keyword: c.facts.keyword,
          }),
  }),
  defineRule({
    id: 'CG-RES-012',
    name: 'Response value constraint tightened',
    summary: 'A response constraint, pattern or format became stricter.',
    handles: ['schema.constraintChanged', 'schema.patternChanged', 'schema.formatChanged'],
    direction: 'response',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: '{what} became stricter in {where}.',
      explanation: 'Consumers handle a subset of what they handled before.',
      resolution: 'No action needed.',
    },
    rationale: 'Narrower responses are always handled.',
    examples: [
      ['maxLength 255 → 50', true],
      ['Pattern added', true],
      ['Relaxed', false],
    ],
    assess: (c) => {
      switch (c.kind) {
        case 'schema.constraintChanged':
          return c.facts.relation === 'tightened'
            ? assessed('response', 'narrows', 'value-space', { what: `\`${c.facts.keyword}\`` })
            : null;
        case 'schema.patternChanged':
          return c.facts.from === undefined && c.facts.to !== undefined
            ? assessed('response', 'narrows', 'value-space', { what: '`pattern`' })
            : null;
        default:
          return c.facts.relation === 'subset'
            ? assessed('response', 'narrows', 'value-space', { what: '`format`' })
            : null;
      }
    },
  }),
  defineRule({
    id: 'CG-RES-013',
    name: 'Response pattern or format relaxed or changed',
    summary: 'A response pattern or format was removed, widened or replaced.',
    handles: ['schema.patternChanged', 'schema.formatChanged'],
    direction: 'response',
    severity: ['medium', 'low', 'low'],
    messages: {
      message: '{what} of {where} changed ({from} → {to}).',
      explanation: 'Values that consumers did not expect may now be returned.',
      resolution: 'Confirm that consumers do not depend on the previous format or pattern.',
    },
    rationale: 'Consumers may parse values according to the documented format.',
    examples: [
      ['format uuid removed', true],
      ['Pattern edited (undetermined)', true],
      ['Pattern added', false],
    ],
    assess: (c) => {
      if (c.kind === 'schema.patternChanged') {
        const params = { what: 'Pattern', from: c.facts.from ?? 'none', to: c.facts.to ?? 'none' };
        if (c.facts.from === undefined) return null;
        return c.facts.to === undefined
          ? assessed('response', 'widens', 'value-space', params)
          : assessed('response', 'unknown', 'value-space', params);
      }
      const params = { what: 'Format', from: c.facts.from ?? 'none', to: c.facts.to ?? 'none' };
      switch (c.facts.relation) {
        case 'superset':
          return assessed('response', 'widens', 'value-space', params);
        case 'disjoint':
        case 'overlapping':
          return assessed('response', 'incomparable', 'value-space', params);
        case 'unknown':
          return assessed('response', 'unknown', 'value-space', params);
        default:
          return null;
      }
    },
  }),
  defineRule({
    id: 'CG-RES-014',
    name: 'Response variant added',
    summary: 'A oneOf/anyOf branch was added to a response schema (or an allOf constraint removed).',
    handles: ['schema.variantAdded', 'schema.variantRemoved'],
    direction: 'response',
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: '{where} may now return payloads of a new {composition} shape.',
      explanation: 'Consumers that handle each variant explicitly may not handle the new one.',
      resolution: 'Make sure consumers have a fallback for unknown variants.',
    },
    rationale: 'New variants were not guaranteed before.',
    examples: [
      ['oneOf [Card, Bank] → + Wallet', true],
      ['Request direction', false],
    ],
    assess: (c) => {
      if (c.kind === 'schema.variantAdded') {
        return c.facts.composition === 'allOf'
          ? null
          : assessed('response', 'widens', 'enumerated', { composition: c.facts.composition });
      }
      return c.facts.composition === 'allOf'
        ? assessed('response', 'widens', 'value-space', { composition: 'allOf' })
        : null;
    },
  }),
  defineRule({
    id: 'CG-RES-015',
    name: 'Response variant removed',
    summary: 'A oneOf/anyOf branch was removed from a response schema (or an allOf constraint added).',
    handles: ['schema.variantRemoved', 'schema.variantAdded'],
    direction: 'response',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: '{where} returns fewer {composition} shapes.',
      explanation: 'Consumers handle a subset of what they handled before.',
      resolution: 'No action needed.',
    },
    rationale: 'Narrower responses are always handled.',
    examples: [
      ['oneOf [A, B] → [A]', true],
      ['Variant added', false],
    ],
    assess: (c) => {
      const narrows =
        c.kind === 'schema.variantRemoved' ? c.facts.composition !== 'allOf' : c.facts.composition === 'allOf';
      return narrows ? assessed('response', 'narrows', 'structural', { composition: c.facts.composition }) : null;
    },
  }),
  defineRule({
    id: 'CG-RES-016',
    name: 'Success response removed',
    summary: 'A success (2XX) response key is absent from the candidate.',
    handles: ['response.removed'],
    severity: ['critical', 'high', 'medium'],
    messages: {
      message: 'Success response {status} of {operation} was removed{fallback}.',
      explanation: 'Consumers expecting {status} will receive a different status or shape.',
      resolution: 'Keep returning {status}, or release as a new major version.',
    },
    rationale: 'Consumers branch on success status codes.',
    examples: [
      ['200 replaced by 201', true],
      ['2XX removed', true],
      ['Error response removed (→ RES-017)', false],
    ],
    assess: (c) =>
      // 200 → 2XX: consumers of 200 are still covered by the range; schema differences are compared there.
      c.facts.statusClass === 'success' && c.facts.effectiveFallback !== `${c.facts.status.charAt(0)}XX`
        ? assessed('response', 'incomparable', 'structural', {
            status: c.facts.status,
            operation: c.subject.operationKey ?? '',
            fallback: c.facts.effectiveFallback === undefined ? '' : ` (now covered by ${c.facts.effectiveFallback})`,
          })
        : null,
  }),
  defineRule({
    id: 'CG-RES-017',
    name: 'Non-success response removed',
    summary: 'A non-success response key is absent from the candidate.',
    handles: ['response.removed'],
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Response {status} of {operation} is no longer documented.',
      explanation: 'The provider may still return it undocumented.',
      resolution: 'No action needed.',
    },
    rationale: 'Fewer documented error responses narrow the response space.',
    examples: [
      ['404 removed', true],
      ['Success response removed', false],
    ],
    assess: (c) =>
      c.facts.statusClass === 'success'
        ? null
        : assessed(
            'response',
            'narrows',
            'structural',
            { status: c.facts.status, operation: c.subject.operationKey ?? '' },
            [reasoning('The provider may still return it undocumented.')],
          ),
  }),
  defineRule({
    id: 'CG-RES-018',
    name: 'Success response added',
    summary: 'A new success (2XX) response was added.',
    handles: ['response.added'],
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'New success response {status} for {operation}.',
      explanation: 'Consumers that only handle the previous success statuses may not handle {status}.',
      resolution: 'Make sure consumers treat any 2xx as success.',
    },
    rationale: 'Many consumers treat any 2xx as success, but some branch on exact codes.',
    limitations: ['Consumers often treat any 2xx as success.'],
    examples: [
      ['202 Accepted added beside 200', true],
      ['Error response added', false],
    ],
    assess: (c) =>
      c.facts.statusClass === 'success'
        ? assessed('response', 'widens', 'enumerated', {
            status: c.facts.status,
            operation: c.subject.operationKey ?? '',
          })
        : null,
  }),
  defineRule({
    id: 'CG-RES-019',
    name: 'Non-success response added',
    summary: 'A new non-success response was documented.',
    handles: ['response.added'],
    severity: LOW,
    messages: {
      message: 'Response {status} is now documented for {operation}.',
      explanation: 'Its schema is compared against what the previous fallback response documented.',
      resolution: 'No action needed.',
    },
    rationale: 'Documenting an error response does not change what consumers already handle.',
    examples: [
      ['429 added', true],
      ['Success response added', false],
    ],
    assess: (c) =>
      c.facts.statusClass === 'success'
        ? null
        : assessed('response', 'widens', 'additive', {
            status: c.facts.status,
            operation: c.subject.operationKey ?? '',
          }),
  }),
  defineRule({
    id: 'CG-RES-020',
    name: 'Response media type removed',
    summary: 'A response no longer offers a media type.',
    handles: ['mediaType.removed'],
    direction: 'response',
    severity: BREAKING_HIGH,
    messages: {
      message: 'Response media type {mediaType} was removed from {where}.',
      explanation: 'Consumers that request {mediaType} via Accept may receive 406 or a different format.',
      resolution: 'Keep offering {mediaType}, or release as a new major version.',
    },
    rationale: 'Consumers request media types; removal narrows accepted negotiation (area: request).',
    limitations: ['Server negotiation fallbacks are unknown.'],
    examples: [
      ['application/xml removed from 200', true],
      ['Normalization-only difference', false],
    ],
    assess: (c) => assessed('request', 'narrows', 'structural', { mediaType: c.facts.mediaType }),
  }),
  defineRule({
    id: 'CG-RES-021',
    name: 'Response media type added',
    summary: 'A response offers a new media type.',
    handles: ['mediaType.added'],
    direction: 'response',
    severity: DEFAULT_SEVERITY,
    messages: {
      message: 'Response media type {mediaType} was added to {where}.',
      explanation: 'Existing consumers keep requesting the media types they used before.',
      resolution: 'No action needed.',
    },
    rationale: 'More negotiable media types widen what consumers may request.',
    examples: [
      ['application/xml added', true],
      ['No change', false],
    ],
    assess: (c) => assessed('request', 'widens', 'structural', { mediaType: c.facts.mediaType }),
  }),
  defineRule({
    id: 'CG-RES-022',
    name: 'Required response header removed',
    summary: 'A required response header was removed.',
    handles: ['header.removed'],
    severity: BREAKING_HIGH,
    messages: {
      message: 'Required header was removed: {where}.',
      explanation: 'Consumers that read this header will no longer find it.',
      resolution: 'Keep sending the header, or release as a new major version.',
    },
    rationale: 'A guaranteed header is no longer guaranteed.',
    examples: [
      ['Required X-RateLimit-Remaining removed', true],
      ['Optional header removed (→ RES-024)', false],
    ],
    assess: (c) => (c.facts.required ? assessed('response', 'widens', 'structural') : null),
  }),
  defineRule({
    id: 'CG-RES-023',
    name: 'Response header became optional',
    summary: 'A required response header is now optional.',
    handles: ['header.requiredChanged'],
    severity: BREAKING_HIGH,
    messages: {
      message: 'Header is no longer guaranteed: {where}.',
      explanation: 'Consumers that read the header without checking for absence may fail.',
      resolution: 'Keep the header required, or release as a new major version.',
    },
    rationale: 'A guaranteed header may now be absent.',
    examples: [
      ['required: true → false', true],
      ['false → true', false],
    ],
    assess: (c) => (c.facts.from && !c.facts.to ? assessed('response', 'widens', 'structural') : null),
  }),
  defineRule({
    id: 'CG-RES-024',
    name: 'Response header added or optional header removed',
    summary: 'A response header was added, or an optional one removed.',
    handles: ['header.added', 'header.removed'],
    severity: LOW,
    messages: {
      message: '{what}: {where}.',
      explanation: '{explanation}',
      resolution: '{resolution}',
    },
    rationale: 'Optional headers were never guaranteed; added headers are ignored by existing consumers.',
    examples: [
      ['ETag added', true],
      ['Optional Link removed', true],
      ['Required header removed (→ RES-022)', false],
    ],
    assess: (c) =>
      c.kind === 'header.added'
        ? assessed('response', 'widens', 'additive', {
            what: 'Header added',
            explanation: 'Existing consumers ignore headers they do not know.',
            resolution: 'No action needed.',
          })
        : c.facts.required
          ? null
          : assessed('response', 'widens', 'value-space', {
              what: 'Optional header removed',
              explanation: 'Consumers that use the header when present will no longer receive it.',
              resolution: 'Confirm that consumers do not depend on the header.',
            }),
  }),
  defineRule({
    id: 'CG-RES-025',
    name: 'Response body removed',
    summary: 'A response no longer has a body.',
    handles: ['response.bodyRemoved'],
    severity: BREAKING_HIGH,
    messages: {
      message: 'The body of {where} was removed.',
      explanation: 'Consumers that parse the body will receive none.',
      resolution: 'Keep the body, or release as a new major version.',
    },
    rationale: 'Consumers parse documented bodies.',
    examples: [
      ['200 had JSON content, now none', true],
      ['One of two media types removed (→ RES-020)', false],
    ],
    assess: () => assessed('response', 'incomparable', 'structural'),
  }),
  defineRule({
    id: 'CG-RES-026',
    name: 'Response property became write-only',
    summary: 'A response property gained writeOnly.',
    handles: ['schema.accessChanged'],
    direction: 'response',
    severity: ['high', 'medium', 'medium'],
    messages: {
      message: 'Property "{property}" became write-only in {where}.',
      explanation: 'Write-only properties are not returned, so consumers reading "{property}" will not find it.',
      resolution: 'Keep the property readable, or release as a new major version.',
    },
    rationale: 'A returned field stops being returned.',
    examples: [
      ['password gains writeOnly', true],
      ['Request direction', false],
    ],
    assess: (c) =>
      !c.facts.writeOnly[0] && c.facts.writeOnly[1]
        ? assessed('response', 'widens', c.facts.requiredInBase ? 'structural' : 'value-space', {
            property: c.facts.property,
          })
        : null,
  }),
  defineRule({
    id: 'CG-RES-027',
    name: 'Response body added',
    summary: 'A response that had no body now has one.',
    handles: ['response.bodyAdded'],
    severity: LOW,
    messages: {
      message: 'A body was added to {where}.',
      explanation: 'Existing consumers ignore a body they did not expect.',
      resolution: 'No action needed.',
    },
    rationale: 'Additional content does not invalidate existing handling.',
    examples: [
      ['Existing 200 gains content', true],
      ['Body on both sides', false],
    ],
    assess: () => assessed('response', 'widens', 'additive', {}, [assumption('Consumers ignore unexpected bodies.')]),
  }),
];
