import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CHANGE_KINDS,
  directionOf,
  schemaPathKey,
  siteKey,
  type ChangeKind,
  type UsageSite,
} from '../../src/findings/changes.js';
import {
  CLASSIFICATIONS,
  SEVERITIES,
  classificationRank,
  downgradeSeverity,
  isValidClassificationBasis,
  severityAtLeast,
  severityRank,
} from '../../src/findings/classification.js';
import { DEFAULT_CLASSIFICATION_POLICY, DEFAULT_LIMITS } from '../../src/config/config.js';
import { ROOT_POINTER, appendPointer } from '../../src/ids/pointer.js';
import {
  documentUri,
  erasePathTemplateNames,
  isRuleId,
  mediaTypeKey,
  mergedSchemaNodeId,
  operationKey,
  parameterKey,
  ruleId,
  schemaNodeId,
  statusClassOf,
  statusKey,
  type MediaTypeKey,
  type ParameterKey,
  type StatusKey,
} from '../../src/model/identity.js';
import { compareCodeUnits } from '../../src/ids/sorted.js';
import { MODEL_VERSION } from '../../src/model/contract.js';
import { JSON_TYPES } from '../../src/model/schema.js';
import { REPORT_VERSION } from '../../src/findings/result.js';
import { CONTRACT_AREAS } from '../../src/rules/rule.js';

describe('identity helpers', () => {
  it('builds document URIs and schema node ids', () => {
    const uri = documentUri('file:///api/openapi.yaml');
    const id = schemaNodeId(uri, appendPointer(ROOT_POINTER, 'components', 'schemas', 'User'));
    expect(id).toBe('file:///api/openapi.yaml#/components/schemas/User');
    expect(mergedSchemaNodeId(id)).toBe(`${id}~merged`);
    expect(() => documentUri('')).toThrow(RangeError);
  });

  it('validates rule ids', () => {
    expect(isRuleId('CG-REQ-020')).toBe(true);
    expect(isRuleId('CG-SCHEMA-900')).toBe(true);
    expect(isRuleId('CG-XYZ-001')).toBe(false);
    expect(isRuleId('CG-REQ-20')).toBe(false);
    expect(ruleId('CG-API-001')).toBe('CG-API-001');
    expect(() => ruleId('nope')).toThrow(RangeError);
  });

  it('erases template names, including mixed segments', () => {
    expect(erasePathTemplateNames('/users/{id}/files/{name}.{ext}')).toBe('/users/{}/files/{}.{}');
    expect(operationKey('get', '/users/{userId}')).toBe('GET /users/{}');
    expect(operationKey('GET', '/users/{id}')).toBe(operationKey('get', '/users/{userId}'));
    expect(operationKey('get', '/users/')).not.toBe(operationKey('get', '/users'));
  });

  it('builds parameter keys', () => {
    expect(parameterKey('query', 'Limit')).toBe('query:Limit');
    expect(parameterKey('header', 'X-Request-ID')).toBe('header:x-request-id');
    expect(parameterKey('path', 'id', 1)).toBe('path:#1');
    expect(() => parameterKey('path', 'id')).toThrow(RangeError);
    expectTypeOf(parameterKey('cookie', 'sid')).toEqualTypeOf<ParameterKey>();
  });

  it('normalizes status keys', () => {
    expect(statusKey('200')).toBe('200');
    expect(statusKey('2xx')).toBe('2XX');
    expect(statusKey(' default ')).toBe('default');
    expect(statusKey('600')).toBeUndefined();
    expect(statusKey('20')).toBeUndefined();
    expect(statusKey('Default')).toBeUndefined();
    expectTypeOf(statusKey('200')).toEqualTypeOf<StatusKey | undefined>();
  });

  it('classifies status keys', () => {
    const cls = (k: string): string => statusClassOf(statusKey(k) as StatusKey);
    expect(['101', '204', '3XX', '404', '503', 'default'].map(cls)).toEqual([
      'informational',
      'success',
      'redirect',
      'client-error',
      'server-error',
      'default',
    ]);
  });

  it('normalizes media types', () => {
    expect(mediaTypeKey('Application/JSON')).toBe('application/json');
    expect(mediaTypeKey(' text/plain ; Charset="UTF-8" ')).toBe('text/plain;charset=utf-8');
    expect(mediaTypeKey('multipart/form-data; boundary=X; a=1')).toBe('multipart/form-data;a=1;boundary=X');
    expect(mediaTypeKey('application/*')).toBe('application/*');
    expect(mediaTypeKey('application/json;')).toBe('application/json');
    expectTypeOf(mediaTypeKey('a/b')).toEqualTypeOf<MediaTypeKey | undefined>();
  });

  it.each(['json', 'a/b/c', 'a /b', 'text/plain; charset', 'text/plain; =x', 'text/plain; c=', '/json'])(
    'rejects invalid media type %j',
    (raw) => {
      expect(mediaTypeKey(raw)).toBeUndefined();
    },
  );
});

describe('classification helpers', () => {
  it('ranks classifications and severities', () => {
    expect(classificationRank('breaking')).toBe(0);
    expect(classificationRank('informational')).toBe(CLASSIFICATIONS.length - 1);
    expect(severityRank('critical')).toBe(0);
    expect(severityAtLeast('high', 'medium')).toBe(true);
    expect(severityAtLeast('low', 'medium')).toBe(false);
    expect(severityAtLeast('medium', 'medium')).toBe(true);
  });

  it('downgrades severity one level with a floor', () => {
    expect(downgradeSeverity('critical')).toBe('high');
    expect(downgradeSeverity('high')).toBe('medium');
    expect(downgradeSeverity('medium')).toBe('low');
    expect(downgradeSeverity('low')).toBe('low');
    expect(downgradeSeverity('info')).toBe('info');
    expect(downgradeSeverity('high', 'high')).toBe('high');
    expect(downgradeSeverity('low', 'info')).toBe('info');
    expect(SEVERITIES).toHaveLength(5);
  });

  it('enforces valid classification/basis combinations (ADR-10)', () => {
    expect(isValidClassificationBasis('undetermined', 'indeterminate')).toBe(true);
    expect(isValidClassificationBasis('undetermined', 'contract-guaranteed')).toBe(false);
    expect(isValidClassificationBasis('breaking', 'contract-guaranteed')).toBe(true);
    expect(isValidClassificationBasis('breaking', 'policy-dependent')).toBe(true);
    expect(isValidClassificationBasis('breaking', 'consumer-dependent')).toBe(false);
    expect(isValidClassificationBasis('breaking', 'indeterminate')).toBe(false);
    expect(isValidClassificationBasis('potentially-breaking', 'indeterminate')).toBe(true);
    expect(isValidClassificationBasis('non-breaking', 'contract-guaranteed')).toBe(true);
    expect(isValidClassificationBasis('informational', 'indeterminate')).toBe(false);
  });
});

describe('change kinds and keys', () => {
  it('CHANGE_KINDS lists every kind exactly once, sorted', () => {
    // Compile-time: every ChangeKind is in the array and vice versa.
    type Listed = (typeof CHANGE_KINDS)[number];
    expectTypeOf<Listed>().toEqualTypeOf<ChangeKind>();
    expect(new Set(CHANGE_KINDS).size).toBe(CHANGE_KINDS.length);
    expect([...CHANGE_KINDS].sort(compareCodeUnits)).toEqual(CHANGE_KINDS);
  });

  it('derives direction from usage sites', () => {
    const sites: UsageSite[] = [
      { kind: 'operation' },
      { kind: 'parameter', key: parameterKey('query', 'q') },
      { kind: 'requestBody' },
      { kind: 'response', status: '200' as StatusKey },
      { kind: 'responseHeader', status: '200' as StatusKey, header: 'etag' },
      { kind: 'security' },
      { kind: 'servers' },
    ];
    expect(sites.map(directionOf)).toEqual([
      undefined,
      'request',
      'request',
      'response',
      'response',
      undefined,
      undefined,
    ]);
    expect(sites.map(siteKey)).toEqual([
      'operation',
      'parameter:query:q',
      'requestBody',
      'response:200',
      'responseHeader:200:etag',
      'security',
      'servers',
    ]);
  });

  it('includes media types in site keys when present', () => {
    const mt = mediaTypeKey('application/json') as MediaTypeKey;
    expect(siteKey({ kind: 'requestBody', mediaType: mt })).toBe('requestBody:application/json');
    expect(siteKey({ kind: 'response', status: '201' as StatusKey, mediaType: mt })).toBe(
      'response:201:application/json',
    );
  });

  it('builds schema path keys with escaping', () => {
    expect(
      schemaPathKey([
        { kind: 'items' },
        { kind: 'property', name: 'a/b c' },
        { kind: 'additionalProperties' },
        { kind: 'variant', composition: 'oneOf', matchKey: 'Card' },
        { kind: 'discriminatorMapping', value: 'x' },
      ]),
    ).toBe('items/prop:a%2Fb%20c/additionalProperties/oneOf:Card/mapping:x');
    expect(schemaPathKey([])).toBe('');
  });
});

describe('configuration defaults', () => {
  it('matches the documented defaults (§12.6)', () => {
    expect(DEFAULT_CLASSIFICATION_POLICY).toEqual({
      strictResponseValidation: false,
      constraintTightening: 'potentially-breaking',
      responseEnumAdditions: 'potentially-breaking',
      removedRequestParameters: 'non-breaking',
      closedResponseAdditions: 'potentially-breaking',
    });
    expect(DEFAULT_LIMITS.maxDocumentBytes).toBe(20 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxSchemaPairs).toBe(250_000);
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
  });
});

describe('versioned constants', () => {
  it('exposes model/report versions and sorted enumerations', () => {
    expect(MODEL_VERSION).toBe(1);
    expect(REPORT_VERSION).toBe('1.0');
    expect([...JSON_TYPES].sort(compareCodeUnits)).toEqual(JSON_TYPES);
    expect(JSON_TYPES).toHaveLength(7);
    expect([...CONTRACT_AREAS].sort(compareCodeUnits)).toEqual(CONTRACT_AREAS);
  });
});
