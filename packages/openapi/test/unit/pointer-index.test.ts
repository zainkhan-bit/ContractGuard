import { LineCounter } from 'yaml';
import { describe, expect, it } from 'vitest';
import { PointerIndexBuilder } from '../../src/parse/pointer-index.js';

const lines = (): LineCounter => {
  const l = new LineCounter();
  l.addNewLine(0);
  return l;
};

describe('PointerIndexBuilder (trie)', () => {
  it('indexes nested entries without storing full pointers and resolves them back', () => {
    const b = new PointerIndexBuilder();
    const root = b.root({ start: 0, end: 50 });
    const paths = b.child(root, 'paths', { start: 10, end: 40 }, { start: 2, end: 7 });
    const slash = b.child(paths, '/a/b~c', { start: 12, end: 30 });
    const item = b.child(slash, 0, { start: 14, end: 16 });
    expect(b.pointerOf(item)).toBe('#/paths/~1a~1b~0c/0');
    expect(b.pointerOf(slash, 'x')).toBe('#/paths/~1a~1b~0c/x');
    expect(b.pointerOf(root)).toBe('#');
    expect(b.pointerOf(undefined)).toBe('#');
    expect(b.pointerOf(undefined, 'k')).toBe('#/k');

    // Re-setting an existing entry updates it in place.
    expect(b.child(paths, '/a/b~c', { start: 12, end: 31 })).toBe(slash);
    expect(b.root({ start: 0, end: 51 })).toBe(root);

    const index = b.build(lines());
    expect(index.size).toBe(4);
    expect(index.rangeOf('#/paths/~1a~1b~0c' as never)?.value.end.offset).toBe(31);
    expect(index.rangeOf('#/paths' as never)?.key?.start.offset).toBe(2);
    expect(index.rangeOf('#' as never)?.value.end.offset).toBe(51);
    expect(index.rangeOf('#/nope' as never)).toBeUndefined();
    expect(index.nearestExisting('#/paths/~1a~1b~0c/0' as never)).toBe('#/paths/~1a~1b~0c/0');
    expect(index.nearestExisting('#/paths/~1a~1b~0c/9/z' as never)).toBe('#/paths/~1a~1b~0c');
    expect(index.nearestExisting('#/other' as never)).toBe('#');
  });

  it('returns nothing from an empty index', () => {
    const index = new PointerIndexBuilder().build(lines());
    expect(index.size).toBe(0);
    expect(index.rangeOf('#' as never)).toBeUndefined();
  });
});
