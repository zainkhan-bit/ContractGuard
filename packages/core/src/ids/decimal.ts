/**
 * Exact decimal numbers for contract values (§7.7).
 *
 * JSON/YAML numbers are kept as exact decimals so that, for example,
 * `maximum: 9007199254740993` and `maximum: 9007199254740992` remain different.
 * Comparison is pure string arithmetic (no BigInt growth on hostile exponents);
 * only `isMultipleOf` uses BigInt and refuses inputs with extreme exponent gaps.
 */

/** Largest accepted |exponent| when parsing. Larger values are rejected (parser emits a diagnostic). */
export const MAX_DECIMAL_EXPONENT = 1_000_000;

/** Exponent gap above which `isMultipleOf` answers "unknown" instead of allocating huge integers. */
export const MAX_MULTIPLE_OF_EXPONENT_GAP = 4_000;

const DECIMAL_SYNTAX = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/;

interface DecimalParts {
  /** -1, 0 or 1 */
  readonly sign: -1 | 0 | 1;
  /** Significant digits without leading/trailing zeros; "" for zero. */
  readonly digits: string;
  /** value = sign × digits × 10^exponent */
  readonly exponent: number;
}

/**
 * An exact, immutable decimal number. Instances are the only representation of
 * numbers inside canonical JSON values.
 */
export class JsonNumber {
  /** Canonical decimal text: plain notation for moderate magnitudes, otherwise normalized scientific ("1.5e40"). */
  readonly text: string;
  /** Nearest IEEE-754 double (for display and heuristics only — never for comparison). */
  readonly approx: number;
  readonly #parts: DecimalParts;

  private constructor(parts: DecimalParts) {
    this.#parts = parts;
    this.text = formatParts(parts);
    this.approx = Number(this.text);
    Object.freeze(this);
  }

  /**
   * Parses decimal source text (JSON number grammar, plus the YAML 1.2 core forms
   * "+1", ".5", "1.", leading zeros). Returns undefined if the text is not a finite
   * decimal or its exponent exceeds MAX_DECIMAL_EXPONENT.
   */
  static parse(text: string): JsonNumber | undefined {
    const parts = parseParts(text.trim());
    return parts === undefined ? undefined : new JsonNumber(parts);
  }

  /** Converts a finite JS number exactly as JavaScript prints it (shortest round-trip form). */
  static fromNumber(value: number): JsonNumber | undefined {
    if (!Number.isFinite(value)) return undefined;
    return JsonNumber.parse(Object.is(value, -0) ? '0' : String(value));
  }

  /** Converts a bigint exactly. */
  static fromBigInt(value: bigint): JsonNumber {
    const parsed = JsonNumber.parse(value.toString());
    // bigint.toString() always yields valid integer syntax with a small exponent.
    return parsed as JsonNumber;
  }

  get isInteger(): boolean {
    return this.#parts.sign === 0 || this.#parts.exponent >= 0;
  }

  get sign(): -1 | 0 | 1 {
    return this.#parts.sign;
  }

  /** Mathematical comparison: negative if this < other, 0 if equal, positive if greater. */
  compare(other: JsonNumber): -1 | 0 | 1 {
    return compareParts(this.#parts, other.#parts);
  }

  equals(other: JsonNumber): boolean {
    return this.compare(other) === 0;
  }

  /**
   * True if this number is an integer multiple of `divisor` (divisor must be > 0),
   * false if not, undefined if the exponent gap is too large to decide cheaply.
   */
  isMultipleOf(divisor: JsonNumber): boolean | undefined {
    const a = this.#parts;
    const b = divisor.#parts;
    if (b.sign <= 0) return undefined;
    if (a.sign === 0) return true;
    if (Math.abs(a.exponent - b.exponent) > MAX_MULTIPLE_OF_EXPONENT_GAP) return undefined;
    const e = Math.min(a.exponent, b.exponent);
    const big = (p: DecimalParts): bigint => BigInt(p.digits) * 10n ** BigInt(p.exponent - e);
    return big(a) % big(b) === 0n;
  }

  toString(): string {
    return this.text;
  }

  toJSON(): string {
    return this.text;
  }
}

function parseParts(text: string): DecimalParts | undefined {
  const match = DECIMAL_SYNTAX.exec(text);
  if (match === null) return undefined;
  const [, signText = '', mantissa = '', exponentText] = match;
  let exponent = 0;
  if (exponentText !== undefined) {
    const strippedExponent = exponentText.replace(/^([+-]?)0+(?=\d)/, '$1');
    if (strippedExponent.replace(/^[+-]/, '').length > 9) return undefined;
    exponent = Number(strippedExponent);
  }
  const dot = mantissa.indexOf('.');
  const intPart = dot === -1 ? mantissa : mantissa.slice(0, dot);
  const fracPart = dot === -1 ? '' : mantissa.slice(dot + 1);
  let digits = intPart + fracPart;
  exponent -= fracPart.length;

  digits = digits.replace(/^0+/, '');
  if (digits === '') return { sign: 0, digits: '', exponent: 0 };
  const trailing = /0+$/.exec(digits);
  if (trailing !== null) {
    exponent += trailing[0].length;
    digits = digits.slice(0, -trailing[0].length);
  }
  const mostSignificant = digits.length - 1 + exponent;
  if (Math.abs(exponent) > MAX_DECIMAL_EXPONENT || Math.abs(mostSignificant) > MAX_DECIMAL_EXPONENT) {
    return undefined;
  }
  return { sign: signText === '-' ? -1 : 1, digits, exponent };
}

function compareParts(a: DecimalParts, b: DecimalParts): -1 | 0 | 1 {
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  const magnitude = compareMagnitude(a, b);
  return (a.sign === 1 ? magnitude : -magnitude) as -1 | 0 | 1;
}

function compareMagnitude(a: DecimalParts, b: DecimalParts): -1 | 0 | 1 {
  const msdA = a.digits.length - 1 + a.exponent;
  const msdB = b.digits.length - 1 + b.exponent;
  if (msdA !== msdB) return msdA < msdB ? -1 : 1;
  const length = Math.max(a.digits.length, b.digits.length);
  const da = a.digits.padEnd(length, '0');
  const db = b.digits.padEnd(length, '0');
  if (da === db) return 0;
  return da < db ? -1 : 1;
}

const PLAIN_LIMIT = 30;

function formatParts(p: DecimalParts): string {
  if (p.sign === 0) return '0';
  const sign = p.sign === -1 ? '-' : '';
  const msd = p.digits.length - 1 + p.exponent;
  if (p.exponent >= 0 && msd < PLAIN_LIMIT) {
    return sign + p.digits + '0'.repeat(p.exponent);
  }
  if (p.exponent < 0 && p.exponent >= -PLAIN_LIMIT && msd < PLAIN_LIMIT) {
    const pointIndex = p.digits.length + p.exponent;
    if (pointIndex > 0) {
      return `${sign}${p.digits.slice(0, pointIndex)}.${p.digits.slice(pointIndex)}`;
    }
    return `${sign}0.${'0'.repeat(-pointIndex)}${p.digits}`;
  }
  const head = p.digits.slice(0, 1);
  const tail = p.digits.slice(1);
  return `${sign}${head}${tail === '' ? '' : `.${tail}`}e${msd >= 0 ? '+' : ''}${msd}`;
}

/**
 * The equivalent inclusive integer bound for integer-only schemas:
 * min: exclusive → floor(x)+1, inclusive → ceil(x); max: exclusive → ceil(x)-1, inclusive → floor(x).
 */
export function integerBound(value: JsonNumber, side: 'min' | 'max', exclusive: boolean): JsonNumber {
  const text = value.text;
  if (/e/i.test(text)) return value; // extreme magnitudes: leave as is
  const negative = text.startsWith('-');
  const [intPart = '0', frac = ''] = text.split('.');
  const truncated = BigInt(intPart);
  const hasFraction = /[1-9]/.test(frac);
  const floor = hasFraction && negative ? truncated - 1n : truncated;
  const ceil = hasFraction && !negative ? truncated + 1n : truncated;
  if (side === 'min') return JsonNumber.fromBigInt(exclusive ? floor + 1n : ceil);
  return JsonNumber.fromBigInt(exclusive ? ceil - 1n : floor);
}
