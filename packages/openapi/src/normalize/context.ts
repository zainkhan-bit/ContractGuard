import {
  appendPointer,
  diagnostic,
  isCanonicalArray,
  isCanonicalObject,
  isJsonNumber,
  type AnalysisLimits,
  type CanonicalJson,
  type CanonicalObject,
  type Diagnostic,
  type DiagnosticCode,
  type DocumentUri,
  type JsonPointer,
  type OasDialect,
  type SourceRef,
} from '@contractguard/core';
import { followReferences } from '../resolve/follow.js';
import { locate, type DocumentSet } from '../resolve/resolver.js';

/** A location inside the document set. */
export interface Loc {
  readonly uri: DocumentUri;
  readonly pointer: JsonPointer;
}

/** A value read through zero or more $ref hops. */
export interface Resolved<T extends CanonicalJson = CanonicalJson> {
  readonly value: T;
  readonly loc: Loc;
  readonly source: SourceRef;
  readonly via: readonly SourceRef[];
}

export function child(loc: Loc, ...segments: readonly (string | number)[]): Loc {
  return { uri: loc.uri, pointer: appendPointer(loc.pointer, ...segments) };
}

/** Shared state and helpers for one normalization run. */
export class NormalizeContext {
  readonly diagnostics: Diagnostic[] = [];

  constructor(
    readonly set: DocumentSet,
    readonly dialect: OasDialect,
    readonly limits: AnalysisLimits,
    readonly side: 'base' | 'candidate' | undefined,
  ) {}

  source(loc: Loc): SourceRef {
    const doc = this.set.documents.get(loc.uri);
    return doc === undefined ? { uri: loc.uri, pointer: loc.pointer } : locate(doc, loc.pointer);
  }

  report(code: DiagnosticCode, message: string, loc: Loc): void {
    this.diagnostics.push(
      diagnostic(code, message, {
        ...(this.side === undefined ? {} : { side: this.side }),
        location: this.source(loc),
      }),
    );
  }

  /** Follows $ref chains (siblings ignored) and returns the referenced object, or undefined with a diagnostic. */
  resolveObject(loc: Loc, what: string): Resolved<CanonicalObject> | undefined {
    const followed = followReferences(this.set, loc, {
      maxRefHops: this.limits.maxRefHops,
      stopAtSiblings: false,
      ...(this.side === undefined ? {} : { side: this.side }),
    });
    if (followed.value === undefined) {
      this.pushUnique(followed.diagnostics);
      return undefined;
    }
    const { value, location, via } = followed.value;
    if (!isCanonicalObject(value)) {
      this.report('CGD-SPEC-005', `Expected ${what} to be an object`, { uri: location.uri, pointer: location.pointer });
      return undefined;
    }
    return { value, loc: { uri: location.uri, pointer: location.pointer }, source: location, via };
  }

  pushUnique(diagnostics: readonly Diagnostic[]): void {
    for (const d of diagnostics) {
      const key = `${d.code}|${d.location?.uri ?? ''}${d.location?.pointer ?? ''}`;
      if (!this.#seen.has(key)) {
        this.#seen.add(key);
        this.diagnostics.push(d);
      }
    }
  }

  readonly #seen = new Set<string>();
}

// ---------------------------------------------------------------------------
// Typed readers for raw canonical objects. Invalid shapes are reported, never thrown.
// ---------------------------------------------------------------------------

export function str(obj: CanonicalObject, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

export function bool(obj: CanonicalObject, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}

/** Non-negative integer keyword (minLength, maxItems, …). */
export function count(obj: CanonicalObject, key: string): number | undefined {
  const v = obj[key];
  if (!isJsonNumber(v) || !v.isInteger || v.sign < 0) return undefined;
  return v.approx;
}

export function objectAt(obj: CanonicalObject, key: string): CanonicalObject | undefined {
  const v = obj[key];
  return v !== undefined && isCanonicalObject(v) ? v : undefined;
}

export function arrayAt(obj: CanonicalObject, key: string): readonly CanonicalJson[] | undefined {
  const v = obj[key];
  return v !== undefined && isCanonicalArray(v) ? v : undefined;
}

export function extensions(obj: CanonicalObject): ReadonlyMap<string, CanonicalJson> {
  return new Map(
    Object.keys(obj)
      .filter((k) => k.startsWith('x-'))
      .map((k) => [k, obj[k] as CanonicalJson]),
  );
}
