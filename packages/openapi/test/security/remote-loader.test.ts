import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, documentUri, type ReferencePolicy } from '@contractguard/core';
import { RemoteSourceLoader, isPublicAddress } from '../../src/load/remote-loader.js';
import type { LoadContext } from '../../src/load/source.js';
import { codes } from '../helpers.js';

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case '/ok.yaml':
        res.writeHead(200, { 'content-type': 'application/yaml' });
        res.end('openapi: 3.1.0\n');
        return;
      case '/redirect':
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      case '/big-declared':
        res.writeHead(200, { 'content-length': '999999' });
        res.end('x'.repeat(10));
        return;
      case '/big-streamed':
        res.writeHead(200);
        res.write('x'.repeat(600));
        res.end('x'.repeat(600));
        return;
      case '/slow':
        setTimeout(() => res.end('late'), 2000);
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

const policy = (overrides: Partial<ReferencePolicy> = {}): ReferencePolicy => ({
  root: '/',
  allowRemote: true,
  allowedHosts: ['127.0.0.1', 'localhost'],
  allowedSchemes: ['http', 'https'],
  fetchTimeoutMs: 500,
  maxRemoteBytes: 1000,
  ...overrides,
});
const ctx = (overrides: Partial<ReferencePolicy> = {}): LoadContext => ({
  policy: policy(overrides),
  limits: DEFAULT_LIMITS,
});
const url = (path: string, host = '127.0.0.1') => documentUri(`http://${host}:${port}${path}`);

describe('RemoteSourceLoader policy (§16.3)', () => {
  const loader = new RemoteSourceLoader();

  it('is disabled unless allowRemote', async () => {
    expect(codes((await loader.load(url('/ok.yaml'), ctx({ allowRemote: false }))).diagnostics)).toEqual([
      'CGD-REF-010',
    ]);
  });

  it('enforces scheme and exact host allowlists', async () => {
    expect(codes((await loader.load(url('/ok.yaml'), ctx({ allowedSchemes: ['https'] }))).diagnostics)).toEqual([
      'CGD-REF-012',
    ]);
    expect(codes((await loader.load(url('/ok.yaml'), ctx({ allowedHosts: ['example.com'] }))).diagnostics)).toEqual([
      'CGD-REF-011',
    ]);
    expect(codes((await loader.load(documentUri('http://user:pw@127.0.0.1/x'), ctx())).diagnostics)).toEqual([
      'CGD-REF-012',
    ]);
    expect(codes((await loader.load(documentUri('not a url'), ctx())).diagnostics)).toEqual(['CGD-REF-012']);
  });

  it('T7: refuses loopback IP literals even when the host is allow-listed', async () => {
    expect(codes((await loader.load(url('/ok.yaml'), ctx())).diagnostics)).toEqual(['CGD-REF-014']);
  });

  it('T7: refuses bracketed IPv6 loopback literals', async () => {
    const r = await loader.load(documentUri('http://[::1]:1/x.yaml'), ctx({ allowedHosts: ['::1'] }));
    expect(codes(r.diagnostics)).toEqual(['CGD-REF-014']);
  });

  it('reports DNS failures without leaking internals', async () => {
    const r = await loader.load(
      documentUri('http://does-not-exist.invalid/x.yaml'),
      ctx({ allowedHosts: ['does-not-exist.invalid'] }),
    );
    expect(codes(r.diagnostics)).toEqual(['CGD-FS-003']);
  });

  it('T7: refuses host names that resolve to blocked addresses (checked at connect time)', async () => {
    const r = await loader.load(url('/ok.yaml', 'localhost'), ctx());
    expect(codes(r.diagnostics)).toEqual(['CGD-REF-014']);
  });
});

describe('RemoteSourceLoader transport (test server permitted explicitly)', () => {
  const loader = new RemoteSourceLoader({ isAddressAllowed: (a) => a === '127.0.0.1' || a === '::1' });

  it('fetches documents', async () => {
    const r = await loader.load(url('/ok.yaml'), ctx());
    expect(new TextDecoder().decode(r.value?.bytes)).toBe('openapi: 3.1.0\n');
    expect(r.value?.formatHint).toBe('yaml');
  });

  it('T7: never follows redirects (e.g. to cloud metadata)', async () => {
    const r = await loader.load(url('/redirect'), ctx());
    expect(codes(r.diagnostics)).toEqual(['CGD-REF-012']);
    expect(r.diagnostics[0]?.message).toContain('Redirects are not followed');
  });

  it('caps size by declared length and while streaming', async () => {
    expect(codes((await loader.load(url('/big-declared'), ctx())).diagnostics)).toEqual(['CGD-REF-015']);
    expect(codes((await loader.load(url('/big-streamed'), ctx())).diagnostics)).toEqual(['CGD-REF-015']);
  });

  it('times out and reports HTTP errors', async () => {
    expect((await loader.load(url('/slow'), ctx())).diagnostics[0]?.message).toContain('Timed out');
    expect((await loader.load(url('/missing'), ctx())).diagnostics[0]?.message).toContain('HTTP 404');
  });
});

describe('isPublicAddress', () => {
  it.each([
    ['8.8.8.8', true],
    ['1.1.1.1', true],
    ['2606:4700:4700::1111', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['::1', false],
    ['::', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:169.254.169.254', false],
    ['64:ff9b::10.0.0.1', false],
    ['not-an-ip', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});
