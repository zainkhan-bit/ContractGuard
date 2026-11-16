import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll } from 'vitest';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A fresh temporary directory (real path, so macOS /private/var and Windows short names compare equal). */
export function tempDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cg-app-')));
  dirs.push(d);
  return d;
}

export function write(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

/** A git repository with one commit per entry of `commits` (files written then committed, in order). */
export function repo(commits: readonly Readonly<Record<string, string>>[]): string {
  const d = tempDir();
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'config', 'user.email', 'test@example.com');
  git(d, 'config', 'user.name', 'Test');
  git(d, 'config', 'commit.gpgsign', 'false');
  commits.forEach((files, i) => {
    write(d, files);
    git(d, 'add', '-A');
    git(d, 'commit', '-q', '-m', `c${String(i)}`);
  });
  return d;
}

export const TODAY = '2026-06-01';

export function spec(
  opts: { readonly requiredAge?: boolean; readonly tag?: boolean; readonly extraPath?: boolean } = {},
): string {
  return `openapi: 3.1.0
info: {title: Pets, version: 1.0.0}
tags: [{name: internal}]
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
                name: {type: string}
                age: {type: integer}
      responses:
        '201': {description: created}
${
  opts.extraPath === false
    ? ''
    : `  /admin/stats:
    get:
      tags: [internal]
      responses:
        '200': {description: ok}
`
}`;
}
