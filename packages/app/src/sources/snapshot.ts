import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  compareCodeUnits,
  diagnostic,
  documentUri,
  sha256Hex,
  type Diagnostic,
  type DocumentUri,
  type StageResult,
} from '@contractguard/core';
import { MemorySourceLoader, type LoadContext, type LoadedSource, type SourceLoader } from '@contractguard/openapi';

export const SNAPSHOT_FORMAT = 'contractguard-snapshot';

/** Baseline snapshot (§12.5): bundled *source* documents, so snapshots survive tool upgrades. */
export interface Snapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly version: 1;
  readonly createdWith: string;
  /** Path of the root document, relative to the snapshot's document base. */
  readonly root: string;
  readonly documents: readonly { readonly uri: string; readonly sha256: string; readonly content: string }[];
  /** sha256 over the document list (paths and hashes). */
  readonly sha256: string;
}

function listHash(documents: Snapshot['documents']): string {
  return sha256Hex(JSON.stringify(documents.map((d) => [d.uri, d.sha256])));
}

/** Longest common directory of URL paths (always ends with "/"). */
function commonDirectory(paths: readonly string[]): string {
  const split = paths.map((p) => p.split('/').slice(0, -1));
  const first = split[0] ?? [];
  let n = first.length;
  for (const s of split) {
    let i = 0;
    while (i < n && i < s.length && s[i] === first[i]) i++;
    n = i;
  }
  return `${first.slice(0, n).join('/')}/`;
}

/** Builds a snapshot from the loaded documents of a contract (root first). */
export function buildSnapshot(
  rootUri: DocumentUri,
  documents: readonly { readonly uri: DocumentUri; readonly bytes: Uint8Array }[],
  createdWith: string,
): StageResult<Snapshot> {
  const urls = documents.map((d) => new URL(d.uri));
  const origin = (u: URL): string => `${u.protocol}//${u.host}`;
  if (urls.some((u) => origin(u) !== origin(urls[0] as URL))) {
    return {
      diagnostics: [
        diagnostic('CGD-CONFIG-002', 'A snapshot can only bundle documents from one source (mixed origins)'),
      ],
    };
  }
  const base = commonDirectory(urls.map((u) => u.pathname));
  const rel = (u: URL): string => decodeURIComponent(u.pathname.slice(base.length));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const docs = documents
    .map((d, i) => {
      const content = decoder.decode(d.bytes);
      return { uri: rel(urls[i] as URL), sha256: sha256Hex(content), content };
    })
    .sort((a, b) => compareCodeUnits(a.uri, b.uri));
  return {
    value: {
      format: SNAPSHOT_FORMAT,
      version: 1,
      createdWith,
      root: rel(new URL(rootUri)),
      documents: docs,
      sha256: listHash(docs),
    },
    diagnostics: [],
  };
}

const SNAPSHOT_SHAPE = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  version: z.literal(1),
  createdWith: z.string(),
  root: z.string(),
  documents: z.array(z.object({ uri: z.string().min(1), sha256: z.string(), content: z.string() })).min(1),
  sha256: z.string(),
});

export interface OpenedSnapshot {
  readonly rootUri: DocumentUri;
  readonly loader: SourceLoader;
}

/** Reads and verifies a snapshot; documents are served as `snapshot://<hash>/<path>`. */
export async function openSnapshot(file: string): Promise<StageResult<OpenedSnapshot>> {
  const bad = (message: string, hint?: string): StageResult<OpenedSnapshot> => ({
    diagnostics: [diagnostic('CGD-FS-002', `Invalid snapshot ${file}: ${message}`, hint === undefined ? {} : { hint })],
  });
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const d: Diagnostic = diagnostic(code === 'ENOENT' ? 'CGD-FS-001' : 'CGD-FS-002', `Cannot read snapshot ${file}`, {
      hint: code === 'ENOENT' ? 'create one with "contractguard baseline create <spec> -o <file>"' : String(code),
    });
    return { diagnostics: [d] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return bad('not valid JSON');
  }
  const shape = SNAPSHOT_SHAPE.safeParse(json);
  if (!shape.success) return bad('unsupported format, version or document entries');
  const snap = shape.data;
  for (const d of snap.documents) {
    if (d.uri.split('/').includes('..')) return bad('malformed document entry');
    if (sha256Hex(d.content) !== d.sha256)
      return bad(`checksum mismatch for ${d.uri}`, 'the snapshot was edited by hand; recreate it');
  }
  if (listHash(snap.documents) !== snap.sha256) return bad('checksum mismatch');
  if (!snap.documents.some((d) => d.uri === snap.root)) return bad('root document missing');
  const prefix = `snapshot://${snap.sha256.slice(0, 16)}/`;
  const uriOf = (p: string): DocumentUri => documentUri(`${prefix}${p.split('/').map(encodeURIComponent).join('/')}`);
  const memory = new MemorySourceLoader(
    snap.documents.map((d) => [uriOf(d.uri), d.content] as const),
    ['snapshot:'],
  );
  const loader: SourceLoader = {
    schemes: ['snapshot:'],
    load: (uri: DocumentUri, ctx: LoadContext): Promise<StageResult<LoadedSource>> => memory.load(uri, ctx),
  };
  return { value: { rootUri: uriOf(snap.root), loader }, diagnostics: [] };
}
