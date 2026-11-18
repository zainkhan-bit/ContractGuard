import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll } from 'vitest';
import type { RunnerIo } from '../src/runner.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

export function tempDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cg-action-')));
  dirs.push(d);
  return d;
}

export function write(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd: dir,
      encoding: 'utf8',
    },
  ).trim();
}

export interface Sandbox {
  /** Shallow (depth 1) clone of the last commit: what actions/checkout gives a job. */
  readonly workspace: string;
  /** One SHA per commit, in order. */
  readonly shas: readonly string[];
  readonly root: string;
}

/** A repository with one commit per entry, a bare "origin", and a depth-1 clone as the workspace. */
export function sandbox(commits: readonly Readonly<Record<string, string>>[], branch = 'main'): Sandbox {
  const root = tempDir();
  const src = join(root, 'src');
  mkdirSync(src);
  git(src, 'init', '-q', '-b', branch);
  const shas = commits.map((files, i) => {
    write(src, files);
    git(src, 'add', '-A');
    git(src, 'commit', '-q', '-m', `c${String(i)}`);
    return git(src, 'rev-parse', 'HEAD');
  });
  git(root, 'clone', '-q', '--bare', src, 'origin.git');
  const url = `file://${join(root, 'origin.git')
    .replaceAll('\\', '/')
    .replace(/^([A-Za-z]):/, '/$1:')}`;
  git(root, 'clone', '-q', '--depth=1', `--branch=${branch}`, url, 'ws');
  return { workspace: join(root, 'ws'), shas, root };
}

export const SPEC = (opts: { readonly requiredAge?: boolean; readonly tag?: boolean } = {}): string => `openapi: 3.1.0
info: {title: Pets, version: 1.0.0}
paths:
  /pets/{id}:
    get:
      parameters:
        - {name: id, in: path, required: true, schema: {type: string}}
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: {type: string}
${opts.tag === false ? '' : '                  tag: {type: string}\n'}  /pets:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
${opts.requiredAge === true ? '              required: [age]\n' : ''}              properties:
                age: {type: integer}
      responses:
        '201': {description: created}
`;

export interface FakeRunner extends RunnerIo {
  readonly log: () => string;
  readonly outputs: () => Record<string, string>;
  readonly summary: () => string;
  readonly dir: string;
}

/** A runner environment: env files in a temp dir, captured stdout, `inputs` as INPUT_* variables. */
export function fakeRunner(
  workspace: string,
  event: { readonly name: string; readonly payload: unknown },
  inputs: Readonly<Record<string, string>> = {},
  extraEnv: Readonly<Record<string, string>> = {},
): FakeRunner {
  const dir = tempDir();
  const eventPath = join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event.payload));
  writeFileSync(join(dir, 'output'), '');
  writeFileSync(join(dir, 'summary'), '');
  const env: Record<string, string> = {
    GITHUB_EVENT_NAME: event.name,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: 'octo/api',
    GITHUB_WORKSPACE: workspace,
    GITHUB_OUTPUT: join(dir, 'output'),
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.test',
    GITHUB_RUN_ID: '99',
    GITHUB_SHA: 'f'.repeat(40),
    RUNNER_TEMP: dir,
    ...extraEnv,
  };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  let out = '';
  return {
    env,
    dir,
    write: (t) => {
      out += t;
    },
    log: () => out,
    summary: () => readFileSync(join(dir, 'summary'), 'utf8'),
    outputs: () => {
      const text = readFileSync(join(dir, 'output'), 'utf8');
      const result: Record<string, string> = {};
      const re = /^([\w-]+)<<(ghadelimiter_[\w-]+)\n([\s\S]*?)\n\2$/gm;
      for (const m of text.matchAll(re)) result[m[1] as string] = m[3] as string;
      return result;
    },
  };
}

export function prEvent(
  base: string,
  opts: { readonly number?: number; readonly headRepo?: string } = {},
): { name: string; payload: unknown } {
  return {
    name: 'pull_request',
    payload: {
      repository: { full_name: 'octo/api' },
      pull_request: {
        number: opts.number ?? 7,
        base: { sha: base },
        head: { sha: 'e'.repeat(40), repo: { full_name: opts.headRepo ?? 'octo/api' } },
      },
    },
  };
}

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body?: unknown;
}

/** A scripted GitHub REST API: issue comments kept in memory. */
export function fakeGitHub(initial: { id: number; body: string }[] = []): {
  fetch: typeof fetch;
  calls: Call[];
  comments: { id: number; body: string }[];
} {
  const comments = [...initial];
  const calls: Call[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { body: string }) : undefined;
    calls.push({ method, url, ...(body === undefined ? {} : { body }) });
    if (method === 'GET') return Promise.resolve(Response.json(comments));
    if (method === 'POST') {
      const c = { id: comments.length + 1, body: body?.body ?? '' };
      comments.push(c);
      return Promise.resolve(Response.json(c, { status: 201 }));
    }
    const id = Number(url.split('/').pop());
    const c = comments.find((x) => x.id === id);
    if (c !== undefined) c.body = body?.body ?? '';
    return Promise.resolve(Response.json(c ?? {}));
  };
  return { fetch: impl, calls, comments };
}
