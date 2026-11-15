import { sha256Hex } from './hash.js';

/**
 * Small, dependency-free deterministic PRNG (mulberry32). Used for reproducible
 * test-case generation (§14.3). Not cryptographically secure.
 */
export interface Prng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

export function mulberry32(seed: number): Prng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
      }
      return Math.floor(next() * maxExclusive);
    },
  };
}

/** Derives a 32-bit seed from arbitrary strings (stable across platforms and versions). */
export function seedFromStrings(...parts: readonly string[]): number {
  return Number.parseInt(sha256Hex(parts.map((p) => `${p.length}:${p}`).join('|')).slice(0, 8), 16) >>> 0;
}
