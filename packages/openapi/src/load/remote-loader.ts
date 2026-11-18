import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import {
  ROOT_POINTER,
  diagnostic,
  stageFail,
  stageOk,
  type Diagnostic,
  type DocumentUri,
  type StageResult,
} from '@zainkhan-bit/contractguard-core';
import { formatHintFromUri, type LoadContext, type LoadedSource, type SourceLoader } from './source.js';

/**
 * Address ranges that remote references may never reach (§16.2 T7): loopback, private,
 * link-local (incl. cloud metadata 169.254.169.254), CGNAT, benchmarking, documentation,
 * multicast, reserved, and their IPv6 counterparts.
 */
export function createDefaultBlockList(): BlockList {
  const list = new BlockList();
  const v4: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  for (const [net, prefix] of v4) list.addSubnet(net, prefix, 'ipv4');
  const v6: [string, number][] = [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ];
  // IPv4-mapped (::ffff:0:0/96) is deliberately absent: Node's BlockList applies such rules to
  // plain IPv4 checks too. Mapped addresses are unwrapped and checked as IPv4 in isPublicAddress.
  for (const [net, prefix] of v6) list.addSubnet(net, prefix, 'ipv6');
  return list;
}

const DEFAULT_BLOCK_LIST = createDefaultBlockList();

/** Extracts an embedded IPv4 address from IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::a.b.c.d) forms. */
function embeddedIpv4(address: string): string | undefined {
  const m = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return m?.[1];
}

/** True if the address may be contacted. */
export function isPublicAddress(address: string, blockList: BlockList = DEFAULT_BLOCK_LIST): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  const embedded = family === 6 ? embeddedIpv4(address) : undefined;
  if (embedded !== undefined && blockList.check(embedded, 'ipv4')) return false;
  return !blockList.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export interface RemoteLoaderOptions {
  /** Address predicate; tests use it to permit a local server. Defaults to isPublicAddress. */
  readonly isAddressAllowed?: (address: string) => boolean;
}

class RemoteFailure extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

/**
 * Fetches remote documents under the ReferencePolicy (§16.3). Off unless `allowRemote`.
 * The vetted IP is pinned for the connection (custom DNS lookup), so DNS rebinding
 * cannot redirect the request to a blocked address after the check.
 */
export class RemoteSourceLoader implements SourceLoader {
  readonly schemes: readonly string[] = ['http:', 'https:'];
  readonly #allowed: (address: string) => boolean;

  constructor(options: RemoteLoaderOptions = {}) {
    this.#allowed = options.isAddressAllowed ?? ((a) => isPublicAddress(a));
  }

  async load(uri: DocumentUri, ctx: LoadContext): Promise<StageResult<LoadedSource>> {
    const side = ctx.side === undefined ? {} : { side: ctx.side };
    const at = { uri, pointer: ROOT_POINTER };
    const fail = (code: Parameters<typeof diagnostic>[0], message: string, hint?: string): StageResult<LoadedSource> =>
      stageFail([diagnostic(code, message, { ...side, location: at, ...(hint === undefined ? {} : { hint }) })]);

    const policy = ctx.policy;
    if (!policy.allowRemote) {
      return fail(
        'CGD-REF-010',
        `Remote references are disabled: ${uri}`,
        'Download the file into the repository, or enable references.allowRemote (and --allow-remote-references in CI).',
      );
    }
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      return fail('CGD-REF-012', `Invalid URL: ${uri}`);
    }
    const scheme = url.protocol.slice(0, -1);
    if (!(policy.allowedSchemes as readonly string[]).includes(scheme)) {
      return fail('CGD-REF-012', `URI scheme "${scheme}" is not allowed for remote references`);
    }
    if (url.username !== '' || url.password !== '') {
      return fail('CGD-REF-012', 'Credentials in reference URLs are not allowed');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!policy.allowedHosts.some((h) => h.toLowerCase() === host)) {
      return fail('CGD-REF-011', `Host "${host}" is not in references.allowedHosts`);
    }
    if (isIP(host) !== 0 && !this.#allowed(host)) {
      return fail('CGD-REF-014', `Address ${host} is blocked (private, loopback, link-local or reserved)`);
    }

    try {
      const bytes = await this.#fetch(url, ctx, side);
      const hint = formatHintFromUri(uri);
      return stageOk({ uri, bytes, ...(hint === undefined ? {} : { formatHint: hint }) });
    } catch (error) {
      if (error instanceof RemoteFailure) return stageFail([error.diagnostic]);
      const code = (error as { code?: unknown }).code;
      return fail('CGD-FS-003', `Could not fetch ${uri} (${typeof code === 'string' ? code : 'network error'})`);
    }
  }

  #fetch(url: URL, ctx: LoadContext, side: { readonly side?: 'base' | 'candidate' }): Promise<Uint8Array> {
    const at = { uri: url.href as DocumentUri, pointer: ROOT_POINTER };
    const failure = (code: Parameters<typeof diagnostic>[0], message: string): RemoteFailure =>
      new RemoteFailure(diagnostic(code, message, { ...side, location: at }));
    const allowed = this.#allowed;

    const lookup: LookupFunction = (hostname, options, callback) => {
      dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
        if (err !== null) {
          callback(err, '', 0);
          return;
        }
        const blocked = addresses.find((a) => !allowed(a.address));
        if (blocked !== undefined || addresses.length === 0) {
          callback(
            failure('CGD-REF-014', `${hostname} resolves to a blocked address (${blocked?.address ?? 'none'})`),
            '',
            0,
          );
          return;
        }
        const chosen = addresses[0] as { address: string; family: number };
        if (options.all === true) callback(null, [chosen]);
        else callback(null, chosen.address, chosen.family);
      });
    };

    return new Promise<Uint8Array>((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = send(
        url,
        {
          method: 'GET',
          lookup,
          headers: {
            accept: 'application/json, application/yaml, text/yaml, */*;q=0.5',
            'user-agent': 'contractguard',
          },
          timeout: ctx.policy.fetchTimeoutMs,
          ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
        },
        (res: IncomingMessage) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            reject(failure('CGD-REF-012', `Redirects are not followed for remote references (HTTP ${status})`));
            return;
          }
          if (status !== 200) {
            res.resume();
            reject(failure('CGD-FS-003', `HTTP ${status} fetching ${url.href}`));
            return;
          }
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > ctx.policy.maxRemoteBytes) {
            res.destroy();
            reject(
              failure(
                'CGD-REF-015',
                `Remote document is ${declared} bytes, above maxRemoteBytes (${ctx.policy.maxRemoteBytes})`,
              ),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > ctx.policy.maxRemoteBytes) {
              res.destroy();
              reject(failure('CGD-REF-015', `Remote document exceeds maxRemoteBytes (${ctx.policy.maxRemoteBytes})`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve(new Uint8Array(Buffer.concat(chunks)));
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () => {
        req.destroy(failure('CGD-FS-003', `Timed out after ${ctx.policy.fetchTimeoutMs} ms fetching ${url.href}`));
      });
      req.on('error', reject);
      req.end();
    });
  }
}
