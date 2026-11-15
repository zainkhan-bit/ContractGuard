import { type LineCounter } from 'yaml';
import { parentPointer, type JsonPointer, type SourcePosition, type SourceRange } from '@contractguard/core';

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

/** Sentinel for "no key range" (array items and the root). */
const NO_KEY = -1;

/**
 * Compact storage: one Map slot per pointer and four numbers per slot in a flat array
 * (keyStart, keyEnd, valueStart, valueEnd) — avoids millions of small objects on large specs.
 */
export class PointerIndexBuilder {
  readonly #slots = new Map<string, number>();
  readonly #offsets: number[] = [];

  set(pointer: JsonPointer, value: OffsetRange, key?: OffsetRange): void {
    let slot = this.#slots.get(pointer);
    if (slot === undefined) {
      slot = this.#offsets.length;
      this.#slots.set(pointer, slot);
    }
    this.#offsets[slot] = key?.start ?? NO_KEY;
    this.#offsets[slot + 1] = key?.end ?? NO_KEY;
    this.#offsets[slot + 2] = value.start;
    this.#offsets[slot + 3] = value.end;
  }

  build(lineCounter: LineCounter): PointerIndex {
    return new LinePointerIndex(this.#slots, Float64Array.from(this.#offsets), lineCounter);
  }
}

class LinePointerIndex implements PointerIndex {
  readonly #slots: ReadonlyMap<string, number>;
  readonly #offsets: Float64Array;
  readonly #lines: LineCounter;

  constructor(slots: ReadonlyMap<string, number>, offsets: Float64Array, lines: LineCounter) {
    this.#slots = slots;
    this.#offsets = offsets;
    this.#lines = lines;
  }

  get size(): number {
    return this.#slots.size;
  }

  rangeOf(pointer: JsonPointer): { readonly key?: SourceRange; readonly value: SourceRange } | undefined {
    const slot = this.#slots.get(pointer);
    if (slot === undefined) return undefined;
    const o = this.#offsets;
    const value = this.#toRange(o[slot + 2] as number, o[slot + 3] as number);
    const keyStart = o[slot] as number;
    return keyStart === NO_KEY ? { value } : { key: this.#toRange(keyStart, o[slot + 1] as number), value };
  }

  nearestExisting(pointer: JsonPointer): JsonPointer {
    let current: JsonPointer | undefined = pointer;
    while (current !== undefined) {
      if (this.#slots.has(current)) return current;
      current = parentPointer(current);
    }
    return '#' as JsonPointer;
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
