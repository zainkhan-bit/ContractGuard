/**
 * Representative analysis results for golden tests (§13, M6): real specs → loadContract → checkCompatibility →
 * assembleResult. Everything is in memory under file:///repo so outputs are identical on every OS.
 */
import {
  DEFAULT_LIMITS,
  documentUri,
  type AnalysisResult,
  type Diagnostic,
  type ReferencePolicy,
} from '@contractguard/core';
import {
  assembleResult,
  checkCompatibility,
  RULESET_VERSION,
  type CheckOptions,
  type ReportPolicy,
} from '@contractguard/engine';
import { loadContract, MemorySourceLoader } from '@contractguard/openapi';

export const SRC_ROOT = 'file:///repo';
const POLICY: ReferencePolicy = {
  root: '/',
  allowRemote: false,
  allowedHosts: [],
  allowedSchemes: [],
  fetchTimeoutMs: 1,
  maxRemoteBytes: 1,
};
const H = 'openapi: 3.1.0\ninfo: {title: Payments, version: "1.0"}\n';

interface Side {
  readonly files: Readonly<Record<string, string>>;
  readonly revision?: string;
}

interface ScenarioSpec {
  readonly name: string;
  readonly base: Side;
  readonly candidate: Side;
  readonly check?: CheckOptions;
  readonly policy?: ReportPolicy;
  readonly allowInvalidSpec?: boolean;
}

async function load(side: Side, dir: string, allowInvalidSpec: boolean) {
  const entries = Object.entries(side.files).map(
    ([path, text]) => [documentUri(`${SRC_ROOT}/${dir}/${path}`), text] as const,
  );
  const loader = new MemorySourceLoader(entries, ['file:']);
  return loadContract(documentUri(`${SRC_ROOT}/${dir}/openapi.yaml`), {
    loader,
    policy: POLICY,
    limits: DEFAULT_LIMITS,
    validator: false,
    allowInvalidSpec,
    side: dir === 'base' ? 'base' : 'candidate',
  });
}

export async function build(s: ScenarioSpec): Promise<AnalysisResult> {
  const b = await load(s.base, 'base', s.allowInvalidSpec ?? false);
  const c = await load(s.candidate, 'api', s.allowInvalidSpec ?? false);
  const diagnostics: Diagnostic[] = [...b.diagnostics, ...c.diagnostics];
  const findings =
    b.value !== undefined && c.value !== undefined
      ? checkCompatibility(b.value.contract, c.value.contract, { today: '2026-11-16', ...s.check }).findings
      : [];
  return assembleResult({
    specId: s.name,
    perspective: 'provider-backward',
    toolVersion: '0.1.0',
    rulesetVersion: RULESET_VERSION,
    ...(b.value === undefined
      ? {}
      : {
          base: { contract: b.value.contract, ...(s.base.revision === undefined ? {} : { revision: s.base.revision }) },
        }),
    ...(c.value === undefined
      ? {}
      : {
          candidate: {
            contract: c.value.contract,
            ...(s.candidate.revision === undefined ? {} : { revision: s.candidate.revision }),
          },
        }),
    findings,
    diagnostics,
    degraded: b.value?.degraded === true || c.value?.degraded === true,
    ...(s.policy === undefined ? {} : { policy: s.policy }),
  });
}

const one = (text: string, revision?: string): Side => ({
  files: { 'openapi.yaml': text },
  ...(revision === undefined ? {} : { revision }),
});

const USERS = `${H}paths:
  /users/{id}:
    parameters: [{name: id, in: path, required: true, schema: {type: string}}]
    get:
      operationId: getUser
      responses:
        '200': {description: ok, content: {application/json: {schema: {$ref: '#/components/schemas/User'}}}}
        '404': {description: missing}
  /users:
    get:
      parameters: [{name: limit, in: query, schema: {type: integer, maximum: 100, default: 20}}]
      responses:
        '200': {description: ok, content: {application/json: {schema: {type: array, items: {$ref: '#/components/schemas/User'}}}}}
    post:
      requestBody: {required: true, content: {application/json: {schema: {$ref: '#/components/schemas/NewUser'}}}}
      responses: {'201': {description: created}}
components:
  schemas:
    User:
      type: object
      required: [id, email]
      properties:
        id: {type: string}
        email: {type: string, format: email}
        status: {type: string, enum: [active, suspended]}
        score: {type: number, maximum: 10.5}
    NewUser:
      type: object
      required: [email]
      properties:
        email: {type: string, maxLength: 200}
        nickname: {type: string}
`;

const MIXED = USERS.replace('required: [id, email]', 'required: [id]')
  .replace('enum: [active, suspended]', 'enum: [active, suspended, deleted]')
  .replace('maxLength: 200', 'maxLength: 100')
  // A function replacement: '$' in a replacement string has special meaning.
  .replace(
    '        nickname: {type: string}\n',
    () => "        nickname: {type: string, pattern: '^[a-z]+$'}\n        role: {type: string}\n",
  )
  .replace('required: [email]', 'required: [email, role]')
  .replace('maximum: 10.5', 'maximum: 12.25')
  .replace("        '404': {description: missing}\n", '');

const STRICT: ReportPolicy = {
  failOn: ['breaking', 'potentially-breaking'],
  minSeverity: 'medium',
  undetermined: 'fail',
};

export const SCENARIOS: readonly ScenarioSpec[] = [
  { name: 'identical', base: one(USERS, 'git:origin/main@3f2a9c1'), candidate: one(USERS, 'working tree') },
  { name: 'mixed-changes', base: one(USERS, 'git:origin/main@3f2a9c1'), candidate: one(MIXED, 'working tree') },
  { name: 'mixed-strict-policy', base: one(USERS), candidate: one(MIXED), policy: STRICT },
  {
    name: 'suppressed',
    base: one(USERS),
    candidate: one(MIXED),
    check: {
      ignore: [
        {
          rule: 'CG-RES-002',
          reason: 'email is optional by design (ADR-12)',
          expires: '2027-01-31',
          configPointer: '/rules/ignore/0',
        },
        { rule: 'CG-REQ-001', reason: 'clients upgraded', configPointer: '/rules/ignore/1' },
      ] as never,
    },
  },
  {
    name: 'operation-removed',
    base: one(USERS),
    candidate: one(USERS.replace(/ {4}post:\n(?: {6}.*\n)+/, '')),
  },
  {
    name: 'probable-rename',
    base: one(USERS),
    candidate: one(USERS.replace('/users/{id}:', '/members/{id}:')),
  },
  {
    name: 'deprecated-removal',
    base: one(USERS.replace('    post:\n', '    post:\n      deprecated: true\n')),
    candidate: one(USERS.replace(/ {4}post:\n(?: {6}.*\n)+/, '')),
  },
  {
    name: 'security',
    base: one(
      `${H}security: [{key: []}]\npaths:\n  /a: {get: {responses: {'200': {description: ok}}}}\n  /b: {get: {security: [], responses: {'200': {description: ok}}}}\ncomponents:\n  securitySchemes:\n    key: {type: apiKey, name: X-Key, in: header}\n    oauth: {type: oauth2, flows: {clientCredentials: {tokenUrl: 'https://auth/token', scopes: {read: r}}}}\n`,
    ),
    candidate: one(
      `${H}security: [{apiKey: []}]\npaths:\n  /a: {get: {security: [{oauth: [read]}], responses: {'200': {description: ok}}}}\n  /b: {get: {security: [{apiKey: []}], responses: {'200': {description: ok}}}}\ncomponents:\n  securitySchemes:\n    apiKey: {type: apiKey, name: X-Key, in: header}\n    oauth: {type: oauth2, flows: {clientCredentials: {tokenUrl: 'https://auth2/token', scopes: {read: r}}}}\n`,
    ),
  },
  {
    name: 'servers',
    base: one(
      `${H}servers: [{url: 'https://us.api.example.com/v1'}, {url: 'https://eu.api.example.com/v1'}]\npaths: {}\n`,
    ),
    candidate: one(`${H}servers: [{url: 'https://us.api.example.com/v2'}]\npaths: {}\n`),
  },
  {
    name: 'multi-file',
    base: {
      files: {
        'openapi.yaml': `${H}paths:\n  /orders:\n    get:\n      responses: {'200': {description: ok, content: {application/json: {schema: {$ref: 'schemas/order.yaml'}}}}}\n`,
        'schemas/order.yaml':
          'type: object\nrequired: [id, total]\nproperties:\n  id: {type: string}\n  total: {type: integer}\n',
      },
    },
    candidate: {
      files: {
        'openapi.yaml': `${H}paths:\n  /orders:\n    get:\n      responses: {'200': {description: ok, content: {application/json: {schema: {$ref: 'schemas/order.yaml'}}}}}\n`,
        'schemas/order.yaml':
          'type: object\nrequired: [id, total]\nproperties:\n  id: {type: string}\n  total: {type: number}\n',
      },
    },
  },
  {
    name: 'undetermined',
    base: one(
      `${H}paths:\n  /x:\n    post:\n      requestBody: {content: {application/json: {schema: {type: string, pattern: '^[a-z]+$'}}}}\n      responses: {'204': {description: ok}}\n`,
    ),
    candidate: one(
      `${H}paths:\n  /x:\n    post:\n      requestBody: {content: {application/json: {schema: {type: string, pattern: '^[a-z0-9]+$'}}}}\n      responses: {'204': {description: ok}}\n`,
    ),
    policy: { failOn: ['breaking'], minSeverity: 'low', undetermined: 'fail' },
  },
  {
    name: 'group-by-operation',
    base: one(USERS),
    candidate: one(MIXED),
  },
  {
    name: 'input-error',
    base: one(USERS),
    candidate: one('openapi: 3.1.0\ninfo: {title: broken\npaths: {}\n'),
  },
  {
    name: 'degraded',
    base: one(USERS),
    candidate: one(
      USERS.replace(
        'components:',
        () => "  /dup/{a}:\n    get: {operationId: getUser, responses: {'200': {description: ok}}}\ncomponents:",
      ),
    ),
    allowInvalidSpec: true,
  },
  {
    name: 'responses',
    base: one(
      `${H}paths:\n  /r:\n    get:\n      responses:\n        '200': {description: ok, headers: {X-Rate: {required: true, schema: {type: integer}}}, content: {application/json: {schema: {type: object}}, application/xml: {schema: {type: object}}}}\n        '404': {description: nf}\n`,
    ),
    candidate: one(
      `${H}paths:\n  /r:\n    get:\n      responses:\n        '201': {description: created, content: {application/json: {schema: {type: object}}}}\n        '429': {description: slow}\n`,
    ),
  },
  {
    name: 'composition',
    base: one(
      `${H}paths:\n  /p:\n    post:\n      requestBody: {content: {application/json: {schema: {oneOf: [{$ref: '#/components/schemas/Card'}, {$ref: '#/components/schemas/Wallet'}], discriminator: {propertyName: kind}}}}}\n      responses: {'200': {description: ok, content: {application/json: {schema: {anyOf: [{type: string}, {type: integer}]}}}}}\ncomponents:\n  schemas:\n    Card: {type: object, properties: {kind: {type: string}, number: {type: string}}}\n    Wallet: {type: object, properties: {kind: {type: string}, walletId: {type: string}}}\n`,
    ),
    candidate: one(
      `${H}paths:\n  /p:\n    post:\n      requestBody: {content: {application/json: {schema: {oneOf: [{$ref: '#/components/schemas/Card'}], discriminator: {propertyName: kind}}}}}\n      responses: {'200': {description: ok, content: {application/json: {schema: {anyOf: [{type: string}, {type: integer}, {type: boolean}]}}}}}\ncomponents:\n  schemas:\n    Card: {type: object, properties: {kind: {type: string}, number: {type: string}}}\n`,
    ),
  },
  {
    name: 'parameters',
    base: one(
      `${H}paths:\n  /s:\n    get:\n      parameters:\n        - {name: q, in: query, schema: {type: string}}\n        - {name: ids, in: query, schema: {type: array, items: {type: string}}}\n        - {name: api_key, in: query, schema: {type: string}}\n      responses: {'200': {description: ok}}\n`,
    ),
    candidate: one(
      `${H}paths:\n  /s:\n    get:\n      parameters:\n        - {name: q, in: query, required: true, schema: {type: string}}\n        - {name: ids, in: query, explode: false, schema: {type: array, items: {type: string}}}\n        - {name: api_key, in: header, required: true, schema: {type: string}}\n        - {name: X-Tenant, in: header, required: true, schema: {type: string}}\n      responses: {'200': {description: ok}}\n`,
    ),
  },
  {
    name: 'equivalent-included',
    base: one(
      USERS.replace('openapi: 3.1.0', 'openapi: 3.0.3').replace(
        '{type: string, format: email}',
        '{type: string, format: email, nullable: true}',
      ),
    ),
    candidate: one(
      USERS.replace('{type: string, format: email}', "{type: [string, 'null'], format: email}").replace(
        'operationId: getUser',
        'operationId: fetchUser',
      ),
    ),
    check: { includeEquivalentChanges: true },
  },
  {
    name: 'markdown-special-characters',
    base: one(
      `${H}paths:\n  /a|b:\n    get:\n      responses: {'200': {description: ok, content: {application/json: {schema: {type: object, required: ['pipe|name'], properties: {'pipe|name': {type: string}}}}}}}\n`,
    ),
    candidate: one(
      `${H}paths:\n  /a|b:\n    get:\n      responses: {'200': {description: ok, content: {application/json: {schema: {type: object, properties: {}}}}}}\n`,
    ),
  },
];

/** A large result for size-cap tests: many operations with breaking and non-breaking changes. */
export function largeSpecs(count: number): { base: string; candidate: string } {
  let base = `${H}paths:\n`;
  let cand = `${H}paths:\n`;
  for (let i = 0; i < count; i++) {
    base += `  /r${String(i)}:\n    get:\n      responses: {'200': {description: ok, content: {application/json: {schema: {type: object, required: [a], properties: {a: {type: string}, b: {type: string, enum: [x, y]}}}}}}}\n`;
    cand += `  /r${String(i)}:\n    get:\n      responses: {'200': {description: ok, content: {application/json: {schema: {type: object, properties: {a: {type: string}, b: {type: string, enum: [x]}, c${String(i)}: {type: string}}}}}}}\n`;
  }
  return { base, candidate: cand };
}

export { one };
