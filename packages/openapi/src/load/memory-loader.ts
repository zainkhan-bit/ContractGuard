import {
  ROOT_POINTER,
  diagnostic,
  stageFail,
  stageOk,
  type DocumentUri,
  type StageResult,
} from '@zainkhan-bit/contractguard-core';
import { formatHintFromUri, type LoadContext, type LoadedSource, type SourceLoader } from './source.js';

/**
 * Serves documents from memory. Used for stdin, git blobs and snapshots (which are
 * read by @zainkhan-bit/contractguard-app and handed over as bytes), and in tests.
 */
export class MemorySourceLoader implements SourceLoader {
  readonly schemes: readonly string[];
  readonly #documents: ReadonlyMap<string, Uint8Array>;

  constructor(documents: Iterable<readonly [DocumentUri, Uint8Array | string]>, schemes: readonly string[]) {
    const encoder = new TextEncoder();
    this.#documents = new Map(
      [...documents].map(([uri, content]) => [uri, typeof content === 'string' ? encoder.encode(content) : content]),
    );
    this.schemes = schemes;
  }

  load(uri: DocumentUri, ctx: LoadContext): Promise<StageResult<LoadedSource>> {
    const side = ctx.side === undefined ? {} : { side: ctx.side };
    const bytes = this.#documents.get(uri);
    if (bytes === undefined) {
      return Promise.resolve(
        stageFail([
          diagnostic('CGD-FS-001', `Document not found: ${uri}`, { ...side, location: { uri, pointer: ROOT_POINTER } }),
        ]),
      );
    }
    if (bytes.length > ctx.limits.maxDocumentBytes) {
      return Promise.resolve(
        stageFail([
          diagnostic(
            'CGD-LIMIT-001',
            `Document is ${bytes.length} bytes, above the limit of ${ctx.limits.maxDocumentBytes}: ${uri}`,
            {
              ...side,
              location: { uri, pointer: ROOT_POINTER },
            },
          ),
        ]),
      );
    }
    const hint = formatHintFromUri(uri);
    return Promise.resolve(stageOk({ uri, bytes, ...(hint === undefined ? {} : { formatHint: hint }) }));
  }
}

/** Dispatches to the loader registered for a URI's scheme. */
export class CompositeSourceLoader implements SourceLoader {
  readonly schemes: readonly string[];
  readonly #byScheme: ReadonlyMap<string, SourceLoader>;

  constructor(loaders: readonly SourceLoader[]) {
    const map = new Map<string, SourceLoader>();
    for (const loader of loaders) for (const scheme of loader.schemes) map.set(scheme, loader);
    this.#byScheme = map;
    this.schemes = [...map.keys()];
  }

  load(uri: DocumentUri, ctx: LoadContext): Promise<StageResult<LoadedSource>> {
    const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(uri)?.[0].toLowerCase();
    const loader = scheme === undefined ? undefined : this.#byScheme.get(scheme);
    if (loader === undefined) {
      const side = ctx.side === undefined ? {} : { side: ctx.side };
      const remote = scheme === 'http:' || scheme === 'https:';
      return Promise.resolve(
        stageFail([
          remote
            ? diagnostic('CGD-REF-010', `Remote references are disabled: ${uri}`, {
                ...side,
                location: { uri, pointer: ROOT_POINTER },
                hint: 'Download the file into the repository, or enable references.allowRemote (and --allow-remote-references in CI).',
              })
            : diagnostic('CGD-REF-012', `URI scheme not allowed: ${scheme ?? '(none)'} in ${uri}`, {
                ...side,
                location: { uri, pointer: ROOT_POINTER },
              }),
        ]),
      );
    }
    return loader.load(uri, ctx);
  }
}
