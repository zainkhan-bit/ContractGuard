import { describe, expect, it } from 'vitest';
import { canonicalObject, JsonNumber, type CanonicalJson, type ChangeSubject } from '@zainkhan-bit/contractguard-core';
import {
  isSecretContext,
  MAX_VALUE_CHARS,
  MAX_VALUE_ITEMS,
  REDACTED,
  safeParams,
  safeValue,
} from '../../src/compat/sanitize.js';

const subject = (over: Partial<ChangeSubject>): ChangeSubject =>
  ({
    operationKey: undefined,
    site: { kind: 'requestBody', mediaType: 'application/json' },
    direction: 'request',
    schemaPath: [],
    ...over,
  }) as unknown as ChangeSubject;

describe('finding value sanitization (§16.2 T11)', () => {
  it('keeps scalars, truncates long strings and arrays, bounds depth', () => {
    expect(safeValue(null)).toBeNull();
    expect(safeValue(true)).toBe(true);
    const n = JsonNumber.fromBigInt(42n);
    expect(safeValue(n)).toBe(n);
    expect((safeValue('x'.repeat(500)) as string).length).toBe(MAX_VALUE_CHARS + 1);
    const long = safeValue(Array.from({ length: 70 }, (_, i) => String(i))) as string[];
    expect(long).toHaveLength(MAX_VALUE_ITEMS + 1);
    expect(long.at(-1)).toBe('… (+20 more)');
    let deep: CanonicalJson = 'leaf';
    for (let i = 0; i < 12; i++) deep = [deep];
    expect(JSON.stringify(safeValue(deep))).toContain('…');
  });

  it('redacts nested values under secret-like keys', () => {
    const v = safeValue(
      canonicalObject([
        ['user', 'ann'],
        ['apiKey', 'sk_live_123'],
        ['nested', canonicalObject([['client_secret', 'x']])],
      ]),
    ) as Record<string, unknown>;
    expect(v['user']).toBe('ann');
    expect(v['apiKey']).toBe(REDACTED);
    expect((v['nested'] as Record<string, unknown>)['client_secret']).toBe(REDACTED);
  });

  it('decides secret context from data-valued change kinds and names', () => {
    const prop = subject({ schemaPath: [{ kind: 'property', name: 'password' }] as never });
    expect(isSecretContext('schema.defaultChanged', prop)).toBe(true);
    expect(isSecretContext('schema.enumChanged', prop)).toBe(true);
    expect(isSecretContext('parameter.locationChanged', prop)).toBe(false);
    expect(
      isSecretContext(
        'schema.defaultChanged',
        subject({ site: { kind: 'parameter', key: 'header:X-Api-Key' } as never }),
      ),
    ).toBe(true);
    expect(
      isSecretContext(
        'schema.defaultChanged',
        subject({ site: { kind: 'responseHeader', header: 'Set-Cookie' } as never }),
      ),
    ).toBe(true);
    expect(isSecretContext('schema.defaultChanged', subject({ schemaPath: [{ kind: 'items' }] as never }))).toBe(false);
  });

  it('truncates message parameters', () => {
    const p = safeParams({ a: 'y'.repeat(400), b: ['z'.repeat(300), 3], c: 7 });
    expect(p.a).toHaveLength(MAX_VALUE_CHARS + 1);
    expect((p.b as unknown[])[0]).toHaveLength(MAX_VALUE_CHARS + 1);
    expect((p.b as unknown[])[1]).toBe(3);
    expect(p.c).toBe(7);
  });
});
