import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_CLASSIFICATION_POLICY,
  DEFAULT_LIMITS,
  diagnostic,
  documentUri,
  pointerFromSegments,
  sortDiagnostics,
  type Classification,
  type Diagnostic,
  type DiagnosticCode,
  type IgnoreEntry,
  type ReportFormat,
  type ResolvedConfiguration,
  type RuleId,
  type RuleOverride,
  type Severity,
  type SourceRef,
  type StageResult,
} from '@zainkhan-bit/contractguard-core';
import { DEFAULT_REGISTRY, DEFAULT_REPORT_POLICY } from '@zainkhan-bit/contractguard-engine';
import { parseDocument, toPlainJson, type PointerIndex } from '@zainkhan-bit/contractguard-openapi';
import { didYouMean } from '../text.js';
import { CONFIG_KEYS, parseConfigFile, parseSize, type ConfigFile, type ConfigIssue as $ZodIssue } from './schema.js';

export const CONFIG_FILE_NAMES: readonly string[] = [
  '.contractguard.yaml',
  '.contractguard.yml',
  '.contractguard.json',
];

/** Flags that override configuration (§12.3). Policy and analysis can never come from environment variables. */
export interface CliOverrides {
  readonly perspective?: string;
  readonly failOn?: readonly Classification[];
  readonly minSeverity?: Severity;
  readonly undetermined?: 'fail' | 'review' | 'ignore';
  readonly formats?: readonly ReportFormat[];
  readonly outputDir?: string;
  readonly groupBy?: 'cause' | 'operation';
  readonly deterministic?: boolean;
  readonly includeEquivalent?: boolean;
  readonly allowInvalidSpec?: boolean;
}

export interface Trust {
  /** CI mode: capability-expanding settings need a matching trusted flag (§12.6 trust boundary). */
  readonly ci: boolean;
  readonly allowRemoteReferences: boolean;
}

export interface AdHocSpec {
  readonly base: string;
  readonly candidate: string;
}

export interface ConfigRequest {
  readonly cwd: string;
  /** Explicit config path; `false` disables discovery (`--no-config`). */
  readonly configPath?: string | false;
  /** Raw specifier strings from the command line (ad-hoc comparison). */
  /** Ad-hoc comparisons (positionals, or the Action's `specs` input); replace the configured specs. */
  readonly adHoc?: AdHocSpec | readonly AdHocSpec[];
  readonly specIds?: readonly string[];
  readonly overrides?: CliOverrides;
  readonly trust?: Trust;
  /** Today's date (YYYY-MM-DD), for ignore expiry. */
  readonly today: string;
}

export interface LoadedConfiguration {
  readonly config: ResolvedConfiguration;
  /** Directory that relative paths in the configuration are resolved against. */
  readonly baseDir: string;
  /** The configuration file, when one was used. */
  readonly path?: string;
  /** The git working tree root, when inside one. */
  readonly gitRoot?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The nearest directory at or above `dir` that contains `.git` (file or directory). */
export async function findGitRoot(dir: string): Promise<string | undefined> {
  let current = resolve(dir);
  for (;;) {
    if (await exists(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Discovery: `.contractguard.{yaml,yml,json}` in cwd, then parents up to the git root (§12.3). */
export async function discoverConfig(cwd: string, gitRoot: string | undefined): Promise<string | undefined> {
  let current = resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = join(current, name);
      if (await exists(candidate)) return candidate;
    }
    const parent = dirname(current);
    if (current === gitRoot || parent === current) return undefined;
    current = parent;
  }
}

function issueCode(issue: $ZodIssue): DiagnosticCode {
  if (issue.path[0] === 'version') return 'CGD-CONFIG-001';
  if (issue.code === 'unrecognized_keys') return 'CGD-CONFIG-003';
  return 'CGD-CONFIG-002';
}

const KNOWN_TOP_LEVEL = CONFIG_KEYS;

/** Turns zod issues into positioned diagnostics (pointer + line/column). */
function issueDiagnostics(issues: readonly $ZodIssue[], uri: string, index: PointerIndex): Diagnostic[] {
  const out: Diagnostic[] = [];
  const at = (segments: readonly PropertyKey[]): SourceRef => {
    const pointer = index.nearestExisting(pointerFromSegments(segments.map(String)));
    const range = index.rangeOf(pointer);
    return { uri: documentUri(uri), pointer, ...(range === undefined ? {} : { range: range.key ?? range.value }) };
  };
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const suggestion = issue.path.length === 0 ? didYouMean(key, KNOWN_TOP_LEVEL) : undefined;
        out.push(
          diagnostic('CGD-CONFIG-003', `Unknown configuration key "${[...issue.path.map(String), key].join('.')}"`, {
            location: at([...issue.path, key]),
            ...(suggestion === undefined ? {} : { hint: `did you mean "${suggestion}"?` }),
          }),
        );
      }
      continue;
    }
    const where = issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.');
    out.push(diagnostic(issueCode(issue), `${where}: ${issue.message}`, { location: at(issue.path) }));
  }
  return out;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Semantic checks that need the rule catalog or the current date. */
function semanticDiagnostics(
  file: ConfigFile,
  uri: string,
  index: PointerIndex | undefined,
  today: string,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const loc = (segments: readonly (string | number)[]): { location?: SourceRef } => {
    if (index === undefined) return {};
    const pointer = index.nearestExisting(pointerFromSegments(segments.map(String)));
    const range = index.rangeOf(pointer);
    return { location: { uri: documentUri(uri), pointer, ...(range === undefined ? {} : { range: range.value }) } };
  };
  const ids = DEFAULT_REGISTRY.rules.map((r) => r.id as string);
  const unknownRule = (id: string, path: readonly (string | number)[]): void => {
    const s = didYouMean(id, ids);
    out.push(
      diagnostic('CGD-CONFIG-010', `Unknown rule id "${id}"`, {
        ...loc(path),
        ...(s === undefined ? {} : { hint: `did you mean ${s}?` }),
      }),
    );
  };
  const seen = new Set<string>();
  file.specs.forEach((s, i) => {
    if (seen.has(s.id)) out.push(diagnostic('CGD-CONFIG-002', `Duplicate spec id "${s.id}"`, loc(['specs', i, 'id'])));
    seen.add(s.id);
  });
  file.rules?.disable?.forEach((id, i) => {
    if (DEFAULT_REGISTRY.byId(id) === undefined) unknownRule(id, ['rules', 'disable', i]);
  });
  for (const [id, o] of Object.entries(file.rules?.overrides ?? {})) {
    const rule = DEFAULT_REGISTRY.byId(id);
    if (rule === undefined) {
      unknownRule(id, ['rules', 'overrides', id]);
      continue;
    }
    if (o.classification !== undefined && !rule.overridable.classification) {
      out.push(
        diagnostic('CGD-CONFIG-011', `The classification of ${id} cannot be overridden`, {
          ...loc(['rules', 'overrides', id, 'classification']),
          hint: 'only rules marked overridable accept a classification; use severity, disable or ignore instead',
        }),
      );
    }
    for (const name of Object.keys(o.options ?? {})) {
      if (!(rule.options ?? []).some((spec) => spec.name === name)) {
        out.push(
          diagnostic(
            'CGD-CONFIG-002',
            `${id} has no option "${name}"`,
            loc(['rules', 'overrides', id, 'options', name]),
          ),
        );
      }
    }
  }
  file.rules?.ignore?.forEach((e, i) => {
    if (e.rule !== undefined && DEFAULT_REGISTRY.byId(e.rule) === undefined)
      unknownRule(e.rule, ['rules', 'ignore', i, 'rule']);
    if (e.expires === undefined) return;
    if (e.expires < today) {
      out.push(
        diagnostic(
          'CGD-CONFIG-112',
          `Ignore entry #${String(i)} expired on ${e.expires} and no longer applies`,
          loc(['rules', 'ignore', i, 'expires']),
        ),
      );
    } else if (e.expires <= addDays(today, 30)) {
      out.push(
        diagnostic(
          'CGD-CONFIG-113',
          `Ignore entry #${String(i)} expires on ${e.expires}`,
          loc(['rules', 'ignore', i, 'expires']),
        ),
      );
    }
  });
  return out;
}

const FILE_ID = /[^a-z0-9-]+/g;

/** Spec id for an ad-hoc comparison: the candidate file stem, normalized. */
export function adHocSpecId(candidate: string): string {
  const stem = basename(candidate.split(':').pop() ?? candidate, extname(candidate))
    .toLowerCase()
    .replace(FILE_ID, '-');
  const id = stem.replace(/^-+|-+$/g, '').slice(0, 63);
  return /^[a-z0-9]/.test(id) ? id : 'api';
}

/** Loads, validates and resolves the configuration (discovery, defaults, CLI overrides, trust boundary). */
export async function loadConfiguration(req: ConfigRequest): Promise<StageResult<LoadedConfiguration>> {
  const gitRoot = await findGitRoot(req.cwd);
  let path: string | undefined;
  const explicit = req.configPath;
  if (typeof explicit === 'string') {
    path = resolve(req.cwd, explicit);
    if (!(await exists(path))) {
      return { diagnostics: [diagnostic('CGD-CONFIG-014', `Configuration file not found: ${explicit}`)] };
    }
  } else if (explicit !== false) {
    path = await discoverConfig(req.cwd, gitRoot);
  }

  let file: ConfigFile | undefined;
  const diagnostics: Diagnostic[] = [];
  if (path !== undefined) {
    const uri = pathToFileURL(path).href;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (error) {
      return { diagnostics: [diagnostic('CGD-CONFIG-015', `Cannot read ${path}: ${(error as Error).message}`)] };
    }
    const parsed = parseDocument({ uri: documentUri(uri), bytes }, { limits: DEFAULT_LIMITS });
    if (parsed.value === undefined) {
      return {
        diagnostics: parsed.diagnostics.map((d) => ({
          ...d,
          code: 'CGD-CONFIG-015' as const,
          category: 'configuration' as const,
          severity: 'error' as const,
        })),
      };
    }
    const result = parseConfigFile(toPlainJson(parsed.value.value));
    if (!result.success)
      return { diagnostics: sortDiagnostics(issueDiagnostics(result.issues, uri, parsed.value.index)) };
    file = result.data;
    diagnostics.push(...semanticDiagnostics(file, uri, parsed.value.index, req.today));
    if (diagnostics.some((d) => d.severity === 'error')) return { diagnostics: sortDiagnostics(diagnostics) };
  } else if (req.adHoc === undefined) {
    return {
      diagnostics: [
        diagnostic('CGD-CONFIG-014', 'No configuration file found', {
          hint: 'pass <base> <candidate>, create one with "contractguard init", or use --config',
        }),
      ],
    };
  }

  const baseDir = path === undefined ? resolve(req.cwd) : dirname(path);
  const o = req.overrides ?? {};
  const trust = req.trust ?? { ci: false, allowRemoteReferences: false };

  // Specs: ad-hoc positionals replace configured specs; ids select configured ones.
  let specs: ResolvedConfiguration['specs'];
  if (req.adHoc !== undefined) {
    const pairs: readonly AdHocSpec[] = Array.isArray(req.adHoc) ? req.adHoc : [req.adHoc as AdHocSpec];
    const used = new Map<string, number>();
    specs = pairs.map((p) => {
      const stem = adHocSpecId(p.candidate);
      const n = (used.get(stem) ?? 0) + 1;
      used.set(stem, n);
      return { id: n === 1 ? stem : `${stem}-${String(n)}`, base: p.base, candidate: p.candidate };
    });
  } else {
    const all = (file as ConfigFile).specs;
    const wanted = req.specIds ?? [];
    const unknown = wanted.filter((id) => !all.some((s) => s.id === id));
    if (unknown.length > 0) {
      return {
        diagnostics: unknown.map((id) => {
          const s = didYouMean(
            id,
            all.map((x) => x.id),
          );
          return diagnostic(
            'CGD-CONFIG-002',
            `Unknown spec id "${id}"`,
            s === undefined ? {} : { hint: `did you mean "${s}"?` },
          );
        }),
      };
    }
    specs = all.filter((s) => wanted.length === 0 || wanted.includes(s.id));
  }

  if (o.perspective !== undefined && o.perspective !== 'provider-backward') {
    return {
      diagnostics: [
        diagnostic('CGD-CONFIG-002', `Unknown perspective "${o.perspective}"`, {
          hint: 'this version ships provider-backward only',
        }),
      ],
    };
  }

  const a = file?.analysis;
  const l = a?.limits;
  const sizeOr = (v: number | string | undefined, d: number): number => (v === undefined ? d : (parseSize(v) ?? d));
  const r = file?.references;
  // Trust boundary: capability expansion from a committed file needs a trusted flag in CI.
  const remoteRequested = r?.allowRemote === true;
  const allowRemote = remoteRequested && (!trust.ci || trust.allowRemoteReferences);
  const repoRoot = gitRoot ?? baseDir;
  let root = r?.root === undefined ? repoRoot : resolve(baseDir, r.root);
  const outside = relative(repoRoot, root).startsWith('..') || isAbsolute(relative(repoRoot, root));
  if (outside && trust.ci) root = repoRoot;
  if (remoteRequested && !allowRemote) {
    diagnostics.push(
      diagnostic('CGD-CONFIG-002', 'references.allowRemote is ignored in CI mode without --allow-remote-references', {
        severity: 'warning',
        hint: 'capability-expanding settings from a committed file need a trusted flag (§12.6)',
      }),
    );
  }

  const config: ResolvedConfiguration = {
    version: 1,
    specs,
    compatibility: { perspective: 'provider-backward' },
    policy: {
      failOn: o.failOn ?? file?.policy?.failOn ?? DEFAULT_REPORT_POLICY.failOn,
      minSeverity: o.minSeverity ?? file?.policy?.minSeverity ?? DEFAULT_REPORT_POLICY.minSeverity,
      undetermined: o.undetermined ?? file?.policy?.undetermined ?? DEFAULT_REPORT_POLICY.undetermined,
    },
    analysis: {
      strictResponseValidation: a?.strictResponseValidation ?? DEFAULT_CLASSIFICATION_POLICY.strictResponseValidation,
      constraintTightening: a?.constraintTightening ?? DEFAULT_CLASSIFICATION_POLICY.constraintTightening,
      responseEnumAdditions: a?.responseEnumAdditions ?? DEFAULT_CLASSIFICATION_POLICY.responseEnumAdditions,
      removedRequestParameters: a?.removedRequestParameters ?? DEFAULT_CLASSIFICATION_POLICY.removedRequestParameters,
      closedResponseAdditions: a?.closedResponseAdditions ?? DEFAULT_CLASSIFICATION_POLICY.closedResponseAdditions,
      includeEquivalentChanges: o.includeEquivalent ?? a?.includeEquivalentChanges ?? false,
      honorExtensibleEnum: a?.honorExtensibleEnum ?? true,
      allowInvalidSpec: o.allowInvalidSpec ?? a?.allowInvalidSpec ?? false,
      limits: {
        maxDocumentBytes: sizeOr(l?.maxDocumentBytes, DEFAULT_LIMITS.maxDocumentBytes),
        maxTotalBytes: sizeOr(l?.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes),
        maxDocuments: l?.maxDocuments ?? DEFAULT_LIMITS.maxDocuments,
        maxDepth: l?.maxDepth ?? DEFAULT_LIMITS.maxDepth,
        maxRefHops: l?.maxRefHops ?? DEFAULT_LIMITS.maxRefHops,
        maxSchemaPairs: l?.maxSchemaPairs ?? DEFAULT_LIMITS.maxSchemaPairs,
        timeoutMs: l?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
      },
    },
    rules: {
      disabled: new Set((file?.rules?.disable ?? []) as RuleId[]),
      overrides: new Map(
        Object.entries(file?.rules?.overrides ?? {}).map(([id, v]) => [
          id as RuleId,
          {
            ...(v.classification === undefined ? {} : { classification: v.classification }),
            ...(v.severity === undefined ? {} : { severity: v.severity }),
            ...(v.options === undefined ? {} : { options: v.options }),
          } satisfies RuleOverride,
        ]),
      ),
      ignore: (file?.rules?.ignore ?? []).map((e, i): IgnoreEntry => ({
        ...(e.rule === undefined ? {} : { rule: e.rule as RuleId }),
        ...(e.fingerprint === undefined ? {} : { fingerprint: e.fingerprint }),
        ...(e.operation === undefined ? {} : { operation: e.operation }),
        ...(e.path === undefined ? {} : { path: e.path }),
        reason: e.reason,
        ...(e.expires === undefined ? {} : { expires: e.expires }),
        configPointer: `/rules/ignore/${String(i)}`,
      })),
    },
    filters: {
      include: file?.filters?.include ?? [],
      exclude: file?.filters?.exclude ?? [],
      excludeTags: file?.filters?.excludeTags ?? [],
      excludeExtensions: file?.filters?.excludeExtensions ?? [],
    },
    references: {
      root,
      allowRemote,
      allowedHosts: allowRemote ? (r.allowedHosts ?? []) : [],
      allowedSchemes: r?.allowedSchemes ?? ['https'],
      fetchTimeoutMs: r?.fetchTimeoutMs ?? 10_000,
      maxRemoteBytes: sizeOr(r?.maxRemoteBytes, 5 * 1024 * 1024),
    },
    report: {
      formats: o.formats ?? file?.report?.formats ?? (trust.ci ? ['console', 'json'] : ['console']),
      outputDir: resolve(baseDir, o.outputDir ?? file?.report?.outputDir ?? '.contractguard/reports'),
      groupBy: o.groupBy ?? file?.report?.groupBy ?? 'cause',
      deterministic: o.deterministic ?? file?.report?.deterministic ?? false,
    },
  };
  return {
    value: { config, baseDir, ...(path === undefined ? {} : { path }), ...(gitRoot === undefined ? {} : { gitRoot }) },
    diagnostics: sortDiagnostics(diagnostics),
  };
}
