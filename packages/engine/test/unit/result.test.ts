import { describe, expect, it } from 'vitest';
import { checkCompatibility } from '../../src/check.js';
import { assembleResult, isGating } from '../../src/result.js';
import { contract, HEAD31 } from '../helpers.js';

const spec = (schema: string): string =>
  `${HEAD31}paths:\n  /a:\n    get:\n      responses: {'200': {description: ok, content: {application/json: {schema: ${schema}}}}}\n  /b:\n    post:\n      requestBody: {content: {application/json: {schema: ${schema}}}}\n      responses: {'204': {description: ok}}\n`;

describe('assembleResult', () => {
  it('summarizes findings, groups causes and applies the default policy', async () => {
    const B = await contract(
      spec("{type: object, required: [x], properties: {x: {type: string, pattern: '^a'}, e: {enum: [a, b]}}}"),
    );
    const C = await contract(spec("{type: object, properties: {x: {type: string, pattern: '^b'}, e: {enum: [a]}}}"));
    const { findings } = checkCompatibility(B, C);
    const r = assembleResult({
      specId: 'api',
      perspective: 'provider-backward',
      toolVersion: '1.2.3',
      rulesetVersion: '1.0.0',
      base: { contract: B, revision: 'main' },
      candidate: { contract: C },
      findings,
      diagnostics: [],
    });
    expect(r.status).toBe('completed');
    expect(r.base?.revision).toBe('main');
    expect(r.candidate?.revision).toBeUndefined();
    expect(r.base?.operationCount).toBe(2);
    expect(r.summary.byClassification.breaking).toBe(2);
    expect(r.summary.byClassification.undetermined).toBe(2);
    expect(r.summary.affectedOperations).toBe(2);
    expect(r.policy).toMatchObject({ passed: false, undeterminedHandling: 'review' });
    expect(r.policy.reasons.map((x) => x.rule)).toEqual(['CG-RES-002', 'CG-REQ-020']);
    expect(r.causes[0]?.worst).toBe('breaking');
    expect(r.causes.reduce((n, c) => n + c.findingFingerprints.length, 0)).toBe(findings.length);
    expect(r.generatedAt).toBeUndefined();

    const strict = assembleResult({
      specId: 'api',
      perspective: 'provider-backward',
      toolVersion: '1',
      rulesetVersion: '1',
      base: { contract: B },
      candidate: { contract: C },
      findings,
      diagnostics: [],
      degraded: true,
      policy: { failOn: [], minSeverity: 'low', undetermined: 'fail' },
      generatedAt: '2026-11-16T00:00:00Z',
    });
    expect(strict.status).toBe('completed-degraded');
    expect(strict.policy.reasons.map((x) => x.rule).sort()).toEqual(['CG-REQ-027', 'CG-RES-013']);
    expect(strict.policy.reasons[0]?.because).toContain('undetermined: fail');
    expect(strict.generatedAt).toBe('2026-11-16T00:00:00Z');
  });

  it('marks input errors as failed and ignores suppressed or low-severity findings', async () => {
    const B = await contract(spec('{type: integer}'));
    const C = await contract(spec('{type: number}'));
    const { findings } = checkCompatibility(B, C, {
      ignore: [{ rule: 'CG-RES-008', reason: 'ok', configPointer: '/i' }] as never,
    });
    const r = assembleResult({
      specId: 's',
      perspective: 'provider-backward',
      toolVersion: '1',
      rulesetVersion: '1',
      base: { contract: B },
      findings,
      diagnostics: [],
    });
    expect(r.status).toBe('input-error');
    expect(r.candidate).toBeUndefined();
    expect(r.policy.passed).toBe(false);
    expect(r.summary.suppressed).toBe(1);
    const suppressed = findings.find((f) => f.status === 'suppressed');
    expect(
      suppressed === undefined
        ? true
        : isGating(suppressed, { failOn: ['breaking'], minSeverity: 'low', undetermined: 'review' }),
    ).toBe(false);
    const active = findings.find((f) => f.status === 'active' && f.classification === 'non-breaking');
    expect(
      active === undefined
        ? false
        : isGating(active, { failOn: ['non-breaking'], minSeverity: 'critical', undetermined: 'review' }),
    ).toBe(false);
    expect(
      active === undefined
        ? false
        : isGating(active, { failOn: ['non-breaking'], minSeverity: 'info', undetermined: 'review' }),
    ).toBe(true);
  });
});
