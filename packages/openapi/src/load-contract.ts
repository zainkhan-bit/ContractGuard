import {
  errorsIn,
  sortDiagnostics,
  type AnalysisLimits,
  type ApiContract,
  type Diagnostic,
  type DiagnosticCategory,
  type DocumentUri,
  type ReferencePolicy,
  type StageResult,
} from '@zainkhan-bit/contractguard-core';
import type { SourceLoader } from './load/source.js';
import { normalize } from './normalize/normalize.js';
import { parseDocument } from './parse/parser.js';
import { resolveReferences, type DocumentSet } from './resolve/resolver.js';
import { HyperjumpSpecValidator, type SpecValidator } from './validate/structural.js';
import { detectVersion } from './version/detect.js';

export interface LoadContractOptions {
  readonly loader: SourceLoader;
  readonly policy: ReferencePolicy;
  readonly limits: AnalysisLimits;
  readonly side?: 'base' | 'candidate';
  /** Structural validator; `false` disables structural validation. Default: HyperjumpSpecValidator. */
  readonly validator?: SpecValidator | false;
  /** Continue past structural/semantic specification errors (§8.8). The result is marked degraded. */
  readonly allowInvalidSpec?: boolean;
  readonly signal?: AbortSignal;
}

export interface LoadedContract {
  readonly contract: ApiContract;
  readonly documents: DocumentSet;
  /** True when errors were tolerated because of `allowInvalidSpec`. */
  readonly degraded: boolean;
}

const ALWAYS_FATAL: readonly DiagnosticCategory[] = ['filesystem', 'parse', 'limit', 'reference', 'internal'];
const FATAL_UNLESS_ALLOWED: readonly DiagnosticCategory[] = ['specification', 'semantic'];

let defaultValidator: HyperjumpSpecValidator | undefined;

/**
 * The full front-end pipeline for one side (§8): load → parse → detect version → resolve
 * → validate → normalize, applying the stage policy of §8.8. Diagnostics are sorted.
 */
export async function loadContract(
  rootUri: DocumentUri,
  options: LoadContractOptions,
): Promise<StageResult<LoadedContract>> {
  const side = options.side === undefined ? {} : { side: options.side };
  const ctx = {
    policy: options.policy,
    limits: options.limits,
    ...side,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const diagnostics: Diagnostic[] = [];
  const done = (value?: LoadedContract): StageResult<LoadedContract> =>
    value === undefined
      ? { diagnostics: sortDiagnostics(diagnostics) }
      : { value, diagnostics: sortDiagnostics(diagnostics) };

  const loaded = await options.loader.load(rootUri, ctx);
  for (const d of loaded.diagnostics) diagnostics.push(d);
  if (loaded.value === undefined) return done();

  const parsed = parseDocument(loaded.value, { limits: options.limits, ...side });
  for (const d of parsed.diagnostics) diagnostics.push(d);
  if (parsed.value === undefined) return done();

  const version = detectVersion(parsed.value, options.side);
  for (const d of version.diagnostics) diagnostics.push(d);
  if (version.value === undefined) return done();

  const resolved = await resolveReferences(parsed.value, version.value.dialect, { loader: options.loader, ctx });
  for (const d of resolved.diagnostics) diagnostics.push(d);
  if (resolved.value === undefined || errorsIn(diagnostics, ALWAYS_FATAL).length > 0) return done();

  if (options.validator !== false) {
    const validator = options.validator ?? (defaultValidator ??= new HyperjumpSpecValidator());
    const structural = await validator.validate(parsed.value, version.value.dialect, options.side);
    for (const d of structural.diagnostics) diagnostics.push(d);
  }

  const normalized = normalize(resolved.value, version.value, { limits: options.limits, ...side });
  for (const d of normalized.diagnostics) diagnostics.push(d);
  if (normalized.value === undefined || errorsIn(diagnostics, ALWAYS_FATAL).length > 0) return done();

  const specErrors = errorsIn(diagnostics, FATAL_UNLESS_ALLOWED);
  if (specErrors.length > 0 && options.allowInvalidSpec !== true) return done();
  return done({ contract: normalized.value, documents: resolved.value, degraded: specErrors.length > 0 });
}
