import {
  DEFAULT_LIMITS,
  documentUri,
  type ApiContract,
  type Diagnostic,
  type ReferencePolicy,
  type SchemaNode,
} from '@contractguard/core';
import { describe, expect, it } from 'vitest';
import { loadContract, type LoadContractOptions } from '../../src/load-contract.js';
import { MemorySourceLoader } from '../../src/load/memory-loader.js';
import { basePathOf, pathSegments } from '../../src/normalize/operations.js';
import { parseDocument } from '../../src/parse/parser.js';
import { toPlainJson, type SpecValidator } from '../../src/validate/structural.js';
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

async function load(
  text: string,
  options: Partial<LoadContractOptions> = {},
  extra: Record<string, string> = {},
): Promise<{ contract?: ApiContract; diagnostics: readonly Diagnostic[]; degraded?: boolean }> {
  const loader = new MemorySourceLoader(
    [[ROOT, text], ...Object.entries(extra).map(([k, v]) => [documentUri(k), v] as const)],
    ['file:'],
  );
  const r = await loadContract(ROOT, { loader, policy: POLICY, limits: DEFAULT_LIMITS, validator: false, ...options });
  return r.value === undefined
    ? { diagnostics: r.diagnostics }
    : { contract: r.value.contract, diagnostics: r.diagnostics, degraded: r.value.degraded };
}

async function contractOf(text: string, options: Partial<LoadContractOptions> = {}): Promise<ApiContract> {
  const r = await load(text, options);
  if (r.contract === undefined) throw new Error(r.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'));
  return r.contract;
}

function node(c: ApiContract, pointer: string): SchemaNode {
  const n = c.schemas.nodes.get(`${ROOT}${pointer}` as never);
  if (n === undefined) throw new Error(`no node at ${pointer}; have ${[...c.schemas.nodes.keys()].join(', ')}`);
  return n;
}

function prop(c: ApiContract, owner: SchemaNode, name: string): SchemaNode {
  const edge = owner.object.properties.get(name);
  if (edge === undefined) throw new Error(`no property ${name}`);
  return c.schemas.nodes.get(edge.target) as SchemaNode;
}

/** Version- and formatting-independent projection of a contract (drops positions and spellings). */
function semantic(c: ApiContract): string {
  const DROP = new Set(['source', 'via', 'range', 'dialect', 'origin', 'spec', 'documents', 'explicit', 'unsupported']);
  return JSON.stringify(c, (key, value: unknown) => {
    if (DROP.has(key)) return undefined;
    if (value instanceof Map) return [...(value as Map<unknown, unknown>)];
    if (value instanceof Set) return [...(value as Set<unknown>)];
    return value;
  });
}

const PETS_30 = `openapi: 3.0.3
info: {title: Pets, version: "1.0"}
servers: [{url: "https://api.example.com/v1/"}]
security: [{apiKey: []}]
paths:
  /pets/{petId}:
    parameters:
      - {name: petId, in: path, required: true, schema: {type: string}}
      - {name: X-Trace, in: header, schema: {type: string}}
    get:
      operationId: getPet
      parameters:
        - {name: fields, in: query, schema: {type: array, items: {type: string}}}
      responses:
        '200':
          description: ok
          headers: {X-Rate: {schema: {type: integer}, required: true}, Content-Type: {schema: {type: string}}}
          content:
            Application/JSON: {schema: {$ref: '#/components/schemas/Pet'}}
        default: {$ref: '#/components/responses/Error'}
      security: [{oauth: [read, read]}, {}]
  /pets:
    post:
      requestBody:
        required: true
        content: {application/json: {schema: {$ref: '#/components/schemas/Pet'}}}
      responses: {'201': {description: created}}
components:
  securitySchemes:
    apiKey: {type: apiKey, name: X-API-Key, in: header}
    oauth: {type: oauth2, flows: {clientCredentials: {tokenUrl: 'https://auth/token', scopes: {read: r, write: w}}}}
  responses:
    Error: {description: err, content: {application/json: {schema: {type: object, properties: {code: {type: integer}}}}}}
  schemas:
    Pet:
      type: object
      required: [id, name]
      properties:
        id: {type: integer, minimum: 0, exclusiveMinimum: true}
        name: {type: string, nullable: true, maxLength: 50}
        tag: {type: string, enum: [a, b, a]}
        kids: {type: array, items: {$ref: '#/components/schemas/Pet'}}
        meta: {allOf: [{$ref: '#/components/schemas/Meta'}]}
      additionalProperties: false
    Meta: {type: object, properties: {created: {type: string, format: date-time}}}
`;

const PETS_31 = PETS_30.replace('openapi: 3.0.3', 'openapi: 3.1.0')
  .replace('{type: integer, minimum: 0, exclusiveMinimum: true}', '{type: integer, exclusiveMinimum: 0}')
  .replace('{type: string, nullable: true, maxLength: 50}', '{type: [string, "null"], maxLength: 50}');

describe('normalize: operations', () => {
  it('builds keyed, sorted operations with merged parameters, bodies, responses and security', async () => {
    const c = await contractOf(PETS_30);
    expect([...c.operations.keys()]).toEqual(['POST /pets', 'GET /pets/{}']);
    const get = c.operations.get('GET /pets/{}' as never);
    expect(get?.operationId).toBe('getPet');
    expect([...(get?.parameters.keys() ?? [])]).toEqual(['header:x-trace', 'path:#1', 'query:fields']);
    expect(get?.parameters.get('path:#1' as never)?.required).toBe(true);
    expect(get?.parameters.get('query:fields' as never)?.serialization).toMatchObject({ style: 'form', explode: true });
    expect(get?.parameters.get('header:x-trace' as never)?.serialization).toMatchObject({
      style: 'simple',
      explode: false,
    });

    const ok = get?.responses.get('200' as never);
    expect(ok?.statusClass).toBe('success');
    expect([...(ok?.headers.keys() ?? [])]).toEqual(['x-rate']); // Content-Type header ignored
    expect([...(ok?.content.keys() ?? [])]).toEqual(['application/json']);
    expect(ok?.content.get('application/json' as never)?.schema?.target).toBe(`${ROOT}#/components/schemas/Pet`);

    const dflt = get?.responses.get('default' as never);
    expect(dflt?.source.pointer).toBe('#/components/responses/Error');
    expect(dflt?.via.map((v) => v.pointer)).toEqual(['#/paths/~1pets~1{petId}/get/responses/default']);

    expect(get?.security).toMatchObject({ origin: 'operation', anonymousAllowed: true });
    expect(get?.security.alternatives.map((a) => [...a].map(([n, s]) => [n, [...s]]))).toEqual([[['oauth', ['read']]]]);

    const post = c.operations.get('POST /pets' as never);
    expect(post?.requestBody?.required).toBe(true);
    expect(post?.security).toMatchObject({ origin: 'root', anonymousAllowed: false });
    expect(c.servers.map((s) => s.basePath)).toEqual(['/v1']);
    expect([...c.securitySchemes.keys()]).toEqual(['apiKey', 'oauth']);
    expect([...c.namedSchemas.keys()]).toEqual(['Meta', 'Pet']);
  });

  it('records traceability: positions of operations and parameters', async () => {
    const c = await contractOf(PETS_30);
    const get = c.operations.get('GET /pets/{}' as never);
    expect(get?.source).toMatchObject({ uri: ROOT, pointer: '#/paths/~1pets~1{petId}/get' });
    expect(get?.source.range?.start.line).toBeGreaterThan(1);
    expect(get?.parameters.get('path:#1' as never)?.source.pointer).toBe('#/paths/~1pets~1{petId}/parameters/0');
  });

  it('defaults servers to "/" and computes base paths', async () => {
    const c = await contractOf('openapi: 3.0.0\ninfo: {title: t, version: v}\npaths: {}\n');
    expect(c.servers.map((s) => s.basePath)).toEqual(['/']);
    expect(c.operations.size).toBe(0);
    expect(basePathOf('https://x.test')).toBe('/');
    expect(basePathOf('https://x.test/a/b/')).toBe('/a/b');
    expect(basePathOf('/api/v2?x=1')).toBe('/api/v2');
    expect(basePathOf('api')).toBe('/api');
    const vars = await contractOf(`openapi: 3.0.0
info: {title: t, version: v}
servers: [{url: 'https://{host}/{base}', variables: {host: {default: h}, base: {default: v2, enum: [v1, v2]}}}]
paths: {}
`);
    expect(vars.servers[0]?.basePath).toBe('/v2');
    expect(vars.servers[0]?.variables.get('base')?.enum).toEqual(['v1', 'v2']);
  });

  it('splits path segments', () => {
    expect(pathSegments('/a/{id}/b{x}.{y}')).toEqual([
      { kind: 'literal', value: 'a' },
      { kind: 'template', name: 'id', position: 1 },
      { kind: 'mixed', raw: 'b{x}.{y}', names: ['x', 'y'] },
    ]);
  });

  it('reports semantic errors: equivalent paths, duplicate operationIds, path params, unknown schemes', async () => {
    const r = await load(`openapi: 3.0.0
info: {title: t, version: v}
paths:
  /a/{x}:
    get:
      operationId: dup
      parameters: [{name: y, in: path, required: true, schema: {type: string}}]
      responses: {'200': {description: ok}}
  /a/{z}:
    get: {responses: {'200': {description: ok}}}
  /b:
    get:
      operationId: dup
      security: [{nope: []}]
      responses: {'200': {description: ok}}
`);
    expect(r.contract).toBeUndefined();
    expect(codes(r.diagnostics)).toEqual(
      expect.arrayContaining(['CGD-SEM-001', 'CGD-SEM-002', 'CGD-SEM-003', 'CGD-SEM-004']),
    );
  });

  it('keeps the contract when allowInvalidSpec is set, and marks it degraded', async () => {
    const r = await load(
      `openapi: 3.0.0
info: {title: t, version: v}
paths:
  /a/{x}:
    get: {responses: {'200': {description: ok}}}
`,
      { allowInvalidSpec: true },
    );
    expect(r.degraded).toBe(true);
    expect(codes(r.diagnostics)).toContain('CGD-SEM-003');
    expect(r.contract?.operations.size).toBe(1);
  });

  it('warns about ignored header parameters and unknown path-item keys', async () => {
    const r = await load(`openapi: 3.0.0
info: {title: t, version: v}
paths:
  /a:
    query: {responses: {'200': {description: ok}}}
    get:
      parameters:
        - {name: Accept, in: header, schema: {type: string}}
        - {name: Authorization, in: header}
        - {name: q, in: query}
      responses: {'200': {description: ok}, x-note: 1}
`);
    expect(codes(r.diagnostics)).toEqual(['CGD-SPEC-105', 'CGD-SPEC-106', 'CGD-SPEC-106']);
    const get = r.contract?.operations.get('GET /a' as never);
    expect([...(get?.parameters.keys() ?? [])]).toEqual(['query:q']);
    // A parameter without schema accepts anything.
    const q = get?.parameters.get('query:q' as never);
    expect(q?.value.kind).toBe('schema');
    if (q?.value.kind === 'schema') expect(r.contract?.schemas.nodes.get(q.value.schema.target)?.trivial).toBe('any');
    expect([...(get?.responses.keys() ?? [])]).toEqual(['200']);
  });

  it('normalizes content parameters, encodings, status ranges and media type keys', async () => {
    const c = await contractOf(`openapi: 3.0.0
info: {title: t, version: v}
paths:
  /up:
    post:
      parameters:
        - name: filter
          in: query
          content: {application/json: {schema: {type: object}}}
      requestBody:
        content:
          multipart/form-data:
            schema: {type: object}
            encoding:
              file: {contentType: image/png, headers: {X-Part: {schema: {type: string}}}}
              meta: {style: form, explode: false}
      responses:
        2xx: {description: ok}
        '404': {description: missing}
`);
    const op = c.operations.get('POST /up' as never);
    const filter = op?.parameters.get('query:filter' as never);
    expect(filter?.value.kind).toBe('content');
    const enc = op?.requestBody?.content.get('multipart/form-data' as never)?.encoding;
    expect(enc?.get('file')?.contentType).toBe('image/png');
    expect([...(enc?.get('file')?.headers.keys() ?? [])]).toEqual(['x-part']);
    expect(enc?.get('meta')?.serialization).toMatchObject({ style: 'form', explode: false });
    expect([...(op?.responses.keys() ?? [])]).toEqual(['2XX', '404']);
    expect(op?.responses.get('404' as never)?.statusClass).toBe('client-error');
  });

  it('reports invalid media types, statuses, paths and duplicate normalized keys', async () => {
    const r = await load(
      `openapi: 3.0.0
info: {title: t, version: v}
paths:
  nope: {}
  /a:
    get:
      parameters: [{in: query}]
      requestBody:
        content: {'application/json': {}, 'Application/JSON': {}, 'not a type': {}}
      responses: {'200': {description: a}, '2xx': {description: b}, '2XX': {description: c}, '999x': {description: d}}
`,
      { allowInvalidSpec: true },
    );
    const msgs = r.diagnostics.map((d) => d.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        'Path "nope" must start with "/"',
        'Parameter needs "name" and "in"',
        'Invalid media type "not a type"',
        'Invalid response status "999x"',
      ]),
    );
    expect(msgs.some((m) => m.includes('duplicates another entry'))).toBe(true);
  });

  it('normalizes security schemes with stable fingerprints', async () => {
    const c = await contractOf(`openapi: 3.1.0
info: {title: t, version: v}
paths: {}
components:
  securitySchemes:
    k: {type: apiKey, name: X-Key, in: header}
    b: {type: http, scheme: Bearer, bearerFormat: JWT}
    o: {type: openIdConnect, openIdConnectUrl: 'https://id/.well-known'}
    m: {type: mutualTLS}
    a: {type: oauth2, flows: {authorizationCode: {authorizationUrl: 'https://a', tokenUrl: 'https://t', refreshUrl: 'https://r', scopes: {b: x, a: y}}}}
`);
    const s = c.securitySchemes;
    expect([...s.keys()]).toEqual(['a', 'b', 'k', 'm', 'o']);
    expect(s.get('b')).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    const a = s.get('a');
    expect(a?.type === 'oauth2' ? [...(a.flows.get('authorizationCode')?.scopes ?? [])] : []).toEqual(['a', 'b']);
    const renamed = await contractOf(`openapi: 3.1.0
info: {title: t, version: v}
paths: {}
components:
  securitySchemes:
    key2: {type: apiKey, name: x-key, in: header, description: changed}
`);
    expect(renamed.securitySchemes.get('key2')?.fingerprint).toBe(s.get('k')?.fingerprint);
    for (const scheme of s.values()) expect(scheme.fingerprint).toMatch(/^[0-9a-f]{16}$/);

    const bad = await load(
      'openapi: 3.0.0\ninfo: {title: t, version: v}\npaths: {}\ncomponents: {securitySchemes: {z: {type: magic}}}\n',
    );
    expect(bad.diagnostics.map((d) => d.message)).toContain('Unknown security scheme type "magic"');
  });

  it('records callbacks and webhooks as unsupported features', async () => {
    const c = await contractOf(`openapi: 3.1.0
info: {title: t, version: v}
webhooks: {ping: {post: {responses: {'200': {description: ok}}}}}
paths:
  /s:
    post:
      callbacks: {cb: {'{$request.body#/url}': {post: {responses: {'200': {description: ok}}}}}}
      responses: {'200': {description: ok}}
`);
    expect(c.unsupported.map((u) => u.feature)).toEqual(['webhooks', 'callbacks']);
    expect(c.operations.get('POST /s' as never)?.hasCallbacks).toBe(true);
  });
});

describe('normalize: schemas', () => {
  it('normalizes constraints, nullability, enums and unwraps single allOf', async () => {
    const c = await contractOf(PETS_30);
    const pet = node(c, '#/components/schemas/Pet');
    expect([...(pet.types ?? [])]).toEqual(['object']);
    expect([...pet.object.required]).toEqual(['id', 'name']);
    expect(pet.object.additionalProperties.kind).toBe('none');
    expect([...pet.object.properties.keys()]).toEqual(['id', 'kids', 'meta', 'name', 'tag']);
    const id = prop(c, pet, 'id');
    expect(id.numeric.minimum?.value.text).toBe('1'); // integer exclusive 0 → inclusive 1
    expect(id.numeric.minimum?.exclusive).toBe(false);
    expect(prop(c, pet, 'name').nullability).toEqual({ allowsNull: true, origin: 'oas30-nullable' });
    expect(prop(c, pet, 'tag').enumValues).toEqual(['a', 'b']);
    expect(pet.object.properties.get('meta')?.target).toBe(`${ROOT}#/components/schemas/Meta`);
    expect(prop(c, pet, 'kids').array.items?.target).toBe(`${ROOT}#/components/schemas/Pet`);
  });

  it('produces equivalent contracts for equivalent 3.0 and 3.1 documents', async () => {
    const a = await contractOf(PETS_30);
    const b = await contractOf(PETS_31);
    expect(b.spec.dialect).toBe('oas31');
    expect(semantic(b)).toBe(semantic(a));
  });

  it('is invariant to formatting: JSON and YAML spellings normalize identically', async () => {
    const yaml = await contractOf(PETS_30);
    const parsed = parseDocument({ uri: ROOT, bytes: new TextEncoder().encode(PETS_30) }, { limits: DEFAULT_LIMITS });
    const pretty = JSON.stringify(toPlainJson(parsed.value?.value ?? null), null, 7);
    expect(pretty.startsWith('{\n       "components"')).toBe(true);
    expect(semantic(await contractOf(pretty))).toBe(semantic(yaml));
  });

  it('warns about nullable without type and reports unreachable required properties', async () => {
    const r = await load(`openapi: 3.0.0
info: {title: t, version: v}
paths: {}
components:
  schemas:
    A: {nullable: true}
    B: {type: object, required: [ghost], additionalProperties: false}
`);
    expect(codes(r.diagnostics)).toEqual(['CGD-SPEC-110', 'CGD-SEM-106']);
  });

  it('reports discriminator mappings to missing schemas', async () => {
    const r = await load(
      `openapi: 3.0.0
info: {title: t, version: v}
paths: {}
components:
  schemas:
    Pet:
      oneOf: [{$ref: '#/components/schemas/Cat'}]
      discriminator: {propertyName: kind, mapping: {cat: Cat, dog: '#/components/schemas/Dog'}}
    Cat: {type: object}
`,
      { allowInvalidSpec: true },
    );
    expect(codes(r.diagnostics)).toContain('CGD-SEM-005');
    const pet = node(r.contract as ApiContract, '#/components/schemas/Pet');
    expect(pet.discriminator?.propertyName).toBe('kind');
    expect(pet.composition.oneOf.map((e) => e.target)).toEqual([`${ROOT}#/components/schemas/Cat`]);
  });

  it('handles 3.1 boolean schemas, const, prefixItems and $ref siblings', async () => {
    const c = await contractOf(`openapi: 3.1.0
info: {title: t, version: v}
paths: {}
components:
  schemas:
    Any: true
    None: false
    C: {const: 5}
    T: {type: array, prefixItems: [{type: string}], items: false}
    R: {$ref: '#/components/schemas/C', description: d, maxLength: 3}
`);
    expect(node(c, '#/components/schemas/Any').trivial).toBe('any');
    expect(node(c, '#/components/schemas/None').trivial).toBe('never');
    const k = node(c, '#/components/schemas/C');
    expect(k.enumOrigin).toBe('const');
    expect(k.enumValues?.map(String)).toEqual(['5']);
    const t = node(c, '#/components/schemas/T');
    expect(t.array.prefixItems?.length).toBe(1);
    const r = node(c, '#/components/schemas/R');
    expect(r.composition.allOfOrigins).toContain('ref-sibling');
    expect(r.string.maxLength).toBe(3);
  });

  it('rejects boolean schemas in 3.0 and records unresolved references as unsupported', async () => {
    const r = await load(
      `openapi: 3.0.0
info: {title: t, version: v}
paths: {}
components:
  schemas:
    B: {properties: {x: true}}
`,
      { allowInvalidSpec: true },
    );
    expect(r.diagnostics.map((d) => d.message)).toContain('Boolean schemas are not valid in OpenAPI 3.0');
  });

  it('runs the structural validator by default and stops on spec errors', async () => {
    const r = await load('openapi: 3.0.0\ninfo: {title: t}\npaths: {}\n', { validator: undefined } as never);
    expect(codes(r.diagnostics)).toContain('CGD-SPEC-005');
    expect(r.contract).toBeUndefined();
  });

  it('accepts a custom validator and stops early on parse or version errors', async () => {
    const seen: string[] = [];
    const validator: SpecValidator = {
      validate(doc) {
        seen.push(doc.uri);
        return Promise.resolve({ diagnostics: [] });
      },
    };
    const ok = await load('openapi: 3.0.0\ninfo: {title: t, version: v}\npaths: {}\n', { validator });
    expect(ok.contract).toBeDefined();
    expect(seen).toEqual([ROOT]);
    expect(codes((await load('{', { validator })).diagnostics)).toContain('CGD-PARSE-001');
    expect(codes((await load('swagger: "2.0"\n', { validator })).diagnostics)).toEqual(['CGD-SPEC-003']);
    const missing = await loadContract(documentUri('file:///api/missing.yaml'), {
      loader: new MemorySourceLoader([], ['file:']),
      policy: POLICY,
      limits: DEFAULT_LIMITS,
    });
    expect(missing.value).toBeUndefined();
    expect(missing.diagnostics.length).toBeGreaterThan(0);
  });

  it('stops on unresolved references (always fatal)', async () => {
    const r = await load(
      `openapi: 3.0.0
info: {title: t, version: v}
paths: {}
components: {schemas: {A: {$ref: './other.yaml#/X'}}}
`,
      { allowInvalidSpec: true },
    );
    expect(r.contract).toBeUndefined();
    expect(r.diagnostics.some((d) => d.category === 'reference' || d.category === 'filesystem')).toBe(true);
  });

  it('is deterministic across runs', async () => {
    const a = await contractOf(PETS_30);
    const b = await contractOf(PETS_30);
    expect(semantic(a)).toBe(semantic(b));
    expect([...a.schemas.nodes.keys()]).toEqual([...b.schemas.nodes.keys()]);
  });
});
