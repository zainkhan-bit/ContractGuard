# ADR-18: Error handling model

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Decision.** Expected failures are values; bugs are exceptions.
  - Pipeline stages return `StageResult<T> = { value?: T; diagnostics: Diagnostic[] }`. A stage _fails_ when it emits an `error`-severity diagnostic in a category that the stage policy marks as fatal (§8.8).
  - Exceptions are reserved for invariant violations (`InternalError`) and are caught only at process boundaries (CLI `main`, Action `run`), which map them to exit code 4 with a redacted message (`--debug` prints the stack).
  - Diagnostics have a stable `code` (`CGD-<AREA>-NNN`; numbers ≥ 100 within an area are warnings/info), `category`, `severity`, message, optional `location`, optional `hint`.
  - _Amendment (M0):_ argument-validation errors in public helpers (e.g. `ruleId('x')`) throw `RangeError`; this is API misuse by a caller, treated like an invariant violation.
- **Justification.** Users see many errors at once (all reference errors, not just the first), and every error has a location and a fix hint.
- **Consequences.** Lint rule: no `throw` outside `InternalError`/`assert` helpers in library packages (custom ESLint rule or `no-restricted-syntax`).
