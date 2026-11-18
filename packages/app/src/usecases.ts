import {
  DEFAULT_LIMITS,
  sortDiagnostics,
  type ApiContract,
  type Diagnostic,
  type DocumentUri,
  type ReferencePolicy,
  type StageResult,
} from '@zainkhan-bit/contractguard-core';
import { loadContract, type SpecValidator } from '@zainkhan-bit/contractguard-openapi';
import type { LoadedConfiguration } from './config/load.js';
import { openSource } from './sources/open.js';
import { buildSnapshot, type Snapshot } from './sources/snapshot.js';
import { parseSourceSpecifier } from './sources/specifier.js';

export interface SourceOptions {
  readonly cwd: string;
  /** Configuration for references/limits; defaults apply when absent. */
  readonly loaded?: LoadedConfiguration;
  readonly stdinText?: string;
  readonly signal?: AbortSignal;
  readonly validator?: SpecValidator | false;
}

function settings(o: SourceOptions): {
  references: ReferencePolicy;
  limits: typeof DEFAULT_LIMITS;
  allowInvalidSpec: boolean;
} {
  return {
    references: o.loaded?.config.references ?? {
      root: o.cwd,
      allowRemote: false,
      allowedHosts: [],
      allowedSchemes: ['https'],
      fetchTimeoutMs: 10_000,
      maxRemoteBytes: 5 * 1024 * 1024,
    },
    limits: o.loaded?.config.analysis.limits ?? DEFAULT_LIMITS,
    allowInvalidSpec: o.loaded?.config.analysis.allowInvalidSpec ?? false,
  };
}

export interface ValidatedSpec {
  readonly specifier: string;
  readonly contract?: ApiContract;
  readonly diagnostics: readonly Diagnostic[];
}

/** `validate`: load + parse + resolve + validate one specification. Usage errors come back as diagnostics. */
export async function validateSource(raw: string, o: SourceOptions): Promise<ValidatedSpec> {
  const spec = parseSourceSpecifier(raw, o.cwd);
  if (spec.value === undefined) return { specifier: raw, diagnostics: spec.diagnostics };
  const opened = await openSource(spec.value, {
    ...(o.stdinText === undefined ? {} : { stdinText: o.stdinText }),
    ...(o.signal === undefined ? {} : { signal: o.signal }),
  });
  if (opened.value === undefined) return { specifier: raw, diagnostics: opened.diagnostics };
  const s = settings(o);
  const r = await loadContract(opened.value.rootUri, {
    loader: opened.value.loader,
    policy: s.references,
    limits: s.limits,
    allowInvalidSpec: s.allowInvalidSpec,
    ...(o.signal === undefined ? {} : { signal: o.signal }),
    ...(o.validator === undefined ? {} : { validator: o.validator }),
  });
  return {
    specifier: raw,
    ...(r.value === undefined ? {} : { contract: r.value.contract }),
    diagnostics: sortDiagnostics(r.diagnostics),
  };
}

/** `baseline create`: loads a specification and bundles its source documents into a snapshot. */
export async function createBaseline(
  raw: string,
  o: SourceOptions & { readonly toolVersion: string },
): Promise<StageResult<Snapshot>> {
  const spec = parseSourceSpecifier(raw, o.cwd);
  if (spec.value === undefined) return { diagnostics: spec.diagnostics };
  const opened = await openSource(spec.value, { ...(o.stdinText === undefined ? {} : { stdinText: o.stdinText }) });
  if (opened.value === undefined) return { diagnostics: opened.diagnostics };
  const s = settings(o);
  const ctx = { policy: s.references, limits: s.limits };
  const r = await loadContract(opened.value.rootUri, {
    loader: opened.value.loader,
    ...ctx,
    allowInvalidSpec: s.allowInvalidSpec,
    ...(o.validator === undefined ? {} : { validator: o.validator }),
  });
  if (r.value === undefined) return { diagnostics: r.diagnostics };
  const docs: { uri: DocumentUri; bytes: Uint8Array }[] = [];
  for (const uri of r.value.documents.documents.keys()) {
    const loaded = await opened.value.loader.load(uri, ctx);
    if (loaded.value === undefined) return { diagnostics: loaded.diagnostics };
    docs.push({ uri, bytes: loaded.value.bytes });
  }
  // The document set's own root key, so the root matches the document URIs exactly on every platform.
  const snap = buildSnapshot(r.value.documents.root, docs, o.toolVersion);
  return { ...snap, diagnostics: [...r.diagnostics, ...snap.diagnostics] };
}
