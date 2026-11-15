# ADR-05: Structural specification validation

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Problem.** "Parses as YAML" ≠ "valid OpenAPI". We need spec-level validation with good locations, and it must not block the pipeline in ways that hide useful findings.
- **Alternatives.** (a) Ajv 2020 with the official schemas. (b) `@hyperjump/json-schema` OpenAPI dialects. (c) Hand-written validation only. (d) Spectral as a dependency.
- **Criteria.** Correct 2020-12 / `$dynamicRef` handling for 3.1, 3.0 support, output with instance locations, dependency weight, license.
- **Decision.** **(b) behind a `SpecValidator` port**, plus a small set of hand-written **semantic validations** that no meta-schema can express (duplicate equivalent path templates, duplicate `operationId`, path template ↔ path parameter consistency, unknown security scheme references, discriminator mapping targets).
- **Justification.** Ajv's documented `$dynamicRef` problems with the OAS 3.1 schema force schema patching (a). Hand-writing all structural validation (c) duplicates the official schema and drifts. Spectral (d) is a linter with a large dependency tree and rule semantics we do not need.
- **Trade-offs.** Hyperjump is less widely used than Ajv. Performance on very large documents must be measured (M2 spike, acceptance: validate a 5 MB spec in < 2 s). Fallback: run structural validation only on the root document skeleton and rely on the normalizer's typed checks.
- **Consequences.** Validation errors become `Diagnostic`s with pointer + source range. By default, spec errors in either document stop analysis (exit 2). `--allow-invalid-spec` continues with warnings and marks the run as _degraded_ in all reports.
