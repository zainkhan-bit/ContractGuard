import { describe, expect, it } from 'vitest';
import { HyperjumpSpecValidator, toPlainJson } from '../../src/validate/structural.js';
import { codes, parseOk } from '../helpers.js';

const validator = new HyperjumpSpecValidator();

describe('HyperjumpSpecValidator', () => {
  it('accepts valid 3.0 and 3.1 documents', async () => {
    const v30 = await validator.validate(
      parseOk(`openapi: 3.0.3
info: {title: t, version: '1'}
paths:
  /a:
    get:
      responses:
        '200': {description: ok, content: {application/json: {schema: {type: string, nullable: true}}}}
`),
      'oas30',
    );
    expect(v30.diagnostics).toEqual([]);
    const v31 = await validator.validate(
      parseOk(`openapi: 3.1.0
info: {title: t, version: '1'}
paths:
  /a:
    get:
      responses:
        '200': {description: ok, content: {application/json: {schema: {type: [string, 'null']}}}}
`),
      'oas31',
    );
    expect(v31.diagnostics).toEqual([]);
  });

  it('reports precise locations for invalid documents', async () => {
    const doc = parseOk(`openapi: 3.1.0
info: {title: t}
paths:
  /a:
    get:
      responses:
        '200': {content: {}}
`);
    const r = await validator.validate(doc, 'oas31', 'candidate');
    expect(codes(r.diagnostics).every((c) => c === 'CGD-SPEC-005')).toBe(true);
    const messages = r.diagnostics.map((d) => d.message);
    expect(messages.some((m) => m.includes('#/info') && m.includes('required'))).toBe(true);
    expect(messages.some((m) => m.includes('#/paths/~1a/get/responses/200'))).toBe(true);
    expect(r.diagnostics.every((d) => d.side === 'candidate' && d.location?.range !== undefined)).toBe(true);
  });

  it('rejects 3.1-only syntax in a 3.0 document', async () => {
    const doc = parseOk(`openapi: 3.0.3
info: {title: t, version: '1'}
paths:
  /a:
    get:
      responses:
        '200': {description: ok, content: {application/json: {schema: {type: [string, 'null']}}}}
`);
    const r = await validator.validate(doc, 'oas30');
    expect(r.diagnostics.some((d) => d.message.includes('schema/type'))).toBe(true);
  });

  it('caps the number of reported errors', async () => {
    const paths = Array.from({ length: 10 }, (_, i) => `  /p${i}: {get: {responses: {'200': {}}}}`).join('\n');
    const r = await new HyperjumpSpecValidator({ maxErrors: 3 }).validate(
      parseOk(`openapi: 3.1.0\ninfo: {title: t, version: '1'}\npaths:\n${paths}\n`),
      'oas31',
    );
    expect(r.diagnostics).toHaveLength(4);
    expect(r.diagnostics[3]?.message).toContain('more structural errors');
  });
});

describe('toPlainJson', () => {
  it('converts canonical values to ordinary objects with numbers', () => {
    const plain = toPlainJson(parseOk('a: [1.5, {b: null}]\n__proto__: x\n').value) as Record<string, unknown>;
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
    expect(plain['a']).toEqual([1.5, { b: null }]);
    expect(Object.keys(plain)).toEqual(['__proto__', 'a']);
  });
});
