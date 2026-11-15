import { describe, expect, it } from 'vitest';
import { codes, json, parseText } from '../helpers.js';

/** §16.2 T1–T5: hostile parser inputs must end with a diagnostic quickly, never a crash or hang. */
describe('hostile YAML inputs', () => {
  it('T1: billion-laughs alias expansion is stopped by the alias budget', () => {
    const lines = ['l0: &l0 ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]'];
    for (let i = 1; i <= 9; i++) {
      const prev = `*l${i - 1}`;
      lines.push(`l${i}: &l${i} [${Array.from({ length: 9 }, () => prev).join(',')}]`);
    }
    const start = performance.now();
    const r = parseText(`${lines.join('\n')}\n`);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(codes(r.diagnostics)).toEqual(['CGD-LIMIT-005']);
  });

  it('T1: self-referential aliases terminate', () => {
    expect(codes(parseText('a: &a [*a]\n').diagnostics)).toEqual(['CGD-LIMIT-005']);
  });

  it('T2: 20,000-level flow nesting ends with a depth diagnostic, not a crash', () => {
    const r = parseText(`${'['.repeat(20_000)}${']'.repeat(20_000)}`);
    expect(codes(r.diagnostics)).toEqual(['CGD-LIMIT-003']);
  });

  it('T2: deep block nesting beyond maxDepth is rejected', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `${' '.repeat(i)}k${i}:`).join('\n');
    expect(codes(parseText(`${lines} 1\n`).diagnostics)).toEqual(['CGD-LIMIT-003']);
  });

  it('T4: language-specific tags are rejected, never executed', () => {
    for (const text of [
      'a: !!js/function "function(){ return 1 }"\n',
      'a: !!python/object:os.system ["echo hi"]\n',
      'a: !<tag:yaml.org,2002:js/regexp> /x/\n',
    ]) {
      expect(codes(parseText(text).diagnostics)).toEqual(['CGD-PARSE-012']);
    }
  });

  it('T5: prototype-pollution keys are plain data', () => {
    const r = parseText('__proto__:\n  isAdmin: true\nconstructor:\n  prototype:\n    x: 1\n');
    expect(r.doc).toBeDefined();
    expect(json(r.doc as NonNullable<typeof r.doc>)).toBe(
      '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}',
    );
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
  });

  it('large but legitimate documents parse quickly', () => {
    const paths = Array.from(
      { length: 2000 },
      (_, i) =>
        `  /r${i}/{id}:\n    get:\n      responses:\n        '200': {description: ok, content: {application/json: {schema: {type: object}}}}`,
    ).join('\n');
    const start = performance.now();
    const r = parseText(`openapi: 3.1.0\npaths:\n${paths}\n`);
    expect(r.doc).toBeDefined();
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
