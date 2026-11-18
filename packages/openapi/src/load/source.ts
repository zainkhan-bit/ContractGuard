import type { AnalysisLimits, DocumentUri, ReferencePolicy, StageResult } from '@zainkhan-bit/contractguard-core';

/** Raw bytes of one document, as read by a SourceLoader. */
export interface LoadedSource {
  readonly uri: DocumentUri;
  readonly bytes: Uint8Array;
  /** From the file extension or HTTP content type; parsing works without it. */
  readonly formatHint?: 'json' | 'yaml';
}

export interface LoadContext {
  readonly policy: ReferencePolicy;
  readonly limits: AnalysisLimits;
  readonly side?: 'base' | 'candidate';
  readonly signal?: AbortSignal;
}

/**
 * Port: reads raw bytes for an absolute DocumentUri. Implementations must enforce
 * the ReferencePolicy before performing any I/O (§8.2, §16).
 */
export interface SourceLoader {
  /** URI schemes this loader serves, e.g. ["file:"]. */
  readonly schemes: readonly string[];
  load(uri: DocumentUri, ctx: LoadContext): Promise<StageResult<LoadedSource>>;
}

/** Infers a format hint from a URI's path extension. */
export function formatHintFromUri(uri: string): 'json' | 'yaml' | undefined {
  const path = uri.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  return undefined;
}
