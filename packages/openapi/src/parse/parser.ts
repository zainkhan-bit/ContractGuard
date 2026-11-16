import {
  LineCounter,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  type Document,
  type Node as YamlNode,
} from 'yaml';
import {
  JsonNumber,
  ROOT_POINTER,
  canonicalObject,
  diagnostic,
  sha256Hex,
  stageFail,
  stageOk,
  type AnalysisLimits,
  type CanonicalJson,
  type Diagnostic,
  type DiagnosticCode,
  type DocumentUri,
  type JsonPointer,
  type SourceRef,
  type StageResult,
} from '@contractguard/core';
import type { LoadedSource } from '../load/source.js';
import { parseJson } from './json-parser.js';
import { PointerIndexBuilder, positionAt, type OffsetRange, type PointerIndex, type Slot } from './pointer-index.js';

export interface ParsedDocument {
  readonly uri: DocumentUri;
  /** Canonical JSON: null-prototype sorted objects, exact JsonNumbers, frozen. */
  readonly value: CanonicalJson;
  readonly index: PointerIndex;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ParseOptions {
  readonly limits: AnalysisLimits;
  readonly side?: 'base' | 'candidate';
  /** Maximum number of alias expansions (YAML anchors/aliases). Default 50. */
  readonly maxAliasExpansions?: number;
}

const CORE_TAGS = new Set([
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
]);

const DECIMAL = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const HEX_OR_OCTAL = /^(0x[0-9a-fA-F]+|0o[0-7]+)$/;

class ParseAbort extends Error {}

/**
 * Parses JSON or YAML bytes into canonical JSON plus a pointer → range index (§8.3).
 * One code path for both formats; YAML 1.2 core schema; no custom tags, no merge keys.
 */
export function parseDocument(source: LoadedSource, options: ParseOptions): StageResult<ParsedDocument> {
  const { uri, bytes } = source;
  const side = options.side === undefined ? {} : { side: options.side };
  const rootRef: SourceRef = { uri, pointer: ROOT_POINTER };

  if (bytes.length > options.limits.maxDocumentBytes) {
    return stageFail([
      diagnostic(
        'CGD-LIMIT-001',
        `Document is ${bytes.length} bytes, above the limit of ${options.limits.maxDocumentBytes}`,
        {
          ...side,
          location: rootRef,
        },
      ),
    ]);
  }
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return stageFail([
      diagnostic('CGD-PARSE-002', 'Document is UTF-16 encoded; only UTF-8 is supported', {
        ...side,
        location: rootRef,
        hint: 'Re-save the file as UTF-8.',
      }),
    ]);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return stageFail([diagnostic('CGD-PARSE-002', 'Document is not valid UTF-8', { ...side, location: rootRef })]);
  }

  // Fast path: strict JSON. Anything that is not strict JSON falls through to the YAML parser
  // (JSON-like YAML flow syntax such as trailing commas or unquoted keys is still accepted there).
  if (/^\uFEFF?[ \t\r\n]*[{[]/.test(text)) {
    const json = parseJson(text, options.limits.maxDepth);
    if (json.ok) {
      return stageOk({ uri, value: json.value, index: json.index, sha256: sha256Hex(bytes), bytes: bytes.length });
    }
    if (!json.syntax) {
      return stageFail([
        diagnostic(json.code, json.message, {
          ...side,
          location: {
            uri,
            pointer: json.pointer,
            range: { start: positionAt(json.lines, json.range.start), end: positionAt(json.lines, json.range.end) },
          },
        }),
      ]);
    }
  }

  const lines = new LineCounter();
  let docs: Document.Parsed[];
  try {
    docs = parseAllDocuments(text, {
      version: '1.2',
      schema: 'core',
      // Duplicate keys are detected below with a Set; the library's check is quadratic in map size.
      uniqueKeys: false,
      merge: false,
      customTags: [],
      lineCounter: lines,
      keepSourceTokens: false,
      prettyErrors: false,
      strict: true,
      intAsBigInt: false,
    }) as Document.Parsed[];
  } catch (error) {
    if (error instanceof RangeError) {
      return stageFail([
        diagnostic('CGD-LIMIT-003', 'Document nesting is too deep to parse', { ...side, location: rootRef }),
      ]);
    }
    throw error;
  }
  // parseAllDocuments returns an EmptyStream (array-like with .empty) for empty input.
  if (!Array.isArray(docs) || docs.length === 0) {
    return stageFail([diagnostic('CGD-PARSE-001', 'Document is empty', { ...side, location: rootRef })]);
  }
  if (docs.length > 1) {
    const second = docs[1];
    const offset = second?.range[0] ?? 0;
    return stageFail([
      diagnostic('CGD-PARSE-014', 'File contains more than one YAML document', {
        ...side,
        location: { ...rootRef, range: { start: positionAt(lines, offset), end: positionAt(lines, offset) } },
      }),
    ]);
  }
  const doc = docs[0] as Document.Parsed;

  // The yaml composer recurses per nesting level and reports stack exhaustion as ordinary errors.
  if (doc.errors.some((e) => e.message.includes('Maximum call stack size exceeded'))) {
    return stageFail([
      diagnostic('CGD-LIMIT-003', 'Document nesting is too deep to parse', {
        ...side,
        location: rootRef,
        hint: `Documents may nest at most ${options.limits.maxDepth} levels.`,
      }),
    ]);
  }

  const diagnostics: Diagnostic[] = [];
  const locate = (start: number, end: number, pointer: JsonPointer = ROOT_POINTER): SourceRef => ({
    uri,
    pointer,
    range: { start: positionAt(lines, start), end: positionAt(lines, end) },
  });
  for (const error of doc.errors) {
    const code: DiagnosticCode = error.code === 'DUPLICATE_KEY' ? 'CGD-PARSE-003' : 'CGD-PARSE-001';
    diagnostics.push(
      diagnostic(code, error.message.split('\n', 1)[0] ?? error.message, {
        ...side,
        location: locate(error.pos[0], error.pos[1]),
      }),
    );
  }
  for (const warning of doc.warnings) {
    if (warning.code === 'TAG_RESOLVE_FAILED') {
      diagnostics.push(
        diagnostic('CGD-PARSE-012', warning.message.split('\n', 1)[0] ?? warning.message, {
          ...side,
          location: locate(warning.pos[0], warning.pos[1]),
          hint: 'Only plain JSON-compatible YAML is supported (no custom or YAML 1.1 tags).',
        }),
      );
    }
  }
  if (diagnostics.length > 0) return stageFail(diagnostics);

  const index = new PointerIndexBuilder();
  const maxAliases = options.maxAliasExpansions ?? 50;
  let aliasExpansions = 0;

  const fail = (
    code: DiagnosticCode,
    message: string,
    node: YamlNode | null | undefined,
    slot: Slot,
    extra?: string,
  ): never => {
    const [start, end] = node?.range ?? [0, 0];
    const pointer = index.pointerOf(slot, extra);
    diagnostics.push(diagnostic(code, message, { ...side, location: locate(start, end, pointer) }));
    throw new ParseAbort(message);
  };

  const rangeOf = (node: YamlNode): OffsetRange => {
    const r = node.range ?? [0, 0];
    return { start: r[0], end: r[1] };
  };

  const build = (node: YamlNode | null, slot: Slot, depth: number): CanonicalJson => {
    if (depth > options.limits.maxDepth) {
      fail('CGD-LIMIT-003', `Nesting exceeds maxDepth (${options.limits.maxDepth})`, node, slot);
    }
    if (node === null) return null;
    if (isAlias(node)) {
      aliasExpansions++;
      if (aliasExpansions > maxAliases) {
        fail('CGD-LIMIT-005', `More than ${maxAliases} YAML alias expansions`, node, slot);
      }
      const target = node.resolve(doc);
      if (target === undefined) fail('CGD-PARSE-001', `Unresolved alias *${node.source}`, node, slot);
      return build(target as YamlNode, slot, depth + 1);
    }
    if (node.tag !== undefined && !CORE_TAGS.has(node.tag)) {
      fail('CGD-PARSE-012', `Unsupported YAML tag ${node.tag}`, node, slot);
    }
    if (isMap(node)) {
      const entries: [string, CanonicalJson][] = [];
      const seen = new Set<string>();
      for (const pair of node.items) {
        const keyNode = pair.key as YamlNode | null;
        const key = keyString(keyNode);
        if (key === undefined) {
          fail('CGD-PARSE-010', 'Mapping keys must be strings or scalars', keyNode, slot);
        }
        const k = key as string;
        if (seen.has(k)) fail('CGD-PARSE-003', `Duplicate key "${k}"`, keyNode, slot, k);
        seen.add(k);
        const valueNode = pair.value as YamlNode | null;
        const keyRange = keyNode === null ? undefined : rangeOf(keyNode);
        const valueRange =
          valueNode === null
            ? { start: keyRange?.end ?? rangeOf(node).start, end: keyRange?.end ?? rangeOf(node).start }
            : rangeOf(valueNode);
        const childSlot = index.child(slot, k, valueRange, keyRange);
        entries.push([k, build(valueNode, childSlot, depth + 1)]);
      }
      return canonicalObject(entries);
    }
    if (isSeq(node)) {
      const items: CanonicalJson[] = [];
      node.items.forEach((item, i) => {
        const itemNode = item as YamlNode | null;
        const childSlot = index.child(slot, i, itemNode === null ? rangeOf(node) : rangeOf(itemNode));
        items.push(build(itemNode, childSlot, depth + 1));
      });
      return Object.freeze(items);
    }
    if (isScalar(node)) {
      const v: unknown = node.value;
      if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'bigint') {
        const n = toNumber(node.source, v);
        return typeof n === 'string' ? fail(n, `Unsupported number ${String(node.source ?? v)}`, node, slot) : n;
      }
      return fail('CGD-PARSE-013', 'Unsupported scalar value', node, slot);
    }
    return fail('CGD-PARSE-013', 'Unsupported YAML node', node, slot);
  };

  let value: CanonicalJson;
  try {
    const contents = doc.contents as YamlNode | null;
    const rootSlot = index.root(contents === null ? { start: 0, end: 0 } : rangeOf(contents));
    value = build(contents, rootSlot, 0);
  } catch (error) {
    if (error instanceof ParseAbort) return stageFail(diagnostics);
    if (error instanceof RangeError) {
      return stageFail([diagnostic('CGD-LIMIT-003', 'Document nesting is too deep', { ...side, location: rootRef })]);
    }
    throw error;
  }

  return stageOk({ uri, value, index: index.build(lines), sha256: sha256Hex(bytes), bytes: bytes.length });
}

function keyString(node: YamlNode | null): string | undefined {
  if (node === null || !isScalar(node)) return undefined;
  if (typeof node.value === 'string') return node.value;
  // Plain non-string scalars as keys (e.g. `200:` or `true:`) keep their source spelling.
  return typeof node.source === 'string' && node.source !== '' ? node.source : undefined;
}

/** Exact number from the scalar's source text, or the diagnostic code explaining why it is unrepresentable. */
function toNumber(source: unknown, value: number | bigint): JsonNumber | DiagnosticCode {
  if (typeof source === 'string') {
    // Decimal source text is authoritative (the yaml library may have overflowed it to Infinity).
    if (DECIMAL.test(source)) return JsonNumber.parse(source) ?? 'CGD-PARSE-015';
    if (HEX_OR_OCTAL.test(source)) return JsonNumber.fromBigInt(BigInt(source));
  }
  if (typeof value === 'bigint') return JsonNumber.fromBigInt(value);
  return JsonNumber.fromNumber(value) ?? 'CGD-PARSE-011';
}
