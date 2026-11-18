import type { AnalysisResult, CompatibilityFinding, RuleDefinition, SourceRef } from '@zainkhan-bit/contractguard-core';
import { displayPath, toJsonText, type RenderOptions } from './shared.js';

export interface SarifOptions extends RenderOptions {
  /** Repository root the artifact URIs are made relative to (a `file:` URI or absolute path). */
  readonly srcRoot: string;
  /** Rule catalog for `tool.driver.rules`; when absent, rules are derived from the findings. */
  readonly rules?: readonly RuleDefinition[];
  /** Include non-breaking and informational findings (`--sarif-all`). */
  readonly all?: boolean;
  /** Base URL of the rule documentation; `<id>` is appended. */
  readonly helpUriBase?: string;
}

export const SARIF_SCHEMA =
  'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';
const INFORMATION_URI = 'https://github.com/zainkhan-bit/ContractGuard';

type Level = 'error' | 'warning' | 'note';

function levelOf(f: CompatibilityFinding): Level {
  switch (f.classification) {
    case 'breaking':
      return 'error';
    case 'potentially-breaking':
    case 'undetermined':
      return 'warning';
    case 'non-breaking':
    case 'informational':
      return 'note';
  }
}

/** A SARIF physical location; regions are 1-based and need a range. */
function physical(ref: SourceRef, srcRoot: string): Record<string, unknown> {
  const location: Record<string, unknown> = { artifactLocation: { uri: displayPath(ref.uri, srcRoot) } };
  if (ref.range !== undefined) {
    location['region'] = {
      startLine: ref.range.start.line,
      startColumn: ref.range.start.column,
      endLine: ref.range.end.line,
      endColumn: Math.max(ref.range.end.column, 1),
    };
  }
  return { physicalLocation: location };
}

/** True when the anchor only exists in the baseline (the element was removed). */
function baseOnly(f: CompatibilityFinding): boolean {
  return f.location.candidate === undefined && f.location.base !== undefined && f.location.anchor === f.location.base;
}

function resultOf(
  f: CompatibilityFinding,
  r: AnalysisResult,
  o: SarifOptions,
  ruleIndex: ReadonlyMap<string, number>,
): Record<string, unknown> {
  const related: Record<string, unknown>[] = [];
  let primary: Record<string, unknown>;
  if (baseOnly(f) && r.candidate !== undefined) {
    // Code scanning can only show candidate files: anchor to the candidate root, keep the baseline as related.
    primary = {
      physicalLocation: {
        artifactLocation: { uri: displayPath(r.candidate.rootUri, o.srcRoot) },
        region: { startLine: 1 },
      },
    };
    related.push({
      ...physical(f.location.base as SourceRef, o.srcRoot),
      message: { text: 'Baseline location (removed in the candidate)' },
    });
  } else {
    primary = physical(f.location.anchor, o.srcRoot);
    if (f.location.base !== undefined && f.location.base !== f.location.anchor) {
      related.push({ ...physical(f.location.base, o.srcRoot), message: { text: 'Baseline definition' } });
    }
  }
  for (const e of f.evidence) {
    if (e.kind === 'reference-chain' && e.location !== undefined)
      related.push({ ...physical(e.location, o.srcRoot), message: { text: e.text } });
  }
  return {
    ruleId: f.ruleId,
    ...(ruleIndex.has(f.ruleId) ? { ruleIndex: ruleIndex.get(f.ruleId) } : {}),
    level: levelOf(f),
    message: { text: `${f.message} ${f.explanation} Fix: ${f.resolution}` },
    locations: [primary],
    ...(related.length === 0 ? {} : { relatedLocations: related.map((x, id) => ({ id, ...x })) }),
    partialFingerprints: { 'contractguard/v1': f.fingerprint },
    ...(f.status === 'suppressed'
      ? { suppressions: [{ kind: 'external', justification: f.suppression?.reason ?? '', status: 'accepted' }] }
      : {}),
    properties: {
      classification: f.classification,
      severity: f.severity,
      basis: f.basis,
      perspective: f.perspective,
      ...(f.subject.operationKey === undefined ? {} : { operation: f.subject.operationKey }),
    },
  };
}

function rulesOf(results: readonly AnalysisResult[], o: SarifOptions): Record<string, unknown>[] {
  const help = (id: string): string =>
    `${o.helpUriBase ?? `${INFORMATION_URI}/blob/main/docs/rules/`}${id}${o.helpUriBase === undefined ? '.md' : ''}`;
  if (o.rules !== undefined) {
    return [...o.rules]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((rule) => ({
        id: rule.id,
        name: rule.name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ?? '').toUpperCase()),
        shortDescription: { text: rule.name },
        fullDescription: { text: `${rule.summary} ${rule.docs.rationale}` },
        helpUri: help(rule.id),
        properties: { tags: ['contractguard', rule.area.toLowerCase()] },
      }));
  }
  const seen = new Map<string, string>();
  for (const r of results) for (const f of r.findings) seen.set(f.ruleId, f.ruleName);
  return [...seen]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, name]) => ({
      id,
      shortDescription: { text: name },
      helpUri: help(id),
      properties: { tags: ['contractguard'] },
    }));
}

/**
 * SARIF 2.1.0 (§13.4): one run per spec, rules from the catalog, fingerprints for code-scanning deduplication.
 * Non-breaking and informational findings are omitted unless `all` is set.
 */
export function renderSarif(results: readonly AnalysisResult[], o: SarifOptions): string {
  const rules = rulesOf(results, o);
  const ruleIndex = new Map(rules.map((r, i) => [r['id'] as string, i]));
  const runs = results.map((r) => ({
    tool: {
      driver: {
        name: 'ContractGuard',
        semanticVersion: r.tool.version,
        informationUri: INFORMATION_URI,
        rules,
        properties: { rulesetVersion: r.tool.rulesetVersion },
      },
    },
    automationDetails: { id: `contractguard/${r.specId}/` },
    results: r.findings
      .filter((f) => o.all === true || (f.classification !== 'non-breaking' && f.classification !== 'informational'))
      .map((f) => resultOf(f, r, o, ruleIndex)),
    properties: { perspective: r.perspective, status: r.status, policyPassed: r.policy.passed },
  }));
  return `${toJsonText({ $schema: SARIF_SCHEMA, version: '2.1.0', runs })}\n`;
}
