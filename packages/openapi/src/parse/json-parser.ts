import { LineCounter } from 'yaml';
import {
  JsonNumber,
  canonicalObject,
  type CanonicalJson,
  type DiagnosticCode,
  type JsonPointer,
} from '@zainkhan-bit/contractguard-core';
import { PointerIndexBuilder, type OffsetRange, type PointerIndex, type Slot } from './pointer-index.js';

/**
 * Strict RFC 8259 JSON parser with source positions — the fast path for JSON documents
 * (the general YAML path is ~0.5 s/MB; this is ~100× faster). Iterative (no recursion),
 * so nesting depth is bounded only by `maxDepth`.
 */
export type JsonParseOutcome =
  | { readonly ok: true; readonly value: CanonicalJson; readonly index: PointerIndex; readonly lines: LineCounter }
  | { readonly ok: false; readonly syntax: true; readonly offset: number; readonly message: string }
  | {
      readonly ok: false;
      readonly syntax: false;
      readonly code: DiagnosticCode;
      readonly message: string;
      readonly range: OffsetRange;
      readonly pointer: JsonPointer;
      readonly lines: LineCounter;
    };

interface ObjectFrame {
  readonly kind: 'object';
  /** This container's slot in the pointer index. */
  readonly slot: Slot;
  /** Range of the key under which this container sits in its parent object, if any. */
  readonly ownKeyRange?: OffsetRange;
  readonly start: number;
  readonly entries: [string, CanonicalJson][];
  readonly seen: Set<string>;
  key?: string;
  keyRange?: OffsetRange;
}

interface ArrayFrame {
  readonly kind: 'array';
  readonly slot: Slot;
  readonly ownKeyRange?: OffsetRange;
  readonly start: number;
  readonly items: CanonicalJson[];
}

type Frame = ObjectFrame | ArrayFrame;

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Internal control-flow signals (never escape parseJson). */
class SyntaxFailure extends Error {
  constructor(
    readonly offset: number,
    message: string,
  ) {
    super(message);
  }
}

class SemanticFailure extends Error {
  constructor(
    readonly code: DiagnosticCode,
    message: string,
    readonly range: OffsetRange,
    readonly pointer: JsonPointer,
  ) {
    super(message);
  }
}

export function parseJson(text: string, maxDepth: number): JsonParseOutcome {
  const lines = new LineCounter();
  lines.addNewLine(0);
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines.addNewLine(i + 1);

  const index = new PointerIndexBuilder();
  const stack: Frame[] = [];
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let root: CanonicalJson | undefined;

  const skipWs = (): void => {
    for (;;) {
      const c = text.charCodeAt(pos);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) pos++;
      else return;
    }
  };

  const readString = (): string => {
    const start = pos;
    pos++; // opening quote
    let out = '';
    let chunk = pos;
    for (;;) {
      if (pos >= text.length) throw new SyntaxFailure(start, 'Unterminated string');
      const c = text.charCodeAt(pos);
      if (c === 0x22) {
        out += text.slice(chunk, pos);
        pos++;
        return out;
      }
      if (c < 0x20) throw new SyntaxFailure(pos, 'Control character in string');
      if (c === 0x5c) {
        out += text.slice(chunk, pos);
        const e = text[pos + 1];
        switch (e) {
          case '"':
          case '\\':
          case '/':
            out += e;
            pos += 2;
            break;
          case 'b':
            out += '\b';
            pos += 2;
            break;
          case 'f':
            out += '\f';
            pos += 2;
            break;
          case 'n':
            out += '\n';
            pos += 2;
            break;
          case 'r':
            out += '\r';
            pos += 2;
            break;
          case 't':
            out += '\t';
            pos += 2;
            break;
          case 'u': {
            const hex = text.slice(pos + 2, pos + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new SyntaxFailure(pos, 'Invalid \\u escape');
            out += String.fromCharCode(Number.parseInt(hex, 16));
            pos += 6;
            break;
          }
          default:
            throw new SyntaxFailure(pos, 'Invalid escape sequence');
        }
        chunk = pos;
        continue;
      }
      pos++;
    }
  };

  /** Stores a completed value into its parent (or as the root). `own` is set for containers (already indexed). */
  const deliver = (value: CanonicalJson, range: OffsetRange, own?: Frame): void => {
    const parent = stack[stack.length - 1];
    if (own !== undefined) index.update(own.slot, range, own.ownKeyRange);
    if (parent === undefined) {
      root = value;
      if (own === undefined) index.root(range);
      return;
    }
    if (parent.kind === 'array') {
      if (own === undefined) index.child(parent.slot, parent.items.length, range);
      parent.items.push(value);
    } else {
      const key = parent.key as string;
      if (own === undefined) index.child(parent.slot, key, range, parent.keyRange);
      parent.entries.push([key, value]);
      delete parent.key;
      delete parent.keyRange;
    }
  };

  /** Token of the value about to be read within its parent (undefined at the root). */
  const currentToken = (): string | number | undefined => {
    const parent = stack[stack.length - 1];
    if (parent === undefined) return undefined;
    return parent.kind === 'array' ? parent.items.length : parent.key;
  };

  /** Pointer of the value about to be read (computed only for diagnostics). */
  const currentPointer = (): JsonPointer => index.pointerOf(stack[stack.length - 1]?.slot, currentToken());

  /** Creates the index slot for a container that is being opened. */
  const openSlot = (start: number): { readonly slot: Slot; readonly ownKeyRange?: OffsetRange } => {
    const parent = stack[stack.length - 1];
    const placeholder = { start, end: start + 1 };
    if (parent === undefined) return { slot: index.root(placeholder) };
    if (parent.kind === 'array') return { slot: index.child(parent.slot, parent.items.length, placeholder) };
    const ownKeyRange = parent.keyRange as OffsetRange;
    return { slot: index.child(parent.slot, parent.key as string, placeholder, ownKeyRange), ownKeyRange };
  };

  try {
    // State machine: expecting a value, then a separator/closer.
    let expectValue = true;
    for (;;) {
      skipWs();
      if (expectValue) {
        const start = pos;
        const c = text[pos];
        if (c === '{' || c === '[') {
          if (stack.length + 1 > maxDepth) {
            throw new SemanticFailure(
              'CGD-LIMIT-003',
              `Nesting exceeds maxDepth (${maxDepth})`,
              { start, end: start + 1 },
              currentPointer(),
            );
          }
          const opened = openSlot(start);
          pos++;
          skipWs();
          if (c === '{') {
            const frame: ObjectFrame = { kind: 'object', ...opened, start, entries: [], seen: new Set() };
            stack.push(frame);
            if (text[pos] === '}') {
              pos++;
              stack.pop();
              deliver(canonicalObject([]), { start, end: pos }, frame);
              expectValue = false;
              continue;
            }
            readKey(frame);
            continue; // expect value
          }
          const frame: ArrayFrame = { kind: 'array', ...opened, start, items: [] };
          stack.push(frame);
          if (text[pos] === ']') {
            pos++;
            stack.pop();
            deliver(Object.freeze([]), { start, end: pos }, frame);
            expectValue = false;
          }
          continue;
        }
        let value: CanonicalJson;
        if (c === '"') value = readString();
        else if (text.startsWith('true', pos)) {
          value = true;
          pos += 4;
        } else if (text.startsWith('false', pos)) {
          value = false;
          pos += 5;
        } else if (text.startsWith('null', pos)) {
          value = null;
          pos += 4;
        } else {
          NUMBER.lastIndex = pos;
          const m = NUMBER.exec(text);
          if (m === null || m[0] === '' || m[0] === '-') throw new SyntaxFailure(pos, 'Unexpected token');
          const n = JsonNumber.parse(m[0]);
          if (n === undefined) {
            throw new SemanticFailure(
              'CGD-PARSE-015',
              `Number exponent out of range: ${m[0]}`,
              { start, end: pos + m[0].length },
              currentPointer(),
            );
          }
          value = n;
          pos += m[0].length;
        }
        deliver(value, { start, end: pos });
        expectValue = false;
        continue;
      }

      // After a value.
      const top = stack[stack.length - 1];
      if (top === undefined) {
        if (pos < text.length) throw new SyntaxFailure(pos, 'Unexpected content after the document');
        break;
      }
      const c = text[pos];
      if (c === ',') {
        pos++;
        skipWs();
        if (top.kind === 'object') readKey(top);
        expectValue = true;
        continue;
      }
      if ((c === '}' && top.kind === 'object') || (c === ']' && top.kind === 'array')) {
        pos++;
        stack.pop();
        const value = top.kind === 'object' ? canonicalObject(top.entries) : Object.freeze(top.items);
        deliver(value, { start: top.start, end: pos }, top);
        continue;
      }
      throw new SyntaxFailure(
        pos,
        pos >= text.length ? 'Unexpected end of input' : `Unexpected character ${JSON.stringify(c)}`,
      );
    }
  } catch (failure) {
    if (failure instanceof SyntaxFailure)
      return { ok: false, syntax: true, offset: failure.offset, message: failure.message };
    if (failure instanceof SemanticFailure) {
      return {
        ok: false,
        syntax: false,
        code: failure.code,
        message: failure.message,
        range: failure.range,
        pointer: failure.pointer,
        lines,
      };
    }
    throw failure;
  }

  return { ok: true, value: root ?? null, index: index.build(lines), lines };

  function readKey(frame: ObjectFrame): void {
    if (text[pos] !== '"') throw new SyntaxFailure(pos, 'Expected a string key');
    const start = pos;
    const key = readString();
    const keyRange = { start, end: pos };
    if (frame.seen.has(key)) {
      throw new SemanticFailure('CGD-PARSE-003', `Duplicate key "${key}"`, keyRange, index.pointerOf(frame.slot, key));
    }
    frame.seen.add(key);
    skipWs();
    if (text[pos] !== ':') throw new SyntaxFailure(pos, 'Expected ":"');
    pos++;
    frame.key = key;
    frame.keyRange = keyRange;
  }
}
