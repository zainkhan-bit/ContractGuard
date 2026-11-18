import { diagnostic, documentUri, type DocumentUri, type StageResult } from '@zainkhan-bit/contractguard-core';
import {
  CompositeSourceLoader,
  FileSourceLoader,
  MemorySourceLoader,
  RemoteSourceLoader,
  fileUri,
  type SourceLoader,
} from '@zainkhan-bit/contractguard-openapi';
import { GitSourceLoader, resolveGitSource } from './git.js';
import { openSnapshot } from './snapshot.js';
import { describeSpecifier, type SourceSpecifier } from './specifier.js';

export interface OpenedSource {
  readonly rootUri: DocumentUri;
  readonly loader: SourceLoader;
  /** Human-readable revision, e.g. `git:origin/main@3f2a9c1`, `working tree`. */
  readonly revision: string;
}

/** stdin documents must be self-contained: relative references resolve under stdin:/// and are not found. */
export const STDIN_URI: DocumentUri = documentUri('stdin:///openapi');

/** Opens a source: resolves git refs to SHAs, verifies snapshots, and returns a loader for its documents. */
export async function openSource(
  spec: SourceSpecifier,
  options: { readonly stdinText?: string; readonly signal?: AbortSignal } = {},
): Promise<StageResult<OpenedSource>> {
  const remote = new RemoteSourceLoader();
  switch (spec.kind) {
    case 'path':
      return {
        value: {
          rootUri: fileUri(spec.path),
          loader: new CompositeSourceLoader([new FileSourceLoader(), remote]),
          revision: describeSpecifier(spec),
        },
        diagnostics: [],
      };
    case 'git': {
      const r = await resolveGitSource(spec.ref, spec.path, spec.cwd, options.signal);
      if (r.value === undefined) return { diagnostics: r.diagnostics };
      return {
        value: {
          rootUri: r.value.uri,
          loader: new CompositeSourceLoader([new GitSourceLoader(r.value.toplevel), remote]),
          revision: describeSpecifier(spec, r.value.sha),
        },
        diagnostics: [],
      };
    }
    case 'snapshot': {
      const s = await openSnapshot(spec.file);
      if (s.value === undefined) return { diagnostics: s.diagnostics };
      return {
        value: { rootUri: s.value.rootUri, loader: s.value.loader, revision: describeSpecifier(spec) },
        diagnostics: [],
      };
    }
    case 'url':
      return {
        value: {
          rootUri: documentUri(spec.url),
          loader: new CompositeSourceLoader([remote]),
          revision: describeSpecifier(spec),
        },
        diagnostics: [],
      };
    case 'stdin':
      if (options.stdinText === undefined) {
        return {
          diagnostics: [
            diagnostic('CGD-FS-001', 'No input on stdin', { hint: '"-" reads the candidate from standard input' }),
          ],
        };
      }
      return {
        value: {
          rootUri: STDIN_URI,
          loader: new CompositeSourceLoader([new MemorySourceLoader([[STDIN_URI, options.stdinText]], ['stdin:'])]),
          revision: describeSpecifier(spec),
        },
        diagnostics: [],
      };
  }
}
