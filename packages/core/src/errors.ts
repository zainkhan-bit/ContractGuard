/**
 * Invariant violations (bugs). Expected failures are reported as Diagnostics, never thrown (ADR-18).
 * InternalError is caught only at process boundaries (CLI main, Action run).
 */
export class InternalError extends Error {
  override readonly name: string = 'InternalError';
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.details = details;
  }
}

/** Throws InternalError when `condition` is false. Use only for invariants, never for input validation. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new InternalError(`Assertion failed: ${message}`);
  }
}

/** Exhaustiveness helper for discriminated unions. */
export function assertNever(value: never, context = 'value'): never {
  throw new InternalError(`Unexpected ${context}: ${JSON.stringify(value)}`);
}
