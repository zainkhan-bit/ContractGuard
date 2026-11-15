import {
  DEFAULT_LIMITS,
  documentUri,
  type ApiContract,
  type ContractChange,
  type ReferencePolicy,
} from '@contractguard/core';
import {
  MemorySourceLoader,
  detectVersion,
  loadContract,
  normalize,
  parseDocument,
  resolveReferences,
} from '@contractguard/openapi';
import { diffContracts } from '../src/diff/contract-diff.js';

export const ROOT = documentUri('file:///api/openapi.yaml');
const POLICY: ReferencePolicy = {
  root: '/',
  allowRemote: false,
  allowedHosts: [],
  allowedSchemes: ['https'],
  fetchTimeoutMs: 1000,
  maxRemoteBytes: 1,
};

/** Loads a contract strictly (spec errors fail the test). */
export async function contract(text: string, extra: Record<string, string> = {}): Promise<ApiContract> {
  const loader = new MemorySourceLoader(
    [[ROOT, text], ...Object.entries(extra).map(([k, v]) => [documentUri(k), v] as const)],
    ['file:'],
  );
  const r = await loadContract(ROOT, { loader, policy: POLICY, limits: DEFAULT_LIMITS, validator: false });
  if (r.value === undefined) throw new Error(r.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'));
  return r.value.contract;
}

/** Loads a contract leniently: unresolved references become placeholder nodes. */
export async function lenientContract(text: string): Promise<ApiContract> {
  const loader = new MemorySourceLoader([[ROOT, text]], ['file:']);
  const ctx = { policy: POLICY, limits: DEFAULT_LIMITS };
  const loaded = await loader.load(ROOT, ctx);
  const doc = parseDocument(loaded.value as never, { limits: DEFAULT_LIMITS }).value as never;
  const version = detectVersion(doc).value as never;
  const set = await resolveReferences(doc, (version as { dialect: 'oas30' }).dialect, { loader, ctx });
  return normalize(set.value as never, version, { limits: DEFAULT_LIMITS }).value as ApiContract;
}

export async function diff(
  base: string,
  candidate: string,
  maxSchemaPairs = DEFAULT_LIMITS.maxSchemaPairs,
): Promise<ContractChange[]> {
  return [...diffContracts(await contract(base), await contract(candidate), { limits: { maxSchemaPairs } }).changes];
}

/** Compact one-line rendering of a change, for readable assertions. */
export function brief(c: ContractChange): string {
  const path = c.subject.schemaPath
    .map((s) =>
      s.kind === 'property'
        ? s.name
        : s.kind === 'variant'
          ? `${s.composition}[${s.matchKey}]`
          : s.kind === 'discriminatorMapping'
            ? s.value
            : s.kind,
    )
    .join('.');
  const site = c.subject.site;
  const where =
    site.kind === 'parameter'
      ? `param ${site.key}`
      : site.kind === 'requestBody'
        ? `body${site.mediaType === undefined ? '' : ` ${site.mediaType}`}`
        : site.kind === 'response'
          ? `res ${site.status}${site.mediaType === undefined ? '' : ` ${site.mediaType}`}`
          : site.kind === 'responseHeader'
            ? `res ${site.status} header ${site.header}`
            : site.kind;
  return `${c.subject.operationKey ?? '-'} | ${where}${path === '' ? '' : ` | ${path}`} | ${c.kind} ${JSON.stringify(c.facts)}`;
}

export const HEAD30 = 'openapi: 3.0.3\ninfo: {title: t, version: v}\n';
export const HEAD31 = 'openapi: 3.1.0\ninfo: {title: t, version: v}\n';
