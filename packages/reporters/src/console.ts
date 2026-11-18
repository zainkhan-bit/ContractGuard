import type { AnalysisResult, Classification } from '@zainkhan-bit/contractguard-core';
import {
  SECTION_ORDER,
  displayPath,
  groupFindings,
  locationText,
  operationsOf,
  summaryLine,
  valueChange,
  type FindingGroup,
  type RenderOptions,
} from './shared.js';

export interface ConsoleOptions extends RenderOptions {
  readonly color: boolean;
  /** Terminal width in columns (wrapping target, minimum 40). */
  readonly width: number;
  /** Show non-breaking and informational findings in full instead of one line each. */
  readonly verbose?: boolean;
}

const STYLE: Readonly<
  Record<Classification, { readonly mark: string; readonly label: string; readonly code: string }>
> = {
  breaking: { mark: '✖', label: 'BREAKING', code: '31' },
  'potentially-breaking': { mark: '▲', label: 'POTENTIALLY BREAKING', code: '33' },
  undetermined: { mark: '?', label: 'UNDETERMINED', code: '35' },
  'non-breaking': { mark: '✓', label: 'NON-BREAKING', code: '32' },
  informational: { mark: '·', label: 'INFO', code: '2' },
};

/** Visible width (ignores ANSI escapes). */
function visible(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '').length;
}

/** Word-wraps `text` to `width`, prefixing continuation lines with `indent`. */
export function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/).filter((w) => w !== '');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line !== '' && visible(line) + 1 + visible(w) > width - indent.length) {
      lines.push(line);
      line = w;
    } else line = line === '' ? w : `${line} ${w}`;
  }
  if (line !== '') lines.push(line);
  return lines.join(`\n${indent}`);
}

/**
 * Human console output (§12.5): verdict-first, grouped by cause (or operation), width-aware, optional colour.
 * Pure and deterministic.
 */
export function renderConsole(results: readonly AnalysisResult[], o: ConsoleOptions): string {
  const width = Math.max(40, o.width);
  const paint = (code: string, s: string): string => (o.color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const bold = (s: string): string => paint('1', s);
  const dim = (s: string): string => paint('2', s);
  const out: string[] = [];

  for (const r of results) {
    out.push(bold(`ContractGuard ${r.tool.version} · perspective: ${r.perspective} · spec: ${r.specId}`));
    for (const [name, s] of [
      ['base:     ', r.base],
      ['candidate:', r.candidate],
    ] as const) {
      out.push(
        s === undefined
          ? `${name} ${paint('31', 'not loaded')}`
          : `${name} ${s.revision === undefined ? '' : `${s.revision} `}${displayPath(s.rootUri, o.srcRoot)} (OpenAPI ${s.specVersion}, ${String(s.operationCount)} operations)`,
      );
    }
    if (r.status === 'completed-degraded') {
      out.push(paint('33', 'warning: invalid input was tolerated (allowInvalidSpec); results may be incomplete'));
    }
    out.push('');

    const head = (g: FindingGroup): string => {
      const f = g.lead;
      const st = STYLE[f.classification];
      const left = `${paint(st.code, `${st.mark} ${st.label}`)}  ${f.ruleId}  ${f.ruleName}`;
      const pad = Math.max(2, width - visible(left) - f.severity.length);
      return `${left}${' '.repeat(pad)}${f.severity}`;
    };

    for (const classification of SECTION_ORDER) {
      const groups = groupFindings(r.findings, classification, o.groupBy);
      const brief = (classification === 'non-breaking' || classification === 'informational') && o.verbose !== true;
      const limit = o.maxFindings ?? Infinity;
      for (const g of groups.slice(0, limit)) {
        const f = g.lead;
        if (brief) {
          out.push(
            `${paint(STYLE[classification].code, STYLE[classification].mark)} ${f.ruleId}  ${wrap(f.message, width - 14, ' '.repeat(14))}`,
          );
          continue;
        }
        out.push(head(g));
        out.push(`  ${dim('what:')}     ${wrap(f.message, width, ' '.repeat(12))}`);
        const change = valueChange(f);
        if (change !== undefined) out.push(`  ${dim('change:')}   ${wrap(change, width, ' '.repeat(12))}`);
        out.push(`  ${dim('where:')}    ${locationText(f.location.anchor, o.srcRoot)}`);
        const ops = operationsOf(g.findings);
        out.push(`  ${dim('affects:')}  ${ops.slice(0, 3).join(`\n${' '.repeat(12)}`)}`);
        if (ops.length > 3) out.push(`${' '.repeat(12)}+ ${String(ops.length - 3)} more`);
        out.push(`  ${dim('why:')}      ${wrap(f.explanation, width, ' '.repeat(12))}`);
        out.push(`  ${dim('fix:')}      ${wrap(f.resolution, width, ' '.repeat(12))}`);
        out.push('');
      }
      if (groups.length > limit)
        out.push(dim(`  … ${String(groups.length - limit)} more ${classification} group(s); see the JSON report`), '');
    }
    if (
      SECTION_ORDER.some((c) => r.summary.byClassification[c] > 0 && (c === 'non-breaking' || c === 'informational')) &&
      o.verbose !== true
    ) {
      out.push('');
    }

    for (const d of r.diagnostics) {
      const where = d.location === undefined ? '' : `${locationText(d.location, o.srcRoot)}  `;
      out.push(`${paint(d.severity === 'error' ? '31' : '33', d.severity)}  ${d.code}  ${where}${d.message}`);
    }
    if (r.diagnostics.length > 0) out.push('');

    out.push(`Summary: ${summaryLine(r)}`);
    const policy =
      r.status === 'input-error'
        ? paint('31', 'Analysis failed: input error')
        : r.policy.passed
          ? paint('32', 'PASSED')
          : paint(
              '31',
              `FAILED (${String(r.policy.reasons.length)} gating finding${r.policy.reasons.length === 1 ? '' : 's'})`,
            );
    out.push(`Policy: ${policy}`);
    out.push('');
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}
