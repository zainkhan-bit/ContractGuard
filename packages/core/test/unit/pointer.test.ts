import { describe, expect, it } from 'vitest';
import {
  ROOT_POINTER,
  appendPointer,
  escapeToken,
  isAncestorOrSelf,
  parentPointer,
  parsePointer,
  pointerFromSegments,
  pointerFromUriFragment,
  pointerSegments,
  pointerToUriFragment,
  unescapeToken,
  type JsonPointer,
} from '../../src/ids/pointer.js';

const p = (s: string): JsonPointer => s as JsonPointer;

describe('escapeToken / unescapeToken', () => {
  it('escapes ~ before / (RFC 6901 order)', () => {
    expect(escapeToken('a/b~c')).toBe('a~1b~0c');
    expect(escapeToken('~1')).toBe('~01');
  });

  it('unescapes ~1 then ~0 so "~01" becomes "~1"', () => {
    expect(unescapeToken('~01')).toBe('~1');
    expect(unescapeToken('a~1b~0c')).toBe('a/b~c');
  });

  it('rejects invalid escapes', () => {
    expect(unescapeToken('~2')).toBeUndefined();
    expect(unescapeToken('a~')).toBeUndefined();
  });
});

describe('pointerFromSegments / pointerSegments', () => {
  it('builds the root pointer for no segments', () => {
    expect(pointerFromSegments([])).toBe('#');
    expect(pointerSegments(ROOT_POINTER)).toEqual([]);
  });

  it('round-trips OpenAPI paths and indexes', () => {
    const ptr = pointerFromSegments(['paths', '/users/{id}', 'get', 'parameters', 0]);
    expect(ptr).toBe('#/paths/~1users~1{id}/get/parameters/0');
    expect(pointerSegments(ptr)).toEqual(['paths', '/users/{id}', 'get', 'parameters', '0']);
  });

  it('supports empty-string tokens', () => {
    const ptr = pointerFromSegments(['']);
    expect(ptr).toBe('#/');
    expect(pointerSegments(ptr)).toEqual(['']);
  });
});

describe('parsePointer', () => {
  it('accepts fragment and plain forms', () => {
    expect(parsePointer('#')).toBe('#');
    expect(parsePointer('')).toBe('#');
    expect(parsePointer('/a/b')).toBe('#/a/b');
    expect(parsePointer('#/a~1b')).toBe('#/a~1b');
  });

  it('rejects malformed pointers', () => {
    expect(parsePointer('a/b')).toBeUndefined();
    expect(parsePointer('#a')).toBeUndefined();
    expect(parsePointer('#/a~2')).toBeUndefined();
  });
});

describe('appendPointer / parentPointer / isAncestorOrSelf', () => {
  it('appends to root and non-root pointers', () => {
    expect(appendPointer(ROOT_POINTER, 'components', 'schemas')).toBe('#/components/schemas');
    expect(appendPointer(p('#/a'), 'b/c')).toBe('#/a/b~1c');
    expect(appendPointer(p('#/a'))).toBe('#/a');
  });

  it('computes parents', () => {
    expect(parentPointer(ROOT_POINTER)).toBeUndefined();
    expect(parentPointer(p('#/a'))).toBe('#');
    expect(parentPointer(p('#/a/b/c'))).toBe('#/a/b');
  });

  it('checks ancestry on token boundaries', () => {
    expect(isAncestorOrSelf(ROOT_POINTER, p('#/x'))).toBe(true);
    expect(isAncestorOrSelf(p('#/a'), p('#/a'))).toBe(true);
    expect(isAncestorOrSelf(p('#/a'), p('#/a/b'))).toBe(true);
    expect(isAncestorOrSelf(p('#/a'), p('#/ab'))).toBe(false);
  });
});

describe('URI fragments', () => {
  it('percent-decodes before parsing', () => {
    expect(pointerFromUriFragment('#/a%20b/c')).toBe('#/a b/c');
    expect(pointerFromUriFragment('/x')).toBe('#/x');
  });

  it('rejects invalid percent-encoding', () => {
    expect(pointerFromUriFragment('#/%E0%A4%A')).toBeUndefined();
  });

  it('encodes unsafe characters including non-ASCII and %', () => {
    expect(pointerToUriFragment(p('#/a b/ü/100%'))).toBe('#/a%20b/%C3%BC/100%25');
    expect(pointerToUriFragment(p('#/~1users/get'))).toBe('#/~1users/get');
  });

  it('round-trips through encoding', () => {
    const ptr = pointerFromSegments(['paths', '/a b/{id}', 'ü', '%']);
    expect(pointerFromUriFragment(pointerToUriFragment(ptr))).toBe(ptr);
  });
});
