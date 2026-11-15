import { createHash } from 'node:crypto';
import { stringifyCanonical, type CanonicalJson } from './canonical-json.js';

/** Hex-encoded SHA-256 of a string (UTF-8) or bytes. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** SHA-256 over the canonical serialization of a value. Equal values hash identically. */
export function hashCanonical(value: CanonicalJson): string {
  return sha256Hex(stringifyCanonical(value));
}

/** Truncated canonical hash (default 32 hex chars = 128 bits), used for fingerprints. */
export function shortHash(value: CanonicalJson, hexLength = 32): string {
  if (!Number.isInteger(hexLength) || hexLength < 8 || hexLength > 64) {
    throw new RangeError(`hexLength must be an integer in [8, 64], got ${hexLength}`);
  }
  return hashCanonical(value).slice(0, hexLength);
}
