import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, documentUri, type ReferencePolicy } from '@zainkhan-bit/contractguard-core';
import { FileSourceLoader, fileUri, isForbiddenWindowsPath, isPathInside } from '../../src/load/file-loader.js';
import { CompositeSourceLoader, MemorySourceLoader } from '../../src/load/memory-loader.js';
import { formatHintFromUri, type LoadContext } from '../../src/load/source.js';
import { codes } from '../helpers.js';

let base: string;
let root: string;

const policy = (r: string): ReferencePolicy => ({
  root: r,
  allowRemote: false,
  allowedHosts: [],
  allowedSchemes: ['https'],
  fetchTimeoutMs: 1000,
  maxRemoteBytes: 1000,
});
const ctx = (r: string = root): LoadContext => ({ policy: policy(r), limits: DEFAULT_LIMITS, side: 'candidate' });

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'cg-load-')));
  root = path.join(base, 'repo');
  await mkdir(path.join(root, 'specs'), { recursive: true });
  await writeFile(path.join(root, 'specs', 'openapi.yaml'), 'openapi: 3.1.0\n');
  await writeFile(path.join(root, 'specs', 'schemas.json'), '{}');
  await writeFile(path.join(base, 'secret.yaml'), 'token: x\n');
  await symlink(path.join(base, 'secret.yaml'), path.join(root, 'specs', 'escape.yaml'));
  await symlink(path.join(root, 'specs', 'openapi.yaml'), path.join(root, 'link.yaml'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('FileSourceLoader', () => {
  const loader = new FileSourceLoader();

  it('reads files inside the root with a format hint', async () => {
    const r = await loader.load(fileUri(path.join(root, 'specs', 'openapi.yaml')), ctx());
    expect(new TextDecoder().decode(r.value?.bytes)).toBe('openapi: 3.1.0\n');
    expect(r.value?.formatHint).toBe('yaml');
    const j = await loader.load(fileUri(path.join(root, 'specs', 'schemas.json')), ctx());
    expect(j.value?.formatHint).toBe('json');
  });

  it('follows symlinks that stay inside the root and reports the real path', async () => {
    const r = await loader.load(fileUri(path.join(root, 'link.yaml')), ctx());
    expect(r.value?.uri).toBe(fileUri(path.join(root, 'specs', 'openapi.yaml')));
  });

  it('rejects traversal outside the root', async () => {
    const r = await loader.load(fileUri(path.join(root, '..', 'secret.yaml')), ctx());
    expect(codes(r.diagnostics)).toEqual(['CGD-REF-013']);
    expect(r.diagnostics[0]?.side).toBe('candidate');
  });

  it('rejects symlinks that escape the root', async () => {
    const r = await loader.load(fileUri(path.join(root, 'specs', 'escape.yaml')), ctx());
    expect(codes(r.diagnostics)).toEqual(['CGD-REF-013']);
  });

  it('reports missing files, directories and a missing root', async () => {
    expect(codes((await loader.load(fileUri(path.join(root, 'nope.yaml')), ctx())).diagnostics)).toEqual([
      'CGD-FS-001',
    ]);
    expect(codes((await loader.load(fileUri(path.join(root, 'specs')), ctx())).diagnostics)).toEqual(['CGD-FS-002']);
    expect(
      codes(
        (await loader.load(fileUri(path.join(root, 'specs', 'openapi.yaml')), ctx(path.join(base, 'missing'))))
          .diagnostics,
      ),
    ).toEqual(['CGD-FS-001']);
  });

  it('enforces the size limit before reading', async () => {
    const r = await loader.load(fileUri(path.join(root, 'specs', 'openapi.yaml')), {
      ...ctx(),
      limits: { ...DEFAULT_LIMITS, maxDocumentBytes: 3 },
    });
    expect(codes(r.diagnostics)).toEqual(['CGD-LIMIT-001']);
  });

  it('rejects non-file URIs', async () => {
    const r = await loader.load(documentUri('https://example.com/x.yaml'), ctx());
    expect(codes(r.diagnostics)).toEqual(['CGD-FS-001']);
  });

  it('rejects UNC and alternate-data-stream paths on Windows', async () => {
    const win = new FileSourceLoader({ platform: 'win32' });
    const r = await win.load(documentUri('file:///C:/repo/spec.yaml:hidden'), ctx());
    expect(codes(r.diagnostics)).toEqual(['CGD-REF-013']);
  });
});

describe('path helpers', () => {
  it('detects containment, including the root itself', () => {
    expect(isPathInside('/a/b', '/a/b')).toBe(true);
    expect(isPathInside('/a/b', '/a/b/c/d')).toBe(true);
    expect(isPathInside('/a/b', '/a/bc')).toBe(false);
    expect(isPathInside('/a/b', '/a')).toBe(false);
  });

  it('is case-insensitive on Windows', () => {
    expect(isPathInside('C:\\Repo', 'c:\\repo\\specs\\a.yaml', path.win32)).toBe(true);
    expect(isPathInside('C:\\Repo', 'D:\\repo\\a.yaml', path.win32)).toBe(false);
  });

  it('flags forbidden Windows path forms', () => {
    expect(isForbiddenWindowsPath('\\\\server\\share\\a.yaml')).toBe(true);
    expect(isForbiddenWindowsPath('//server/share/a.yaml')).toBe(true);
    expect(isForbiddenWindowsPath('\\\\?\\C:\\a.yaml')).toBe(true);
    expect(isForbiddenWindowsPath('C:\\repo\\a.yaml:stream')).toBe(true);
    expect(isForbiddenWindowsPath('C:\\repo\\a.yaml')).toBe(false);
  });

  it('derives format hints from extensions', () => {
    expect(formatHintFromUri('file:///a/B.YML')).toBe('yaml');
    expect(formatHintFromUri('https://h/x.json?v=1#/a')).toBe('json');
    expect(formatHintFromUri('file:///a/spec')).toBeUndefined();
  });
});

describe('MemorySourceLoader and CompositeSourceLoader', () => {
  const memUri = documentUri('git://abc123/api/openapi.yaml');
  const memory = new MemorySourceLoader([[memUri, 'openapi: 3.0.3\n']], ['git:']);
  const composite = new CompositeSourceLoader([memory, new FileSourceLoader()]);

  it('serves in-memory documents by scheme', async () => {
    const r = await composite.load(memUri, ctx());
    expect(new TextDecoder().decode(r.value?.bytes)).toBe('openapi: 3.0.3\n');
    expect(composite.schemes).toEqual(['git:', 'file:']);
  });

  it('reports missing in-memory documents and size limits', async () => {
    expect(codes((await memory.load(documentUri('git://abc123/nope.yaml'), ctx())).diagnostics)).toEqual([
      'CGD-FS-001',
    ]);
    expect(
      codes((await memory.load(memUri, { ...ctx(), limits: { ...DEFAULT_LIMITS, maxDocumentBytes: 2 } })).diagnostics),
    ).toEqual(['CGD-LIMIT-001']);
  });

  it('refuses remote URIs when no remote loader is registered', async () => {
    const r = await composite.load(documentUri('https://example.com/a.yaml'), ctx());
    expect(codes(r.diagnostics)).toEqual(['CGD-REF-010']);
    expect(r.diagnostics[0]?.hint).toContain('allowRemote');
  });

  it('refuses unknown schemes', async () => {
    expect(codes((await composite.load(documentUri('ftp://h/a.yaml'), ctx())).diagnostics)).toEqual(['CGD-REF-012']);
    expect(codes((await composite.load(documentUri('no-scheme'), ctx())).diagnostics)).toEqual(['CGD-REF-012']);
  });

  it('accepts byte content', async () => {
    const bytesLoader = new MemorySourceLoader([[memUri, new Uint8Array([0x61])]], ['git:']);
    expect((await bytesLoader.load(memUri, { policy: policy(root), limits: DEFAULT_LIMITS })).value?.bytes).toEqual(
      new Uint8Array([0x61]),
    );
  });
});
