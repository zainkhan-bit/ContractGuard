import { resolve } from 'node:path';
import { diagnostic, type StageResult } from '@contractguard/core';

/** A parsed source specifier (§12.2). Paths are absolute. */
export type SourceSpecifier =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'git'; readonly ref: string; readonly path: string; readonly cwd: string }
  | { readonly kind: 'snapshot'; readonly file: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'stdin' };

/**
 * Conservative git ref syntax: branch, tag, remote ref or SHA, optionally with ~n/^n suffixes. Rejects anything
 * that could be read as an option or revision expression (leading "-", "..", "@{", spaces, control characters).
 */
const SAFE_REF = /^(?!-)(?!.*\.\.)(?!.*@\{)(?!.*\/\/)[A-Za-z0-9._/-]+(?:[~^]\d*)*$/;

export function isSafeGitRef(ref: string): boolean {
  return (
    ref.length > 0 &&
    ref.length <= 255 &&
    SAFE_REF.test(ref) &&
    !ref.endsWith('.lock') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.')
  );
}

const usage = (message: string, hint?: string): StageResult<SourceSpecifier> => ({
  diagnostics: [diagnostic('CGD-CONFIG-002', message, hint === undefined ? {} : { hint })],
});

/** Parses `<path>`, `git:<ref>:<path>`, `snapshot:<file>`, `https://…` or `-` (stdin) relative to `cwd`. */
export function parseSourceSpecifier(raw: string, cwd: string): StageResult<SourceSpecifier> {
  const text = raw.trim();
  if (text === '') return usage('Empty source specifier');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(text))
    return usage(`Source specifier contains control characters: ${JSON.stringify(raw)}`);
  if (text === '-') return { value: { kind: 'stdin' }, diagnostics: [] };
  if (text.startsWith('git:')) {
    const rest = text.slice(4);
    const sep = rest.indexOf(':');
    if (sep <= 0 || sep === rest.length - 1) {
      return usage(
        `Invalid git specifier "${raw}"`,
        'expected git:<ref>:<path>, e.g. git:origin/main:api/openapi.yaml',
      );
    }
    const ref = rest.slice(0, sep);
    const path = rest.slice(sep + 1);
    if (!isSafeGitRef(ref)) {
      return usage(
        `Invalid git reference "${ref}"`,
        'use a branch, tag, remote branch or commit SHA (e.g. origin/main, v1.2.0, 3f2a9c1)',
      );
    }
    if (path.includes('\\')) {
      return usage(`Git paths use forward slashes: "${path}"`, `write git:${ref}:${path.replaceAll('\\', '/')}`);
    }
    if (path.startsWith('-') || path.includes('\0')) return usage(`Invalid path in git specifier: "${path}"`);
    return { value: { kind: 'git', ref, path, cwd: resolve(cwd) }, diagnostics: [] };
  }
  if (text.startsWith('snapshot:')) {
    const file = text.slice('snapshot:'.length);
    if (file === '') return usage('Empty snapshot path', 'expected snapshot:<file>');
    return { value: { kind: 'snapshot', file: resolve(cwd, file) }, diagnostics: [] };
  }
  if (/^https?:\/\//i.test(text)) {
    try {
      return { value: { kind: 'url', url: new URL(text).href }, diagnostics: [] };
    } catch {
      return usage(`Invalid URL "${raw}"`);
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text))
    return usage(`Unsupported source "${raw}"`, 'use a path, git:<ref>:<path>, snapshot:<file>, https://… or -');
  return { value: { kind: 'path', path: resolve(cwd, text) }, diagnostics: [] };
}

/** Human-readable description of a specifier (for reports). */
export function describeSpecifier(spec: SourceSpecifier, sha?: string): string {
  switch (spec.kind) {
    case 'path':
      return 'working tree';
    case 'git':
      if (sha === undefined) return `git:${spec.ref}`;
      // A ref that is itself (a prefix of) the commit SHA, e.g. the Action's base commit: show it once.
      return /^[0-9a-f]{7,40}$/i.test(spec.ref) && sha.startsWith(spec.ref.toLowerCase())
        ? `git:${sha.slice(0, 7)}`
        : `git:${spec.ref}@${sha.slice(0, 7)}`;
    case 'snapshot':
      return `snapshot`;
    case 'url':
      return 'remote';
    case 'stdin':
      return 'stdin';
  }
}
