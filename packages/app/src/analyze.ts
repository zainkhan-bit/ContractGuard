import {
  diagnostic,
  sortDiagnostics,
  type AnalysisResult,
  type ApiContract,
  type CompatibilityFinding,
  type Diagnostic,
  type DocumentUri,
  type ResolvedConfiguration,
  type SourceRef,
  type StageResult,
} from '@contractguard/core';
import { assembleResult, checkCompatibility, RULESET_VERSION } from '@contractguard/engine';
import { loadContract, type DocumentSet, type LoadedContract, type SpecValidator } from '@contractguard/openapi';
import picomatch from 'picomatch';
import { loadConfiguration, type ConfigRequest, type LoadedConfiguration } from './config/load.js';
import { openSource, type OpenedSource } from './sources/open.js';
import { parseSourceSpecifier, type SourceSpecifier } from './sources/specifier.js';

export interface AnalysisRequest extends ConfigRequest {
  readonly toolVersion: string;
  /** Text read from stdin when a specifier is "-". */
  readonly stdinText?: string;
  readonly signal?: AbortSignal;
  /** Structural validator override (tests); `false` disables structural validation. */
  readonly validator?: SpecValidator | false;
}

export type ExitOutcome = 'passed' | 'policy-failed' | 'input-error';

export interface AnalysisRun {
  readonly loaded: LoadedConfiguration;
  readonly results: readonly AnalysisResult[];
  readonly outcome: ExitOutcome;
}

interface SideLoad {
  readonly opened?: OpenedSource;
  readonly loaded?: LoadedContract;
  readonly diagnostics: readonly Diagnostic[];
}

/** Parses both specifiers of every spec up front so syntax errors are configuration errors (exit 3). */
function parseSpecs(
  config: ResolvedConfiguration,
  dir: string,
): StageResult<Map<string, { base: SourceSpecifier; candidate: SourceSpecifier }>> {
  const out = new Map<string, { base: SourceSpecifier; candidate: SourceSpecifier }>();
  const diagnostics: Diagnostic[] = [];
  for (const s of config.specs) {
    const base = parseSourceSpecifier(s.base, dir);
    const candidate = parseSourceSpecifier(s.candidate, dir);
    diagnostics.push(...base.diagnostics.map((d) => ({ ...d, message: `${s.id} (base): ${d.message}` })));
    diagnostics.push(...candidate.diagnostics.map((d) => ({ ...d, message: `${s.id} (candidate): ${d.message}` })));
    if (base.value?.kind === 'stdin') {
      diagnostics.push(diagnostic('CGD-CONFIG-002', `${s.id}: stdin ("-") can only be the candidate`));
    }
    if (base.value !== undefined && candidate.value !== undefined)
      out.set(s.id, { base: base.value, candidate: candidate.value });
  }
  return diagnostics.length > 0 ? { diagnostics } : { value: out, diagnostics: [] };
}

async function loadSide(
  spec: SourceSpecifier,
  side: 'base' | 'candidate',
  config: ResolvedConfiguration,
  req: AnalysisRequest,
  signal: AbortSignal,
): Promise<SideLoad> {
  const opened = await openSource(spec, {
    ...(req.stdinText === undefined ? {} : { stdinText: req.stdinText }),
    signal,
  });
  if (opened.value === undefined) return { diagnostics: opened.diagnostics.map((d) => ({ ...d, side })) };
  const r = await loadContract(opened.value.rootUri, {
    loader: opened.value.loader,
    policy: config.references,
    limits: config.analysis.limits,
    side,
    allowInvalidSpec: config.analysis.allowInvalidSpec,
    signal,
    ...(req.validator === undefined ? {} : { validator: req.validator }),
  });
  return { opened: opened.value, ...(r.value === undefined ? {} : { loaded: r.value }), diagnostics: r.diagnostics };
}

/** `<METHOD|*>:<glob>` filter matching on the declared path template. */
function compileFilter(patterns: readonly string[]): ((method: string, path: string) => boolean) | undefined {
  if (patterns.length === 0) return undefined;
  const compiled = patterns.map((p) => {
    const i = p.indexOf(':');
    const method = p.slice(0, i).toUpperCase();
    const glob = picomatch(p.slice(i + 1), { dot: true });
    return (m: string, path: string): boolean => (method === '*' || method === m) && glob(path);
  });
  return (m, path) => compiled.some((f) => f(m, path));
}

/** Drops findings on operations excluded by filters (tags, extensions, include/exclude globs). */
function applyFilters(
  findings: readonly CompatibilityFinding[],
  config: ResolvedConfiguration,
  base: ApiContract,
  candidate: ApiContract,
): CompatibilityFinding[] {
  const f = config.filters;
  const include = compileFilter(f.include);
  const exclude = compileFilter(f.exclude);
  if (include === undefined && exclude === undefined && f.excludeTags.length === 0 && f.excludeExtensions.length === 0)
    return [...findings];
  return findings.filter((x) => {
    const key = x.subject.operationKey;
    if (key === undefined) return true;
    const op = candidate.operations.get(key) ?? base.operations.get(key);
    const method = x.subject.method ?? op?.method ?? '';
    const path = x.subject.path ?? op?.path ?? '';
    if (include !== undefined && !include(method, path)) return false;
    if (exclude?.(method, path) === true) return false;
    if (op?.tags.some((t) => f.excludeTags.includes(t)) === true) return false;
    if (op !== undefined && f.excludeExtensions.some((e) => op.extensions.get(e) === true)) return false;
    return true;
  });
}

/**
 * §13.5: a finding about a removed element is anchored to the nearest existing element of the corresponding
 * candidate document (e.g. the path item of a removed operation), so annotations land in the candidate file.
 */
function reanchor(
  findings: readonly CompatibilityFinding[],
  baseSet: DocumentSet,
  candSet: DocumentSet,
): CompatibilityFinding[] {
  const baseDir = new URL('.', baseSet.root).href;
  return findings.map((f) => {
    const b = f.location.base;
    if (f.location.candidate !== undefined || b === undefined || f.location.anchor !== b || !b.uri.startsWith(baseDir))
      return f;
    const target = new URL(b.uri.slice(baseDir.length), new URL('.', candSet.root)).href as DocumentUri;
    const doc = candSet.documents.get(target) ?? candSet.documents.get(candSet.root);
    if (doc === undefined) return f;
    const pointer = doc.index.nearestExisting(b.pointer);
    const range = doc.index.rangeOf(pointer);
    const anchor: SourceRef = {
      uri: doc.uri,
      pointer,
      ...(range === undefined ? {} : { range: range.key ?? range.value }),
    };
    return { ...f, location: { ...f.location, anchor } };
  });
}

function timeoutReason(signal: AbortSignal): Diagnostic | undefined {
  return signal.aborted && (signal.reason as Error | undefined)?.name === 'TimeoutError'
    ? diagnostic('CGD-LIMIT-010', 'Analysis timed out', { hint: 'raise analysis.limits.timeoutMs' })
    : undefined;
}

/** Runs one configured comparison. Never throws for expected failures; they become an input-error result. */
async function analyzeSpec(
  specId: string,
  specs: { base: SourceSpecifier; candidate: SourceSpecifier },
  loaded: LoadedConfiguration,
  req: AnalysisRequest,
): Promise<AnalysisResult> {
  const config = loaded.config;
  const signals = [
    AbortSignal.timeout(config.analysis.limits.timeoutMs),
    ...(req.signal === undefined ? [] : [req.signal]),
  ];
  const signal = AbortSignal.any(signals);
  const [b, c] = await Promise.all([
    loadSide(specs.base, 'base', config, req, signal),
    loadSide(specs.candidate, 'candidate', config, req, signal),
  ]);
  const diagnostics: Diagnostic[] = [...b.diagnostics, ...c.diagnostics];
  const timeout = timeoutReason(signal);
  if (timeout !== undefined) diagnostics.push(timeout);
  let findings: CompatibilityFinding[] = [];
  if (b.loaded !== undefined && c.loaded !== undefined && timeout === undefined) {
    const checked = checkCompatibility(b.loaded.contract, c.loaded.contract, {
      policy: config.analysis,
      overrides: config.rules.overrides,
      disabled: config.rules.disabled,
      ignore: config.rules.ignore,
      today: req.today,
      honorExtensibleEnum: config.analysis.honorExtensibleEnum,
      includeEquivalentChanges: config.analysis.includeEquivalentChanges,
      maxSchemaPairs: config.analysis.limits.maxSchemaPairs,
    });
    findings = reanchor(
      applyFilters(checked.findings, config, b.loaded.contract, c.loaded.contract),
      b.loaded.documents,
      c.loaded.documents,
    );
  }
  const ok = timeout === undefined;
  return assembleResult({
    specId,
    perspective: config.compatibility.perspective,
    toolVersion: req.toolVersion,
    rulesetVersion: RULESET_VERSION,
    ...(ok && b.loaded !== undefined && b.opened !== undefined
      ? { base: { contract: b.loaded.contract, revision: b.opened.revision } }
      : {}),
    ...(ok && c.loaded !== undefined && c.opened !== undefined
      ? { candidate: { contract: c.loaded.contract, revision: c.opened.revision } }
      : {}),
    findings,
    diagnostics: sortDiagnostics(diagnostics),
    degraded: b.loaded?.degraded === true || c.loaded?.degraded === true,
    policy: config.policy,
    ...(config.report.deterministic ? {} : { generatedAt: new Date().toISOString() }),
  });
}

/** The `check` use case: configuration → per-spec analysis → results and an exit outcome (§6.2). */
export async function analyze(req: AnalysisRequest): Promise<StageResult<AnalysisRun>> {
  const loaded = await loadConfiguration(req);
  if (loaded.value === undefined) return { diagnostics: loaded.diagnostics };
  const dir = req.adHoc === undefined ? loaded.value.baseDir : req.cwd;
  const parsed = parseSpecs(loaded.value.config, dir);
  if (parsed.value === undefined) return { diagnostics: [...loaded.diagnostics, ...parsed.diagnostics] };
  const results: AnalysisResult[] = [];
  for (const s of loaded.value.config.specs) {
    results.push(
      await analyzeSpec(
        s.id,
        parsed.value.get(s.id) as { base: SourceSpecifier; candidate: SourceSpecifier },
        loaded.value,
        req,
      ),
    );
  }
  const outcome: ExitOutcome = results.some((r) => r.status === 'input-error')
    ? 'input-error'
    : results.some((r) => !r.policy.passed)
      ? 'policy-failed'
      : 'passed';
  return { value: { loaded: loaded.value, results, outcome }, diagnostics: loaded.diagnostics };
}
