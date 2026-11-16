import { describe, expect, it } from 'vitest';
import { describeSubject, interpolate, schemaPathText } from '../../src/compat/text.js';

describe('finding text', () => {
  it('renders schema paths', () => {
    expect(
      schemaPathText([
        { kind: 'property', name: 'items' },
        { kind: 'items' },
        { kind: 'property', name: 'a' },
        { kind: 'additionalProperties' },
        { kind: 'variant', composition: 'oneOf', matchKey: 'Card' },
        { kind: 'discriminatorMapping', value: 'card' },
      ]),
    ).toBe('items[].a.{*}.oneOf[Card].mapping[card]');
    expect(schemaPathText([{ kind: 'additionalProperties' }])).toBe('{*}');
    expect(schemaPathText([{ kind: 'variant', composition: 'anyOf', matchKey: '#0' }])).toBe('anyOf[#0]');
    expect(schemaPathText([{ kind: 'discriminatorMapping', value: 'x' }])).toBe('mapping[x]');
  });

  it('describes every site kind', () => {
    const d = (site: object, extra: object = {}): string =>
      describeSubject({ site, schemaPath: [], ...extra } as never);
    expect(d({ kind: 'operation' }, { method: 'GET', path: '/a' })).toBe('GET /a: the operation');
    expect(d({ kind: 'servers' })).toBe('the server list');
    expect(d({ kind: 'security' })).toBe('the security schemes');
    expect(d({ kind: 'security' }, { operationKey: 'GET /a' })).toBe('the security requirements');
    expect(d({ kind: 'parameter', key: 'header:x-id' })).toBe('header parameter "x-id"');
    expect(d({ kind: 'requestBody' })).toBe('the request body');
    expect(d({ kind: 'response', status: '200' })).toBe('response 200');
    expect(d({ kind: 'responseHeader', status: '200', header: 'etag' })).toBe('header "etag" of response 200');
    expect(
      describeSubject({
        site: { kind: 'requestBody', mediaType: 'application/json' },
        schemaPath: [{ kind: 'property', name: 'a' }],
      } as never),
    ).toBe('the request body (application/json) at `a`');
  });

  it('interpolates parameters', () => {
    expect(interpolate('{a} and {b} and {missing}', { a: 'x', b: ['1', '2'] })).toBe('x and 1, 2 and {missing}');
    expect(interpolate('{n}/{t}', { n: 3, t: true })).toBe('3/true');
  });
});
