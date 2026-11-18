import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  documentUri,
  parsePointer,
  stringifyCanonical,
  type DocumentUri,
  type JsonPointer,
  type ReferencePolicy,
} from '@zainkhan-bit/contractguard-core';
import { CompositeSourceLoader, MemorySourceLoader } from '../../src/load/memory-loader.js';
import type { LoadContext } from '../../src/load/source.js';
import { parseDocument } from '../../src/parse/parser.js';
import { followReferences } from '../../src/resolve/follow.js';
import { hasUnresolved, resolveReferences, siteKey, valueAt } from '../../src/resolve/resolver.js';
import { walkReferences } from '../../src/resolve/walk.js';
import { codes, parseOk } from '../helpers.js';

const ptr = (s: string): JsonPointer => parsePointer(s) as JsonPointer;
const policy: ReferencePolicy = {
  root: '/',
  allowRemote: false,
  allowedHosts: [],
  allowedSchemes: ['https'],
  fetchTimeoutMs: 1000,
  maxRemoteBytes: 1000,
};
const ctx: LoadContext = { policy, limits: DEFAULT_LIMITS, side: 'candidate' };

async function resolveFiles(
  files: Record<string, string>,
  dialect: 'oas30' | 'oas31' = 'oas30',
  context: LoadContext = ctx,
) {
  const entries = Object.entries(files).map(([p, t]) => [documentUri(`file:///api/${p}`), t] as const);
  const loader = new CompositeSourceLoader([new MemorySourceLoader(entries, ['file:'])]);
  const rootUri = entries[0]?.[0] as DocumentUri;
  const root = parseDocument(
    { uri: rootUri, bytes: new TextEncoder().encode(files[Object.keys(files)[0] as string]) },
    { limits: DEFAULT_LIMITS },
  );
  if (root.value === undefined) throw new Error('root parse failed');
  return resolveReferences(root.value, dialect, { loader, ctx: context });
}

describe('walkReferences', () => {
  it('finds $ref sites and skips data-valued keywords', () => {
    const doc = parseOk(`
a: {$ref: '#/b'}
example: {$ref: 'not-a-ref'}
default: {$ref: 'no'}
enum: [{$ref: 'no'}]
const: {$ref: 'no'}
x-vendor: {$ref: 'no'}
schema:
  examples: [{$ref: 'data'}]
media:
  examples:
    one: {$ref: '#/components/examples/one'}
    two: {value: {$ref: 'data'}}
props:
  properties:
    $ref: {type: string}
`);
    const r = walkReferences(doc.value, 'file:///api/openapi.yaml', 'oas30');
    expect(r.refs.map((x) => [x.site, x.raw])).toEqual([
      ['#/a', '#/b'],
      ['#/media/examples/one', '#/components/examples/one'],
    ]);
  });

  it('treats keyword-like names inside name maps as names (regression)', () => {
    const doc = parseOk(`
paths:
  /a:
    get:
      responses:
        default: {$ref: '#/components/responses/Error'}
components:
  schemas:
    Thing:
      properties:
        default: {$ref: '#/components/schemas/D'}
        example: {$ref: '#/components/schemas/E'}
        enum: {$ref: '#/components/schemas/F'}
        x-id: {$ref: '#/components/schemas/G'}
      default: {$ref: 'data-not-a-ref'}
`);
    const r = walkReferences(doc.value, 'file:///api/openapi.yaml', 'oas30');
    expect(r.refs.map((x) => x.site)).toEqual([
      '#/components/schemas/Thing/properties/default',
      '#/components/schemas/Thing/properties/enum',
      '#/components/schemas/Thing/properties/example',
      '#/components/schemas/Thing/properties/x-id',
      '#/paths/~1a/get/responses/default',
    ]);
  });

  it('tracks $id re-basing, $anchor and $dynamicRef in 3.1 only', () => {
    const text = `
components:
  schemas:
    A:
      $id: https://example.com/schemas/a.json
      $anchor: top
      properties:
        b: {$ref: 'b.json'}
        c: {$dynamicRef: '#node'}
`;
    const r31 = walkReferences(parseOk(text).value, 'file:///api/openapi.yaml', 'oas31');
    expect(r31.identifiers.map((i) => i.uri)).toEqual([
      'https://example.com/schemas/a.json',
      'https://example.com/schemas/a.json#top',
    ]);
    expect(r31.refs.map((x) => [x.raw, x.kind, x.base])).toEqual([
      ['b.json', 'ref', 'https://example.com/schemas/a.json'],
      ['#node', 'dynamicRef', 'https://example.com/schemas/a.json'],
    ]);
    const r30 = walkReferences(parseOk(text).value, 'file:///api/openapi.yaml', 'oas30');
    expect(r30.identifiers).toEqual([]);
    expect(r30.refs.map((x) => x.raw)).toEqual(['b.json']);
  });
});

describe('resolveReferences', () => {
  it('resolves local and relative-file references with source locations', async () => {
    const r = await resolveFiles({
      'openapi.yaml': `openapi: 3.0.3
paths:
  /u:
    get:
      responses:
        '200': {$ref: '#/components/responses/Ok'}
components:
  responses:
    Ok: {description: ok, content: {application/json: {schema: {$ref: 'schemas/user.yaml#/User'}}}}
`,
      'schemas/user.yaml': `User:\n  type: object\n  properties:\n    address: {$ref: '../common/address.yaml'}\n`,
      'common/address.yaml': `type: object\n`,
    });
    expect(r.diagnostics).toEqual([]);
    const set = r.value;
    expect([...(set?.documents.keys() ?? [])]).toEqual([
      'file:///api/openapi.yaml',
      'file:///api/schemas/user.yaml',
      'file:///api/common/address.yaml',
    ]);
    const local = set?.references.get(
      siteKey(documentUri('file:///api/openapi.yaml'), ptr('#/paths/~1u/get/responses/200')),
    );
    expect(local?.status).toBe('resolved');
    expect(local?.status === 'resolved' && local.target.pointer).toBe('#/components/responses/Ok');
    expect(local?.status === 'resolved' && local.target.range?.start.line).toBe(9);
    const nested = set?.references.get(
      siteKey(documentUri('file:///api/schemas/user.yaml'), ptr('#/User/properties/address')),
    );
    expect(nested?.status === 'resolved' && nested.target.uri).toBe('file:///api/common/address.yaml');
    expect(set?.totalBytes).toBeGreaterThan(100);
    expect(set && hasUnresolved(set)).toBe(false);
  });

  it('decodes percent-encoded and escaped pointer fragments', async () => {
    const r = await resolveFiles({
      'openapi.yaml': `a: {$ref: '#/paths/~1users~1%7Bid%7D/x%20y'}\npaths:\n  /users/{id}:\n    x y: 1\n`,
    });
    expect(r.diagnostics).toEqual([]);
  });

  it('reports unresolved pointers, missing files and invalid fragments, keeping a partial set', async () => {
    const r = await resolveFiles({
      'openapi.yaml': `a: {$ref: '#/nope'}\nb: {$ref: 'missing.yaml'}\nc: {$ref: '#bad~2'}\nd: {$ref: '#plain'}\ne: {$ref: '#/a~2b'}\n`,
    });
    expect(codes(r.diagnostics).sort()).toEqual([
      'CGD-FS-001',
      'CGD-REF-001',
      'CGD-REF-002',
      'CGD-REF-002',
      'CGD-REF-002',
    ]);
    expect(r.value && hasUnresolved(r.value)).toBe(true);
    expect(r.diagnostics.every((d) => d.location?.uri === 'file:///api/openapi.yaml')).toBe(true);
  });

  it('records cyclic references without looping', async () => {
    const r = await resolveFiles({
      'openapi.yaml': `Node:\n  type: object\n  properties:\n    children: {type: array, items: {$ref: '#/Node'}}\n`,
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.references.size).toBe(1);
  });

  it('resolves 3.1 $id-based and $anchor references', async () => {
    const r = await resolveFiles(
      {
        'openapi.yaml': `openapi: 3.1.0
components:
  schemas:
    A:
      $id: https://example.com/schemas/a.json
      $defs:
        B: {$anchor: bee, type: string}
      properties:
        viaAnchor: {$ref: '#bee'}
        viaId: {$ref: 'https://example.com/schemas/a.json#/$defs/B'}
`,
      },
      'oas31',
    );
    expect(r.diagnostics).toEqual([]);
    const targets = [...(r.value?.references.values() ?? [])].map((x) =>
      x.status === 'resolved' ? x.target.pointer : x.status,
    );
    expect(targets).toEqual(['#/components/schemas/A/$defs/B', '#/components/schemas/A/$defs/B']);
  });

  it('warns about $ref siblings in 3.0', async () => {
    const r = await resolveFiles({ 'openapi.yaml': `a: {$ref: '#/b', description: d, x-ok: 1}\nb: {}\n` });
    expect(codes(r.diagnostics)).toEqual(['CGD-SPEC-101']);
    expect(r.diagnostics[0]?.severity).toBe('warning');
  });

  it('refuses remote references when no remote loader is enabled', async () => {
    const r = await resolveFiles({ 'openapi.yaml': `a: {$ref: 'https://example.com/s.yaml#/X'}\n` });
    expect(codes(r.diagnostics)).toEqual(['CGD-REF-010']);
    const ref = [...(r.value?.references.values() ?? [])][0];
    expect(ref?.status).toBe('forbidden');
  });

  it('enforces maxDocuments and maxTotalBytes', async () => {
    const files = {
      'openapi.yaml': `a: {$ref: 'one.yaml'}\nb: {$ref: 'two.yaml'}\n`,
      'one.yaml': 'x: 1\n',
      'two.yaml': 'y: 2\n',
    };
    const docs = await resolveFiles(files, 'oas30', { ...ctx, limits: { ...DEFAULT_LIMITS, maxDocuments: 2 } });
    expect(codes(docs.diagnostics)).toEqual(['CGD-LIMIT-004']);
    const bytes = await resolveFiles(files, 'oas30', { ...ctx, limits: { ...DEFAULT_LIMITS, maxTotalBytes: 50 } });
    expect(codes(bytes.diagnostics)).toContain('CGD-LIMIT-002');
  });

  it('reports parse errors in referenced documents', async () => {
    const r = await resolveFiles({ 'openapi.yaml': `a: {$ref: 'bad.yaml'}\n`, 'bad.yaml': 'x: [\n' });
    expect(codes(r.diagnostics)).toEqual(['CGD-PARSE-001']);
  });

  it('loads each document once even when reached by different relative paths', async () => {
    const r = await resolveFiles({
      'openapi.yaml': `a: {$ref: 'sub/../common.yaml#/A'}\nb: {$ref: './common.yaml#/A'}\n`,
      'common.yaml': 'A: {type: string}\n',
    });
    expect(r.value?.documents.size).toBe(2);
  });
});

describe('resolveReferences edge cases', () => {
  it('finds references inside arrays (allOf, parameters)', async () => {
    const r = await resolveFiles({
      'openapi.yaml': `p:\n  parameters: [{$ref: '#/c/P'}]\n  schema: {allOf: [{$ref: '#/c/S'}, {type: object}]}\nc:\n  P: {name: q, in: query}\n  S: {type: object}\n`,
    });
    expect(r.diagnostics).toEqual([]);
    expect([...(r.value?.references.keys() ?? [])]).toEqual([
      'file:///api/openapi.yaml#/p/parameters/0',
      'file:///api/openapi.yaml#/p/schema/allOf/0',
    ]);
  });

  it('accepts percent-encoded pointer fragments and rejects malformed ones', async () => {
    const r = await resolveFiles({
      'openapi.yaml': `a: {$ref: '#%2Fb'}\nb: 1\nc: {$ref: 'http://[bad'}\nd: {$ref: '#/b%E0%A4%A'}\n`,
    });
    expect(codes(r.diagnostics).sort()).toEqual(['CGD-REF-001', 'CGD-REF-002']);
    const a = r.value?.references.get('file:///api/openapi.yaml#/a');
    expect(a?.status === 'resolved' && a.target.pointer).toBe('#/b');
  });

  it('rejects malformed anchors and unknown 3.1 anchors', async () => {
    const r = await resolveFiles({ 'openapi.yaml': `a: {$ref: '#%E0%A4%A'}\nb: {$ref: '#nowhere'}\n` }, 'oas31');
    expect(r.diagnostics.map((d) => d.message).sort()).toEqual([
      'Invalid fragment in reference #%E0%A4%A',
      'Unresolved anchor "#nowhere" in reference #nowhere',
    ]);
  });
});

describe('followReferences', () => {
  it('follows chains and records the via path', async () => {
    const r = await resolveFiles({ 'openapi.yaml': `a: {$ref: '#/b'}\nb: {$ref: '#/c'}\nc: {type: string}\n` });
    const set = r.value;
    if (set === undefined) throw new Error('no set');
    const f = followReferences(set, { uri: set.root, pointer: ptr('#/a') }, { maxRefHops: 10, stopAtSiblings: false });
    expect(f.value?.location.pointer).toBe('#/c');
    expect(f.value?.via.map((v) => v.pointer)).toEqual(['#/a', '#/b']);
    expect(stringifyCanonical(f.value?.value ?? null)).toBe('{"type":"string"}');
    const direct = followReferences(
      set,
      { uri: set.root, pointer: ptr('#/c') },
      { maxRefHops: 10, stopAtSiblings: false },
    );
    expect(direct.value?.via).toEqual([]);
  });

  it('detects pure reference cycles and hop limits', async () => {
    const r = await resolveFiles({
      'openapi.yaml': `a: {$ref: '#/b'}\nb: {$ref: '#/a'}\nc: {$ref: '#/d'}\nd: {$ref: '#/e'}\ne: {}\n`,
    });
    const set = r.value;
    if (set === undefined) throw new Error('no set');
    expect(
      codes(
        followReferences(set, { uri: set.root, pointer: ptr('#/a') }, { maxRefHops: 10, stopAtSiblings: false })
          .diagnostics,
      ),
    ).toEqual(['CGD-REF-004']);
    expect(
      codes(
        followReferences(set, { uri: set.root, pointer: ptr('#/c') }, { maxRefHops: 1, stopAtSiblings: false })
          .diagnostics,
      ),
    ).toEqual(['CGD-LIMIT-006']);
    expect(
      codes(
        followReferences(set, { uri: set.root, pointer: ptr('#/zzz') }, { maxRefHops: 1, stopAtSiblings: false })
          .diagnostics,
      ),
    ).toEqual(['CGD-REF-001']);
  });

  it('stops at references with semantic siblings when asked (3.1 conjunction)', async () => {
    const r = await resolveFiles(
      {
        'openapi.yaml': `a: {$ref: '#/b', maxLength: 3, description: d}\nb: {type: string}\nc: {$ref: '#/b', description: only}\n`,
      },
      'oas31',
    );
    const set = r.value;
    if (set === undefined) throw new Error('no set');
    expect(
      followReferences(set, { uri: set.root, pointer: ptr('#/a') }, { maxRefHops: 5, stopAtSiblings: true }).value
        ?.location.pointer,
    ).toBe('#/a');
    expect(
      followReferences(set, { uri: set.root, pointer: ptr('#/c') }, { maxRefHops: 5, stopAtSiblings: true }).value
        ?.location.pointer,
    ).toBe('#/b');
  });

  it('surfaces unresolved references along the chain', async () => {
    const r = await resolveFiles({ 'openapi.yaml': `a: {$ref: '#/missing'}\n` });
    const set = r.value;
    if (set === undefined) throw new Error('no set');
    expect(
      codes(
        followReferences(set, { uri: set.root, pointer: ptr('#/a') }, { maxRefHops: 5, stopAtSiblings: false })
          .diagnostics,
      ),
    ).toEqual(['CGD-REF-001']);
  });
});

describe('valueAt', () => {
  it('walks objects and arrays strictly', () => {
    const v = parseOk('a: [10, {b: 2}]\n').value;
    expect(stringifyCanonical(valueAt(v, ptr('#/a/1/b')) ?? null)).toBe('2');
    expect(valueAt(v, ptr('#/a/01'))).toBeUndefined();
    expect(valueAt(v, ptr('#/a/5'))).toBeUndefined();
    expect(valueAt(v, ptr('#/a/0/x'))).toBeUndefined();
    expect(valueAt(v, ptr('#/toString'))).toBeUndefined();
  });
});
