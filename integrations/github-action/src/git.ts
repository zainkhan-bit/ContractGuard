import { execFile } from 'node:child_process';
import { isSafeGitRef } from '@contractguard/app';
import { InputError } from './runner.js';

interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** git with an argument array and no shell (T10); never prompts for credentials. */
export function git(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { cwd, encoding: 'utf8', maxBuffer: 1 << 24, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

const SHA = /^[0-9a-f]{40}$/i;

async function commitOf(ref: string, cwd: string): Promise<string | undefined> {
  const r = await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], cwd);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

/**
 * Makes sure the base revision exists locally and returns its SHA. The default `actions/checkout` is shallow
 * (depth 1), so the base commit is usually missing: it is fetched on its own (`contents: read` is enough).
 */
export async function ensureBaseCommit(ref: string, cwd: string, log: (line: string) => void): Promise<string> {
  if (!isSafeGitRef(ref)) throw new InputError(`Invalid base revision "${ref}"`);
  const local = await commitOf(ref, cwd);
  if (local !== undefined) return local;

  let fetch: GitResult;
  if (SHA.test(ref)) {
    log(`Fetching base commit ${ref.slice(0, 12)} (shallow checkout)`);
    fetch = await git(['fetch', '--no-tags', '--depth=1', 'origin', ref], cwd);
  } else if (ref === 'HEAD^' || ref === 'HEAD~1') {
    log('Fetching the parent commit (shallow checkout)');
    fetch = await git(['fetch', '--no-tags', '--deepen=1', 'origin'], cwd);
  } else {
    // A branch or tag name: fetch it into its remote-tracking ref so "origin/main" resolves afterwards.
    const name = ref.replace(/^origin\//, '').replace(/^refs\/heads\//, '');
    log(`Fetching ${name} from origin`);
    fetch = await git(
      ['fetch', '--no-tags', '--depth=1', 'origin', `+refs/heads/${name}:refs/remotes/origin/${name}`],
      cwd,
    );
    if (fetch.code !== 0) fetch = await git(['fetch', '--no-tags', '--depth=1', 'origin', ref], cwd);
    if (fetch.code === 0) {
      const tracked = (await commitOf(`origin/${name}`, cwd)) ?? (await commitOf('FETCH_HEAD', cwd));
      if (tracked !== undefined) return tracked;
    }
  }
  const fetched = fetch.code === 0 ? await commitOf(ref, cwd) : undefined;
  if (fetched !== undefined) return fetched;
  throw new InputError(
    `Base revision "${ref}" is not available and could not be fetched${fetch.stderr === '' ? '' : `: ${fetch.stderr.trim()}`}. ` +
      'Use actions/checkout with fetch-depth: 0, or set base-ref to a branch that exists on origin.',
  );
}
