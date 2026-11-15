import { describe, expect, it } from 'vitest';
import { JsonNumber, MAX_DECIMAL_EXPONENT } from '../../src/ids/decimal.js';

const n = (text: string): JsonNumber => {
  const v = JsonNumber.parse(text);
  if (v === undefined) throw new Error(`unparseable ${text}`);
  return v;
};

describe('JsonNumber.parse', () => {
  it.each([
    ['0', '0'],
    ['-0', '0'],
    ['0.000', '0'],
    ['+1', '1'],
    ['007', '7'],
    ['1.50', '1.5'],
    ['.5', '0.5'],
    ['1.', '1'],
    ['1e3', '1000'],
    ['1E+3', '1000'],
    ['1.5e-2', '0.015'],
    ['-12.340e1', '-123.4'],
    ['9007199254740993', '9007199254740993'],
    ['1e30', '1e+30'],
    ['123e28', '1.23e+30'],
    ['1e29', '100000000000000000000000000000'],
    ['1e-31', '1e-31'],
    ['0.000000000000000000000000000001', '0.000000000000000000000000000001'],
    ['-2.5e-40', '-2.5e-40'],
    ['  42  ', '42'],
  ])('parses %s as %s', (input, expected) => {
    expect(n(input).text).toBe(expected);
  });

  it.each(['', 'abc', '1e', '--1', '0x1F', '.', '1.2.3', 'NaN', 'Infinity', '.inf', '1_000'])('rejects %j', (input) => {
    expect(JsonNumber.parse(input)).toBeUndefined();
  });

  it('rejects hostile exponents without allocating', () => {
    expect(JsonNumber.parse('1e9999999999')).toBeUndefined();
    expect(JsonNumber.parse(`1e${MAX_DECIMAL_EXPONENT + 1}`)).toBeUndefined();
    expect(JsonNumber.parse(`1e-${MAX_DECIMAL_EXPONENT + 1}`)).toBeUndefined();
    expect(JsonNumber.parse(`1e${MAX_DECIMAL_EXPONENT}`)?.text).toBe(`1e+${MAX_DECIMAL_EXPONENT}`);
  });

  it('accepts exponents with leading zeros', () => {
    expect(n('1e0005').text).toBe('100000');
    expect(n('1e-0002').text).toBe('0.01');
  });
});

describe('JsonNumber.fromNumber / fromBigInt', () => {
  it('converts finite numbers exactly as printed', () => {
    expect(JsonNumber.fromNumber(0.1)?.text).toBe('0.1');
    expect(JsonNumber.fromNumber(-0)?.text).toBe('0');
    expect(JsonNumber.fromNumber(1e21)?.text).toBe('1000000000000000000000');
    expect(JsonNumber.fromNumber(5e-324)?.text).toBe('5e-324');
  });

  it('rejects non-finite numbers', () => {
    expect(JsonNumber.fromNumber(Number.NaN)).toBeUndefined();
    expect(JsonNumber.fromNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('converts bigints exactly', () => {
    expect(JsonNumber.fromBigInt(123456789012345678901234567890n).text).toBe('123456789012345678901234567890');
    expect(JsonNumber.fromBigInt(1234567890123456789012345678901n).text).toBe('1.234567890123456789012345678901e+30');
    expect(JsonNumber.fromBigInt(-5n).text).toBe('-5');
  });
});

describe('JsonNumber comparison', () => {
  it('compares mathematically, not textually', () => {
    expect(n('1').compare(n('1.0'))).toBe(0);
    expect(n('10').compare(n('9'))).toBe(1);
    expect(n('-10').compare(n('-9'))).toBe(-1);
    expect(n('0.1').compare(n('0.09'))).toBe(1);
    expect(n('-1').compare(n('0'))).toBe(-1);
    expect(n('0').compare(n('-0'))).toBe(0);
    expect(n('9007199254740993').compare(n('9007199254740992'))).toBe(1);
    expect(n('1e1000').compare(n('9e999'))).toBe(1);
    expect(n('123').compare(n('1.23e2'))).toBe(0);
    expect(n('1.2301').compare(n('1.23'))).toBe(1);
  });

  it('exposes equals, sign and isInteger', () => {
    expect(n('2.50').equals(n('2.5'))).toBe(true);
    expect(n('-3').sign).toBe(-1);
    expect(n('0').sign).toBe(0);
    expect(n('3').sign).toBe(1);
    expect(n('1e3').isInteger).toBe(true);
    expect(n('1.5').isInteger).toBe(false);
    expect(n('0').isInteger).toBe(true);
  });

  it('approximates for display', () => {
    expect(n('1.5e-2').approx).toBe(0.015);
  });

  it('serializes via toString / toJSON', () => {
    expect(String(n('1.50'))).toBe('1.5');
    expect(JSON.stringify({ v: n('2e3') })).toBe('{"v":"2000"}');
  });

  it('is immutable', () => {
    expect(Object.isFrozen(n('1'))).toBe(true);
  });
});

describe('JsonNumber.isMultipleOf', () => {
  it.each([
    ['4', '2', true],
    ['2', '4', false],
    ['3', '2', false],
    ['0', '7', true],
    ['0.3', '0.1', true],
    ['0.35', '0.1', false],
    ['1e5', '0.001', true],
    ['-6', '3', true],
    ['10', '2.5', true],
  ] as const)('%s is multiple of %s → %s', (a, b, expected) => {
    expect(n(a).isMultipleOf(n(b))).toBe(expected);
  });

  it('is undefined for non-positive divisors', () => {
    expect(n('4').isMultipleOf(n('0'))).toBeUndefined();
    expect(n('4').isMultipleOf(n('-2'))).toBeUndefined();
  });

  it('is undefined for huge exponent gaps', () => {
    expect(n('1e5000').isMultipleOf(n('1'))).toBeUndefined();
  });
});
