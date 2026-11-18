import { DEFAULT_LIMITS, JsonNumber, type ContractChange } from '@zainkhan-bit/contractguard-core';
import { describe, expect, it } from 'vitest';
import { diffContracts } from '../../src/diff/contract-diff.js';
import { hiddenIn } from '../../src/diff/project.js';
import {
  compareBound,
  compareLimit,
  compareMultipleOf,
  enumDifference,
  formatRelation,
  setRelation,
} from '../../src/schema/relations.js';
import { brief, diff, HEAD30, HEAD31, lenientContract } from '../helpers.js';

/** Puts schemas S (and optional extra components) into a request body and a response of one operation each. */
function spec(schema: string, extra = '', head = HEAD31): string {
  return `${head}paths:
  /s:
    post:
      requestBody: {content: {application/json: {schema: {$ref: '#/components/schemas/S'}}}}
      responses: {'204': {description: ok}}
    get:
      responses: {'200': {description: ok, content: {application/json: {schema: {$ref: '#/components/schemas/S'}}}}}
components:
  schemas:
    S: ${schema}
${extra}`;
}

/** Changes seen in the response (GET) projection, rendered without the site prefix. */
async function res(a: string, b: string, extraA = '', extraB = extraA, head = HEAD31): Promise<string[]> {
  return (await diff(spec(a, extraA, head), spec(b, extraB, head)))
    .filter((c) => c.subject.operationKey === 'GET /s')
    .map((c) => brief(c).replace('GET /s | res 200 application/json | ', ''));
}

describe('schema comparison: keyword families', () => {
  it('compares types with integer ⊂ number and splits nullability', async () => {
    expect(await res('{type: integer}', '{type: number}')).toEqual([
      'schema.typeChanged {"from":{"types":["integer"]},"to":{"types":["number"]},"relation":"superset"}',
    ]);
    expect(await res('{type: number}', '{type: integer}')).toEqual([
      'schema.typeChanged {"from":{"types":["number"]},"to":{"types":["integer"]},"relation":"subset"}',
    ]);
    expect(await res('{type: string}', "{type: [string, 'null']}")).toEqual([
      'schema.nullabilityChanged {"from":false,"to":true}',
    ]);
    expect(await res('{type: [string, boolean]}', '{type: [string, integer]}')).toEqual([
      'schema.typeChanged {"from":{"types":["boolean","string"]},"to":{"types":["integer","string"]},"relation":"overlapping"}',
    ]);
  });

  it('compares trivial schemas as a whole', async () => {
    expect(await res('{}', '{type: string}')).toEqual([
      'schema.typeChanged {"from":{"types":"any"},"to":{"types":["string"]},"relation":"subset"}',
    ]);
    expect(await res('false', '{type: string}')).toEqual([
      'schema.typeChanged {"from":{"types":[]},"to":{"types":["string"]},"relation":"superset"}',
    ]);
    expect(await res('true', '{}')).toEqual([]);
  });

  it('compares enums, including adding and removing the constraint', async () => {
    expect(await res('{type: string, enum: [a, b]}', '{type: string, enum: [b, c], x-extensible-enum: true}')).toEqual([
      'schema.enumChanged {"removed":["a"],"added":["c"],"extensible":true,"constrained":[true,true]}',
    ]);
    expect(await res('{type: string}', '{type: string, const: a}')).toEqual([
      'schema.enumChanged {"removed":[],"added":["a"],"extensible":false,"constrained":[false,true]}',
    ]);
    expect(await res('{type: string, enum: [a]}', '{type: string, const: a}')).toEqual([]);
  });

  it('compares numeric, string, array and object constraints', async () => {
    expect(
      await res(
        '{type: number, minimum: 1, maximum: 10, multipleOf: 2, format: float}',
        '{type: number, exclusiveMinimum: 1, maximum: 20, multipleOf: 3, format: double}',
      ),
    ).toEqual([
      'schema.constraintChanged {"keyword":"maximum","relation":"relaxed"}',
      'schema.constraintChanged {"keyword":"minimum","relation":"tightened"}',
      'schema.constraintChanged {"keyword":"multipleOf","relation":"incomparable"}',
      'schema.formatChanged {"from":"float","to":"double","relation":"superset"}',
    ]);
    expect(
      await res(
        '{type: string, minLength: 1, pattern: a, format: uuid, contentMediaType: text/plain}',
        '{type: string, maxLength: 9, pattern: b, contentEncoding: base64}',
      ),
    ).toEqual([
      'schema.constraintChanged {"keyword":"contentEncoding","relation":"incomparable"}',
      'schema.constraintChanged {"keyword":"contentMediaType","relation":"incomparable"}',
      'schema.constraintChanged {"keyword":"maxLength","relation":"tightened"}',
      'schema.constraintChanged {"keyword":"minLength","relation":"relaxed"}',
      'schema.formatChanged {"from":"uuid","relation":"superset"}',
      'schema.patternChanged {"from":"a","to":"b"}',
    ]);
    expect(
      await res('{type: array, items: {type: string}}', '{type: array, minItems: 1, maxItems: 3, uniqueItems: true}'),
    ).toEqual([
      'schema.constraintChanged {"keyword":"maxItems","relation":"tightened"}',
      'schema.constraintChanged {"keyword":"minItems","relation":"tightened"}',
      'schema.constraintChanged {"keyword":"uniqueItems","relation":"tightened"}',
      'items | schema.typeChanged {"from":{"types":["string"]},"to":{"types":"any"},"relation":"superset"}',
    ]);
    expect(await res('{type: object, minProperties: 2}', '{type: object, maxProperties: 5}')).toEqual([
      'schema.constraintChanged {"keyword":"maxProperties","relation":"tightened"}',
      'schema.constraintChanged {"keyword":"minProperties","relation":"relaxed"}',
    ]);
  });

  it('scopes keyword families to types both sides admit', async () => {
    expect(await res('{type: object, properties: {a: {type: string}}}', '{type: string, maxLength: 3}')).toEqual([
      'schema.typeChanged {"from":{"types":["object"]},"to":{"types":["string"]},"relation":"disjoint"}',
    ]);
  });

  it('compares properties, required sets, additionalProperties and defaults', async () => {
    expect(
      await res(
        '{type: object, required: [a, ghost], properties: {a: {type: string}, b: {type: string}}, additionalProperties: {type: string}, default: {}}',
        '{type: object, required: [a, c], properties: {a: {type: string}, c: {type: integer}}, additionalProperties: {type: integer}, default: {a: x}}',
      ),
    ).toEqual([
      'schema.defaultChanged {}',
      'schema.propertyAdded {"property":"c","required":true,"parentAdditionalProperties":{"base":"schema","candidate":"schema"},"parentHasUnevaluatedProperties":false}',
      'schema.propertyRemoved {"property":"b","required":false,"parentAdditionalProperties":{"base":"schema","candidate":"schema"},"parentHasUnevaluatedProperties":false}',
      'schema.requiredChanged {"property":"ghost","from":true,"to":false}',
      'additionalProperties | schema.typeChanged {"from":{"types":["string"]},"to":{"types":["integer"]},"relation":"disjoint"}',
    ]);
    expect(await res('{type: object}', '{type: object, additionalProperties: false}')).toEqual([
      'schema.additionalPropertiesChanged {"from":"any","to":"none"}',
    ]);
    expect(await res('{type: object, additionalProperties: {type: string}}', '{type: object}')).toEqual([
      'schema.additionalPropertiesChanged {"from":"schema","to":"any"}',
      'additionalProperties | schema.typeChanged {"from":{"types":["string"]},"to":{"types":"any"},"relation":"superset"}',
    ]);
    expect(
      await res('{type: object, additionalProperties: {type: string}}', '{type: object, additionalProperties: false}'),
    ).toEqual(['schema.additionalPropertiesChanged {"from":"schema","to":"none"}']);
  });

  it('hides readOnly properties in requests and writeOnly in responses, but reports access changes', async () => {
    const a = spec(
      '{type: object, required: [id], properties: {id: {type: integer, readOnly: true}, pw: {type: string, writeOnly: true}, x: {type: string}}}',
    );
    const b = spec(
      '{type: object, properties: {id: {type: string, readOnly: true}, pw: {type: integer, writeOnly: true}, x: {type: string, readOnly: true}, y: {type: string, readOnly: true}}}',
    );
    expect((await diff(a, b)).map(brief)).toEqual([
      'GET /s | res 200 application/json | schema.accessChanged {"property":"x","readOnly":[false,true],"writeOnly":[false,false],"requiredInBase":false}',
      'GET /s | res 200 application/json | schema.propertyAdded {"property":"y","required":false,"parentAdditionalProperties":{"base":"any","candidate":"any"},"parentHasUnevaluatedProperties":false}',
      'GET /s | res 200 application/json | schema.requiredChanged {"property":"id","from":true,"to":false}',
      'GET /s | res 200 application/json | id | schema.typeChanged {"from":{"types":["integer"]},"to":{"types":["string"]},"relation":"disjoint"}',
      'POST /s | body application/json | schema.accessChanged {"property":"x","readOnly":[false,true],"writeOnly":[false,false],"requiredInBase":false}',
      'POST /s | body application/json | pw | schema.typeChanged {"from":{"types":["string"]},"to":{"types":["integer"]},"relation":"disjoint"}',
    ]);
  });

  it('reports a change in a recursive schema once, at its shallowest path, with one cause per definition', async () => {
    const node = (t: string): string =>
      spec(
        `{type: object, properties: {v: {type: ${t}}, children: {type: array, items: {$ref: '#/components/schemas/S'}}}}`,
      );
    const out = await diff(node('string'), node('integer'));
    expect(out.map(brief)).toEqual([
      'GET /s | res 200 application/json | v | schema.typeChanged {"from":{"types":["string"]},"to":{"types":["integer"]},"relation":"disjoint"}',
      'POST /s | body application/json | v | schema.typeChanged {"from":{"types":["string"]},"to":{"types":["integer"]},"relation":"disjoint"}',
    ]);
    expect(new Set(out.map((c) => c.causeKey)).size).toBe(1);
  });

  it('records unsupported keyword changes (value-aware) without guessing a direction', async () => {
    expect(
      await res('{type: object, dependentRequired: {a: [b]}}', '{type: object, dependentRequired: {a: [c]}}'),
    ).toEqual(['schema.unsupportedChanged {"keywords":["dependentRequired"]}']);
    expect(await res('{not: {type: string}}', '{not: {type: integer}}')).toEqual([
      'schema.unsupportedChanged {"keywords":["not"]}',
    ]);
    expect(
      await res(
        "{type: object, patternProperties: {'^a': {type: string}}}",
        "{type: object, patternProperties: {'^a': {type: integer}}}",
      ),
    ).toEqual(['schema.unsupportedChanged {"keywords":["patternProperties"]}']);
    expect(
      await res('{type: array, prefixItems: [{type: string}]}', '{type: array, prefixItems: [{type: integer}]}'),
    ).toEqual(['schema.unsupportedChanged {"keywords":["prefixItems"]}']);
    expect(
      await res(
        '{type: object, unevaluatedProperties: false}',
        '{type: object, unevaluatedProperties: false, properties: {a: {}}}',
      ),
    ).toEqual([
      'schema.propertyAdded {"property":"a","required":false,"parentAdditionalProperties":{"base":"any","candidate":"any"},"parentHasUnevaluatedProperties":true}',
    ]);
  });
});

describe('schema comparison: composition', () => {
  const variants = `    Cat: {type: object, title: Cat, properties: {kind: {type: string}, purrs: {type: boolean}}}
    Dog: {type: object, properties: {kind: {type: string}, barks: {type: boolean}}}
    Bird: {type: object, properties: {kind: {type: string}, wings: {type: integer}}}
`;
  const oneOf = (refs: string, mapping = ''): string =>
    `{oneOf: [${refs}], discriminator: {propertyName: kind${mapping === '' ? '' : `, mapping: {${mapping}}`}}}`;
  const ref = (n: string): string => `{$ref: '#/components/schemas/${n}'}`;

  it('matches branches by discriminator value and component name and reports added/removed variants', async () => {
    expect(
      await res(
        oneOf(`${ref('Cat')}, ${ref('Dog')}`, `c: '#/components/schemas/Cat', d: '#/components/schemas/Dog'`),
        oneOf(`${ref('Cat')}, ${ref('Bird')}`, `c: '#/components/schemas/Cat', b: '#/components/schemas/Bird'`),
        variants,
      ),
    ).toEqual([
      'schema.discriminatorMappingChanged {"removed":["Dog","d"],"added":["Bird","b"]}',
      'schema.variantAdded {"composition":"oneOf","hasDiscriminator":true}',
      'schema.variantRemoved {"composition":"oneOf","hasDiscriminator":true}',
    ]);
    const changedCat = variants.replace('purrs: {type: boolean}', 'purrs: {type: string}');
    expect(
      await res(oneOf(`${ref('Cat')}, ${ref('Dog')}`), oneOf(`${ref('Cat')}, ${ref('Dog')}`), variants, changedCat),
    ).toEqual([
      'oneOf[Cat].purrs | schema.typeChanged {"from":{"types":["boolean"]},"to":{"types":["string"]},"relation":"disjoint"}',
    ]);
  });

  it('reports a discriminator property change', async () => {
    expect(
      await res(oneOf(ref('Cat')), oneOf(ref('Cat')).replace('propertyName: kind', 'propertyName: type'), variants),
    ).toEqual(['schema.discriminatorMappingChanged {"removed":["Cat"],"added":["Cat"]}']);
  });

  it('matches inline branches by title, fingerprint, sole remaining and similarity', async () => {
    expect(
      await res(
        '{anyOf: [{type: string, title: s}, {type: integer}]}',
        '{anyOf: [{type: integer}, {type: string, title: s, maxLength: 2}]}',
      ),
    ).toEqual(['anyOf[s] | schema.constraintChanged {"keyword":"maxLength","relation":"tightened"}']);
    expect(
      await res(
        '{anyOf: [{type: string}, {type: boolean}]}',
        '{anyOf: [{type: boolean}, {type: string, minLength: 1}]}',
      ),
    ).toEqual(['anyOf[#0] | schema.constraintChanged {"keyword":"minLength","relation":"tightened"}']);
    expect(
      await res(
        '{anyOf: [{type: object, properties: {a: {}, b: {}}}, {type: object, properties: {x: {}, y: {}}}, {type: boolean}]}',
        '{anyOf: [{type: object, properties: {x: {}, y: {}, z: {}}}, {type: object, properties: {a: {}, b: {}, c: {}}}]}',
      ),
    ).toEqual([
      'schema.variantRemoved {"composition":"anyOf","hasDiscriminator":false}',
      'anyOf[#0] | schema.propertyAdded {"property":"c","required":false,"parentAdditionalProperties":{"base":"any","candidate":"any"},"parentHasUnevaluatedProperties":false}',
      'anyOf[#1] | schema.propertyAdded {"property":"z","required":false,"parentAdditionalProperties":{"base":"any","candidate":"any"},"parentHasUnevaluatedProperties":false}',
    ]);
  });

  it('flags ambiguous matching and oversize compositions as unanalyzable', async () => {
    const amb = await res(
      '{anyOf: [{type: object, properties: {a: {}}}, {type: string}, {type: boolean}]}',
      '{anyOf: [{type: object, properties: {a: {}, b: {}}}, {type: object, properties: {a: {}, c: {}}}]}',
    );
    expect(amb).toContain('schema.compositionUnanalyzable {"reason":"ambiguous anyOf branch matching"}');
    const many = `{oneOf: [${Array.from({ length: 65 }, (_, i) => `{const: ${i}}`).join(', ')}]}`;
    expect(await res(many, many.replace('{const: 0}', '{const: -1}'))).toEqual([
      'schema.compositionUnanalyzable {"reason":"more than 64 oneOf branches"}',
    ]);
  });

  it('compares non-mergeable allOf branch-wise and merged allOf as one object', async () => {
    expect(
      await res(
        '{allOf: [{type: object, properties: {a: {type: string}}}, {type: object, properties: {a: {maxLength: 3}}}]}',
        '{type: object, properties: {a: {type: string, maxLength: 3}}}',
      ),
    ).toEqual([]);
    expect(
      await res(
        '{allOf: [{oneOf: [{type: string}]}, {minLength: 1}]}',
        '{allOf: [{oneOf: [{type: string}]}, {minLength: 2}]}',
      ),
    ).toEqual(['allOf[#1] | schema.constraintChanged {"keyword":"minLength","relation":"tightened"}']);
    expect(
      await res(
        '{allOf: [{type: object, required: [a]}, {type: object, additionalProperties: false, properties: {a: {}}}]}',
        '{type: object, required: [a], additionalProperties: false, properties: {a: {}}}',
      ),
    ).toEqual([]);
    expect(
      await res('{allOf: [{type: string}, {type: integer}]}', '{allOf: [{type: string}, {type: integer}]}'),
    ).toEqual([]);
    expect(
      await res('{allOf: [{multipleOf: 2}, {multipleOf: 3}]}', '{allOf: [{multipleOf: 2}, {multipleOf: 5}]}'),
    ).toEqual(['allOf[#1] | schema.constraintChanged {"keyword":"multipleOf","relation":"incomparable"}']);
  });

  it('merges allOf parts with nullability, enums, bounds, items, discriminators and defaults', async () => {
    const merged =
      "{allOf: [{type: [number, 'null'], enum: [1, 2, 3, null], minimum: 1, exclusiveMaximum: 9, default: 2}, {type: [integer, 'null'], enum: [2, 3, null], maximum: 9, title: t}]}";
    const flat = "{type: [integer, 'null'], enum: [2, 3, null], minimum: 1, exclusiveMaximum: 9, default: 2}";
    expect(await res(merged, flat)).toEqual([]);
    const arr = '{allOf: [{type: array, items: {type: string}, minItems: 1}, {maxItems: 4, uniqueItems: true}]}';
    expect(await res(arr, '{type: array, items: {type: string}, minItems: 1, maxItems: 4, uniqueItems: true}')).toEqual(
      [],
    );
    expect(
      await res(
        '{allOf: [{type: object, additionalProperties: {type: string}}, {minProperties: 1}]}',
        '{type: object, additionalProperties: {type: string}, minProperties: 1}',
      ),
    ).toEqual([]);
  });
});

describe('schema comparison: limits and unresolved references', () => {
  it('reports budget exhaustion instead of hanging', async () => {
    const a = spec('{type: object, properties: {a: {type: string}, b: {type: string}}}');
    const out = await diff(a, a.replace('b: {type: string}', 'b: {type: integer}'), 1);
    expect(out.map((c) => c.kind)).toContain('schema.budgetExceeded');
  });

  it('reports unresolved references as undetermined', async () => {
    const base = await lenientContract(spec("{$ref: './missing.yaml#/X'}"));
    const cand = await lenientContract(spec('{type: string}'));
    const changes: readonly ContractChange[] = diffContracts(base, cand, { limits: DEFAULT_LIMITS }).changes;
    expect(changes.map((c) => c.kind)).toEqual(['schema.unresolvedReference', 'schema.unresolvedReference']);
    expect(changes[0]?.facts).toEqual({ raw: './missing.yaml#/X' });
  });

  it('works with 3.0 documents', async () => {
    expect(await res('{type: string, nullable: true}', '{type: string}', '', '', HEAD30)).toEqual([
      'schema.nullabilityChanged {"from":true,"to":false}',
    ]);
  });
});

describe('relations', () => {
  const n = (x: string): JsonNumber => JsonNumber.parse(x) as JsonNumber;
  it('computes set relations', () => {
    expect(setRelation(new Set([1]), new Set([1]))).toBe('equal');
    expect(setRelation(new Set([1]), new Set([1, 2]))).toBe('superset');
    expect(setRelation(new Set([1, 2]), new Set([1]))).toBe('subset');
    expect(setRelation(new Set([1, 2]), new Set([2, 3]))).toBe('overlapping');
    expect(setRelation(new Set([1]), new Set([2]))).toBe('disjoint');
  });

  it('orders bounds, limits and multipleOf', () => {
    expect(compareBound(undefined, undefined, 'min')).toBeUndefined();
    expect(compareBound(undefined, { value: n('1'), exclusive: false }, 'min')).toBe('tightened');
    expect(compareBound({ value: n('1'), exclusive: false }, undefined, 'max')).toBe('relaxed');
    expect(compareBound({ value: n('1'), exclusive: false }, { value: n('1'), exclusive: true }, 'min')).toBe(
      'tightened',
    );
    expect(compareBound({ value: n('1'), exclusive: true }, { value: n('1'), exclusive: false }, 'max')).toBe(
      'relaxed',
    );
    expect(compareBound({ value: n('5'), exclusive: false }, { value: n('3'), exclusive: false }, 'max')).toBe(
      'tightened',
    );
    expect(compareBound({ value: n('1'), exclusive: true }, { value: n('1'), exclusive: true }, 'max')).toBeUndefined();
    expect(compareLimit(1, 1, 'min')).toBeUndefined();
    expect(compareLimit(Infinity, 3, 'max')).toBe('tightened');
    expect(compareMultipleOf(undefined, undefined)).toBeUndefined();
    expect(compareMultipleOf(undefined, n('2'))).toBe('tightened');
    expect(compareMultipleOf(n('2'), undefined)).toBe('relaxed');
    expect(compareMultipleOf(n('2'), n('2.0'))).toBeUndefined();
    expect(compareMultipleOf(n('2'), n('4'))).toBe('tightened');
    expect(compareMultipleOf(n('0.5'), n('0.25'))).toBe('relaxed');
  });

  it('relates formats through the lattice', () => {
    expect(formatRelation('int32', 'int64')).toBe('superset');
    expect(formatRelation('int64', 'int32')).toBe('subset');
    expect(formatRelation(undefined, 'uuid')).toBe('subset');
    expect(formatRelation('date', undefined)).toBe('superset');
    expect(formatRelation('date', 'date-time')).toBe('disjoint');
    expect(formatRelation('custom', 'other')).toBe('unknown');
    expect(formatRelation(undefined, 'custom')).toBe('unknown');
    expect(formatRelation('custom', undefined)).toBe('unknown');
    expect(formatRelation('email', 'idn-email')).toBe('superset');
  });

  it('diffs enums by JSON equality', () => {
    expect(enumDifference(['x', 'a', null], ['a', 'y', null])).toEqual({ removed: ['x'], added: ['y'] });
  });

  it('computes direction visibility', () => {
    expect(hiddenIn(undefined, 'request')).toBe(false);
    expect(hiddenIn({}, 'request')).toBe(false);
    expect(hiddenIn({ base: { readOnly: true, writeOnly: false } }, 'request')).toBe(true);
    expect(
      hiddenIn(
        { base: { readOnly: true, writeOnly: false }, candidate: { readOnly: false, writeOnly: false } },
        'request',
      ),
    ).toBe(false);
    expect(hiddenIn({ candidate: { readOnly: false, writeOnly: true } }, 'response')).toBe(true);
  });
});
