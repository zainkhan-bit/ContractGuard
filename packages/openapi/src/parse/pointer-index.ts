import { type LineCounter } from 'yaml';
import {
  ROOT_POINTER,
  pointerFromSegments,
  pointerSegments,
  type JsonPointer,
  type SourcePosition,
  type SourceRange,
} from '@contractguard/core';

/** Offsets [start, end) in UTF-16 code units of the decoded document text. */
export interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

/** Maps JSON pointers to source ranges (§8.3). The single authority for positions (R7). */
export interface PointerIndex {
  rangeOf(pointer: JsonPointer): { readonly key?: SourceRange; readonly value: SourceRange } | undefined;
  /** The pointer itself if indexed, otherwise its nearest indexed ancestor (the root is always indexed). */
  nearestExisting(pointer: JsonPointer): JsonPointer;
  /** Number of indexed pointers. */
  readonly size: number;
}

/** A node in the index: 0 is the root. */
export type Slot = number;

/** Sentinel for "no key range" (array items and the root). */
const NO_KEY = -1;
const ROOT_SLOT: Slot = 0;

/**
 * Compact trie storage: each node stores its parent and its own token, never a full pointer string,
 * so memory stays linear in document size whatever the nesting depth (full pointer strings would be
 * quadratic for deep documents once the engine flattens concatenated strings). Four numbers per node
 * in a flat array: keyStart, keyEnd, valueStart, valueEnd.
 */
export class PointerIndexBuilder {
  /** `${parentSlot}\0${token}` → slot. */
  readonly #children = new Map<string, Slot>();
  readonly #parents: Slot[] = [];
  readonly #tokens: string[] = [];
  readonly #offsets: number[] = [];

  /** Creates (or updates) the root entry and returns its slot. */
  root(value: OffsetRange): Slot {
    if (this.#parents.length === 0) {
      this.#parents.push(-1);
      this.#tokens.push('');
    }
    this.update(ROOT_SLOT, value);
    return ROOT_SLOT;
  }

  /** Creates (or updates) the entry for `token` under `parent` and returns its slot. */
  child(parent: Slot, token: string | number, value: OffsetRange, key?: OffsetRange): Slot {
    const t = String(token);
    const id = `${String(parent)}\0${t}`;
    let slot = this.#children.get(id);
    if (slot === undefined) {
      slot = this.#parents.length;
      this.#children.set(id, slot);
      this.#parents.push(parent);
      this.#tokens.push(t);
    }
    this.update(slot, value, key);
    return slot;
  }

  /** Sets the ranges of an existing slot (containers learn their end offset after their children). */
  update(slot: Slot, value: OffsetRange, key?: OffsetRange): void {
    const o = slot * 4;
    this.#offsets[o] = key?.start ?? NO_KEY;
    this.#offsets[o + 1] = key?.end ?? NO_KEY;
    this.#offsets[o + 2] = value.start;
    this.#offsets[o + 3] = value.end;
  }

  /** The pointer of a slot, optionally extended by one more token (used for diagnostics only). */
  pointerOf(slot: Slot | undefined, extra?: string | number): JsonPointer {
    const segments: string[] = extra === undefined ? [] : [String(extra)];
    for (let s = slot; s !== undefined && s > ROOT_SLOT; s = this.#parents[s]) segments.push(this.#tokens[s] as string);
    return slot === undefined && extra === undefined ? ROOT_POINTER : pointerFromSegments(segments.reverse());
  }

  build(lineCounter: LineCounter): PointerIndex {
    return new LinePointerIndex(this.#children, this.#parents.length, Float64Array.from(this.#offsets), lineCounter);
  }
}

class LinePointerIndex implements PointerIndex {
  readonly #children: ReadonlyMap<string, Slot>;
  readonly #count: number;
  readonly #offsets: Float64Array;
  readonly #lines: LineCounter;

  constructor(children: ReadonlyMap<string, Slot>, count: number, offsets: Float64Array, lines: LineCounter) {
    this.#children = children;
    this.#count = count;
    this.#offsets = offsets;
    this.#lines = lines;
  }

  get size(): number {
    return this.#count;
  }

  /** Walks the trie; returns the deepest slot reached and how many segments matched. */
  #walk(segments: readonly string[]): { readonly slot: Slot; readonly matched: number } {
    let slot = ROOT_SLOT;
    let i = 0;
    for (; i < segments.length; i++) {
      const next = this.#children.get(`${String(slot)}\0${segments[i] as string}`);
      if (next === undefined) break;
      slot = next;
    }
    return { slot, matched: i };
  }

  rangeOf(pointer: JsonPointer): { readonly key?: SourceRange; readonly value: SourceRange } | undefined {
    if (this.#count === 0) return undefined;
    const segments = pointerSegments(pointer);
    const { slot, matched } = this.#walk(segments);
    if (matched !== segments.length) return undefined;
    const o = this.#offsets;
    const base = slot * 4;
    const value = this.#toRange(o[base + 2] as number, o[base + 3] as number);
    const keyStart = o[base] as number;
    return keyStart === NO_KEY ? { value } : { key: this.#toRange(keyStart, o[base + 1] as number), value };
  }

  nearestExisting(pointer: JsonPointer): JsonPointer {
    const segments = pointerSegments(pointer);
    const { matched } = this.#walk(segments);
    return matched === segments.length ? pointer : pointerFromSegments(segments.slice(0, matched));
  }

  #toRange(start: number, end: number): SourceRange {
    return { start: positionAt(this.#lines, start), end: positionAt(this.#lines, end) };
  }
}

/** Converts an offset to a 1-based line/column position using a LineCounter. */
export function positionAt(lines: LineCounter, offset: number): SourcePosition {
  const { line, col } = lines.linePos(offset);
  return { line, column: col, offset };
}
