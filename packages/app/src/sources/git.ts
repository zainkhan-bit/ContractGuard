import { execFile } from 'node:child_process';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import {
  diagnostic,
  documentUri,
  type Diagnostic,
  type DocumentUri,
  type StageResult,
} from '@zainkhan-bit/contractguard-core';
import {
  formatHintFromUri,
  type LoadContext,
  type LoadedSource,
  type SourceLoader,
} from '@zainkhan-bit/contractguard-openapi';
import { isSafeGitRef } from './specifier.js';

interface GitResult {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly code: number | string | null;
}

/** Runs git with an argument array (never a shell). */
function git(args: readonly string[], cwd: string, maxBuffer: number, signal?: AbortSignal): Promise<GitResult> {
  return new Promise((done) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        encoding: 'buffer',
        maxBuffer,
        windowsHide: true,
        ...(signal === undefined ? {} : { signal }),
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : ((error as NodeJS.ErrnoException).code ?? (error as { status?: number }).status ?? 1);
        done({ stdout: Buffer.from(stdout), stderr: Buffer.from(stderr).toString('utf8').trim(), code });
      },
    );
  });
}

export interface ResolvedGitSource {
  readonly sha: string;
  readonly toplevel: string;
  /** Repository-relative POSIX path of the root document. */
  readonly path: string;
  readonly uri: DocumentUri;
}

/** git://<sha>/<repo-relative path> */
export function gitUri(sha: string, repoPath: string): DocumentUri {
  return documentUri(`git://${sha}/${repoPath.split('/').map(encodeURIComponent).join('/')}`);
}

/** Resolves `git:<ref>:<path>` (path relative to cwd) to a commit SHA and a repository path. */
export async function resolveGitSource(
  ref: string,
  path: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<StageResult<ResolvedGitSource>> {
  if (!isSafeGitRef(ref)) return { diagnostics: [diagnostic('CGD-FS-012', `Invalid git reference "${ref}"`)] };
  const top = await git(['rev-parse', '--show-toplevel'], cwd, 1 << 20, signal);
  if (top.code === 'ENOENT') {
    return {
      diagnostics: [
        diagnostic('CGD-FS-010', 'git is not available', {
          hint: 'install git, or compare against a file or snapshot: instead',
        }),
      ],
    };
  }
  if (top.code !== 0)
    return { diagnostics: [diagnostic('CGD-FS-011', `Not inside a git repository: ${cwd}`, { hint: top.stderr })] };
  const toplevel = top.stdout.toString('utf8').trim();
  const rev = await git(
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
    cwd,
    1 << 20,
    signal,
  );
  if (rev.code !== 0) {
    return {
      diagnostics: [
        diagnostic('CGD-FS-011', `git revision "${ref}" not found`, {
          hint: 'in CI, fetch enough history (actions/checkout with fetch-depth: 0) or fetch the base branch',
        }),
      ],
    };
  }
  const sha = rev.stdout.toString('utf8').trim();
  // Path relative to the repository root (git paths are relative to the top level, not the cwd). The cwd's own
  // prefix comes from git rather than from comparing path strings: on Windows the temp/home directory can be an
  // 8.3 short name (RUNNER~1) or differ in case/separators from what `--show-toplevel` prints.
  const prefix = await git(['rev-parse', '--show-prefix'], cwd, 1 << 20, signal);
  const fromCwd = relative(cwd, resolve(cwd, path)).split(sep).join('/');
  const repoPath = posix.normalize(`${prefix.stdout.toString('utf8').trim()}${fromCwd}`);
  if (prefix.code !== 0 || repoPath.startsWith('../') || repoPath === '..' || repoPath === '.' || isAbsolute(fromCwd)) {
    return { diagnostics: [diagnostic('CGD-FS-011', `Path is outside the git repository: ${path}`)] };
  }
  return { value: { sha, toplevel, path: repoPath, uri: gitUri(sha, repoPath) }, diagnostics: [] };
}

/** Serves `git://<sha>/<path>` documents with `git show <sha>:<path>` (relative $refs resolve within the commit). */
export class GitSourceLoader implements SourceLoader {
  readonly schemes: readonly string[] = ['git:'];
  readonly #toplevel: string;

  constructor(toplevel: string) {
    this.#toplevel = toplevel;
  }

  async load(uri: DocumentUri, ctx: LoadContext): Promise<StageResult<LoadedSource>> {
    const side = ctx.side === undefined ? {} : { side: ctx.side };
    const fail = (d: Diagnostic): StageResult<LoadedSource> => ({ diagnostics: [d] });
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      return fail(diagnostic('CGD-FS-011', `Invalid git document URI ${uri}`, side));
    }
    const sha = url.host;
    const path = url.pathname
      .split('/')
      .filter((s) => s !== '')
      .map(decodeURIComponent)
      .join('/');
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) || path === '' || path.split('/').includes('..')) {
      return fail(diagnostic('CGD-REF-013', `Git reference outside the repository: ${uri}`, side));
    }
    const shown = await git(
      ['show', '--end-of-options', `${sha}:${path}`],
      this.#toplevel,
      ctx.limits.maxDocumentBytes + 1,
      ctx.signal,
    );
    if (shown.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return fail(diagnostic('CGD-LIMIT-001', `Document exceeds maxDocumentBytes: ${uri}`, side));
    }
    if (shown.code !== 0) return fail(diagnostic('CGD-FS-001', `${path} not found at ${sha.slice(0, 7)}`, side));
    const formatHint = formatHintFromUri(uri);
    return {
      value: { uri, bytes: new Uint8Array(shown.stdout), ...(formatHint === undefined ? {} : { formatHint }) },
      diagnostics: [],
    };
  }
}

/** The default branch of `origin`, if known (for `init`). */
export async function defaultBranch(cwd: string): Promise<string | undefined> {
  const r = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd, 1 << 16);
  const remote = r.code === 0 ? r.stdout.toString('utf8').trim() : '';
  if (remote !== '') return remote;
  // No origin/HEAD (fresh clone without it, or no remote): fall back to the first existing well-known branch.
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const v = await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], cwd, 1 << 16);
    if (v.code === 0) return ref;
  }
  return undefined;
}
