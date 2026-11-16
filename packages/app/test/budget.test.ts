import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.js';
import { repo, TODAY, write } from './helpers.js';

/** A spec with `n` operations sharing a few component schemas; `variant` changes every 10th operation. */
function large(n: number, variant: boolean): string {
  const lines = ['openapi: 3.1.0', 'info: {title: Large, version: 1.0.0}', 'paths:'];
  for (let i = 0; i < n; i++) {
    lines.push(
      `  /r${String(i)}/{id}:`,
      '    get:',
      '      parameters:',
      '        - {name: id, in: path, required: true, schema: {type: string}}',
      `        - {name: limit, in: query, required: ${variant && i % 10 === 0 ? 'true' : 'false'}, schema: {type: integer, maximum: ${variant && i % 10 === 0 ? '10' : '100'}}}`,
      '      responses:',
      "        '200':",
      '          description: ok',
      '          content:',
      '            application/json:',
      `              schema: {$ref: '#/components/schemas/${i % 2 === 0 ? 'Item' : 'Page'}'}`,
    );
  }
  lines.push(
    'components:',
    '  schemas:',
    '    Item:',
    '      type: object',
    '      required: [id]',
    '      properties:',
    '        id: {type: string}',
    '        tags: {type: array, items: {type: string}}',
    `${variant ? '' : '        legacy: {type: string}\n'}        child: {$ref: '#/components/schemas/Item'}`,
    '    Page:',
    '      type: object',
    '      properties:',
    "        items: {type: array, items: {$ref: '#/components/schemas/Item'}}",
    '        next: {type: [string, "null"]}',
  );
  return `${lines.join('\n')}\n`;
}

describe('performance budget (§18.8)', () => {
  it('500 operations with recursive schemas analyze well within budget', async () => {
    const d = repo([{ 'openapi.yaml': large(500, false) }]);
    write(d, { 'openapi.yaml': large(500, true) });
    const started = performance.now();
    const r = await analyze({
      cwd: d,
      configPath: false,
      adHoc: { base: 'git:HEAD:openapi.yaml', candidate: 'openapi.yaml' },
      today: TODAY,
      toolVersion: '1',
    });
    const ms = performance.now() - started;
    expect(r.value?.outcome).toBe('policy-failed');
    expect(r.value?.results[0]?.summary.affectedOperations).toBe(500); // every operation reaches Item
    // Generous ceiling for slow CI machines; locally this takes well under two seconds.
    expect(ms).toBeLessThan(20_000);
  }, 60_000);
});
