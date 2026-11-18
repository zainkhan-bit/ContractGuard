import { readFile } from 'node:fs/promises';
import { InputError, type RunnerIo } from './runner.js';

const ZERO_SHA = /^0{40}$/;

export interface ActionContext {
  readonly event: string;
  /** Revision the specs are compared against (a SHA from the event, or the `base-ref` input). */
  readonly base: string;
  /** Where `base` came from, for messages. */
  readonly baseSource: 'input' | 'pull_request' | 'push' | 'parent';
  readonly headSha: string;
  readonly repository: string;
  readonly serverUrl: string;
  readonly apiUrl: string;
  readonly workspace: string;
  readonly prNumber?: number;
  /**
   * False for pull requests from forks (and Dependabot): their GITHUB_TOKEN is read-only, so a comment would fail.
   */
  readonly canComment: boolean;
  readonly warnings: readonly string[];
}

interface EventPayload {
  readonly before?: string;
  readonly repository?: { readonly full_name?: string };
  readonly pull_request?: {
    readonly number?: number;
    readonly base?: { readonly sha?: string };
    readonly head?: { readonly sha?: string; readonly repo?: { readonly full_name?: string } | null };
  };
}

async function readEvent(path: string | undefined): Promise<EventPayload> {
  if (path === undefined || path === '') return {};
  try {
    return JSON.parse(await readFile(path, 'utf8')) as EventPayload;
  } catch {
    return {};
  }
}

/** Reads the workflow event and decides the base revision (§13.6 event handling). */
export async function readContext(io: RunnerIo, baseRefInput: string): Promise<ActionContext> {
  const env = io.env;
  const event = env['GITHUB_EVENT_NAME'] ?? '';
  const payload = await readEvent(env['GITHUB_EVENT_PATH']);
  const repository = env['GITHUB_REPOSITORY'] ?? payload.repository?.full_name ?? '';
  const warnings: string[] = [];
  const pr = payload.pull_request;
  const isPr = (event === 'pull_request' || event === 'pull_request_target') && pr !== undefined;

  if (event === 'pull_request_target') {
    warnings.push(
      'pull_request_target runs with a privileged token. ContractGuard only reads the specifications as data, ' +
        'but the recommended trigger is pull_request (see the README).',
    );
  }

  let base: string | undefined;
  let baseSource: ActionContext['baseSource'] = 'input';
  if (baseRefInput !== '') {
    base = baseRefInput;
  } else if (isPr && pr.base?.sha !== undefined) {
    base = pr.base.sha;
    baseSource = 'pull_request';
  } else if (event === 'push' && payload.before !== undefined && !ZERO_SHA.test(payload.before)) {
    base = payload.before;
    baseSource = 'push';
  } else if (event === 'push') {
    // First push of a new branch: no "before" commit. Compare with the parent commit.
    base = 'HEAD^';
    baseSource = 'parent';
    warnings.push('This push created the branch, so there is no previous commit in the event; comparing with HEAD^.');
  }
  if (base === undefined) {
    throw new InputError(
      `Cannot tell what to compare against for the "${event || 'unknown'}" event. Set the base-ref input ` +
        '(for example base-ref: origin/main) or run the Action on pull_request or push.',
    );
  }

  const headRepo = pr?.head?.repo?.full_name;
  const fromFork = isPr && headRepo !== undefined && headRepo !== repository;
  const actor = env['GITHUB_ACTOR'] ?? '';
  const canComment = isPr && !fromFork && actor !== 'dependabot[bot]';

  return {
    event,
    base,
    baseSource,
    headSha: (isPr ? pr.head?.sha : undefined) ?? env['GITHUB_SHA'] ?? 'HEAD',
    repository,
    serverUrl: env['GITHUB_SERVER_URL'] ?? 'https://github.com',
    apiUrl: env['GITHUB_API_URL'] ?? 'https://api.github.com',
    workspace: env['GITHUB_WORKSPACE'] ?? process.cwd(),
    ...(isPr && typeof pr.number === 'number' ? { prNumber: pr.number } : {}),
    canComment,
    warnings,
  };
}
