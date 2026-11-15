import {
  DEFAULT_LIMITS,
  documentUri,
  type ApiContract,
  type Diagnostic,
  type ReferencePolicy,
  type SchemaNode,
} from '@contractguard/core';
import { describe, expect, it } from 'vitest';
import { loadContract } from '../../src/load-contract.js';
import { MemorySourceLoader } from '../../src/load/memory-loader.js';
import { normalize } from '../../src/normalize/normalize.js';
import { parseDocument } from '../../src/parse/parser.js';
import { resolveReferences } from '../../src/resolve/resolver.js';
import { detectVersion } from '../../src/version/detect.js';
import { codes } from '../helpers.js';

const ROOT = documentUri('file:///api/openapi.yaml');
const POLICY: ReferencePolicy = {
  root: '/',
  allowRemote: false,
  allowedHosts: [],
  allowedSchemes: ['https'],
  fetchTimeoutMs: 1000,
  maxRemoteBytes: 1,
};

/** Runs the front end without the "stop on errors" policy, so partially broken documents still normalize. */
async function raw(
  text: string,
  extra: Record<string, string> = {},
  side?: 'base' | 'candidate',
): Promise<{ contract: ApiContract; diagnostics: readonly Diagnostic[] }> {
  const loader = new MemorySourceLoader(
    [[ROOT, text], ...Object.entries(extra).map(([k, v]) => [documentUri(k), v] as const)],
    ['file:'],
  );
  const ctx = { policy: POLICY, limits: DEFAULT_LIMITS, ...(side === undefined ? {} : { side }) };
  const loaded = await loader.load(ROOT, ctx);
  const parsed = parseDocument(loaded.value as never, { limits: DEFAULT_LIMITS });
  const doc = parsed.value;
  if (doc === undefined) throw new Error('parse failed');
  const version = detectVersion(doc).value;
  if (version === undefined) throw new Error('version failed');
  const set = await resolveReferences(doc, version.dialect, { loader, ctx });
  if (set.value === undefined) throw new Error('resolve failed');
  const r = normalize(set.value, version, { limits: DEFAULT_LIMITS, ...(side === undefined ? {} : { side }) });
  if (r.value === undefined) throw new Error('normalize failed');
  return { contract: r.value, diagnostics: [...set.diagnostics, ...r.diagnostics] };
}

function schemas30(body: string): string {
  return `openapi: 3.0.3\ninfo: {title: t, version: v}\npaths: {}\ncomponents:\n  schemas:\n${body}`;
}
function schemas31(body: string): string {
  return `openapi: 3.1.0\ninfo: {title: t, version: v}\npaths: {}\ncomponents:\n  schemas:\n${body}`;
}

function named(c: ApiContract, name: string): SchemaNode {
  const id = c.namedSchemas.get(name);
  const n = id === undefined ? undefined : c.schemas.nodes.get(id);
  if (n === undefined) throw new Error(`no schema ${name}`);
  return n;
}

describe('schema normalization edge cases', () => {
  it('normalizes the full constraint vocabulary', async () => {
    const { contract: c, diagnostics } = await raw(
      schemas31(`    S:
      type: string
      minLength: 2
      maxLength: 9
      pattern: '^a'
      format: email
      contentMediaType: text/plain
      contentEncoding: base64
      title: The S
      default: aa
      deprecated: true
      readOnly: true
    Z: {type: string, minLength: 0, minItems: 0, minProperties: 0}
    A: {type: array, minItems: 1, maxItems: 4, uniqueItems: true, items: {}}
    O:
      type: object
      minProperties: 1
      maxProperties: 3
      patternProperties: {'^x': {type: integer}}
      additionalProperties: {type: string}
    N: {type: number, minimum: 1, exclusiveMinimum: 1, maximum: 10, exclusiveMaximum: 9, multipleOf: 0.5, format: double}
    I: {type: integer, minimum: 0.5, maximum: -0.5}
    J: {type: integer, minimum: -1.5, maximum: 2.5}
    K: {type: integer, minimum: 1e400, multipleOf: 0}
    NOT: {not: {type: string}}
    NEVER: {not: {}, description: d}
    ANY: {anyOf: [{type: string}, {type: integer}]}
    EN: {enum: [a, null]}
    CE: {const: a, enum: [a, b]}
    CX: {const: z, enum: [a]}
    X: {x-foo: 1, type: string}
`),
    );
    expect(codes(diagnostics)).toEqual([]);
    const s = named(c, 'S');
    expect(s.string).toEqual({
      minLength: 2,
      maxLength: 9,
      pattern: '^a',
      format: 'email',
      contentMediaType: 'text/plain',
      contentEncoding: 'base64',
    });
    expect(s.annotations).toEqual({ deprecated: true, default: 'aa', title: 'The S' });
    expect(s.access).toEqual({ readOnly: true, writeOnly: false });
    const z = named(c, 'Z');
    expect(z.string.minLength).toBeUndefined();
    expect(z.array.minItems).toBeUndefined();
    expect(z.object.minProperties).toBeUndefined();
    expect(named(c, 'A').array).toEqual({ minItems: 1, maxItems: 4, uniqueItems: true });
    const o = named(c, 'O');
    expect(o.object.minProperties).toBe(1);
    expect(o.object.maxProperties).toBe(3);
    expect([...o.object.patternProperties.keys()]).toEqual(['^x']);
    expect(o.object.additionalProperties.kind).toBe('schema');
    const n = named(c, 'N');
    expect(n.numeric.minimum).toMatchObject({ exclusive: true });
    expect(n.numeric.minimum?.value.text).toBe('1');
    expect(n.numeric.maximum?.value.text).toBe('9');
    expect(n.numeric.maximum?.exclusive).toBe(true);
    expect(n.numeric.multipleOf?.text).toBe('0.5');
    expect(n.numeric.format).toBe('double');
    expect(named(c, 'I').numeric.minimum?.value.text).toBe('1');
    expect(named(c, 'I').numeric.maximum?.value.text).toBe('-1');
    expect(named(c, 'J').numeric.minimum?.value.text).toBe('-1');
    expect(named(c, 'J').numeric.maximum?.value.text).toBe('2');
    expect(named(c, 'K').numeric.minimum?.value.text).toBe('1e+400');
    expect(named(c, 'K').numeric.multipleOf).toBeUndefined();
    expect(named(c, 'NOT').composition.not).toBeDefined();
    expect(named(c, 'NEVER').trivial).toBe('never');
    expect(named(c, 'ANY').composition.anyOf.length).toBe(2);
    expect(named(c, 'EN').nullability).toEqual({ allowsNull: true, origin: 'enum-includes-null' });
    expect(named(c, 'CE')).toMatchObject({ enumValues: ['a'], enumOrigin: 'both' });
    expect(named(c, 'CX').enumValues).toEqual([]);
    expect([...named(c, 'X').extensions]).toEqual([['x-foo', expect.anything()]]);
  });

  it('handles additionalProperties spellings and type unions', async () => {
    const { contract: c, diagnostics } = await raw(
      schemas31(`    T: {additionalProperties: true}
    F: {additionalProperties: false}
    E: {additionalProperties: {}}
    D: {type: [string, integer, "null"]}
    W: {additionalProperties: 3, type: 7}
`),
    );
    expect(named(c, 'T').object.additionalProperties).toEqual({ kind: 'any', origin: 'explicit-true' });
    expect(named(c, 'F').object.additionalProperties).toEqual({ kind: 'none', origin: 'explicit-false' });
    expect(named(c, 'E').object.additionalProperties).toEqual({ kind: 'any', origin: 'explicit-empty-schema' });
    expect([...(named(c, 'D').types ?? [])]).toEqual(['integer', 'null', 'string']);
    expect(named(c, 'D').nullability).toEqual({ allowsNull: true, origin: 'type-includes-null' });
    expect(diagnostics.map((d) => d.message)).toEqual(['Invalid "type"', 'Invalid "additionalProperties"']);
  });

  it('rejects exclusive bounds of the wrong spelling for the dialect', async () => {
    const a = await raw(schemas30('    A: {type: number, minimum: 1, exclusiveMinimum: 1}\n'));
    expect(a.diagnostics.map((d) => d.message)).toEqual(['"exclusiveMinimum" must be a boolean in OpenAPI 3.0']);
    const b = await raw(schemas31('    B: {type: number, maximum: 1, exclusiveMaximum: true}\n'));
    expect(b.diagnostics.map((d) => d.message)).toEqual(['"exclusiveMaximum" must be a number in OpenAPI 3.1']);
    expect(named(b.contract, 'B').numeric.maximum?.value.text).toBe('1');
  });

  it('builds implicit and explicit discriminator mappings', async () => {
    const { contract: c, diagnostics } = await raw(
      schemas30(`    Pet:
      oneOf: [{$ref: '#/components/schemas/Cat'}, {$ref: '#/components/schemas/Dog~1x'}, {$ref: 'other.yaml#/Bird'}, {type: object}]
      discriminator:
        propertyName: kind
        mapping: {kitty: Cat, ext: 'other.yaml#/Bird', bad: 5, missing: 'other.yaml#/Nope', broken: 'http://[x', weird: '#bad'}
    Cat: {type: object}
    Dog/x: {type: object}
    NoProp: {oneOf: [{type: object}], discriminator: {mapping: {}}}
`),
      { 'file:///api/other.yaml': 'Bird: {type: object}\n' },
    );
    const pet = named(c, 'Pet');
    expect(pet.discriminator?.propertyName).toBe('kind');
    expect([...(pet.discriminator?.mapping.keys() ?? [])].sort()).toEqual(['Cat', 'Dog/x', 'ext', 'kitty']);
    expect(pet.discriminator?.mapping.get('ext')?.target).toBe('file:///api/other.yaml#/Bird');
    expect(codes(diagnostics).filter((x) => x === 'CGD-SEM-005').length).toBe(3);
    expect(named(c, 'NoProp').discriminator).toBeUndefined();
  });

  it('keeps 3.1 $ref siblings, records unsupported keywords and dynamic refs', async () => {
    const { contract: c } = await raw(
      schemas31(`    R: {$ref: '#/components/schemas/B', minLength: 2}
    B: {type: string}
    U: {type: object, dependentRequired: {a: [b]}, unevaluatedProperties: false}
    Dyn: {$dynamicAnchor: node, $dynamicRef: '#node', type: object}
    Single: {allOf: [{$ref: '#/components/schemas/B'}], description: only}
    Multi: {allOf: [{$ref: '#/components/schemas/B'}, {minLength: 1}]}
`),
    );
    const r = named(c, 'R');
    expect(r.composition.allOf.map((e) => e.target)).toEqual([`${ROOT}#/components/schemas/B`]);
    expect(r.composition.allOfOrigins).toEqual(['ref-sibling']);
    expect(named(c, 'U').unsupported.map((u) => u.keyword)).toEqual(['dependentRequired', 'unevaluatedProperties']);
    expect(named(c, 'Dyn').unsupported.map((u) => u.keyword)).toContain('$dynamicRef');
    expect(c.namedSchemas.get('Single')).toBe(`${ROOT}#/components/schemas/B`);
    expect(named(c, 'Multi').composition.allOfOrigins).toEqual(['allOf', 'allOf']);
  });

  it('models unresolved schema references as unsupported trivial nodes', async () => {
    const { contract: c, diagnostics } = await raw(
      schemas31(`    A: {$ref: './missing.yaml#/X'}
    B: {$ref: './missing.yaml#/X', minLength: 1}
    C: {properties: {p: {$ref: '#/components/schemas/Nope'}}}
`),
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    const a = named(c, 'A');
    expect(a.trivial).toBe('any');
    expect(a.unsupported[0]?.keyword).toMatch(/^\$ref-unresolved:/);
    expect(named(c, 'B').composition.allOf[0]?.target).toMatch(/~unresolved$/);
  });

  it('reports invalid schema shapes', async () => {
    const r = await raw(schemas30('    A: {properties: {x: 5, y: [1]}}\n    B: {items: {}, type: array}\n'));
    expect(r.diagnostics.map((d) => d.message)).toEqual(['Expected a schema object', 'Expected a schema object']);
    expect(named(r.contract, 'B').array.items).toBeUndefined();
  });

  it('follows $ref chains to non-objects and cycles with diagnostics', async () => {
    const r = await raw(
      `openapi: 3.0.3
info: {title: t, version: v}
paths:
  /a: {$ref: '#/components/x-items/bad'}
  /b:
    parameters: [{$ref: '#/components/parameters/Loop'}]
    get:
      requestBody: {$ref: '#/components/x-items/bad'}
      responses:
        '200': {$ref: '#/components/x-items/bad'}
        '201':
          description: x
          headers: {X-A: {$ref: '#/components/x-items/bad'}}
          content: {application/json: {$ref: '#/components/x-items/bad'}, text/plain: {encoding: {p: {$ref: '#/components/x-items/bad'}}}}
components:
  x-items: {bad: 5}
  parameters:
    Loop: {$ref: '#/components/parameters/Loop2'}
    Loop2: {$ref: '#/components/parameters/Loop'}
`,
      {},
      'candidate',
    );
    const msgs = r.diagnostics.map((d) => d.message);
    expect(msgs.filter((m) => m.startsWith('Expected')).length).toBeGreaterThanOrEqual(5);
    expect(codes(r.diagnostics)).toContain('CGD-REF-004');
    expect(r.diagnostics.every((d) => d.side === 'candidate')).toBe(true);
    const op = r.contract.operations.get('GET /b' as never);
    expect(op?.requestBody).toBeUndefined();
    expect([...(op?.responses.keys() ?? [])]).toEqual(['201']);
  });
});

describe('operations, security and servers edge cases', () => {
  it('handles tags, odd security requirements, servers and info defaults', async () => {
    const { contract: c, diagnostics } = await raw(`openapi: 3.0.3
info: {}
servers: [5, {description: no url}, {url: 'relative/path', variables: {v: 3}}]
paths:
  /t:
    get:
      tags: [a, 5, b]
      deprecated: true
      x-internal: true
      security: [5, {k: notAnArray}, {k: [z, a, z]}, {k: [a, z]}]
      responses: {'200': {description: ok}}
components:
  securitySchemes:
    k: {type: apiKey}
    h: {type: http}
    o: {type: oauth2, flows: {implicit: 5, password: {tokenUrl: 'https://t'}}}
    oi: {type: openIdConnect}
    q: {type: apiKey, name: Key, in: query}
`);
    expect(c.info).toEqual({ title: '', version: '' });
    expect(c.servers.map((s) => s.basePath)).toEqual(['/relative/path']);
    expect(diagnostics.map((d) => d.message)).toContain('Server needs a "url"');
    const op = c.operations.get('GET /t' as never);
    expect(op?.tags).toEqual(['a', 'b']);
    expect(op?.deprecated).toBe(true);
    expect([...(op?.extensions.keys() ?? [])]).toEqual(['x-internal']);
    expect(op?.security.alternatives.map((a) => [...a].map(([k, s]) => [k, [...s]]))).toEqual([
      [['k', ['a', 'z']]],
      [['k', []]],
    ]);
    expect(c.securitySchemes.get('k')).toMatchObject({ type: 'apiKey', name: '', in: 'header' });
    expect(c.securitySchemes.get('q')).toMatchObject({ in: 'query' });
    expect(c.securitySchemes.get('q')?.fingerprint).not.toBe(c.securitySchemes.get('k')?.fingerprint);
    expect(c.securitySchemes.get('h')).toMatchObject({ type: 'http', scheme: '' });
    const o = c.securitySchemes.get('o');
    expect(o?.type === 'oauth2' ? [...o.flows.keys()] : []).toEqual(['password']);
    expect(c.securitySchemes.get('oi')).toMatchObject({ openIdConnectUrl: '' });
  });

  it('treats an empty security list as anonymous and a missing one as "none"', async () => {
    const { contract: c } = await raw(`openapi: 3.0.3
info: {title: t, version: v}
paths:
  /a: {get: {security: [], responses: {'200': {description: ok}}}}
  /b: {get: {responses: {'200': {description: ok}}}}
`);
    expect(c.operations.get('GET /a' as never)?.security).toMatchObject({
      origin: 'operation',
      anonymousAllowed: true,
    });
    expect(c.operations.get('GET /b' as never)?.security).toEqual({
      origin: 'none',
      alternatives: [],
      anonymousAllowed: true,
    });
  });

  it('handles documents without paths and a content parameter with an invalid media type', async () => {
    const { contract: c, diagnostics } = await raw(`openapi: 3.1.0
info: {title: t, version: v}
components:
  parameters:
    P: {name: p, in: query, content: {'??': {}}}
`);
    expect(c.operations.size).toBe(0);
    expect(diagnostics).toEqual([]);
    const bad = await raw(`openapi: 3.1.0
info: {title: t, version: v}
paths:
  /x:
    get:
      parameters: [{name: p, in: query, content: {'??': {schema: {type: string}}}}]
      responses: {'200': {description: ok}}
`);
    const p = bad.contract.operations.get('GET /x' as never)?.parameters.get('query:p' as never);
    expect(p?.value.kind).toBe('content');
  });

  it('orders operations by path then method', async () => {
    const { contract: c } = await raw(`openapi: 3.0.3
info: {title: t, version: v}
paths:
  /b: {post: {responses: {'200': {description: ok}}}, get: {responses: {'200': {description: ok}}}}
  /a: {delete: {responses: {'200': {description: ok}}}}
`);
    expect([...c.operations.keys()]).toEqual(['DELETE /a', 'GET /b', 'POST /b']);
  });

  it('fails normalization when the root is not an object', () => {
    const r = normalize(
      {
        root: ROOT,
        dialect: 'oas30',
        documents: new Map(),
        references: new Map(),
        identifiers: new Map(),
        totalBytes: 0,
      } as never,
      { dialect: 'oas30', version: '3.0.0' },
      { limits: DEFAULT_LIMITS, side: 'base' },
    );
    expect(r.value).toBeUndefined();
    expect(r.diagnostics[0]).toMatchObject({ code: 'CGD-SPEC-001', side: 'base' });
  });

  it('propagates load failures through loadContract with side information', async () => {
    const r = await loadContract(ROOT, {
      loader: new MemorySourceLoader([], ['file:']),
      policy: POLICY,
      limits: DEFAULT_LIMITS,
      side: 'base',
      signal: new AbortController().signal,
    });
    expect(r.value).toBeUndefined();
    expect(r.diagnostics.every((d) => d.side === 'base')).toBe(true);
  });
});
