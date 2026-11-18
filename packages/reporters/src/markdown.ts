import type { AnalysisResult, CompatibilityFinding, Diagnostic } from '@zainkhan-bit/contractguard-core';
import {
  CLASSIFICATION_TITLE,
  SECTION_ORDER,
  displayPath,
  groupFindings,
  locationLink,
  locationText,
  operationsOf,
  summaryLine,
  valueChange,
  verdictText,
  type FindingGroup,
  type RenderOptions,
} from './shared.js';

/** GitHub's limit for a job summary. */
export const GITHUB_SUMMARY_LIMIT: number = 1024 * 1024;

export interface MarkdownOptions extends RenderOptions {
  /** Byte cap; lower-priority sections are dropped first (default: GitHub's 1 MiB). */
  readonly maxBytes?: number;
  /** Shown in the "reproduce locally" footer. */
  readonly reproduceCommand?: string;
  readonly docsUrl?: string;
}

const ICON: Record<string, string> = {
  breaking: '❌',
  'potentially-breaking': '⚠️',
  undetermined: '❔',
  'non-breaking': '✅',
  informational: 'ℹ️',
};

/** Escapes text for Markdown table cells and inline use. */
function esc(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** A location as code text, linked when linkBase is set. Baseline locations are never linked (other revision). */
function loc(ref: CompatibilityFinding['location']['anchor'] | undefined, o: RenderOptions, linkable = true): string {
  if (ref === undefined) return '';
  const text = locationText(ref, o.srcRoot);
  const link = linkable ? locationLink(ref, o) : undefined;
  return link === undefined ? `\`${text}\`` : `[\`${text}\`](${link})`;
}

function renderGroup(g: FindingGroup, o: RenderOptions): string {
  const f = g.lead;
  const lines: string[] = [];
  lines.push(`#### ${ICON[f.classification] ?? ''} \`${f.ruleId}\` ${esc(f.ruleName)} · ${f.severity}`);
  lines.push('');
  lines.push(esc(f.message));
  lines.push('');
  const change = valueChange(f);
  if (change !== undefined) lines.push(`- **Change:** \`${esc(change)}\``);
  lines.push(`- **Why:** ${esc(f.explanation)}`);
  const ops = operationsOf(g.findings);
  const shown = ops.slice(0, 10);
  lines.push(
    `- **Affects:** ${shown.map(esc).join('; ')}${ops.length > shown.length ? `; and ${String(ops.length - shown.length)} more` : ''}`,
  );
  lines.push(
    `- **Where:** ${loc(f.location.anchor, o)}${f.location.base !== undefined && f.location.base !== f.location.anchor ? ` (baseline: ${loc(f.location.base, o, false)})` : ''}`,
  );
  const notes = f.evidence.filter((e) => e.kind === 'reasoning' || e.kind === 'assumption' || e.kind === 'policy');
  if (notes.length > 0) lines.push(`- **Evidence:** ${notes.map((e) => esc(e.text)).join(' · ')}`);
  lines.push(`- **Fix:** ${esc(f.resolution)}`);
  lines.push(
    `- **Fingerprint:** \`${f.fingerprint}\`${g.findings.length > 1 ? ` (+${String(g.findings.length - 1)} related)` : ''}`,
  );
  lines.push('');
  return lines.join('\n');
}

interface Section {
  /** Sections with a higher drop rank are omitted first when the report is too large. */
  readonly dropRank: number;
  readonly title: string;
  readonly text: string;
}

function diagnosticsText(diagnostics: readonly Diagnostic[], o: RenderOptions): string {
  return diagnostics
    .map((d) => {
      const where = d.location === undefined ? '' : ` \`${locationText(d.location, o.srcRoot)}\``;
      return `- \`${d.code}\` ${d.severity}${d.side === undefined ? '' : ` (${d.side})`}:${where} ${esc(d.message)}${d.hint === undefined ? '' : ` — ${esc(d.hint)}`}`;
    })
    .join('\n');
}

function sectionsOf(r: AnalysisResult, o: MarkdownOptions): Section[] {
  const out: Section[] = [];
  // Drop order under the size cap: informational, non-breaking, suppressed, diagnostics, undetermined, …, breaking.
  const DROP_RANK = {
    breaking: 1,
    'potentially-breaking': 2,
    undetermined: 3,
    'non-breaking': 6,
    informational: 7,
  } as const;
  SECTION_ORDER.forEach((classification) => {
    const groups = groupFindings(r.findings, classification, o.groupBy);
    if (groups.length === 0) return;
    const limit = o.maxFindings ?? Infinity;
    const shown = groups.slice(0, limit);
    const more = groups.length - shown.length;
    const body = `${shown.map((g) => renderGroup(g, o)).join('\n')}${more > 0 ? `\n_…and ${String(more)} more (see the JSON report)._\n` : ''}`;
    const count = groups.reduce((n, g) => n + g.findings.length, 0);
    const title = `${CLASSIFICATION_TITLE[classification]} (${String(count)})`;
    const collapsed = classification === 'non-breaking' || classification === 'informational';
    out.push({
      dropRank: DROP_RANK[classification],
      title,
      text: collapsed
        ? `<details>\n<summary><strong>${title}</strong></summary>\n\n${body}\n</details>\n`
        : `### ${ICON[classification] ?? ''} ${title}\n\n${body}`,
    });
  });
  const suppressed = r.findings.filter((f) => f.status === 'suppressed');
  if (suppressed.length > 0) {
    const rows = suppressed.map(
      (f) =>
        `| \`${f.ruleId}\` | ${esc(f.message)} | ${esc(f.suppression?.reason ?? '')} | ${f.suppression?.expires ?? '—'} | \`${f.suppression?.configPointer ?? ''}\` |`,
    );
    out.push({
      dropRank: 5,
      title: `Suppressed (${String(suppressed.length)})`,
      text: `<details>\n<summary><strong>Suppressed (${String(suppressed.length)})</strong></summary>\n\n| Rule | Finding | Reason | Expires | Config |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n</details>\n`,
    });
  }
  if (r.diagnostics.length > 0) {
    out.push({ dropRank: 4, title: 'Diagnostics', text: `### Diagnostics\n\n${diagnosticsText(r.diagnostics, o)}\n` });
  }
  return out;
}

function header(r: AnalysisResult, o: MarkdownOptions): string {
  const icon = r.status === 'input-error' || !r.policy.passed ? '❌' : '✅';
  const side = (s: AnalysisResult['base']): string =>
    s === undefined
      ? '_not loaded_'
      : `${esc(s.revision ?? '')}${s.revision === undefined ? '' : ' '}\`${displayPath(s.rootUri, o.srcRoot)}\` (OpenAPI ${s.specVersion}, ${String(s.operationCount)} operations)`;
  const sum = r.summary;
  const lines = [
    `## ContractGuard · \`${esc(r.specId)}\``,
    '',
    `**${icon} ${verdictText(r)}**${r.status === 'completed-degraded' ? ' _(degraded: invalid input was tolerated)_' : ''}`,
    '',
    '| | |',
    '|---|---|',
    `| Perspective | ${r.perspective} |`,
    `| Base | ${side(r.base)} |`,
    `| Candidate | ${side(r.candidate)} |`,
    `| Tool | ContractGuard ${r.tool.version} (rules ${r.tool.rulesetVersion}) |`,
    '',
    '| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |',
    '|---:|---:|---:|---:|---:|---:|---:|',
    `| ${SECTION_ORDER.map((c) => String(sum.byClassification[c])).join(' | ')} | ${String(sum.suppressed)} | ${String(sum.affectedOperations)} |`,
    '',
    '',
  ];
  return lines.join('\n');
}

function footer(r: AnalysisResult, o: MarkdownOptions): string {
  const cmd = o.reproduceCommand ?? `npx contractguard check --spec ${r.specId}`;
  return `<sub>Reproduce locally: \`${cmd}\`${o.docsUrl === undefined ? '' : ` · [Rule documentation](${o.docsUrl})`} · ${esc(summaryLine(r))}</sub>\n`;
}

const encoder = new TextEncoder();
const bytes = (s: string): number => encoder.encode(s).length;

/**
 * Markdown report (§13.2). Pure and deterministic. When the output exceeds `maxBytes`, lower-priority sections
 * (informational, non-breaking, suppressed, diagnostics, …) are dropped first and the omission is stated.
 */
export function renderMarkdown(results: readonly AnalysisResult[], o: MarkdownOptions): string {
  const cap = o.maxBytes ?? GITHUB_SUMMARY_LIMIT;
  const parts = results.map((r) => ({ r, head: header(r, o), sections: sectionsOf(r, o), foot: footer(r, o) }));
  const compose = (keep: (p: (typeof parts)[number], s: Section) => boolean): string =>
    parts
      .map((p) => {
        const kept = p.sections.filter((s) => keep(p, s));
        const dropped = p.sections.filter((s) => !keep(p, s));
        const note =
          dropped.length === 0
            ? ''
            : `> [!NOTE]\n> Omitted to fit GitHub's size limit: ${dropped.map((s) => s.title).join(', ')}. The JSON report contains every finding.\n\n`;
        return `${p.head}${note}${kept.map((s) => s.text).join('\n')}\n${p.foot}`;
      })
      .join('\n---\n\n');
  let keepBelow = 8;
  let text = compose(() => true);
  while (bytes(text) > cap && keepBelow > 1) {
    keepBelow -= 1;
    const limit = keepBelow;
    text = compose((_p, s) => s.dropRank < limit);
  }
  if (bytes(text) > cap) {
    // Even the headers do not fit: hard cut on a character boundary.
    const marker = '\n\n_…truncated._\n';
    let cut = text.slice(0, cap - bytes(marker));
    while (bytes(cut) > cap - bytes(marker)) cut = cut.slice(0, -1);
    text = cut + marker;
  }
  return text;
}
