# ADR-19: Determinism and identity

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Decision.**
  - All user-keyed collections are sorted by code-unit order (never `localeCompare`). Operations are ordered by `(path, method)`. Findings are ordered by `(classification rank, severity rank, operationKey, site, schemaPath, ruleId)`.
  - No wall-clock data in analysis outputs. `generatedAt` is the only timestamp and is omitted with `--deterministic` (default in golden tests; the Action keeps it).
  - Numbers are compared mathematically, with exact decimal comparison for values beyond 2^53 (§7.7).
  - **Finding fingerprint** = first 32 hex characters of `sha256` over a canonical tuple `(fingerprintVersion, ruleId, perspective, operationKey, siteKey, normalizedSchemaPath, discriminator)`. It deliberately excludes line numbers, file names, values that can grow (e.g. lists of removed enum values) and tool version (§10.7).
  - **No concurrency** in v1 analysis (single-threaded, async only for I/O, which is awaited in sorted order).
- **Consequences.** CI runs the full corpus twice with shuffled key order and different `cwd` and compares outputs byte-for-byte.
