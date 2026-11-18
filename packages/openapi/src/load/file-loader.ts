import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ROOT_POINTER,
  diagnostic,
  documentUri,
  stageFail,
  stageOk,
  type DocumentUri,
  type SourceRef,
  type StageResult,
} from '@zainkhan-bit/contractguard-core';
import { formatHintFromUri, type LoadContext, type LoadedSource, type SourceLoader } from './source.js';

/** Converts an absolute filesystem path into a canonical file: DocumentUri. */
export function fileUri(absolutePath: string): DocumentUri {
  return documentUri(pathToFileURL(absolutePath).href);
}

/**
 * True if `target` is `root` or inside it. Both must be absolute, already-realpath'd paths.
 * `path.relative` is case-insensitive on Windows.
 */
export function isPathInside(root: string, target: string, pathApi: typeof path = path): boolean {
  const rel = pathApi.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !pathApi.isAbsolute(rel));
}

/** Windows-specific path shapes that are never accepted from references (§16.2 T6). */
export function isForbiddenWindowsPath(p: string): boolean {
  // UNC / device paths: \\server\share, \\?\C:\..., \\.\pipe\...
  if (/^[\\/]{2}/.test(p)) return true;
  // Alternate data streams: any ":" other than the drive-letter colon.
  const withoutDrive = p.replace(/^[A-Za-z]:/, '');
  return withoutDrive.includes(':');
}

function at(uri: DocumentUri): SourceRef {
  return { uri, pointer: ROOT_POINTER };
}

/**
 * Loads local files. Enforces root confinement (after resolving symlinks),
 * regular-file checks and size limits before reading any content.
 */
export class FileSourceLoader implements SourceLoader {
  readonly schemes: readonly string[] = ['file:'];
  readonly #platform: NodeJS.Platform;

  constructor(options: { readonly platform?: NodeJS.Platform } = {}) {
    this.#platform = options.platform ?? process.platform;
  }

  async load(uri: DocumentUri, ctx: LoadContext): Promise<StageResult<LoadedSource>> {
    const side = ctx.side === undefined ? {} : { side: ctx.side };
    let filePath: string;
    try {
      filePath = fileURLToPath(uri);
    } catch {
      return stageFail([diagnostic('CGD-FS-001', `Not a valid file URI: ${uri}`, { ...side, location: at(uri) })]);
    }
    if (this.#platform === 'win32' && isForbiddenWindowsPath(filePath)) {
      return stageFail([
        diagnostic('CGD-REF-013', `Path form is not allowed (UNC path or alternate data stream): ${filePath}`, {
          ...side,
          location: at(uri),
        }),
      ]);
    }

    let real: string;
    let root: string;
    try {
      root = await realpath(ctx.policy.root);
    } catch {
      return stageFail([
        diagnostic('CGD-FS-001', `references.root does not exist: ${ctx.policy.root}`, { ...side, location: at(uri) }),
      ]);
    }
    try {
      real = await realpath(filePath);
    } catch (error) {
      return stageFail([fsDiagnostic(error, filePath, uri, side)]);
    }
    if (!isPathInside(root, real)) {
      return stageFail([
        diagnostic('CGD-REF-013', `File is outside references.root: ${filePath}`, {
          ...side,
          location: at(uri),
          hint: `Only files under ${root} may be read. Adjust references.root if this is intended.`,
        }),
      ]);
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(real, 'r');
      const stat = await handle.stat();
      if (!stat.isFile()) {
        return stageFail([diagnostic('CGD-FS-002', `Not a regular file: ${filePath}`, { ...side, location: at(uri) })]);
      }
      if (stat.size > ctx.limits.maxDocumentBytes) {
        return stageFail([
          diagnostic(
            'CGD-LIMIT-001',
            `Document is ${stat.size} bytes, above the limit of ${ctx.limits.maxDocumentBytes}: ${filePath}`,
            { ...side, location: at(uri), hint: 'Raise analysis.limits.maxDocumentBytes if this file is legitimate.' },
          ),
        ]);
      }
      const bytes = new Uint8Array(await handle.readFile());
      const hint = formatHintFromUri(uri);
      return stageOk({ uri: fileUri(real), bytes, ...(hint === undefined ? {} : { formatHint: hint }) });
    } catch (error) {
      return stageFail([fsDiagnostic(error, filePath, uri, side)]);
    } finally {
      await handle?.close();
    }
  }
}

function fsDiagnostic(
  error: unknown,
  filePath: string,
  uri: DocumentUri,
  side: { readonly side?: 'base' | 'candidate' },
): ReturnType<typeof diagnostic> {
  const code = (error as { code?: unknown }).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return diagnostic('CGD-FS-001', `File not found: ${filePath}`, { ...side, location: at(uri) });
  }
  if (code === 'EISDIR') {
    return diagnostic('CGD-FS-002', `Not a regular file: ${filePath}`, { ...side, location: at(uri) });
  }
  return diagnostic('CGD-FS-003', `Could not read ${filePath} (${typeof code === 'string' ? code : 'unknown error'})`, {
    ...side,
    location: at(uri),
  });
}
