import {
  DEFAULT_LIMITS,
  documentUri,
  stringifyCanonical,
  type AnalysisLimits,
  type Diagnostic,
  type DocumentUri,
} from '@contractguard/core';
import { parseDocument, type ParsedDocument } from '../src/parse/parser.js';

export const URI: DocumentUri = documentUri('file:///spec/openapi.yaml');

export function parseText(
  text: string,
  limits: AnalysisLimits = DEFAULT_LIMITS,
  uri: DocumentUri = URI,
): { readonly doc?: ParsedDocument; readonly diagnostics: readonly Diagnostic[] } {
  const r = parseDocument({ uri, bytes: new TextEncoder().encode(text) }, { limits });
  return r.value === undefined ? { diagnostics: r.diagnostics } : { doc: r.value, diagnostics: r.diagnostics };
}

export function parseOk(text: string): ParsedDocument {
  const r = parseText(text);
  if (r.doc === undefined) throw new Error(`parse failed: ${r.diagnostics.map((d) => d.message).join('; ')}`);
  return r.doc;
}

export function json(doc: ParsedDocument): string {
  return stringifyCanonical(doc.value);
}

export function codes(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}
