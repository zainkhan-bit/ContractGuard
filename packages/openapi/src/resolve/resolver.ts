import {
  ROOT_POINTER,
  appendPointer,
  compareCodeUnits,
  diagnostic,
  documentUri,
  isCanonicalArray,
  isCanonicalObject,
  pointerFromUriFragment,
  pointerSegments,
  stageOk,
  type CanonicalJson,
  type Diagnostic,
  type DocumentUri,
  type JsonPointer,
  type OasDialect,
  type SourceRef,
  type StageResult,
} from '@zainkhan-bit/contractguard-core';
import type { LoadContext, SourceLoader } from '../load/source.js';
import { parseDocument, type ParsedDocument } from '../parse/parser.js';
import { walkReferences, type RefSite } from './walk.js';

export type ResolvedReference =
  | {
      readonly status: 'resolved';
      readonly site: SourceRef;
      readonly target: SourceRef;
      readonly raw: string;
      readonly kind: 'ref' | 'dynamicRef';
      readonly siblingKeys: readonly string[];
    }
  | {
      readonly status: 'unresolved' | 'forbidden';
      readonly site: SourceRef;
      readonly raw: string;
      readonly kind: 'ref' | 'dynamicRef';
      readonly siblingKeys: readonly string[];
      readonly diagnostic: Diagnostic;
    };

export interface DocumentSet {
  readonly root: DocumentUri;
  readonly dialect: OasDialect;
  /** In load order (root first, then breadth-first, deterministic). */
  readonly documents: ReadonlyMap<DocumentUri, ParsedDocument>;
  /** Keyed by site: `${documentUri}${sitePointer}`. */
  readonly references: ReadonlyMap<string, ResolvedReference>;
  /** Absolute `$id` / `$anchor` URIs → location (3.1 only). */
  readonly identifiers: ReadonlyMap<string, SourceRef>;
  /** Total bytes of all loaded documents. */
  readonly totalBytes: number;
}

export function siteKey(uri: DocumentUri, pointer: JsonPointer): string {
  return `${uri}${pointer}`;
}

/** Reads the value at a pointer inside canonical JSON, or undefined. */
export function valueAt(root: CanonicalJson, pointer: JsonPointer): CanonicalJson | undefined {
  let current: CanonicalJson | undefined = root;
  for (const segment of pointerSegments(pointer)) {
    if (current === undefined) return undefined;
    if (isCanonicalArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (isCanonicalObject(current)) {
      current = Object.hasOwn(current, segment) ? current[segment] : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}

/** Locates a pointer inside a parsed document (with its source range when indexed). */
export function locate(doc: ParsedDocument, pointer: JsonPointer): SourceRef {
  const range = doc.index.rangeOf(pointer)?.value;
  return range === undefined ? { uri: doc.uri, pointer } : { uri: doc.uri, pointer, range };
}

function stripFragment(uri: string): string {
  const hash = uri.indexOf('#');
  return hash === -1 ? uri : uri.slice(0, hash);
}

export interface ResolveOptions {
  readonly loader: SourceLoader;
  readonly ctx: LoadContext;
}

/**
 * Builds the complete, policy-enforced document set for a root document (§8.5).
 * References are recorded as edges; nothing is inlined. Documents are loaded in a
 * deterministic order (sorted per round), so results never depend on I/O timing.
 */
export async function resolveReferences(
  root: ParsedDocument,
  dialect: OasDialect,
  options: ResolveOptions,
): Promise<StageResult<DocumentSet>> {
  const side = options.ctx.side === undefined ? {} : { side: options.ctx.side };
  const diagnostics: Diagnostic[] = [];
  const documents = new Map<DocumentUri, ParsedDocument>([[root.uri, root]]);
  /** Requested document URI → canonical URI actually loaded (e.g. after symlink resolution). */
  const aliases = new Map<string, DocumentUri>([[root.uri, root.uri]]);
  const loadFailures = new Map<string, Diagnostic>();
  const identifiers = new Map<string, SourceRef>();
  const sites: { readonly doc: ParsedDocument; readonly ref: RefSite }[] = [];
  let totalBytes = root.bytes;

  const scan = (doc: ParsedDocument): void => {
    const walked = walkReferences(doc.value, doc.uri, dialect);
    for (const id of walked.identifiers) {
      if (!identifiers.has(id.uri)) identifiers.set(id.uri, locate(doc, id.pointer));
    }
    for (const ref of walked.refs) {
      sites.push({ doc, ref });
      if (dialect === 'oas30' && ref.siblingKeys.some((k) => !k.startsWith('x-'))) {
        diagnostics.push(
          diagnostic(
            'CGD-SPEC-101',
            `Keywords next to $ref are ignored in OpenAPI 3.0: ${ref.siblingKeys.join(', ')}`,
            {
              ...side,
              location: locate(doc, ref.site),
            },
          ),
        );
      }
    }
  };
  scan(root);

  // Load referenced documents round by round until no new documents are needed.
  let scannedSites = 0;
  for (;;) {
    const needed = new Set<string>();
    for (; scannedSites < sites.length; scannedSites++) {
      const { ref } = sites[scannedSites] as (typeof sites)[number];
      let target: string;
      try {
        target = stripFragment(new URL(ref.raw, ref.base).href);
      } catch {
        continue; // reported during resolution
      }
      if (!aliases.has(target) && !identifiers.has(target) && !loadFailures.has(target)) needed.add(target);
    }
    if (needed.size === 0) break;
    for (const target of [...needed].sort(compareCodeUnits)) {
      if (documents.size >= options.ctx.limits.maxDocuments) {
        loadFailures.set(
          target,
          diagnostic('CGD-LIMIT-004', `More than ${options.ctx.limits.maxDocuments} referenced documents`, {
            ...side,
            location: { uri: documentUri(target), pointer: ROOT_POINTER },
          }),
        );
        continue;
      }
      const loaded = await options.loader.load(documentUri(target), options.ctx);
      if (loaded.value === undefined) {
        loadFailures.set(target, loaded.diagnostics[0] ?? diagnostic('CGD-FS-003', `Could not load ${target}`, side));
        continue;
      }
      const existing = documents.get(loaded.value.uri);
      if (existing !== undefined) {
        aliases.set(target, existing.uri);
        continue;
      }
      if (totalBytes + loaded.value.bytes.length > options.ctx.limits.maxTotalBytes) {
        loadFailures.set(
          target,
          diagnostic(
            'CGD-LIMIT-002',
            `Referenced documents exceed maxTotalBytes (${options.ctx.limits.maxTotalBytes})`,
            {
              ...side,
              location: { uri: loaded.value.uri, pointer: ROOT_POINTER },
            },
          ),
        );
        continue;
      }
      const parsed = parseDocument(loaded.value, { limits: options.ctx.limits, ...side });
      if (parsed.value === undefined) {
        loadFailures.set(target, parsed.diagnostics[0] as Diagnostic);
        diagnostics.push(...parsed.diagnostics.slice(1));
        continue;
      }
      totalBytes += parsed.value.bytes;
      documents.set(parsed.value.uri, parsed.value);
      aliases.set(target, parsed.value.uri);
      scan(parsed.value);
    }
  }

  // Resolve every site.
  const references = new Map<string, ResolvedReference>();
  const reported = new Set<string>();
  for (const { doc, ref } of sites) {
    const site = locate(doc, ref.site);
    const common = { site, raw: ref.raw, kind: ref.kind, siblingKeys: ref.siblingKeys };
    const fail = (status: 'unresolved' | 'forbidden', d: Diagnostic): void => {
      const located: Diagnostic = { ...d, location: site };
      references.set(siteKey(doc.uri, ref.site), { status, ...common, diagnostic: located });
      const key = `${d.code}|${siteKey(doc.uri, ref.site)}`;
      if (!reported.has(key)) {
        reported.add(key);
        diagnostics.push(located);
      }
    };

    let url: URL;
    try {
      url = new URL(ref.raw, ref.base);
    } catch {
      fail('unresolved', diagnostic('CGD-REF-001', `Invalid reference URI: ${ref.raw}`, side));
      continue;
    }
    const docPart = stripFragment(url.href);
    const fragment = url.hash === '' ? '' : url.hash.slice(1);

    const failure = loadFailures.get(docPart);
    if (failure !== undefined) {
      const forbidden = failure.category === 'reference' || failure.category === 'limit';
      fail(forbidden ? 'forbidden' : 'unresolved', {
        ...failure,
        message: `Cannot resolve ${ref.raw}: ${failure.message}`,
      });
      continue;
    }

    // Base location: an identified subschema ($id) or a whole document.
    let baseLocation: { readonly doc: ParsedDocument; readonly pointer: JsonPointer } | undefined;
    const idLocation = identifiers.get(docPart);
    if (idLocation !== undefined) {
      const idDoc = documents.get(idLocation.uri);
      if (idDoc !== undefined) baseLocation = { doc: idDoc, pointer: idLocation.pointer };
    }
    if (baseLocation === undefined) {
      const actual = aliases.get(docPart);
      const targetDoc = actual === undefined ? undefined : documents.get(actual);
      if (targetDoc !== undefined) baseLocation = { doc: targetDoc, pointer: ROOT_POINTER };
    }
    if (baseLocation === undefined) {
      fail('unresolved', diagnostic('CGD-REF-001', `Unresolved reference ${ref.raw}`, side));
      continue;
    }

    let targetPointer: JsonPointer;
    let targetDoc = baseLocation.doc;
    if (fragment === '' || fragment.startsWith('/') || fragment.startsWith('%2F') || fragment.startsWith('%2f')) {
      const relative = pointerFromUriFragment(fragment);
      if (relative === undefined) {
        fail('unresolved', diagnostic('CGD-REF-002', `Invalid JSON pointer in reference ${ref.raw}`, side));
        continue;
      }
      targetPointer = appendPointer(baseLocation.pointer, ...pointerSegments(relative));
    } else {
      // Plain-name fragment: a 3.1 $anchor / $dynamicAnchor.
      let anchor: string;
      try {
        anchor = decodeURIComponent(fragment);
      } catch {
        fail('unresolved', diagnostic('CGD-REF-002', `Invalid fragment in reference ${ref.raw}`, side));
        continue;
      }
      const anchorBase = idLocation !== undefined ? docPart : baseLocation.doc.uri;
      const anchored = dialect === 'oas31' ? identifiers.get(`${anchorBase}#${anchor}`) : undefined;
      if (anchored === undefined) {
        fail(
          'unresolved',
          diagnostic(
            dialect === 'oas31' ? 'CGD-REF-001' : 'CGD-REF-002',
            dialect === 'oas31'
              ? `Unresolved anchor "#${anchor}" in reference ${ref.raw}`
              : `Plain-name fragments ("#${anchor}") are not valid in OpenAPI 3.0 references`,
            side,
          ),
        );
        continue;
      }
      targetDoc = documents.get(anchored.uri) ?? targetDoc;
      targetPointer = anchored.pointer;
    }

    if (valueAt(targetDoc.value, targetPointer) === undefined) {
      fail(
        'unresolved',
        diagnostic('CGD-REF-001', `Unresolved reference ${ref.raw}: nothing at ${targetPointer}`, side),
      );
      continue;
    }
    references.set(siteKey(doc.uri, ref.site), {
      status: 'resolved',
      ...common,
      target: locate(targetDoc, targetPointer),
    });
  }

  const set: DocumentSet = {
    root: root.uri,
    dialect,
    documents,
    references: new Map([...references].sort(([a], [b]) => compareCodeUnits(a, b))),
    identifiers: new Map([...identifiers].sort(([a], [b]) => compareCodeUnits(a, b))),
    totalBytes,
  };
  return diagnostics.some((d) => d.severity === 'error') ? { value: set, diagnostics } : stageOk(set, diagnostics);
}

/** Convenience for callers that need failure semantics without the partial set. */
export function hasUnresolved(set: DocumentSet): boolean {
  for (const r of set.references.values()) if (r.status !== 'resolved') return true;
  return false;
}
