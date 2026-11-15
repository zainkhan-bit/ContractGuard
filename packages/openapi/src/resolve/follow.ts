import {
  diagnostic,
  isCanonicalObject,
  type CanonicalJson,
  type Diagnostic,
  type DocumentUri,
  type JsonPointer,
  type SourceRef,
} from '@contractguard/core';
import { locate, siteKey, valueAt, type DocumentSet } from './resolver.js';

export interface FollowedValue {
  /** The first non-reference value (or a reference whose siblings must be kept, see `stopAtSiblings`). */
  readonly value: CanonicalJson;
  readonly location: SourceRef;
  /** $ref sites passed through, outermost first. */
  readonly via: readonly SourceRef[];
}

export interface FollowOptions {
  readonly maxRefHops: number;
  /**
   * Stop at a reference object that has sibling keywords (3.1 schemas: `$ref` + siblings is a
   * conjunction, so the object itself must be kept). Ignored keys: description, summary, x-*.
   */
  readonly stopAtSiblings: boolean;
  readonly side?: 'base' | 'candidate';
}

const NEUTRAL_SIBLINGS = new Set(['description', 'summary']);

function hasSemanticSiblings(value: CanonicalJson): boolean {
  if (!isCanonicalObject(value)) return false;
  return Object.keys(value).some((k) => k !== '$ref' && !NEUTRAL_SIBLINGS.has(k) && !k.startsWith('x-'));
}

/**
 * Follows `$ref` chains starting at a location until a non-reference value (§8.5).
 * Detects pure reference cycles (`CGD-REF-004`) and enforces `maxRefHops` (`CGD-LIMIT-006`).
 */
export function followReferences(
  set: DocumentSet,
  start: { readonly uri: DocumentUri; readonly pointer: JsonPointer },
  options: FollowOptions,
): { readonly value?: FollowedValue; readonly diagnostics: readonly Diagnostic[] } {
  const side = options.side === undefined ? {} : { side: options.side };
  const via: SourceRef[] = [];
  const visited = new Set<string>();
  let uri = start.uri;
  let pointer = start.pointer;

  for (;;) {
    const doc = set.documents.get(uri);
    const value = doc === undefined ? undefined : valueAt(doc.value, pointer);
    const location: SourceRef = doc === undefined ? { uri, pointer } : locate(doc, pointer);
    if (value === undefined) {
      return { diagnostics: [diagnostic('CGD-REF-001', `Nothing at ${uri}${pointer}`, { ...side, location })] };
    }
    const key = siteKey(uri, pointer);
    const ref = set.references.get(key);
    if (ref === undefined || (options.stopAtSiblings && hasSemanticSiblings(value))) {
      return { value: { value, location, via }, diagnostics: [] };
    }
    if (visited.has(key)) {
      return {
        diagnostics: [
          diagnostic('CGD-REF-004', `Circular reference with no content: ${ref.raw}`, {
            ...side,
            location,
            hint: 'A chain of $ref objects points back to itself without ever reaching a definition.',
          }),
        ],
      };
    }
    visited.add(key);
    if (ref.status !== 'resolved') return { diagnostics: [ref.diagnostic] };
    via.push(location);
    if (via.length > options.maxRefHops) {
      return {
        diagnostics: [
          diagnostic('CGD-LIMIT-006', `Reference chain longer than maxRefHops (${options.maxRefHops})`, {
            ...side,
            location,
          }),
        ],
      };
    }
    uri = ref.target.uri;
    pointer = ref.target.pointer;
  }
}
