import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, isJsonNumber, parsePointer, type CanonicalJson, type JsonPointer } from '@contractguard/core';
import { parseDocument } from '../../src/parse/parser.js';
import { URI, codes, json, parseOk, parseText } from '../helpers.js';

const ptr = (s: string): JsonPointer => parsePointer(s) as JsonPointer;

describe('parseDocument: values', () => {
  it('parses JSON and YAML into the same canonical value', () => {
    const yaml = parseOk('openapi: 3.1.0\ninfo:\n  title: T\n  version: "1"\npaths: {}\n');
    const jsonDoc = parseOk('{"paths":{},"openapi":"3.1.0","info":{"version":"1","title":"T"}}');
    expect(json(yaml)).toBe(json(jsonDoc));
  });

  it('keeps exact numbers from source text', () => {
    const doc = parseOk('a: 123456789012345678901234567890\nb: 1e3\nc: 0x1F\nd: 0o17\ne: -0.0\nf: 1.50\ng: .5\n');
    expect(json(doc)).toBe('{"a":123456789012345678901234567890,"b":1000,"c":31,"d":15,"e":0,"f":1.5,"g":0.5}');
    const v = doc.value as Record<string, CanonicalJson>;
    expect(isJsonNumber(v['a'])).toBe(true);
  });

  it('stringifies plain non-string keys using their source spelling', () => {
    const doc = parseOk('responses:\n  200: {description: ok}\n  2XX: {description: x}\n  true: 1\n  1e3: 2\n');
    expect(json(doc)).toBe('{"responses":{"1e3":2,"200":{"description":"ok"},"2XX":{"description":"x"},"true":1}}');
  });

  it('keeps quoted numbers as strings and YAML 1.2 booleans/nulls', () => {
    expect(json(parseOk('a: "3.0"\nb: yes\nc: True\nd: ~\ne:\nf: 2001-12-14\n'))).toBe(
      '{"a":"3.0","b":"yes","c":true,"d":null,"e":null,"f":"2001-12-14"}',
    );
  });

  it('expands aliases within the budget and does not treat << as a merge key', () => {
    expect(json(parseOk('base: &b {x: 1}\nuse: *b\nm:\n  <<: *b\n'))).toBe(
      '{"base":{"x":1},"m":{"<<":{"x":1}},"use":{"x":1}}',
    );
  });

  it('accepts a document of null and scalar roots', () => {
    expect(json(parseOk('null\n'))).toBe('null');
    expect(json(parseOk('"text"'))).toBe('"text"');
  });

  it('produces frozen, prototype-safe values', () => {
    const doc = parseOk('__proto__: {polluted: true}\nconstructor: 1\nlist: [1]\n');
    const v = doc.value as Record<string, CanonicalJson>;
    expect(Object.getPrototypeOf(v)).toBeNull();
    expect(Object.keys(v)).toEqual(['__proto__', 'constructor', 'list']);
    expect(Object.isFrozen(v['list'])).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('records sha256 and byte length', () => {
    const doc = parseOk('a: 1\n');
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.bytes).toBe(5);
    expect(doc.uri).toBe(URI);
  });
});

describe('parseDocument: errors', () => {
  it.each([
    ['syntax error', 'a: [1, 2\n', 'CGD-PARSE-001'],
    ['duplicate key', 'a: 1\na: 2\n', 'CGD-PARSE-003'],
    ['duplicate after key stringification', "200: a\n'200': b\n", 'CGD-PARSE-003'],
    ['non-scalar key', '? [x]\n: 1\n', 'CGD-PARSE-010'],
    ['null key', '? \n: 1\n', 'CGD-PARSE-010'],
    ['infinity', 'a: .inf\n', 'CGD-PARSE-011'],
    ['NaN', 'a: .nan\n', 'CGD-PARSE-011'],
    ['YAML 1.1 binary tag', 'a: !!binary aGk=\n', 'CGD-PARSE-012'],
    ['custom tag', 'a: !custom x\n', 'CGD-PARSE-012'],
    ['custom tag on a map', 'a: !thing {b: 1}\n', 'CGD-PARSE-012'],
    ['multiple documents', 'a: 1\n---\nb: 2\n', 'CGD-PARSE-014'],
    ['huge exponent', 'a: 1e99999999\n', 'CGD-PARSE-015'],
    ['empty document', '', 'CGD-PARSE-001'],
  ])('%s → %s', (_name, text, code) => {
    const r = parseText(text);
    expect(r.doc).toBeUndefined();
    expect(codes(r.diagnostics)).toContain(code);
  });

  it('locates errors with line and column', () => {
    const r = parseText('a: 1\nb: 2\na: 3\n');
    expect(r.diagnostics[0]?.location?.range?.start).toMatchObject({ line: 3, column: 1 });
  });

  it('rejects invalid UTF-8 and UTF-16', () => {
    const bad = parseDocument(
      { uri: URI, bytes: new Uint8Array([0x61, 0x3a, 0x20, 0xff, 0xfe]) },
      { limits: DEFAULT_LIMITS },
    );
    expect(codes(bad.diagnostics)).toEqual(['CGD-PARSE-002']);
    const utf16 = parseDocument(
      { uri: URI, bytes: new Uint8Array([0xff, 0xfe, 0x61, 0x00]) },
      { limits: DEFAULT_LIMITS },
    );
    expect(utf16.diagnostics[0]?.message).toContain('UTF-16');
  });

  it('enforces the document size limit before decoding', () => {
    const r = parseText('a: 1234567890\n', { ...DEFAULT_LIMITS, maxDocumentBytes: 4 });
    expect(codes(r.diagnostics)).toEqual(['CGD-LIMIT-001']);
  });

  it('enforces maxDepth on nested values', () => {
    const r = parseText('a: [[[[[[1]]]]]]\n', { ...DEFAULT_LIMITS, maxDepth: 4 });
    expect(codes(r.diagnostics)).toEqual(['CGD-LIMIT-003']);
    expect(r.diagnostics[0]?.location?.pointer).toBe('#/a/0/0/0/0');
  });

  it('passes the side through to diagnostics', () => {
    const r = parseDocument(
      { uri: URI, bytes: new TextEncoder().encode('a: [') },
      { limits: DEFAULT_LIMITS, side: 'base' },
    );
    expect(r.diagnostics.every((d) => d.side === 'base')).toBe(true);
  });

  it('reports a custom alias budget', () => {
    const r = parseDocument(
      { uri: URI, bytes: new TextEncoder().encode('a: &a 1\nb: [*a, *a, *a]\n') },
      { limits: DEFAULT_LIMITS, maxAliasExpansions: 2 },
    );
    expect(codes(r.diagnostics)).toEqual(['CGD-LIMIT-005']);
  });
});

describe('PointerIndex', () => {
  const text =
    'openapi: 3.0.3\npaths:\n  /users/{id}:\n    get:\n      parameters:\n        - name: id\n          in: path\n';

  it('maps pointers to 1-based key and value ranges', () => {
    const doc = parseOk(text);
    const r = doc.index.rangeOf(ptr('#/paths/~1users~1{id}/get'));
    expect(r?.key?.start).toEqual({ line: 4, column: 5, offset: 41 });
    expect(r?.value.start.line).toBe(5);
    const name = doc.index.rangeOf(ptr('#/paths/~1users~1{id}/get/parameters/0/name'));
    expect(name?.value.start).toMatchObject({ line: 6, column: 17 });
    expect(name?.value.end).toMatchObject({ line: 6, column: 19 });
    expect(doc.index.rangeOf(ptr('#'))?.value.start).toMatchObject({ line: 1, column: 1 });
    expect(doc.index.size).toBeGreaterThan(8);
  });

  it('finds the nearest existing ancestor for removed elements', () => {
    const doc = parseOk(text);
    expect(doc.index.nearestExisting(ptr('#/paths/~1users~1{id}/get/responses/200'))).toBe('#/paths/~1users~1{id}/get');
    expect(doc.index.nearestExisting(ptr('#/nothing/here'))).toBe('#');
    expect(doc.index.rangeOf(ptr('#/nothing'))).toBeUndefined();
  });

  it('handles CRLF line endings', () => {
    const doc = parseOk('a: 1\r\nb:\r\n  c: x\r\n');
    expect(doc.index.rangeOf(ptr('#/b/c'))?.value.start).toMatchObject({ line: 3, column: 6 });
  });

  it('counts columns in UTF-16 code units after non-ASCII text and a BOM', () => {
    const doc = parseOk('\uFEFFtitle: "é😀"\nnext: v\n');
    expect(json(doc)).toBe('{"next":"v","title":"é😀"}');
    expect(doc.index.rangeOf(ptr('#/next'))?.value.start).toMatchObject({ line: 2, column: 7 });
  });

  it('indexes null values at the key position', () => {
    const doc = parseOk('a:\nb: 1\n');
    const r = doc.index.rangeOf(ptr('#/a'));
    expect(r?.value.start.line).toBe(1);
  });

  it('indexes JSON documents', () => {
    const doc = parseOk('{\n  "a": {\n    "b": [10, 20]\n  }\n}');
    expect(doc.index.rangeOf(ptr('#/a/b/1'))?.value.start).toMatchObject({ line: 3, column: 15 });
  });
});
