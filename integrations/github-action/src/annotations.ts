import { fileURLToPath } from 'node:url';
import { relative, sep } from 'node:path';
import type {
  AnalysisResult,
  Classification,
  CompatibilityFinding,
  Diagnostic,
  Severity,
  SourceRef,
} from '@contractguard/core';
import { command, type AnnotationProps } from './runner.js';

/** GitHub shows at most 10 annotations of each type per step. */
export const ANNOTATIONS_PER_TYPE = 10;

const CLASS_RANK: Readonly<Record<Classification, number>> = {
  breaking: 0,
  undetermined: 1,
  'potentially-breaking': 2,
  'non-breaking': 3,
  informational: 4,
};
const SEVERITY_RANK: Readonly<Record<Severity, number>> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const TITLE: Readonly<Partial<Record<Classification, string>>> = {
  breaking: 'Breaking change',
  'potentially-breaking': 'Potentially breaking change',
  undetermined: 'Compatibility could not be determined',
};

/** A workspace-relative POSIX path for a `file:` URI inside the workspace; undefined otherwise (git, snapshot, URL). */
export function workspacePath(uri: string, workspace: string): string | undefined {
  if (!uri.startsWith('file:')) return undefined;
  let path: string;
  try {
    path = fileURLToPath(uri);
  } catch {
    return undefined;
  }
  const rel = relative(workspace, path);
  if (rel === '' || rel.startsWith('..') || /^[a-zA-Z]:/.test(rel)) return undefined;
  return rel.split(sep).join('/');
}

function locate(ref: SourceRef | undefined, workspace: string): AnnotationProps {
  if (ref === undefined) return {};
  const file = workspacePath(ref.uri, workspace);
  if (file === undefined) return {};
  const r = ref.range;
  return {
    file,
    ...(r === undefined
      ? {}
      : {
          line: r.start.line,
          col: r.start.column,
          ...(r.end.line === r.start.line ? {} : { endLine: r.end.line }),
        }),
  };
}

function message(f: CompatibilityFinding): string {
  const op =
    f.subject.method === undefined || f.subject.path === undefined
      ? ''
      : `${f.subject.method.toUpperCase()} ${f.subject.path}: `;
  return `${op}${f.message}\n\n${f.explanation}\n\nFix: ${f.resolution}`;
}

/** Workflow commands for the findings of all results: breaking → error, potentially-breaking/undetermined → warning. */
export function findingAnnotations(results: readonly AnalysisResult[], workspace: string): string {
  const shown = results
    .flatMap((r) => r.findings.map((f) => ({ r, f })))
    .filter(({ f }) => f.status === 'active' && TITLE[f.classification] !== undefined)
    .sort(
      (a, b) =>
        CLASS_RANK[a.f.classification] - CLASS_RANK[b.f.classification] ||
        SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity],
    );
  const buckets: Record<'error' | 'warning', typeof shown> = { error: [], warning: [] };
  for (const x of shown) buckets[x.f.classification === 'breaking' ? 'error' : 'warning'].push(x);
  let out = '';
  for (const kind of ['error', 'warning'] as const) {
    const list = buckets[kind];
    const fits = list.length <= ANNOTATIONS_PER_TYPE ? list : list.slice(0, ANNOTATIONS_PER_TYPE - 1);
    for (const { r, f } of fits) {
      const title = `${TITLE[f.classification] ?? ''} · ${f.ruleId}${results.length > 1 ? ` · ${r.specId}` : ''}`;
      out += command(kind, { title, ...locate(f.location.anchor, workspace) }, message(f));
    }
    if (fits.length < list.length) {
      const more = list.length - fits.length;
      out += command(
        kind,
        { title: 'ContractGuard' },
        `+${String(more)} more ${kind === 'error' ? 'breaking' : 'non-blocking'} finding(s): see the job summary.`,
      );
    }
  }
  return out;
}

/** Errors and warnings from loading (invalid spec, missing file, configuration) as annotations. */
export function diagnosticAnnotations(diagnostics: readonly Diagnostic[], workspace: string): string {
  return diagnostics
    .filter((d) => d.severity === 'error' || d.severity === 'warning')
    .map((d) =>
      command(
        d.severity === 'error' ? 'error' : 'warning',
        { title: `ContractGuard ${d.code}`, ...locate(d.location, workspace) },
        `${d.side === undefined ? '' : `[${d.side}] `}${d.message}${d.hint === undefined ? '' : ` (${d.hint})`}`,
      ),
    )
    .join('');
}
