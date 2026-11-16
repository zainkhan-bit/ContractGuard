/**
 * Executable compatibility fixtures (§10.6, §18.4): every rule has ≥ 1 positive (fires) and ≥ 1 negative
 * (stays silent) case. `expect` pins the classification/severity where the catalog states one.
 */
import type { Classification, Severity } from '@contractguard/core';
import type { CheckOptions } from '../../src/check.js';

export interface Fixture {
  readonly rule: string;
  readonly fires: boolean;
  readonly name: string;
  readonly base: string;
  readonly candidate: string;
  readonly expect?: { readonly classification?: Classification; readonly severity?: Severity };
  readonly options?: CheckOptions;
  /** Load leniently (unresolved references allowed). */
  readonly lenient?: boolean;
}

export const H31 = 'openapi: 3.1.0\ninfo: {title: t, version: v}\n';
export const H30 = 'openapi: 3.0.3\ninfo: {title: t, version: v}\n';
const R = "{responses: {'200': {description: ok}}}";

/** A request body schema on POST /x. */
const body = (schema: string, extra = '', head = H31): string =>
  `${head}paths:\n  /x:\n    post:\n      requestBody: {content: {application/json: {schema: ${schema}}}}\n      responses: {'204': {description: ok}}\n${extra}`;
/** A 200 response schema on GET /x. */
const res = (schema: string, extra = '', head = H31): string =>
  `${head}paths:\n  /x:\n    get:\n      responses: {'200': {description: ok, content: {application/json: {schema: ${schema}}}}}\n${extra}`;
/** Parameters on GET /x. */
const params = (list: string): string =>
  `${H31}paths:\n  /x:\n    get:\n      parameters: [${list}]\n      responses: {'200': {description: ok}}\n`;
/** Raw paths. */
const paths = (p: string, extra = ''): string => `${H31}paths:\n${p}${extra}`;
/** Responses of GET /x. */
const responses = (r: string): string => `${H31}paths:\n  /x:\n    get:\n      responses: {${r}}\n`;
/** Components block with schemas. */
const comps = (s: string): string => `components:\n  schemas:\n${s}`;

const f = (
  rule: string,
  fires: boolean,
  name: string,
  base: string,
  candidate: string,
  more: Partial<Pick<Fixture, 'expect' | 'options' | 'lenient'>> = {},
): Fixture => ({ rule, fires, name, base, candidate, ...more });

const OBJ = '{type: object, properties: {a: {type: string}}}';
const p = (s: string): string => `{type: object, properties: {${s}}}`;

const secured = (sec: string, schemes: string, opSec = ''): string =>
  `${H31}${sec === '' ? '' : `security: ${sec}\n`}paths:\n  /x:\n    get: {${opSec === '' ? '' : `security: ${opSec}, `}responses: {'200': {description: ok}}}\ncomponents:\n  securitySchemes:\n${schemes}`;
const KEY = '    key: {type: apiKey, name: X-Key, in: header}\n';
const BEARER = '    bearer: {type: http, scheme: bearer}\n';
const OAUTH = (url = 'https://t', scopes = 'read: r, write: w', flow = 'clientCredentials'): string =>
  `    oauth: {type: oauth2, flows: {${flow}: {tokenUrl: '${url}', scopes: {${scopes}}}}}\n`;

const servers = (list: string): string => `${H31}servers: [${list}]\npaths: {}\n`;

export const FIXTURES: readonly Fixture[] = [
  // ------------------------------------------------------------------ API
  f(
    'CG-API-001',
    true,
    'method removed from a path with other methods',
    paths(`  /a: {get: ${R}, delete: ${R}}\n`),
    paths(`  /a: {get: ${R}}\n`),
    {
      expect: { classification: 'breaking', severity: 'critical' },
    },
  ),
  f(
    'CG-API-001',
    true,
    'deprecated operation removed (severity downgraded)',
    paths(`  /a: {get: ${R}, delete: {deprecated: true, responses: {'200': {description: ok}}}}\n`),
    paths(`  /a: {get: ${R}}\n`),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-API-001',
    false,
    'path parameter renamed',
    paths(
      "  /u/{id}: {get: {parameters: [{name: id, in: path, required: true, schema: {type: string}}], responses: {'200': {description: ok}}}}\n",
    ),
    paths(
      "  /u/{userId}: {get: {parameters: [{name: userId, in: path, required: true, schema: {type: string}}], responses: {'200': {description: ok}}}}\n",
    ),
  ),
  f(
    'CG-API-001',
    false,
    'candidate adds methods',
    paths(`  /a: {get: ${R}}\n`),
    paths(`  /a: {get: ${R}, post: ${R}}\n`),
  ),
  f(
    'CG-API-002',
    true,
    'new operation',
    paths(`  /a: {get: ${R}}\n`),
    paths(`  /a: {get: ${R}}\n  /orders: {post: ${R}}\n`),
    {
      expect: { classification: 'non-breaking', severity: 'info' },
    },
  ),
  f('CG-API-002', false, 'operation present in both', paths(`  /a: {get: ${R}}\n`), paths(`  /a: {get: ${R}}\n`)),
  f(
    'CG-API-003',
    true,
    'moved with the same operationId',
    paths("  /user: {get: {operationId: getUser, responses: {'200': {description: ok}}}}\n"),
    paths("  /users: {get: {operationId: getUser, responses: {'200': {description: ok}}}}\n"),
    { expect: { classification: 'breaking', severity: 'critical' } },
  ),
  f('CG-API-003', true, 'trailing slash removed', paths(`  /users/: {get: ${R}}\n`), paths(`  /users: {get: ${R}}\n`)),
  f(
    'CG-API-003',
    false,
    'same operationId on a different method',
    paths("  /user: {get: {operationId: getUser, responses: {'200': {description: ok}}}}\n"),
    paths("  /users: {post: {operationId: getUser, responses: {'200': {description: ok}}}}\n"),
  ),
  f(
    'CG-API-003',
    false,
    'duplicate operationIds suppress the hint',
    paths(
      `  /user: {get: {operationId: dup, responses: {'200': {description: ok}}}}\n  /other: {get: {operationId: dup, responses: {'200': {description: ok}}}}\n`,
    ),
    paths(`  /users: {get: {operationId: dup, responses: {'200': {description: ok}}}}\n  /other: {get: ${R}}\n`),
    { lenient: true },
  ),
  f(
    'CG-API-004',
    true,
    'deprecated added',
    paths(`  /a: {get: ${R}}\n`),
    paths("  /a: {get: {deprecated: true, responses: {'200': {description: ok}}}}\n"),
    {
      expect: { classification: 'informational', severity: 'info' },
    },
  ),
  f(
    'CG-API-004',
    true,
    'deprecated removed',
    paths("  /a: {get: {deprecated: true, responses: {'200': {description: ok}}}}\n"),
    paths(`  /a: {get: ${R}}\n`),
  ),
  f('CG-API-004', false, 'unchanged', paths(`  /a: {get: ${R}}\n`), paths(`  /a: {get: ${R}}\n`)),
  f(
    'CG-API-005',
    true,
    '{id} → {userId}',
    paths(
      "  /u/{id}: {get: {parameters: [{name: id, in: path, required: true, schema: {type: string}}], responses: {'200': {description: ok}}}}\n",
    ),
    paths(
      "  /u/{userId}: {get: {parameters: [{name: userId, in: path, required: true, schema: {type: string}}], responses: {'200': {description: ok}}}}\n",
    ),
    { expect: { classification: 'informational' } },
  ),
  f(
    'CG-API-005',
    false,
    'segment moved to another position',
    paths(
      "  /a/{id}/b: {get: {parameters: [{name: id, in: path, required: true, schema: {type: string}}], responses: {'200': {description: ok}}}}\n",
    ),
    paths(
      "  /a/b/{id}: {get: {parameters: [{name: id, in: path, required: true, schema: {type: string}}], responses: {'200': {description: ok}}}}\n",
    ),
  ),
  f(
    'CG-API-006',
    true,
    'getUser → fetchUser',
    paths("  /a: {get: {operationId: getUser, responses: {'200': {description: ok}}}}\n"),
    paths("  /a: {get: {operationId: fetchUser, responses: {'200': {description: ok}}}}\n"),
    { expect: { classification: 'informational' } },
  ),
  f(
    'CG-API-006',
    true,
    'sdkSensitive option',
    paths("  /a: {get: {operationId: getUser, responses: {'200': {description: ok}}}}\n"),
    paths("  /a: {get: {operationId: fetchUser, responses: {'200': {description: ok}}}}\n"),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
      options: { overrides: new Map([['CG-API-006', { options: { sdkSensitive: true } }]]) },
    },
  ),
  f(
    'CG-API-006',
    false,
    'operationId added where none existed',
    paths(`  /a: {get: ${R}}\n`),
    paths("  /a: {get: {operationId: x, responses: {'200': {description: ok}}}}\n"),
  ),
  f(
    'CG-API-007',
    true,
    'callbacks added',
    paths(`  /a: {post: ${R}}\n`),
    paths(
      "  /a: {post: {callbacks: {cb: {'{$request.body#/u}': {post: {responses: {'200': {description: ok}}}}}}, responses: {'200': {description: ok}}}}\n",
    ),
    { expect: { classification: 'undetermined', severity: 'low' } },
  ),
  f(
    'CG-API-007',
    false,
    'callbacks identical',
    paths(
      "  /a: {post: {callbacks: {cb: {'{$request.body#/u}': {post: {responses: {'200': {description: ok}}}}}}, responses: {'200': {description: ok}}}}\n",
    ),
    paths(
      "  /a: {post: {callbacks: {cb: {'{$request.body#/u}': {post: {responses: {'200': {description: ok}}}}}}, responses: {'200': {description: ok}}}}\n",
    ),
  ),

  // ------------------------------------------------------------------ SRV
  f(
    'CG-SRV-001',
    true,
    'one of two hosts removed',
    servers("{url: 'https://us.x/v1'}, {url: 'https://eu.x/v1'}"),
    servers("{url: 'https://us.x/v1'}"),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-SRV-001',
    false,
    'servers reordered',
    servers("{url: 'https://us.x/v1'}, {url: 'https://eu.x/v1'}"),
    servers("{url: 'https://eu.x/v1'}, {url: 'https://us.x/v1'}"),
  ),
  f('CG-SRV-002', true, '/v1 → /v2', servers("{url: 'https://x/v1'}"), servers("{url: 'https://x/v2'}"), {
    expect: { classification: 'potentially-breaking', severity: 'high' },
  }),
  f(
    'CG-SRV-002',
    false,
    'host change only',
    servers("{url: 'https://a.x/v1'}, {url: 'https://b.x/v1'}"),
    servers("{url: 'https://b.x/v1'}"),
  ),
  f(
    'CG-SRV-003',
    true,
    'region enum narrowed',
    servers("{url: 'https://{r}.x', variables: {r: {default: us, enum: [us, eu]}}}"),
    servers("{url: 'https://{r}.x', variables: {r: {default: us, enum: [us]}}}"),
    { expect: { classification: 'potentially-breaking', severity: 'medium' } },
  ),
  f(
    'CG-SRV-003',
    false,
    'enum widened',
    servers("{url: 'https://{r}.x', variables: {r: {default: us, enum: [us]}}}"),
    servers("{url: 'https://{r}.x', variables: {r: {default: us, enum: [us, eu]}}}"),
  ),

  // ------------------------------------------------------------------ REQ structure
  f(
    'CG-REQ-001',
    true,
    'required property added',
    body(OBJ),
    body('{type: object, required: [c], properties: {a: {type: string}, c: {type: string}}}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-REQ-001',
    true,
    'nested inside array items',
    body(`{type: array, items: ${OBJ}}`),
    body('{type: array, items: {type: object, required: [c], properties: {a: {type: string}, c: {}}}}'),
  ),
  f('CG-REQ-001', false, 'optional property added', body(OBJ), body(p('a: {type: string}, c: {type: string}'))),
  f(
    'CG-REQ-001',
    false,
    'required readOnly property added',
    body(OBJ),
    body('{type: object, required: [id], properties: {a: {type: string}, id: {type: string, readOnly: true}}}'),
  ),
  f(
    'CG-REQ-001',
    false,
    'response direction',
    res(OBJ),
    res('{type: object, required: [c], properties: {a: {type: string}, c: {}}}'),
  ),
  f(
    'CG-REQ-002',
    true,
    'limit became required',
    params('{name: limit, in: query, schema: {type: integer}}'),
    params('{name: limit, in: query, required: true, schema: {type: integer}}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-REQ-002',
    false,
    'became optional',
    params('{name: limit, in: query, required: true, schema: {type: integer}}'),
    params('{name: limit, in: query, schema: {type: integer}}'),
  ),
  f(
    'CG-REQ-003',
    true,
    'b added to required',
    body(p('a: {}, b: {}')),
    body('{type: object, required: [b], properties: {a: {}, b: {}}}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-REQ-003',
    false,
    'readOnly property',
    body(p('a: {}, b: {readOnly: true}')),
    body('{type: object, required: [b], properties: {a: {}, b: {readOnly: true}}}'),
  ),
  f(
    'CG-REQ-003',
    false,
    'response direction',
    res(p('a: {}, b: {}')),
    res('{type: object, required: [b], properties: {a: {}, b: {}}}'),
  ),
  f(
    'CG-REQ-004',
    true,
    'required header added',
    params('{name: q, in: query, schema: {type: string}}'),
    params(
      '{name: q, in: query, schema: {type: string}}, {name: X-Tenant, in: header, required: true, schema: {type: string}}',
    ),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-REQ-004',
    false,
    'optional parameter added',
    params('{name: q, in: query, schema: {type: string}}'),
    params('{name: q, in: query, schema: {type: string}}, {name: s, in: query, schema: {type: string}}'),
  ),
  f(
    'CG-REQ-004',
    false,
    'parameter moved location',
    params('{name: api_key, in: query, schema: {type: string}}'),
    params('{name: api_key, in: header, required: true, schema: {type: string}}'),
  ),
  f(
    'CG-REQ-005',
    true,
    'optional parameter added',
    params('{name: q, in: query, schema: {type: string}}'),
    params('{name: q, in: query, schema: {type: string}}, {name: sort, in: query, schema: {type: string}}'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f('CG-REQ-005', true, 'optional body property added', body(OBJ), body(p('a: {type: string}, note: {type: string}'))),
  f(
    'CG-REQ-005',
    false,
    'required parameter added',
    params('{name: q, in: query, schema: {type: string}}'),
    params(
      '{name: q, in: query, schema: {type: string}}, {name: z, in: query, required: true, schema: {type: string}}',
    ),
  ),
  f('CG-REQ-005', false, 'response direction', res(OBJ), res(p('a: {type: string}, note: {type: string}'))),
  f(
    'CG-REQ-006',
    true,
    'filter removed (default policy)',
    params('{name: q, in: query, schema: {type: string}}, {name: filter, in: query, schema: {type: string}}'),
    params('{name: q, in: query, schema: {type: string}}'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-REQ-006',
    true,
    'removedRequestParameters: potentially-breaking',
    params('{name: filter, in: query, schema: {type: string}}'),
    params(''),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
      options: {
        policy: {
          strictResponseValidation: false,
          constraintTightening: 'potentially-breaking',
          responseEnumAdditions: 'potentially-breaking',
          removedRequestParameters: 'potentially-breaking',
          closedResponseAdditions: 'potentially-breaking',
        },
      },
    },
  ),
  f(
    'CG-REQ-006',
    false,
    'moved location',
    params('{name: api_key, in: query, schema: {type: string}}'),
    params('{name: api_key, in: header, schema: {type: string}}'),
  ),
  f(
    'CG-REQ-007',
    true,
    'query → header, required',
    params('{name: api_key, in: query, schema: {type: string}}'),
    params('{name: api_key, in: header, required: true, schema: {type: string}}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-REQ-007',
    true,
    'optional moved',
    params('{name: api_key, in: query, schema: {type: string}}'),
    params('{name: API_KEY, in: cookie, schema: {type: string}}'),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-REQ-007',
    false,
    'different name',
    params('{name: a, in: query, schema: {type: string}}'),
    params('{name: b, in: header, schema: {type: string}}'),
  ),
  f(
    'CG-REQ-008',
    true,
    'became optional',
    params('{name: q, in: query, required: true, schema: {type: string}}'),
    params('{name: q, in: query, schema: {type: string}}'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-REQ-008',
    false,
    'became required',
    params('{name: q, in: query, schema: {type: string}}'),
    params('{name: q, in: query, required: true, schema: {type: string}}'),
  ),
  f(
    'CG-REQ-009',
    true,
    'array explode true → false',
    params('{name: ids, in: query, schema: {type: array, items: {type: string}}}'),
    params('{name: ids, in: query, explode: false, schema: {type: array, items: {type: string}}}'),
    { expect: { classification: 'breaking', severity: 'high' } },
  ),
  f(
    'CG-REQ-009',
    true,
    'style form → spaceDelimited',
    params('{name: ids, in: query, schema: {type: array, items: {type: string}}}'),
    params('{name: ids, in: query, style: spaceDelimited, schema: {type: array, items: {type: string}}}'),
  ),
  f(
    'CG-REQ-009',
    false,
    'absent style → explicit default',
    params('{name: ids, in: query, schema: {type: array, items: {type: string}}}'),
    params('{name: ids, in: query, style: form, explode: true, schema: {type: array, items: {type: string}}}'),
  ),
  f(
    'CG-REQ-009',
    false,
    'explode on a primitive',
    params('{name: q, in: query, schema: {type: string}}'),
    params('{name: q, in: query, explode: false, schema: {type: string}}'),
  ),
  f(
    'CG-REQ-010',
    true,
    'body became required',
    body('{type: object}'),
    body('{type: object}').replace('requestBody: {', 'requestBody: {required: true, '),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-REQ-010',
    false,
    'body became optional',
    body('{type: object}').replace('requestBody: {', 'requestBody: {required: true, '),
    body('{type: object}'),
  ),
  f(
    'CG-REQ-011',
    true,
    'body became optional',
    body('{type: object}').replace('requestBody: {', 'requestBody: {required: true, '),
    body('{type: object}'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-REQ-011',
    false,
    'body became required',
    body('{type: object}'),
    body('{type: object}').replace('requestBody: {', 'requestBody: {required: true, '),
  ),
  f(
    'CG-REQ-012',
    true,
    'required body added',
    paths(`  /jobs: {post: ${R}}\n`),
    paths(
      "  /jobs: {post: {requestBody: {required: true, content: {application/json: {}}}, responses: {'200': {description: ok}}}}\n",
    ),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-REQ-012',
    true,
    'optional body added',
    paths(`  /jobs: {post: ${R}}\n`),
    paths("  /jobs: {post: {requestBody: {content: {application/json: {}}}, responses: {'200': {description: ok}}}}\n"),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f('CG-REQ-012', false, 'body on both sides', body('{type: object}'), body('{type: object}')),
  f(
    'CG-REQ-013',
    true,
    'body removed',
    body('{type: object}'),
    paths(`  /x: {post: {responses: {'204': {description: ok}}}}\n`),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-REQ-013',
    false,
    'media type removed, body remains',
    body('{type: object}').replace('application/json: {', 'text/plain: {}, application/json: {'),
    body('{type: object}'),
  ),
  f(
    'CG-REQ-014',
    true,
    'application/xml removed',
    body('{type: object}').replace('application/json: {', 'application/xml: {}, application/json: {'),
    body('{type: object}'),
    { expect: { classification: 'breaking', severity: 'high' } },
  ),
  f(
    'CG-REQ-014',
    false,
    'charset spelling normalized',
    body('{type: object}').replace('application/json: {', "'text/plain; charset=UTF-8': {}, application/json: {"),
    body('{type: object}').replace('application/json: {', "'text/plain; charset=utf-8': {}, application/json: {"),
  ),
  f(
    'CG-REQ-015',
    true,
    'form media type added',
    body('{type: object}'),
    body('{type: object}').replace('application/json: {', 'application/x-www-form-urlencoded: {}, application/json: {'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f('CG-REQ-015', false, 'no change', body('{type: object}'), body('{type: object}')),

  // ------------------------------------------------------------------ REQ schemas
  f(
    'CG-REQ-020',
    true,
    'enum value removed',
    body('{type: string, enum: [a, b, c]}'),
    body('{type: string, enum: [a, b]}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f('CG-REQ-020', true, 'const changed', body('{type: string, const: x}'), body('{type: string, const: y}')),
  f(
    'CG-REQ-020',
    false,
    'values reordered',
    body('{type: string, enum: [a, b]}'),
    body('{type: string, enum: [b, a]}'),
  ),
  f('CG-REQ-020', false, 'value added', body('{type: string, enum: [a, b]}'), body('{type: string, enum: [a, b, c]}')),
  f('CG-REQ-020', false, '1 vs 1.0', body('{type: number, enum: [1, 2]}'), body('{type: number, enum: [1.0, 2]}')),
  f('CG-REQ-021', true, 'value added', body('{type: string, enum: [a, b]}'), body('{type: string, enum: [a, b, c]}'), {
    expect: { classification: 'non-breaking' },
  }),
  f('CG-REQ-021', true, 'enum removed entirely', body('{type: string, enum: [a, b]}'), body('{type: string}')),
  f(
    'CG-REQ-021',
    false,
    'response direction',
    res('{type: string, enum: [a, b]}'),
    res('{type: string, enum: [a, b, c]}'),
  ),
  f('CG-REQ-022', true, '[string, integer] → string', body('{type: [string, integer]}'), body('{type: string}'), {
    expect: { classification: 'breaking', severity: 'high' },
  }),
  f('CG-REQ-022', true, 'number → integer', body('{type: number}'), body('{type: integer}')),
  f('CG-REQ-022', false, 'integer → number', body('{type: integer}'), body('{type: number}')),
  f('CG-REQ-022', false, 'disjoint', body('{type: string}'), body('{type: object}')),
  f('CG-REQ-023', true, 'integer → number', body('{type: integer}'), body('{type: number}'), {
    expect: { classification: 'non-breaking' },
  }),
  f('CG-REQ-023', true, 'type removed', body('{type: string, maxLength: 3}'), body('{maxLength: 3}')),
  f('CG-REQ-023', false, 'narrowing', body('{type: number}'), body('{type: integer}')),
  f(
    'CG-REQ-024',
    true,
    'maxLength 100 → 50',
    body('{type: string, maxLength: 100}'),
    body('{type: string, maxLength: 50}'),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-REQ-024',
    true,
    'minimum → exclusiveMinimum (number)',
    body('{type: number, minimum: 0}'),
    body('{type: number, exclusiveMinimum: 0}'),
  ),
  f(
    'CG-REQ-024',
    true,
    'multipleOf 2 → 4',
    body('{type: integer, multipleOf: 2}'),
    body('{type: integer, multipleOf: 4}'),
  ),
  f('CG-REQ-024', true, 'uniqueItems added', body('{type: array}'), body('{type: array, uniqueItems: true}')),
  f(
    'CG-REQ-024',
    true,
    'constraintTightening: breaking',
    body('{type: string, maxLength: 100}'),
    body('{type: string, maxLength: 50}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
      options: {
        policy: {
          strictResponseValidation: false,
          constraintTightening: 'breaking',
          responseEnumAdditions: 'potentially-breaking',
          removedRequestParameters: 'non-breaking',
          closedResponseAdditions: 'potentially-breaking',
        },
      },
    },
  ),
  f(
    'CG-REQ-024',
    true,
    'classification overridden by config',
    body('{type: string, maxLength: 100}'),
    body('{type: string, maxLength: 50}'),
    {
      expect: { classification: 'breaking', severity: 'critical' },
      options: { overrides: new Map([['CG-REQ-024', { classification: 'breaking', severity: 'critical' }]]) },
    },
  ),
  f(
    'CG-REQ-024',
    false,
    'integer minimum 1 ↔ exclusiveMinimum 0',
    body('{type: integer, minimum: 1}'),
    body('{type: integer, exclusiveMinimum: 0}'),
  ),
  f(
    'CG-REQ-024',
    false,
    'maxLength 50 → 100',
    body('{type: string, maxLength: 50}'),
    body('{type: string, maxLength: 100}'),
  ),
  f(
    'CG-REQ-024',
    false,
    'multipleOf 4 → 2',
    body('{type: integer, multipleOf: 4}'),
    body('{type: integer, multipleOf: 2}'),
  ),
  f('CG-REQ-025', true, 'maxItems 10 → 20', body('{type: array, maxItems: 10}'), body('{type: array, maxItems: 20}'), {
    expect: { classification: 'non-breaking' },
  }),
  f('CG-REQ-025', true, 'pattern removed', body("{type: string, pattern: '^a'}"), body('{type: string}')),
  f('CG-REQ-025', false, 'tightened', body('{type: array, maxItems: 20}'), body('{type: array, maxItems: 10}')),
  f('CG-REQ-026', true, 'pattern added', body('{type: string}'), body("{type: string, pattern: '^[A-Z]{3}$'}"), {
    expect: { classification: 'potentially-breaking', severity: 'medium' },
  }),
  f('CG-REQ-026', false, 'pattern removed', body("{type: string, pattern: '^a'}"), body('{type: string}')),
  f(
    'CG-REQ-027',
    true,
    'pattern edited',
    body("{type: string, pattern: '^[a-z]+$'}"),
    body("{type: string, pattern: '^[a-z0-9]+$'}"),
    {
      expect: { classification: 'undetermined', severity: 'medium' },
    },
  ),
  f(
    'CG-REQ-027',
    false,
    'identical pattern',
    body("{type: string, pattern: '^a'}"),
    body("{type: string, pattern: '^a'}"),
  ),
  f(
    'CG-REQ-028',
    true,
    'int64 → int32',
    body('{type: integer, format: int64}'),
    body('{type: integer, format: int32}'),
    {
      expect: { classification: 'potentially-breaking', severity: 'low' },
    },
  ),
  f('CG-REQ-028', true, 'email added', body('{type: string}'), body('{type: string, format: email}'), {
    expect: { classification: 'potentially-breaking' },
  }),
  f(
    'CG-REQ-028',
    true,
    'date → date-time',
    body('{type: string, format: date}'),
    body('{type: string, format: date-time}'),
    {
      expect: { classification: 'potentially-breaking' },
    },
  ),
  f(
    'CG-REQ-028',
    true,
    'int32 → int64 is non-breaking',
    body('{type: integer, format: int32}'),
    body('{type: integer, format: int64}'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-REQ-028',
    true,
    'unknown custom format changed',
    body('{type: string, format: sku}'),
    body('{type: string, format: isbn}'),
    {
      expect: { classification: 'undetermined', severity: 'low' },
    },
  ),
  f(
    'CG-REQ-028',
    false,
    'custom format unchanged',
    body('{type: string, format: sku}'),
    body('{type: string, format: sku}'),
  ),
  f(
    'CG-REQ-029',
    true,
    'closed schema drops nickname',
    body('{type: object, additionalProperties: false, properties: {a: {}, nickname: {}}}'),
    body('{type: object, additionalProperties: false, properties: {a: {}}}'),
    { expect: { classification: 'breaking', severity: 'high' } },
  ),
  f(
    'CG-REQ-029',
    true,
    'additionalProperties true → false',
    body('{type: object, additionalProperties: true}'),
    body('{type: object, additionalProperties: false}'),
  ),
  f('CG-REQ-029', false, 'open schema removal', body(p('a: {}, legacyId: {}')), body(p('a: {}'))),
  f('CG-REQ-030', true, 'open schema drops legacyId', body(p('a: {}, legacyId: {}')), body(p('a: {}')), {
    expect: { classification: 'non-breaking' },
  }),
  f(
    'CG-REQ-030',
    false,
    'closed schema',
    body('{type: object, additionalProperties: false, properties: {a: {}, b: {}}}'),
    body('{type: object, additionalProperties: false, properties: {a: {}}}'),
  ),
  f(
    'CG-REQ-031',
    true,
    '3.0 nullable removed',
    body('{type: string, nullable: true}', '', H30),
    body('{type: string}', '', H30),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f('CG-REQ-031', true, "3.1 [string, 'null'] → string", body("{type: [string, 'null']}"), body('{type: string}')),
  f(
    'CG-REQ-031',
    true,
    '3.0 nullable → 3.1 string',
    body('{type: string, nullable: true}', '', H30),
    body('{type: string}'),
  ),
  f(
    'CG-REQ-031',
    false,
    '3.0 nullable → 3.1 type array (equivalent)',
    body('{type: string, nullable: true}', '', H30),
    body("{type: [string, 'null']}"),
  ),
  f(
    'CG-REQ-031',
    false,
    '3.0 nullable without type removed (no effect)',
    body('{nullable: true}', '', H30),
    body('{}', '', H30),
  ),
  f(
    'CG-REQ-032',
    true,
    'Wallet variant removed',
    body(
      "{oneOf: [{$ref: '#/components/schemas/Card'}, {$ref: '#/components/schemas/Wallet'}]}",
      comps(
        '    Card: {type: object, properties: {number: {}}}\n    Wallet: {type: object, properties: {walletId: {}}}\n',
      ),
    ),
    body(
      "{oneOf: [{$ref: '#/components/schemas/Card'}]}",
      comps('    Card: {type: object, properties: {number: {}}}\n'),
    ),
    { expect: { classification: 'breaking', severity: 'high' } },
  ),
  f(
    'CG-REQ-032',
    false,
    'branch renamed but identical',
    body(
      "{oneOf: [{$ref: '#/components/schemas/Card'}, {type: string}]}",
      comps('    Card: {type: object, properties: {number: {}}}\n'),
    ),
    body(
      "{oneOf: [{$ref: '#/components/schemas/PaymentCard'}, {type: string}]}",
      comps('    PaymentCard: {type: object, properties: {number: {}}}\n'),
    ),
  ),
  f(
    'CG-REQ-033',
    true,
    'oneOf branch added without discriminator',
    body('{oneOf: [{type: string}, {type: integer}]}'),
    body('{oneOf: [{type: string}, {type: integer}, {type: boolean}]}'),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-REQ-033',
    false,
    'with discriminator',
    body(
      "{oneOf: [{$ref: '#/components/schemas/A'}], discriminator: {propertyName: k}}",
      comps(
        '    A: {type: object, properties: {k: {type: string}}}\n    B: {type: object, properties: {k: {type: string}, b: {}}}\n',
      ),
    ),
    body(
      "{oneOf: [{$ref: '#/components/schemas/A'}, {$ref: '#/components/schemas/B'}], discriminator: {propertyName: k}}",
      comps(
        '    A: {type: object, properties: {k: {type: string}}}\n    B: {type: object, properties: {k: {type: string}, b: {}}}\n',
      ),
    ),
  ),
  f(
    'CG-REQ-033',
    false,
    'anyOf',
    body('{anyOf: [{type: string}]}'),
    body('{anyOf: [{type: string}, {type: integer}]}'),
  ),
  f(
    'CG-REQ-034',
    true,
    'anyOf branch added',
    body('{anyOf: [{type: string}, {type: boolean}]}'),
    body('{anyOf: [{type: string}, {type: boolean}, {type: integer}]}'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-REQ-034',
    false,
    'variant removed',
    body('{anyOf: [{type: string}, {type: integer}, {type: boolean}]}'),
    body('{anyOf: [{type: string}, {type: integer}]}'),
  ),
  f(
    'CG-REQ-035',
    true,
    'mapping value removed',
    body(
      "{oneOf: [{$ref: '#/components/schemas/Card'}, {$ref: '#/components/schemas/Wallet'}], discriminator: {propertyName: kind, mapping: {card: '#/components/schemas/Card', wallet: '#/components/schemas/Wallet'}}}",
      comps(
        '    Card: {type: object, properties: {kind: {type: string}}}\n    Wallet: {type: object, properties: {kind: {type: string}}}\n',
      ),
    ),
    body(
      "{oneOf: [{$ref: '#/components/schemas/Card'}, {$ref: '#/components/schemas/Wallet'}], discriminator: {propertyName: kind, mapping: {card: '#/components/schemas/Card'}}}",
      comps(
        '    Card: {type: object, properties: {kind: {type: string}}}\n    Wallet: {type: object, properties: {kind: {type: string}}}\n',
      ),
    ),
    { expect: { classification: 'breaking', severity: 'high' } },
  ),
  f(
    'CG-REQ-035',
    false,
    'mapping added',
    body(
      "{oneOf: [{$ref: '#/components/schemas/Card'}], discriminator: {propertyName: kind}}",
      comps('    Card: {type: object, properties: {kind: {type: string}}}\n'),
    ),
    body(
      "{oneOf: [{$ref: '#/components/schemas/Card'}], discriminator: {propertyName: kind, mapping: {card: '#/components/schemas/Card'}}}",
      comps('    Card: {type: object, properties: {kind: {type: string}}}\n'),
    ),
  ),
  f(
    'CG-REQ-036',
    true,
    'default 20 → 50',
    params('{name: limit, in: query, schema: {type: integer, default: 20}}'),
    params('{name: limit, in: query, schema: {type: integer, default: 50}}'),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-REQ-036',
    true,
    'default added (includeEquivalentChanges)',
    params('{name: limit, in: query, schema: {type: integer}}'),
    params('{name: limit, in: query, schema: {type: integer, default: 20}}'),
    {
      expect: { classification: 'informational' },
      options: { includeEquivalentChanges: true },
    },
  ),
  f(
    'CG-REQ-036',
    false,
    'default added',
    params('{name: limit, in: query, schema: {type: integer}}'),
    params('{name: limit, in: query, schema: {type: integer, default: 20}}'),
  ),
  f(
    'CG-REQ-037',
    true,
    'id gains readOnly',
    body(p('id: {type: string}')),
    body(p('id: {type: string, readOnly: true}')),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-REQ-037',
    true,
    'required id gains readOnly',
    body('{type: object, required: [id], properties: {id: {type: string}}}'),
    body('{type: object, required: [id], properties: {id: {type: string, readOnly: true}}}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-REQ-037',
    false,
    'readOnly removed',
    body(p('id: {type: string, readOnly: true}')),
    body(p('id: {type: string}')),
  ),
  f(
    'CG-REQ-038',
    true,
    'non-mergeable allOf branch added',
    body(
      "{allOf: [{$ref: '#/components/schemas/Base'}, {minLength: 1}]}",
      comps('    Base: {oneOf: [{type: string}, {type: integer}]}\n'),
    ),
    body(
      "{allOf: [{$ref: '#/components/schemas/Base'}, {minLength: 1}, {not: {const: x}}]}",
      comps('    Base: {oneOf: [{type: string}, {type: integer}]}\n'),
    ),
    { expect: { classification: 'potentially-breaking', severity: 'medium' } },
  ),
  f(
    'CG-REQ-038',
    false,
    'mergeable allOf',
    body(
      "{allOf: [{$ref: '#/components/schemas/Base'}, {properties: {x: {}}}]}",
      comps('    Base: {type: object, properties: {a: {}}}\n'),
    ),
    body('{type: object, properties: {a: {}, x: {}}}'),
  ),

  // ------------------------------------------------------------------ RES
  f(
    'CG-RES-001',
    true,
    'required email removed',
    res('{type: object, required: [id, email], properties: {id: {}, email: {}}}'),
    res('{type: object, required: [id], properties: {id: {}}}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-RES-001',
    false,
    'request direction',
    body('{type: object, required: [id, email], properties: {id: {}, email: {}}}'),
    body('{type: object, required: [id], properties: {id: {}}}'),
  ),
  f(
    'CG-RES-001',
    false,
    'property moved into an allOf parent',
    res('{type: object, required: [id, email], properties: {id: {}, email: {}}}'),
    res(
      "{allOf: [{$ref: '#/components/schemas/Base'}, {type: object, required: [email], properties: {email: {}}}]}",
      comps('    Base: {type: object, required: [id], properties: {id: {}}}\n'),
    ),
  ),
  f(
    'CG-RES-002',
    true,
    'email became optional',
    res('{type: object, required: [id, email], properties: {id: {}, email: {}}}'),
    res('{type: object, required: [id], properties: {id: {}, email: {}}}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-RES-002',
    false,
    'request direction',
    body('{type: object, required: [id, email], properties: {id: {}, email: {}}}'),
    body('{type: object, required: [id], properties: {id: {}, email: {}}}'),
  ),
  f('CG-RES-003', true, 'optional removed from open schema', res(p('id: {}, avatarUrl: {}')), res(p('id: {}')), {
    expect: { classification: 'potentially-breaking', severity: 'medium' },
  }),
  f(
    'CG-RES-003',
    true,
    'optional removed from closed schema',
    res('{type: object, additionalProperties: false, properties: {id: {}, avatarUrl: {}}}'),
    res('{type: object, additionalProperties: false, properties: {id: {}}}'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-RES-003',
    false,
    'required removed',
    res('{type: object, required: [x], properties: {id: {}, x: {}}}'),
    res(p('id: {}')),
  ),
  f(
    'CG-RES-004',
    true,
    'closed schema gains createdAt',
    res('{type: object, additionalProperties: false, properties: {id: {}}}'),
    res('{type: object, additionalProperties: false, properties: {id: {}, createdAt: {}}}'),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-RES-004',
    true,
    'closedResponseAdditions: breaking',
    res('{type: object, additionalProperties: false, properties: {id: {}}}'),
    res('{type: object, additionalProperties: false, properties: {id: {}, createdAt: {}}}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
      options: {
        policy: {
          strictResponseValidation: false,
          constraintTightening: 'potentially-breaking',
          responseEnumAdditions: 'potentially-breaking',
          removedRequestParameters: 'non-breaking',
          closedResponseAdditions: 'breaking',
        },
      },
    },
  ),
  f('CG-RES-004', false, 'open schema', res(p('id: {}')), res(p('id: {}, createdAt: {}'))),
  f('CG-RES-005', true, 'open schema gains nickname', res(p('id: {}')), res(p('id: {}, nickname: {}')), {
    expect: { classification: 'non-breaking' },
  }),
  f(
    'CG-RES-005',
    true,
    'gains a required property',
    res(p('id: {}')),
    res('{type: object, required: [n], properties: {id: {}, n: {}}}'),
    { expect: { classification: 'non-breaking' } },
  ),
  f('CG-RES-005', true, 'strictResponseValidation', res(p('id: {}')), res(p('id: {}, nickname: {}')), {
    expect: { classification: 'potentially-breaking', severity: 'low' },
    options: {
      policy: {
        strictResponseValidation: true,
        constraintTightening: 'potentially-breaking',
        responseEnumAdditions: 'potentially-breaking',
        removedRequestParameters: 'non-breaking',
        closedResponseAdditions: 'potentially-breaking',
      },
    },
  }),
  f('CG-RES-005', false, 'request direction', body(p('id: {}')), body(p('id: {}, nickname: {}'))),
  f(
    'CG-RES-006',
    true,
    'status gains deleted',
    res('{type: string, enum: [active, suspended]}'),
    res('{type: string, enum: [active, suspended, deleted]}'),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-RES-006',
    true,
    'x-extensible-enum honored',
    res('{type: string, enum: [a], x-extensible-enum: true}'),
    res('{type: string, enum: [a, b], x-extensible-enum: true}'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f('CG-RES-006', false, 'values reordered', res('{type: string, enum: [a, b]}'), res('{type: string, enum: [b, a]}')),
  f('CG-RES-007', true, 'value removed', res('{type: string, enum: [a, b, c]}'), res('{type: string, enum: [a, b]}'), {
    expect: { classification: 'non-breaking' },
  }),
  f(
    'CG-RES-007',
    false,
    'request direction',
    body('{type: string, enum: [a, b, c]}'),
    body('{type: string, enum: [a, b]}'),
  ),
  f('CG-RES-008', true, 'integer → number', res('{type: integer}'), res('{type: number}'), {
    expect: { classification: 'breaking', severity: 'high' },
  }),
  f('CG-RES-008', true, 'string → [string, integer]', res('{type: string}'), res('{type: [string, integer]}')),
  f('CG-RES-008', false, 'number → integer', res('{type: number}'), res('{type: integer}')),
  f('CG-RES-009', true, 'may now be null', res('{type: string}'), res("{type: [string, 'null']}"), {
    expect: { classification: 'breaking', severity: 'high' },
  }),
  f(
    'CG-RES-009',
    false,
    '3.0 → 3.1 representation only',
    res('{type: string, nullable: true}', '', H30),
    res("{type: [string, 'null']}"),
  ),
  f('CG-RES-010', true, '[string, integer] → string', res('{type: [string, integer]}'), res('{type: string}'), {
    expect: { classification: 'non-breaking' },
  }),
  f('CG-RES-010', false, 'widening', res('{type: string}'), res('{type: [string, integer]}')),
  f(
    'CG-RES-011',
    true,
    'maxLength 50 → 255',
    res('{type: string, maxLength: 50}'),
    res('{type: string, maxLength: 255}'),
    {
      expect: { classification: 'potentially-breaking', severity: 'low' },
    },
  ),
  f('CG-RES-011', true, 'maximum removed', res('{type: integer, maximum: 10}'), res('{type: integer}')),
  f('CG-RES-011', false, 'tightened', res('{type: string, maxLength: 255}'), res('{type: string, maxLength: 50}')),
  f(
    'CG-RES-012',
    true,
    'maxLength tightened',
    res('{type: string, maxLength: 255}'),
    res('{type: string, maxLength: 50}'),
    { expect: { classification: 'non-breaking' } },
  ),
  f('CG-RES-012', true, 'pattern added', res('{type: string}'), res("{type: string, pattern: '^a'}")),
  f('CG-RES-012', false, 'relaxed', res('{type: string, maxLength: 50}'), res('{type: string, maxLength: 255}')),
  f('CG-RES-013', true, 'format uuid removed', res('{type: string, format: uuid}'), res('{type: string}'), {
    expect: { classification: 'potentially-breaking', severity: 'low' },
  }),
  f('CG-RES-013', true, 'pattern edited', res("{type: string, pattern: '^a'}"), res("{type: string, pattern: '^b'}"), {
    expect: { classification: 'undetermined', severity: 'low' },
  }),
  f(
    'CG-RES-013',
    true,
    'format changed to an unrelated one',
    res('{type: string, format: date}'),
    res('{type: string, format: uuid}'),
    {
      expect: { classification: 'potentially-breaking' },
    },
  ),
  f('CG-RES-013', false, 'pattern added', res('{type: string}'), res("{type: string, pattern: '^a'}")),
  f(
    'CG-RES-014',
    true,
    'oneOf gains a variant',
    res('{oneOf: [{type: string}, {type: integer}]}'),
    res('{oneOf: [{type: string}, {type: integer}, {type: boolean}]}'),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-RES-014',
    false,
    'request direction',
    body('{oneOf: [{type: string}, {type: integer}]}'),
    body('{oneOf: [{type: string}, {type: integer}, {type: boolean}]}'),
  ),
  f(
    'CG-RES-015',
    true,
    'variant removed',
    res('{oneOf: [{type: string}, {type: integer}, {type: boolean}]}'),
    res('{oneOf: [{type: string}, {type: integer}]}'),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-RES-015',
    false,
    'variant added',
    res('{oneOf: [{type: string}, {type: integer}]}'),
    res('{oneOf: [{type: string}, {type: integer}, {type: boolean}]}'),
  ),
  f(
    'CG-RES-016',
    true,
    '200 replaced by 201',
    responses("'200': {description: ok}"),
    responses("'201': {description: ok}"),
    {
      expect: { classification: 'breaking', severity: 'critical' },
    },
  ),
  f(
    'CG-RES-016',
    true,
    '2XX removed',
    responses("2XX: {description: ok}, '400': {description: bad}"),
    responses("'400': {description: bad}"),
  ),
  f('CG-RES-016', false, '200 → 2XX', responses("'200': {description: ok}"), responses('2XX: {description: ok}')),
  f(
    'CG-RES-017',
    true,
    '404 removed',
    responses("'200': {description: ok}, '404': {description: nf}"),
    responses("'200': {description: ok}"),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-RES-017',
    false,
    'success response removed',
    responses("'200': {description: ok}, '404': {description: nf}"),
    responses("'404': {description: nf}"),
  ),
  f(
    'CG-RES-018',
    true,
    '202 added beside 200',
    responses("'200': {description: ok}"),
    responses("'200': {description: ok}, '202': {description: accepted}"),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-RES-018',
    false,
    'error response added',
    responses("'200': {description: ok}"),
    responses("'200': {description: ok}, '400': {description: bad}"),
  ),
  f(
    'CG-RES-019',
    true,
    '429 added',
    responses("'200': {description: ok}"),
    responses("'200': {description: ok}, '429': {description: slow}"),
    { expect: { classification: 'non-breaking' } },
  ),
  f(
    'CG-RES-019',
    true,
    'strictResponseValidation',
    responses("'200': {description: ok}"),
    responses("'200': {description: ok}, '429': {description: slow}"),
    {
      expect: { classification: 'potentially-breaking', severity: 'low' },
      options: {
        policy: {
          strictResponseValidation: true,
          constraintTightening: 'potentially-breaking',
          responseEnumAdditions: 'potentially-breaking',
          removedRequestParameters: 'non-breaking',
          closedResponseAdditions: 'potentially-breaking',
        },
      },
    },
  ),
  f(
    'CG-RES-019',
    false,
    'success response added',
    responses("'200': {description: ok}"),
    responses("'200': {description: ok}, '201': {description: ok}"),
  ),
  f(
    'CG-RES-020',
    true,
    'application/xml removed from 200',
    responses("'200': {description: ok, content: {application/json: {}, application/xml: {}}}"),
    responses("'200': {description: ok, content: {application/json: {}}}"),
    { expect: { classification: 'breaking', severity: 'high' } },
  ),
  f(
    'CG-RES-020',
    false,
    'normalization-only difference',
    responses("'200': {description: ok, content: {Application/JSON: {}}}"),
    responses("'200': {description: ok, content: {application/json: {}}}"),
  ),
  f(
    'CG-RES-021',
    true,
    'application/xml added',
    responses("'200': {description: ok, content: {application/json: {}}}"),
    responses("'200': {description: ok, content: {application/json: {}, application/xml: {}}}"),
    { expect: { classification: 'non-breaking' } },
  ),
  f(
    'CG-RES-021',
    false,
    'no change',
    responses("'200': {description: ok, content: {application/json: {}}}"),
    responses("'200': {description: ok, content: {application/json: {}}}"),
  ),
  f(
    'CG-RES-022',
    true,
    'required header removed',
    responses("'200': {description: ok, headers: {X-RateLimit-Remaining: {required: true, schema: {type: integer}}}}"),
    responses("'200': {description: ok}"),
    { expect: { classification: 'breaking', severity: 'high' } },
  ),
  f(
    'CG-RES-022',
    false,
    'optional header removed',
    responses("'200': {description: ok, headers: {Link: {schema: {type: string}}}}"),
    responses("'200': {description: ok}"),
  ),
  f(
    'CG-RES-023',
    true,
    'header became optional',
    responses("'200': {description: ok, headers: {X-A: {required: true, schema: {type: string}}}}"),
    responses("'200': {description: ok, headers: {X-A: {schema: {type: string}}}}"),
    { expect: { classification: 'breaking', severity: 'high' } },
  ),
  f(
    'CG-RES-023',
    false,
    'header became required',
    responses("'200': {description: ok, headers: {X-A: {schema: {type: string}}}}"),
    responses("'200': {description: ok, headers: {X-A: {required: true, schema: {type: string}}}}"),
  ),
  f(
    'CG-RES-024',
    true,
    'ETag added',
    responses("'200': {description: ok}"),
    responses("'200': {description: ok, headers: {ETag: {schema: {type: string}}}}"),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-RES-024',
    true,
    'optional Link removed',
    responses("'200': {description: ok, headers: {Link: {schema: {type: string}}}}"),
    responses("'200': {description: ok}"),
    {
      expect: { classification: 'potentially-breaking', severity: 'low' },
    },
  ),
  f(
    'CG-RES-024',
    false,
    'required header removed',
    responses("'200': {description: ok, headers: {X-A: {required: true, schema: {type: string}}}}"),
    responses("'200': {description: ok}"),
  ),
  f(
    'CG-RES-025',
    true,
    'body removed',
    responses("'200': {description: ok, content: {application/json: {}}}"),
    responses("'200': {description: ok}"),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-RES-025',
    false,
    'one of two media types removed',
    responses("'200': {description: ok, content: {application/json: {}, application/xml: {}}}"),
    responses("'200': {description: ok, content: {application/json: {}}}"),
  ),
  f(
    'CG-RES-026',
    true,
    'optional password becomes write-only',
    res(p('password: {type: string}')),
    res(p('password: {type: string, writeOnly: true}')),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f(
    'CG-RES-026',
    true,
    'required password becomes write-only',
    res('{type: object, required: [password], properties: {password: {}}}'),
    res('{type: object, required: [password], properties: {password: {writeOnly: true}}}'),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-RES-026',
    false,
    'request direction',
    body(p('password: {type: string}')),
    body(p('password: {type: string, writeOnly: true}')),
  ),
  f(
    'CG-RES-027',
    true,
    'existing 200 gains content',
    responses("'200': {description: ok}"),
    responses("'200': {description: ok, content: {application/json: {}}}"),
    {
      expect: { classification: 'non-breaking' },
    },
  ),
  f(
    'CG-RES-027',
    false,
    'body on both sides',
    responses("'200': {description: ok, content: {application/json: {}}}"),
    responses("'200': {description: ok, content: {application/json: {}}}"),
  ),

  // ------------------------------------------------------------------ SCHEMA
  f('CG-SCHEMA-001', true, 'request string → object', body('{type: string}'), body('{type: object}'), {
    expect: { classification: 'breaking', severity: 'critical' },
  }),
  f('CG-SCHEMA-001', true, 'response array → string', res('{type: array}'), res('{type: string}'), {
    expect: { classification: 'breaking' },
  }),
  f('CG-SCHEMA-001', false, 'integer → number', res('{type: integer}'), res('{type: number}')),
  f('CG-SCHEMA-001', false, "[string, 'null'] → string", res("{type: [string, 'null']}"), res('{type: string}')),
  f(
    'CG-SCHEMA-002',
    true,
    '3.0 nullable → 3.1 type array',
    res('{type: string, nullable: true}', '', H30),
    res("{type: [string, 'null']}"),
    {
      expect: { classification: 'informational' },
      options: { includeEquivalentChanges: true },
    },
  ),
  f(
    'CG-SCHEMA-002',
    false,
    'not requested',
    res('{type: string, nullable: true}', '', H30),
    res("{type: [string, 'null']}"),
  ),
  f(
    'CG-SCHEMA-900',
    true,
    'if/then/else edited',
    body('{type: object, if: {required: [a]}, then: {required: [b]}}'),
    body('{type: object, if: {required: [a]}, then: {required: [c]}}'),
    {
      expect: { classification: 'undetermined', severity: 'medium' },
    },
  ),
  f('CG-SCHEMA-900', true, 'not added', res('{type: string}'), res('{type: string, not: {const: x}}')),
  f(
    'CG-SCHEMA-900',
    true,
    'property added under unevaluatedProperties',
    body('{type: object, unevaluatedProperties: false}'),
    body('{type: object, unevaluatedProperties: false, properties: {a: {}}}'),
  ),
  f(
    'CG-SCHEMA-900',
    false,
    'unsupported keyword unchanged',
    body('{type: object, if: {required: [a]}, then: {required: [b]}}'),
    body('{type: object, if: {required: [a]}, then: {required: [b]}}'),
  ),
  f(
    'CG-SCHEMA-901',
    true,
    'ambiguous anonymous branches',
    body('{anyOf: [{type: object, properties: {a: {}}}, {type: string}, {type: boolean}]}'),
    body('{anyOf: [{type: object, properties: {a: {}, b: {}}}, {type: object, properties: {a: {}, c: {}}}]}'),
    { expect: { classification: 'undetermined', severity: 'medium' } },
  ),
  f(
    'CG-SCHEMA-901',
    false,
    'branches matched',
    body('{anyOf: [{type: string}, {type: integer}]}'),
    body('{anyOf: [{type: integer}, {type: string, maxLength: 3}]}'),
  ),
  f(
    'CG-SCHEMA-902',
    true,
    'tiny pair budget',
    body(p('a: {type: string}, b: {type: string}')),
    body(p('a: {type: string}, b: {type: integer}')),
    {
      expect: { classification: 'undetermined', severity: 'high' },
      options: { maxSchemaPairs: 1 },
    },
  ),
  f('CG-SCHEMA-902', false, 'normal budget', body(p('a: {type: string}')), body(p('a: {type: integer}'))),
  f('CG-SCHEMA-903', true, 'unresolved reference', body("{$ref: './missing.yaml#/X'}"), body('{type: string}'), {
    expect: { classification: 'undetermined', severity: 'high' },
    lenient: true,
  }),
  f(
    'CG-SCHEMA-903',
    false,
    'all references resolve',
    body("{$ref: '#/components/schemas/A'}", comps('    A: {type: string}\n')),
    body('{type: string}'),
  ),

  // ------------------------------------------------------------------ AUTH
  f(
    'CG-AUTH-001',
    true,
    'security added to an open operation',
    secured('', BEARER),
    secured('', BEARER, '[{bearer: []}]'),
    {
      expect: { classification: 'breaking', severity: 'critical' },
    },
  ),
  f(
    'CG-AUTH-001',
    true,
    'one alternative removed',
    secured('', KEY + OAUTH(), '[{key: []}, {oauth: [read]}]'),
    secured('', KEY + OAUTH(), '[{oauth: [read]}]'),
  ),
  f('CG-AUTH-001', true, 'root security added', secured('', KEY), secured('[{key: []}]', KEY)),
  f(
    'CG-AUTH-001',
    false,
    'scheme renamed, identical definition',
    secured('[{key: []}]', KEY),
    secured('[{apiKey: []}]', KEY.replace('key:', 'apiKey:')),
  ),
  f(
    'CG-AUTH-001',
    false,
    'alternative added',
    secured('[{key: []}]', KEY + BEARER),
    secured('[{key: []}, {bearer: []}]', KEY + BEARER),
  ),
  f(
    'CG-AUTH-002',
    true,
    'write scope required',
    secured('', OAUTH(), '[{oauth: [read]}]'),
    secured('', OAUTH(), '[{oauth: [read, write]}]'),
    {
      expect: { classification: 'potentially-breaking', severity: 'high' },
    },
  ),
  f(
    'CG-AUTH-002',
    false,
    'scope removed',
    secured('', OAUTH(), '[{oauth: [read, write]}]'),
    secured('', OAUTH(), '[{oauth: [read]}]'),
  ),
  f('CG-AUTH-003', true, 'anonymous access allowed', secured('[{key: []}]', KEY), secured('[{key: []}, {}]', KEY), {
    expect: { classification: 'non-breaking' },
  }),
  f(
    'CG-AUTH-003',
    true,
    'alternative added',
    secured('[{key: []}]', KEY + BEARER),
    secured('[{key: []}, {bearer: []}]', KEY + BEARER),
  ),
  f(
    'CG-AUTH-003',
    false,
    'alternative removed',
    secured('[{key: []}, {bearer: []}]', KEY + BEARER),
    secured('[{key: []}]', KEY + BEARER),
  ),
  f(
    'CG-AUTH-004',
    true,
    'apiKey header renamed',
    secured('[{key: []}]', KEY),
    secured('[{key: []}]', KEY.replace('X-Key', 'X-Api-Token')),
    {
      expect: { classification: 'breaking', severity: 'high' },
    },
  ),
  f(
    'CG-AUTH-004',
    true,
    'basic → bearer',
    secured('[{h: []}]', '    h: {type: http, scheme: basic}\n'),
    secured('[{h: []}]', '    h: {type: http, scheme: bearer}\n'),
  ),
  f(
    'CG-AUTH-004',
    false,
    'bearerFormat only',
    secured('[{bearer: []}]', BEARER),
    secured('[{bearer: []}]', BEARER.replace('scheme: bearer', 'scheme: bearer, bearerFormat: JWT')),
  ),
  f(
    'CG-AUTH-005',
    true,
    'flow removed',
    secured('', OAUTH() + OAUTH('https://t', 'read: r', 'password').replace('    oauth:', '    other:')),
    secured('', OAUTH() + '    other: {type: oauth2, flows: {}}\n'),
    {
      expect: { classification: 'potentially-breaking', severity: 'medium' },
    },
  ),
  f('CG-AUTH-005', true, 'tokenUrl changed', secured('', OAUTH('https://t1')), secured('', OAUTH('https://t2'))),
  f(
    'CG-AUTH-005',
    true,
    'bearerFormat only is informational',
    secured('', BEARER),
    secured('', BEARER.replace('scheme: bearer', 'scheme: bearer, bearerFormat: JWT')),
    {
      expect: { classification: 'informational' },
    },
  ),
  f(
    'CG-AUTH-005',
    false,
    'scope description edited',
    secured('', OAUTH('https://t', 'read: r')),
    secured('', OAUTH('https://t', 'read: reading')),
  ),
  f(
    'CG-AUTH-006',
    true,
    'renamed with identical definition',
    secured('', '    ApiKeyAuth: {type: apiKey, name: K, in: header}\n'),
    secured('', '    apiKey: {type: apiKey, name: K, in: header}\n'),
    {
      expect: { classification: 'informational' },
    },
  ),
  f(
    'CG-AUTH-006',
    false,
    'definition changed',
    secured('', '    ApiKeyAuth: {type: apiKey, name: K, in: header}\n'),
    secured('', '    apiKey: {type: apiKey, name: Other, in: header}\n'),
  ),
];
