import { CHANGE_KINDS, type ApiContract, type CompatibilityFinding } from '@contractguard/core';
import { describe, expect, it } from 'vitest';
import { checkCompatibility, DEFAULT_REGISTRY, explainRule } from '../../src/check.js';
import { fingerprintOf } from '../../src/compat/evaluate.js';
import { CONSUMER_FORWARD, PROVIDER_BACKWARD } from '../../src/compat/perspectives.js';
import { RULES } from '../../src/rules/index.js';
import { contract, lenientContract } from '../helpers.js';
import { FIXTURES, H31, type Fixture } from './fixtures.js';

async function run(fx: Fixture): Promise<readonly CompatibilityFinding[]> {
  const load = fx.lenient === true ? lenientContract : contract;
  return checkCompatibility(await load(fx.base), await load(fx.candidate), fx.options).findings;
}

describe('compatibility fixtures', () => {
  it.each(FIXTURES.map((fx) => [`${fx.rule} ${fx.fires ? '✔' : '✘'} ${fx.name}`, fx] as const))(
    '%s',
    async (_title, fx) => {
      const findings = await run(fx);
      const mine = findings.filter((x) => x.ruleId === fx.rule);
      if (!fx.fires) {
        expect(
          mine.map((x) => x.message),
          `${fx.rule} must stay silent`,
        ).toEqual([]);
        return;
      }
      expect(
        mine.length,
        `${fx.rule} must fire; got ${findings.map((x) => x.ruleId).join(', ') || 'nothing'}`,
      ).toBeGreaterThan(0);
      const first = mine[0] as CompatibilityFinding;
      if (fx.expect?.classification !== undefined) expect(first.classification).toBe(fx.expect.classification);
      if (fx.expect?.severity !== undefined) expect(first.severity).toBe(fx.expect.severity);
      // Invariants: evidence and an anchor on every finding.
      for (const x of findings) {
        expect(x.evidence.length).toBeGreaterThan(0);
        expect(x.location.anchor.uri).not.toBe('');
        const template = RULES.find((r) => r.id === x.ruleId)?.messages.message ?? '';
        for (const [, name] of template.matchAll(/\{(\w+)\}/g))
          expect(x.message, x.ruleId).not.toContain(`{${name as string}}`);
        expect(x.fingerprint).toMatch(/^[0-9a-f]{32}$/);
      }
    },
  );
});

describe('rule catalog', () => {
  it('has 83 rules with unique ids', () => {
    expect(RULES.length).toBe(83);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(83);
    expect(DEFAULT_REGISTRY.rules.map((r) => r.id)).toEqual([...RULES.map((r) => r.id)].sort());
  });

  it('handles every change kind', () => {
    const uncovered = CHANGE_KINDS.filter((k) => DEFAULT_REGISTRY.byKind(k).length === 0);
    expect(uncovered).toEqual([]);
  });

  it('has at least one positive and one negative fixture per rule', () => {
    const missing = RULES.flatMap((r) => {
      const fx = FIXTURES.filter((f) => f.rule === r.id);
      const out: string[] = [];
      if (!fx.some((f) => f.fires)) out.push(`${r.id} positive`);
      if (!fx.some((f) => !f.fires)) out.push(`${r.id} negative`);
      return out;
    });
    expect(missing).toEqual([]);
    expect(FIXTURES.length).toBeGreaterThanOrEqual(200);
  });

  it('documents every rule', () => {
    for (const r of RULES) {
      expect(r.name.length, r.id).toBeGreaterThan(0);
      expect(r.docs.rationale.length, r.id).toBeGreaterThan(0);
      expect(
        r.docs.examples.some((e) => e.fires),
        r.id,
      ).toBe(true);
      expect(
        r.docs.examples.some((e) => !e.fires),
        r.id,
      ).toBe(true);
      expect(r.messages.message.length, r.id).toBeGreaterThan(0);
    }
  });

  it('explains rules by id', () => {
    const e = explainRule('cg-api-006');
    expect(e?.name).toBe('operationId changed');
    expect(e?.options.map((o) => o.name)).toEqual(['sdkSensitive']);
    expect(e?.overridable.classification).toBe(true);
    expect(explainRule('CG-REQ-001')?.direction).toBe('request');
    expect(explainRule('CG-NOPE-001')).toBeUndefined();
  });
});

const SPEC = (schema: string, extra = ''): string =>
  `${H31}paths:\n  /pets:\n    get:\n      responses: {'200': {description: ok, content: {application/json: {schema: ${schema}}}}}\n${extra}`;

describe('findings: identity, overrides and suppression', () => {
  const base = SPEC(
    '{type: object, required: [id, email], properties: {id: {}, email: {}, tag: {type: string, enum: [a, b]}}}',
  );
  const cand = SPEC('{type: object, required: [id], properties: {id: {}, tag: {type: string, enum: [a]}}}');

  it('keeps fingerprints stable across formatting, reordering and component renames', async () => {
    const a = checkCompatibility(await contract(base), await contract(cand)).findings;
    const moved = SPEC(
      "{$ref: '#/components/schemas/User'}",
      'components:\n  schemas:\n    User:\n      type: object\n      properties:\n        tag: {enum: [a], type: string}\n        id: {}\n      required: [id]\n',
    );
    const b = checkCompatibility(await contract(base), await contract(moved)).findings;
    expect(b.map((x) => x.fingerprint)).toEqual(a.map((x) => x.fingerprint));
    expect(new Set(a.map((x) => x.fingerprint)).size).toBe(a.length);
  });

  it('changes fingerprints when the rule, perspective or affected property differs', () => {
    const change = {
      kind: 'schema.propertyRemoved',
      subject: {
        operationKey: 'GET /x',
        site: { kind: 'response', status: '200' },
        direction: 'response',
        schemaPath: [],
      },
      base: {},
      candidate: {},
      facts: {
        property: 'a',
        required: true,
        parentAdditionalProperties: { base: 'any', candidate: 'any' },
        parentHasUnevaluatedProperties: false,
      },
      causeKey: 'k',
    } as never;
    const other = { ...(change as object), facts: { ...(change as { facts: object }).facts, property: 'b' } } as never;
    const fp = fingerprintOf('CG-RES-001', 'provider-backward', change);
    expect(fingerprintOf('CG-RES-001', 'provider-backward', change)).toBe(fp);
    expect(fingerprintOf('CG-RES-003', 'provider-backward', change)).not.toBe(fp);
    expect(fingerprintOf('CG-RES-001', 'consumer-forward', change)).not.toBe(fp);
    expect(fingerprintOf('CG-RES-001', 'provider-backward', other)).not.toBe(fp);
  });

  it('applies severity overrides, disabling and suppression with expiry', async () => {
    const B = await contract(base);
    const C = await contract(cand);
    const plain = checkCompatibility(B, C).findings;
    const removed = plain.find((x) => x.ruleId === 'CG-RES-001') as CompatibilityFinding;
    expect(removed.severity).toBe('high');

    const severe = checkCompatibility(B, C, {
      overrides: new Map([['CG-RES-001', { severity: 'critical' }]]),
    }).findings;
    const r1 = severe.find((x) => x.ruleId === 'CG-RES-001');
    expect(r1?.severity).toBe('critical');
    expect(r1?.overrides).toEqual({ originalSeverity: 'high', by: 'rules.CG-RES-001' });

    const disabled = checkCompatibility(B, C, { disabled: new Set(['CG-RES-001']) }).findings;
    expect(disabled.some((x) => x.ruleId === 'CG-RES-001')).toBe(false);

    const ignore = [
      { rule: 'CG-RES-001', reason: 'planned', configPointer: '/ignore/0' },
      { fingerprint: 'nope', reason: 'x', configPointer: '/ignore/1' },
      { operation: 'GET /pets', rule: 'CG-RES-007', reason: 'fine', expires: '2026-01-01', configPointer: '/ignore/2' },
      { reason: 'matches nothing without a selector', configPointer: '/ignore/3' },
    ] as never;
    const sup = checkCompatibility(B, C, { ignore, today: '2026-11-16' }).findings;
    const s1 = sup.find((x) => x.ruleId === 'CG-RES-001');
    expect(s1?.status).toBe('suppressed');
    expect(s1?.suppression).toEqual({ reason: 'planned', configPointer: '/ignore/0' });
    expect(sup.find((x) => x.ruleId === 'CG-RES-007')?.status).toBe('active'); // expired entry

    const byOp = checkCompatibility(B, C, {
      ignore: [
        { operation: 'GET /pets', path: '/pets', reason: 'ok', expires: '2099-01-01', configPointer: '/i' },
      ] as never,
      today: '2026-11-16',
    }).findings;
    expect(byOp.every((x) => x.status === 'suppressed')).toBe(true);
    expect(byOp[0]?.suppression?.expires).toBe('2099-01-01');
    const byFp = checkCompatibility(B, C, {
      ignore: [{ fingerprint: removed.fingerprint, reason: 'r', configPointer: '/f' }] as never,
    }).findings;
    expect(byFp.filter((x) => x.status === 'suppressed').map((x) => x.ruleId)).toEqual(['CG-RES-001']);
  });

  it('sorts findings by classification, severity, operation and rule, and is deterministic', async () => {
    const B = await contract(base);
    const C = await contract(cand);
    const a = checkCompatibility(B, C).findings;
    expect(a.map((x) => `${x.classification}/${x.ruleId}`)).toEqual(['breaking/CG-RES-001', 'non-breaking/CG-RES-007']);
    expect(checkCompatibility(B, C).findings).toEqual(a);
    expect(a[0]?.subject).toMatchObject({ method: 'GET', path: '/pets', operationKey: 'GET /pets' });
    expect(a[0]?.message).toBe(
      'Required property "email" was removed from GET /pets: response 200 (application/json).',
    );
    expect(a[0]?.evidence.map((e) => e.kind)).toEqual(['base-source', 'candidate-source', 'reasoning']);
  });
});

describe('perspectives', () => {
  it('swap roles between provider-backward and consumer-forward', () => {
    expect(PROVIDER_BACKWARD.roleOf('response')).toBe('guarantee');
    expect(PROVIDER_BACKWARD.roleOf('request')).toBe('acceptance');
    expect(CONSUMER_FORWARD.roleOf('response')).toBe('acceptance');
    expect(CONSUMER_FORWARD.roleOf('credentials')).toBe('guarantee');
  });

  const post = (schema: string, required = false): string =>
    `${H31}paths:\n  /x:\n    post:\n      requestBody: {${required ? 'required: true, ' : ''}content: {application/json: {schema: ${schema}}}}\n      responses: {'204': {description: ok}}\n`;
  const query = (required: boolean): string =>
    `${H31}paths:\n  /x:\n    get:\n      parameters: [{name: q, in: query, required: ${String(required)}, schema: {type: string}}]\n      responses: {'200': {description: ok}}\n`;
  const breaking = (fs: readonly CompatibilityFinding[]): boolean => fs.some((f) => f.classification === 'breaking');

  /**
   * Direction duality (metamorphic, §18.6): for rules whose effects are value-space accurate, a change that breaks
   * existing consumers going A → B (provider-backward) breaks new consumers going B → A (consumer-forward).
   */
  it.each([
    ['response type widened', SPEC('{type: integer}'), SPEC('{type: number}')],
    ['request type narrowed', post('{type: number}'), post('{type: integer}')],
    ['request disjoint type', post('{type: string}'), post('{type: object}')],
    [
      'request media type removed',
      post('{type: object}').replace('application/json: {', 'application/xml: {}, application/json: {'),
      post('{type: object}'),
    ],
    ['query parameter became required', query(false), query(true)],
    ['request body became required', post('{type: object}'), post('{type: object}', true)],
  ])('duality: %s', async (_name, a, b) => {
    const A: ApiContract = await contract(a);
    const B: ApiContract = await contract(b);
    for (const [x, y] of [
      [A, B],
      [B, A],
    ] as const) {
      const pb = checkCompatibility(x, y, { perspective: PROVIDER_BACKWARD }).findings;
      const cf = checkCompatibility(y, x, { perspective: CONSUMER_FORWARD }).findings;
      expect(breaking(cf)).toBe(breaking(pb));
    }
  });

  /**
   * Known asymmetries of the v1 catalog under consumer-forward (to be resolved before consumer-forward ships, M10):
   * - RES-004/005 label property additions to responses "widens/additive" (reader-centric, so the strict-validation
   *   policy applies); in value-space terms they narrow.
   * - Reverse changes without a catalog rule: request property became optional, response value no longer nullable.
   * - RES-006 classifies enum additions by provider-backward policy (override), not by the table.
   */
  it.each([
    [
      'required response property removed',
      SPEC('{type: object, required: [a], properties: {a: {}}}'),
      SPEC('{type: object}'),
    ],
    [
      'request property became required',
      post('{type: object, properties: {a: {}}}'),
      post('{type: object, required: [a], properties: {a: {}}}'),
    ],
    ['response enum narrowed', SPEC('{type: string, enum: [a, b]}'), SPEC('{type: string, enum: [a]}')],
  ])('known duality gap (M10): %s', async (_name, a, b) => {
    const A = await contract(a);
    const B = await contract(b);
    const pairs = [
      [A, B],
      [B, A],
    ] as const;
    const mismatch = pairs.some(
      ([x, y]) =>
        breaking(checkCompatibility(x, y, { perspective: PROVIDER_BACKWARD }).findings) !==
        breaking(checkCompatibility(y, x, { perspective: CONSUMER_FORWARD }).findings),
    );
    expect(mismatch).toBe(true);
  });
});
