import type { SourceRef } from '../model/identity.js';
import { compareCodeUnits } from '../ids/sorted.js';
import { DIAGNOSTIC_CODES, type DiagnosticCode } from './codes.js';
import type { DiagnosticCategory, DiagnosticSeverity } from './types.js';

export type { DiagnosticCategory, DiagnosticSeverity } from './types.js';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly category: DiagnosticCategory;
  readonly severity: DiagnosticSeverity;
  readonly side?: 'base' | 'candidate';
  readonly message: string;
  readonly location?: SourceRef;
  readonly hint?: string;
}

/**
 * Result of a pipeline stage (ADR-18): expected failures are values.
 * `value` is absent when the stage could not produce output.
 */
export interface StageResult<T> {
  readonly value?: T;
  readonly diagnostics: readonly Diagnostic[];
}

export interface DiagnosticOptions {
  readonly side?: 'base' | 'candidate';
  readonly location?: SourceRef;
  readonly hint?: string;
  /** Overrides the registry default (e.g. escalate a warning). */
  readonly severity?: DiagnosticSeverity;
}

/** Creates a diagnostic with category/severity taken from the code registry. */
export function diagnostic(code: DiagnosticCode, message: string, options: DiagnosticOptions = {}): Diagnostic {
  const info = DIAGNOSTIC_CODES[code];
  return Object.freeze({
    code,
    category: info.category,
    severity: options.severity ?? info.severity,
    message,
    ...(options.side === undefined ? {} : { side: options.side }),
    ...(options.location === undefined ? {} : { location: options.location }),
    ...(options.hint === undefined ? {} : { hint: options.hint }),
  });
}

export function stageOk<T>(value: T, diagnostics: readonly Diagnostic[] = []): StageResult<T> {
  return { value, diagnostics };
}

export function stageFail<T = never>(diagnostics: readonly Diagnostic[]): StageResult<T> {
  return { diagnostics };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

/** Error diagnostics whose category is in `categories`. */
export function errorsIn(
  diagnostics: readonly Diagnostic[],
  categories: readonly DiagnosticCategory[],
): readonly Diagnostic[] {
  return diagnostics.filter((d) => d.severity === 'error' && categories.includes(d.category));
}

const SEVERITY_ORDER: Readonly<Record<DiagnosticSeverity, number>> = { error: 0, warning: 1, info: 2 };
const SIDE_ORDER: Readonly<Record<string, number>> = { base: 0, candidate: 1, none: 2 };

/** Deterministic order: severity, side, document, pointer, line, code, message. */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (SIDE_ORDER[a.side ?? 'none'] ?? 2) - (SIDE_ORDER[b.side ?? 'none'] ?? 2) ||
    compareCodeUnits(a.location?.uri ?? '', b.location?.uri ?? '') ||
    (a.location?.range?.start.offset ?? -1) - (b.location?.range?.start.offset ?? -1) ||
    compareCodeUnits(a.location?.pointer ?? '', b.location?.pointer ?? '') ||
    compareCodeUnits(a.code, b.code) ||
    compareCodeUnits(a.message, b.message)
  );
}

export function sortDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return Object.freeze([...diagnostics].sort(compareDiagnostics));
}
