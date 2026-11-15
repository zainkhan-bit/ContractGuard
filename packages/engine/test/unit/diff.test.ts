import { describe, expect, it } from 'vitest';
import { brief, diff, HEAD30, HEAD31 } from '../helpers.js';

const op = (body: string): string => `${HEAD30}paths:\n${body}`;
const kinds = async (a: string, b: string): Promise<string[]> => (await diff(a, b)).map(brief);

const PETS = `${HEAD30}servers: [{url: 'https://api.test/v1'}]
paths:
  /pets/{id}:
    get:
      operationId: getPet
      parameters:
        - {name: id, in: path, required: true, schema: {type: integer}}
      responses:
        '200': {description: ok, content: {application/json: {schema: {$ref: '#/components/schemas/Pet'}}}}
        default: {description: err, content: {application/json: {schema: {$ref: '#/components/schemas/Err'}}}}
  /pets:
    post:
      requestBody: {required: true, content: {application/json: {schema: {$ref: '#/components/schemas/Pet'}}}}
      responses: {'201': {description: ok}}
components:
  schemas:
    Err: {type: object, properties: {code: {type: integer}}}
    Pet:
      type: object
      required: [name]
      properties:
        id: {type: integer, readOnly: true}
        name: {type: string, nullable: true}
        kids: {type: array, items: {$ref: '#/components/schemas/Pet'}}
`;

describe('diffContracts: invariants', () => {
  it('reports nothing for identical contracts', async () => {
    expect(await kinds(PETS, PETS)).toEqual([]);
  });

  it('reports nothing for an equivalent 3.0 → 3.1 migration', async () => {
    const v31 = PETS.replace('openapi: 3.0.3', 'openapi: 3.1.0').replace(
      '{type: string, nullable: true}',
      "{type: [string, 'null']}",
    );
    expect(await kinds(PETS, v31)).toEqual([]);
  });

  it('reports nothing when components are renamed, moved or split with allOf', async () => {
    const moved = PETS.replaceAll('#/components/schemas/Pet', '#/components/schemas/Animal')
      .replace('    Pet:\n', '    Animal:\n')
      .replace(
        '      required: [name]\n      properties:\n        id: {type: integer, readOnly: true}\n',
        '      required: [name]\n      allOf: [{properties: {id: {type: integer, readOnly: true}}}]\n      properties:\n',
      );
    expect(moved).toContain('allOf');
    expect(await kinds(PETS, moved)).toEqual([]);
  });

  it('is deterministic', async () => {
    const changed = PETS.replace('required: [name]', 'required: [name, kids]');
    const a = await diff(PETS, changed);
    const b = await diff(PETS, changed);
    expect(a).toEqual(b);
  });
});

describe('diffContracts: operations', () => {
  const base = op(`  /a:
    get: {operationId: listA, responses: {'200': {description: ok}}}
  /b:
    get: {responses: {'200': {description: ok}}}
  /Case/:
    get: {responses: {'200': {description: ok}}}
  /u/{id}:
    get:
      operationId: getU
      parameters: [{name: id, in: path, required: true, schema: {type: string}}]
      responses: {'200': {description: ok}}
`);

  it('reports removals, additions, probable renames, deprecation and id/template renames', async () => {
    const cand = op(`  /a2:
    get: {operationId: listA, responses: {'200': {description: ok}}}
  /case:
    get: {responses: {'200': {description: ok}}}
  /c:
    get: {responses: {'200': {description: ok}}}
  /u/{userId}:
    get:
      operationId: fetchU
      deprecated: true
      parameters: [{name: userId, in: path, required: true, schema: {type: string}}]
      responses: {'200': {description: ok}}
`);
    expect(await kinds(base, cand)).toEqual([
      'GET /Case/ | operation | operation.probableRename {"fromKey":"GET /Case/","toKey":"GET /case","evidence":"structural"}',
      'GET /a | operation | operation.probableRename {"fromKey":"GET /a","toKey":"GET /a2","evidence":"operationId"}',
      'GET /b | operation | operation.removed {}',
      'GET /c | operation | operation.added {}',
      'GET /u/{} | operation | operation.deprecated {"deprecated":true}',
      'GET /u/{} | operation | operation.operationIdChanged {}',
      'GET /u/{} | operation | path.parameterRenamed {"position":1,"from":"id","to":"userId"}',
    ]);
  });

  it('flags callback presence changes as unsupported', async () => {
    const withCb = op(`  /a:
    post:
      callbacks: {cb: {'{$request.body#/u}': {post: {responses: {'200': {description: ok}}}}}}
      responses: {'200': {description: ok}}
`);
    const without = op(`  /a:
    post: {responses: {'200': {description: ok}}}
`);
    expect(await kinds(without, withCb)).toEqual([
      'POST /a | operation | schema.unsupportedChanged {"keywords":["callbacks"]}',
    ]);
  });
});

describe('diffContracts: parameters and bodies', () => {
  const base = op(`  /p:
    post:
      parameters:
        - {name: a, in: query, schema: {type: string}}
        - {name: B, in: header, schema: {type: string}}
        - {name: c, in: query, required: true, schema: {type: integer, minimum: 1}}
        - {name: d, in: query, schema: {type: array, items: {type: string}}}
        - {name: e, in: query, content: {application/json: {schema: {type: object}}}}
      requestBody:
        content:
          application/json: {schema: {type: object}}
          text/plain: {schema: {type: string}}
          multipart/form-data: {schema: {type: object}, encoding: {f: {contentType: image/png}}}
      responses: {'200': {description: ok}}
`);

  it('reports parameter and body changes with facts', async () => {
    const cand = op(`  /p:
    post:
      parameters:
        - {name: b, in: query, required: true, schema: {type: string}}
        - {name: c, in: query, schema: {type: integer, minimum: 2}}
        - {name: d, in: query, explode: false, schema: {type: array, items: {type: string}}}
        - {name: e, in: query, content: {text/plain: {schema: {type: string}}}}
        - {name: z, in: query, required: true, schema: {type: string}}
      requestBody:
        required: true
        content:
          application/json: {schema: {type: object}}
          application/xml: {schema: {type: object}}
          multipart/form-data: {schema: {type: object}, encoding: {f: {contentType: image/jpeg}}}
      responses: {'200': {description: ok}}
`);
    expect(await kinds(base, cand)).toEqual([
      'POST /p | param header:b | parameter.locationChanged {"fromIn":"header","toIn":"query","requiredAfter":true}',
      'POST /p | param query:a | parameter.removed {"required":false,"in":"query"}',
      'POST /p | param query:c | parameter.requiredChanged {"from":true,"to":false}',
      'POST /p | param query:c | schema.constraintChanged {"keyword":"minimum","relation":"tightened"}',
      'POST /p | param query:d | parameter.serializationChanged {"fields":["explode"]}',
      'POST /p | param query:e | parameter.serializationChanged {"fields":["contentMediaType"]}',
      'POST /p | param query:e | schema.typeChanged {"from":{"types":["object"]},"to":{"types":["string"]},"relation":"disjoint"}',
      'POST /p | param query:z | parameter.added {"required":true,"in":"query"}',
      'POST /p | body | requestBody.requiredChanged {"from":false,"to":true}',
      'POST /p | body application/xml | mediaType.added {"mediaType":"application/xml"}',
      'POST /p | body multipart/form-data | schema.unsupportedChanged {"keywords":["encoding"]}',
      'POST /p | body text/plain | mediaType.removed {"mediaType":"text/plain"}',
    ]);
  });

  it('reports request body presence changes', async () => {
    const none = op(`  /p:\n    post: {responses: {'200': {description: ok}}}\n`);
    const some = op(
      `  /p:\n    post: {requestBody: {required: true, content: {application/json: {}}}, responses: {'200': {description: ok}}}\n`,
    );
    expect(await kinds(none, some)).toEqual(['POST /p | body | requestBody.added {"required":true}']);
    expect(await kinds(some, none)).toEqual(['POST /p | body | requestBody.removed {"required":true}']);
  });

  it('compares a media type that gains a schema against the unconstrained schema', async () => {
    const a = op(
      `  /p:\n    post: {requestBody: {content: {application/json: {}}}, responses: {'200': {description: ok}}}\n`,
    );
    const b = op(
      `  /p:\n    post: {requestBody: {content: {application/json: {schema: {type: object}}}}, responses: {'200': {description: ok}}}\n`,
    );
    expect(await kinds(a, b)).toEqual([
      'POST /p | body application/json | schema.typeChanged {"from":{"types":"any"},"to":{"types":["object"]},"relation":"subset"}',
    ]);
  });
});

describe('diffContracts: responses', () => {
  const base = op(`  /r:
    get:
      responses:
        '200':
          description: ok
          headers: {X-A: {schema: {type: string}}, X-B: {required: true, schema: {type: string}}, X-C: {schema: {type: integer}}}
          content: {application/json: {schema: {type: object}}}
        '204': {description: none}
        '404': {description: nf, content: {application/json: {schema: {type: object}}}}
        default: {description: err, content: {application/json: {schema: {type: object, properties: {code: {type: integer}}}}}}
`);

  it('uses effective responses and reports header and body changes', async () => {
    const cand = op(`  /r:
    get:
      responses:
        '200':
          description: ok
          headers: {X-B: {schema: {type: string}}, X-C: {schema: {type: string}}, X-D: {schema: {type: string}}}
        '204': {description: none, content: {text/plain: {schema: {type: string}}}}
        '409': {description: conflict, content: {application/json: {schema: {type: object, properties: {code: {type: integer}}}}}}
        4XX: {description: client, content: {application/json: {schema: {type: string}}}}
        default: {description: err, content: {application/json: {schema: {type: object, properties: {code: {type: integer}}}}}}
`);
    expect(await kinds(base, cand)).toEqual([
      'GET /r | res 200 | response.bodyRemoved {}',
      'GET /r | res 200 header x-a | header.removed {"required":false}',
      'GET /r | res 200 header x-b | header.requiredChanged {"from":true,"to":false}',
      'GET /r | res 200 header x-c | schema.typeChanged {"from":{"types":["integer"]},"to":{"types":["string"]},"relation":"disjoint"}',
      'GET /r | res 200 header x-d | header.added {"required":false}',
      'GET /r | res 204 | response.bodyAdded {}',
      'GET /r | res 404 | response.removed {"status":"404","statusClass":"client-error","effectiveFallback":"4XX"}',
      'GET /r | res 404 application/json | schema.typeChanged {"from":{"types":["object"]},"to":{"types":["string"]},"relation":"disjoint"}',
      'GET /r | res 409 | response.added {"status":"409","statusClass":"client-error","effectiveFallback":"default"}',
      'GET /r | res 4XX | response.added {"status":"4XX","statusClass":"client-error","effectiveFallback":"default"}',
      'GET /r | res 4XX application/json | schema.typeChanged {"from":{"types":["object"]},"to":{"types":["string"]},"relation":"disjoint"}',
    ]);
  });

  it('reports media type changes inside a response', async () => {
    const a = op(
      `  /r:\n    get: {responses: {'200': {description: ok, content: {application/json: {schema: {type: string}}}}}}\n`,
    );
    const b = op(
      `  /r:\n    get: {responses: {'200': {description: ok, content: {application/xml: {schema: {type: string}}}}}}\n`,
    );
    expect(await kinds(a, b)).toEqual([
      'GET /r | res 200 application/json | mediaType.removed {"mediaType":"application/json"}',
      'GET /r | res 200 application/xml | mediaType.added {"mediaType":"application/xml"}',
    ]);
  });
});

describe('diffContracts: security and servers', () => {
  const base = `${HEAD30}servers:
  - {url: 'https://a.test/v1'}
  - {url: 'https://b.test/v1'}
  - {url: 'https://{env}.test/api', variables: {env: {default: prod, enum: [prod, dev]}}}
security: [{key: []}]
paths:
  /open: {get: {security: [], responses: {'200': {description: ok}}}}
  /root: {get: {responses: {'200': {description: ok}}}}
  /oauth: {get: {security: [{oauth: [read]}], responses: {'200': {description: ok}}}}
  /opt: {get: {security: [{key: []}, {}], responses: {'200': {description: ok}}}}
components:
  securitySchemes:
    key: {type: apiKey, name: X-Key, in: header}
    oauth: {type: oauth2, flows: {clientCredentials: {tokenUrl: 'https://t', scopes: {read: r, write: w}}}}
    basic: {type: http, scheme: basic}
`;

  it('treats scheme renames as non-breaking and reports real security changes', async () => {
    const cand = `${HEAD30}servers:
  - {url: 'https://a.test/v1'}
  - {url: 'https://{env}.test/api', variables: {env: {default: prod, enum: [prod]}}}
  - {url: 'https://c.test/v2'}
security: [{apiKey: []}]
paths:
  /open: {get: {security: [{apiKey: []}], responses: {'200': {description: ok}}}}
  /root: {get: {responses: {'200': {description: ok}}}}
  /oauth: {get: {security: [{oauth: [read, write]}], responses: {'200': {description: ok}}}}
  /opt: {get: {security: [{apiKey: []}], responses: {'200': {description: ok}}}}
components:
  securitySchemes:
    apiKey: {type: apiKey, name: x-key, in: header}
    oauth: {type: oauth2, flows: {clientCredentials: {tokenUrl: 'https://t2', scopes: {read: r}}}}
    basic: {type: http, scheme: basic, bearerFormat: X}
`;
    expect(await kinds(base, cand)).toEqual([
      '- | servers | server.removed {}',
      '- | servers | server.variableEnumNarrowed {}',
      '- | security | securityScheme.changed {"scheme":"basic","fields":["bearerFormat"],"incompatible":false}',
      '- | security | securityScheme.changed {"scheme":"oauth","fields":["flows.clientCredentials.tokenUrl","flows.clientCredentials.scopes"],"incompatible":true}',
      '- | security | securityScheme.renamed {"from":"key","to":"apiKey"}',
      'GET /oauth | security | security.alternativesChanged {"unsatisfiedBaseAlternatives":[0],"scopeAdditions":[{"scheme":"oauth","scopes":["write"]}],"anonymousRemoved":false,"relaxed":false}',
      'GET /open | security | security.alternativesChanged {"unsatisfiedBaseAlternatives":[],"scopeAdditions":[],"anonymousRemoved":true,"relaxed":false}',
      'GET /opt | security | security.alternativesChanged {"unsatisfiedBaseAlternatives":[],"scopeAdditions":[],"anonymousRemoved":true,"relaxed":false}',
    ]);
  });

  it('marks relaxed security and base path changes', async () => {
    const relaxed = base
      .replace(
        "/root: {get: {responses: {'200': {description: ok}}}}",
        "/root: {get: {security: [{key: []}, {basic: []}], responses: {'200': {description: ok}}}}",
      )
      .replace("  - {url: 'https://b.test/v1'}\n", "  - {url: 'https://b.test/v2'}\n");
    expect(await kinds(base, relaxed)).toEqual([
      '- | servers | server.removed {}',
      'GET /root | security | security.alternativesChanged {"unsatisfiedBaseAlternatives":[],"scopeAdditions":[],"anonymousRemoved":false,"relaxed":true}',
    ]);
  });

  it('reports a base path change when no candidate server keeps the path', async () => {
    const a = `${HEAD30}servers: [{url: 'https://a.test/v1'}]\npaths: {}\n`;
    expect(await kinds(a, a.replace('/v1', '/v2'))).toEqual(['- | servers | server.basePathChanged {}']);
    expect(await kinds(`${HEAD30}paths: {}\n`, a)).toEqual(['- | servers | server.basePathChanged {}']);
  });

  it('reports a scheme type change and an unsatisfiable alternative', async () => {
    const changed = base.replace('key: {type: apiKey, name: X-Key, in: header}', 'key: {type: http, scheme: bearer}');
    const out = await kinds(base, changed);
    expect(out[0]).toBe('- | security | securityScheme.changed {"scheme":"key","fields":["type"],"incompatible":true}');
    expect(
      out.some((l) =>
        l.startsWith('GET /root | security | security.alternativesChanged {"unsatisfiedBaseAlternatives":[0]'),
      ),
    ).toBe(true);
  });

  it('compares every security scheme type', async () => {
    const schemes = (s: string): string => `${HEAD31}paths: {}\ncomponents:\n  securitySchemes:\n${s}`;
    const a = schemes(`    k: {type: apiKey, name: K, in: query}
    o: {type: openIdConnect, openIdConnectUrl: 'https://a'}
    m: {type: mutualTLS}
    f: {type: oauth2, flows: {implicit: {authorizationUrl: 'https://a', scopes: {}}, password: {tokenUrl: 'https://t', scopes: {}}}}
`);
    const b = schemes(`    k: {type: apiKey, name: k, in: cookie}
    o: {type: openIdConnect, openIdConnectUrl: 'https://b'}
    m: {type: mutualTLS}
    f: {type: oauth2, flows: {implicit: {authorizationUrl: 'https://b', refreshUrl: 'https://r', scopes: {}}}}
`);
    expect(await kinds(a, b)).toEqual([
      '- | security | securityScheme.changed {"scheme":"f","fields":["flows.implicit.authorizationUrl","flows.implicit.refreshUrl","flows.password"],"incompatible":true}',
      '- | security | securityScheme.changed {"scheme":"k","fields":["in","name"],"incompatible":true}',
      '- | security | securityScheme.changed {"scheme":"o","fields":["openIdConnectUrl"],"incompatible":true}',
    ]);
  });
});
