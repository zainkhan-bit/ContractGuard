# ADR-09: Rule engine architecture

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Problem.** Rules must be registered, discoverable, documented, testable in isolation and configurable. They must not spread through the differ as conditionals.
- **Alternatives.** (a) Rules embedded in the differ. (b) Declarative-only rules (data tables). (c) A typed rule registry: each rule declares the change kinds it handles and a pure `assess()` function, plus metadata used for docs, SARIF and `explain`.
- **Criteria.** Separation from diffing, exhaustiveness, documentation generation, determinism.
- **Decision.** **(c)**, with declarative helpers for the common "kind → effect/strength" mapping so that most rules are a few lines of data.
- **Justification.** Pure functions of `(change, context)` are trivially unit-testable and deterministic. Metadata generates `docs/rules/*.md`, `explain` output and SARIF `rules[]` from a single source.
- **Trade-offs.** One extra indirection compared with inline checks.
- **Consequences.** A build-time check (unit test) asserts that every `ChangeKind` is handled by at least one rule or is explicitly listed as "not compatibility-relevant", and that every rule has ≥ 1 positive and ≥ 1 negative fixture. No third-party plugin loading in v1 (master prompt §21: no premature plugin system). The registry is internal but shaped to allow it later.
