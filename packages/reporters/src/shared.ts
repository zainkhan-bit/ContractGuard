import {
  JsonNumber,
  compareCodeUnits,
  type AnalysisResult,
  type Classification,
  type CompatibilityFinding,
  type Severity,
  type SourceRef,
} from '@zainkhan-bit/contractguard-core';

export interface RenderOptions {
  /** Group findings by root cause (default) or by operation. */
  readonly groupBy: 'cause' | 'operation';
  /** Omit volatile fields (generatedAt) so output is byte-stable. */
  readonly deterministic: boolean;
  /** Maximum groups shown per classification section (human formats only). */
  readonly maxFindings?: number;
  /** Base URL that turns source locations into links, e.g. `https://github.com/o/r/blob/<sha>/`. */
  readonly linkBase?: string;
  /** Root that file URIs are shown relative to (a `file:` URI or an absolute path). */
  readonly srcRoot?: string;
}

/** Deterministic JSON writer: sorted object keys, Map/Set as sorted arrays/objects, exact decimals, no undefined. */
export function toJsonText(value: unknown, indent = 2): string {
  const pad = (depth: number): string => (indent === 0 ? '' : `\n${' '.repeat(indent * depth)}`);
  const sep = indent === 0 ? ':' : ': ';
  const write = (v: unknown, depth: number): string | undefined => {
    if (v === undefined || typeof v === 'function') return undefined;
    if (v === null) return 'null';
    if (v instanceof JsonNumber) return v.text;
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Set) return write([...(v as Set<unknown>)].sort(compareUnknown), depth);
    if (v instanceof Map) {
      const entries = [...(v as Map<unknown, unknown>)];
      return entries.every(([k]) => typeof k === 'string')
        ? write(Object.fromEntries(entries), depth)
        : write(
            entries.sort((a, b) => compareUnknown(a[0], b[0])),
            depth,
          );
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      const items = v.map((x) => write(x, depth + 1) ?? 'null');
      return `[${items.map((x) => `${pad(depth + 1)}${x}`).join(',')}${pad(depth)}]`;
    }
    const obj = v as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort(compareCodeUnits)) {
      const text = write(obj[key], depth + 1);
      if (text !== undefined) parts.push(`${pad(depth + 1)}${JSON.stringify(key)}${sep}${text}`);
    }
    return parts.length === 0 ? '{}' : `{${parts.join(',')}${pad(depth)}}`;
  };
  return write(value, 0) ?? 'null';
}

function compareUnknown(a: unknown, b: unknown): number {
  return compareCodeUnits(typeof a === 'string' ? a : toJsonText(a, 0), typeof b === 'string' ? b : toJsonText(b, 0));
}

/**
 * `file:` URI or path → path relative to srcRoot (forward slashes); `git://<sha>/<path>` → `<path>@<sha7>`; other
 * URIs are returned unchanged.
 */
export function displayPath(uri: string, srcRoot?: string): string {
  const git = /^git:\/\/([0-9a-f]{40})\/(.+)$/i.exec(uri);
  if (git !== null) return `${decodeURIComponent(git[2] as string)}@${(git[1] as string).slice(0, 7)}`;
  if (!uri.startsWith('file:')) return uri;
  let path = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  if (srcRoot !== undefined) {
    let root = srcRoot.startsWith('file:')
      ? decodeURIComponent(srcRoot.replace(/^file:\/\//, ''))
      : srcRoot.replaceAll('\\', '/');
    if (/^[A-Za-z]:/.test(root)) root = `/${root}`;
    if (!root.endsWith('/')) root += '/';
    if (path.startsWith(root)) path = path.slice(root.length);
  }
  return path;
}

/** `path:line` (1-based) for a source reference. */
export function locationText(ref: SourceRef | undefined, srcRoot?: string): string {
  if (ref === undefined) return '';
  const path = displayPath(ref.uri, srcRoot);
  return ref.range === undefined ? path : `${path}:${String(ref.range.start.line)}`;
}

/** A link to the location when linkBase is set; otherwise undefined. */
export function locationLink(ref: SourceRef | undefined, o: RenderOptions): string | undefined {
  if (ref === undefined || o.linkBase === undefined || !ref.uri.startsWith('file:')) return undefined;
  const path = displayPath(ref.uri, o.srcRoot);
  const base = o.linkBase.endsWith('/') ? o.linkBase : `${o.linkBase}/`;
  return `${base}${path.split('/').map(encodeURIComponent).join('/')}${ref.range === undefined ? '' : `#L${String(ref.range.start.line)}`}`;
}

export const SECTION_ORDER: readonly Classification[] = [
  'breaking',
  'potentially-breaking',
  'undetermined',
  'non-breaking',
  'informational',
];

export const CLASSIFICATION_TITLE: Readonly<Record<Classification, string>> = {
  breaking: 'Breaking',
  'potentially-breaking': 'Potentially breaking',
  undetermined: 'Undetermined (needs review)',
  'non-breaking': 'Non-breaking',
  informational: 'Informational',
};

export const SEVERITY_TITLE: Readonly<Record<Severity, string>> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
};

export interface FindingGroup {
  readonly key: string;
  /** The finding that represents the group (worst first). */
  readonly lead: CompatibilityFinding;
  readonly findings: readonly CompatibilityFinding[];
}

/** Groups active findings of one classification by cause or by operation, in result order. */
export function groupFindings(
  findings: readonly CompatibilityFinding[],
  classification: Classification,
  groupBy: RenderOptions['groupBy'],
): FindingGroup[] {
  const groups = new Map<string, CompatibilityFinding[]>();
  for (const f of findings) {
    if (f.status !== 'active' || f.classification !== classification) continue;
    const key = groupBy === 'cause' ? `${f.ruleId}|${f.causeKey}` : (f.subject.operationKey ?? '(global)');
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [f]);
    else list.push(f);
  }
  return [...groups].map(([key, fs]) => ({ key, lead: fs[0] as CompatibilityFinding, findings: fs }));
}

/** "GET /pets → response 200 (application/json) → `items[].id`" */
export function affectedText(f: CompatibilityFinding): string {
  const site = f.subject.site;
  const parts: string[] = [];
  if (f.subject.method !== undefined && f.subject.path !== undefined)
    parts.push(`${f.subject.method} ${f.subject.path}`);
  else if (f.subject.operationKey !== undefined) parts.push(f.subject.operationKey);
  switch (site.kind) {
    case 'parameter':
      parts.push(`${site.key.slice(0, site.key.indexOf(':'))} parameter ${site.key.slice(site.key.indexOf(':') + 1)}`);
      break;
    case 'requestBody':
      parts.push(site.mediaType === undefined ? 'request body' : `request body ${site.mediaType}`);
      break;
    case 'response':
      parts.push(
        site.mediaType === undefined ? `response ${site.status}` : `response ${site.status} ${site.mediaType}`,
      );
      break;
    case 'responseHeader':
      parts.push(`response ${site.status} header ${site.header}`);
      break;
    case 'servers':
      parts.push('servers');
      break;
    case 'security':
      parts.push('security');
      break;
    case 'operation':
      break;
  }
  const path = schemaPathOf(f);
  if (path !== '') parts.push(`\`${path}\``);
  return parts.length === 0 ? 'the API' : parts.join(' → ');
}

/** Human schema path of a finding (`items[].address.zip`). */
export function schemaPathOf(f: CompatibilityFinding): string {
  let out = '';
  for (const s of f.subject.schemaPath) {
    switch (s.kind) {
      case 'property':
        out += out === '' ? s.name : `.${s.name}`;
        break;
      case 'items':
        out += '[]';
        break;
      case 'additionalProperties':
        out += out === '' ? '{*}' : '.{*}';
        break;
      case 'variant':
        out += `${out === '' ? '' : '.'}${s.composition}[${s.matchKey}]`;
        break;
      case 'discriminatorMapping':
        out += `${out === '' ? '' : '.'}mapping[${s.value}]`;
        break;
    }
  }
  return out;
}

/** "previous → current" for findings that carry values. */
export function valueChange(f: CompatibilityFinding): string | undefined {
  if (f.previous === undefined && f.current === undefined) return undefined;
  const show = (v: unknown): string => (v === undefined ? '(none)' : toJsonText(v, 0));
  return `${show(f.previous)} → ${show(f.current)}`;
}

/** The verdict sentence, e.g. "Policy failed: 2 breaking changes". */
export function verdictText(r: AnalysisResult): string {
  if (r.status === 'input-error') return 'Analysis failed: input error';
  if (r.policy.passed) return 'Policy passed';
  const counts = new Map<Classification, number>();
  for (const reason of r.policy.reasons) {
    const f = r.findings.find((x) => x.fingerprint === reason.fingerprint);
    if (f !== undefined) counts.set(f.classification, (counts.get(f.classification) ?? 0) + 1);
  }
  const parts = SECTION_ORDER.filter((c) => counts.has(c)).map((c) => {
    const n = counts.get(c) as number;
    const noun = c === 'undetermined' ? 'undetermined finding' : `${SUMMARY_LABEL[c]} change`;
    return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
  });
  return `Policy failed: ${parts.join(', ')}`;
}

/** "1 breaking · 2 non-breaking (1 suppressed)" */
const SUMMARY_LABEL: Readonly<Record<Classification, string>> = {
  breaking: 'breaking',
  'potentially-breaking': 'potentially breaking',
  undetermined: 'undetermined',
  'non-breaking': 'non-breaking',
  informational: 'informational',
};

export function summaryLine(r: AnalysisResult): string {
  const s = r.summary.byClassification;
  const parts = SECTION_ORDER.map((c) => `${String(s[c])} ${SUMMARY_LABEL[c]}`);
  return `${parts.join(' · ')}${r.summary.suppressed > 0 ? ` (${String(r.summary.suppressed)} suppressed)` : ''}`;
}

/** The operations affected by a group, deduplicated, in order. */
export function operationsOf(findings: readonly CompatibilityFinding[]): string[] {
  return [...new Set(findings.map((f) => affectedText(f)))];
}
