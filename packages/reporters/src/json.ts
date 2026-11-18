import type { AnalysisResult } from '@zainkhan-bit/contractguard-core';
import { toJsonText, type RenderOptions } from './shared.js';

/** URL of the published JSON Schema for the report (also shipped as `@zainkhan-bit/contractguard-reporters/schemas/report.v1.json`). */
export const REPORT_SCHEMA_ID = 'https://contractguard.dev/schemas/report.v1.json';

/**
 * The canonical machine-readable report (§13.3): an array of AnalysisResult, keys sorted, Map/Set as sorted
 * arrays/objects, decimals exact. With `deterministic`, volatile fields (generatedAt) are omitted.
 */
export function renderJson(results: readonly AnalysisResult[], o: Pick<RenderOptions, 'deterministic'>): string {
  const docs = results.map((r) => (o.deterministic ? { ...r, generatedAt: undefined } : r));
  return `${toJsonText(docs)}\n`;
}
