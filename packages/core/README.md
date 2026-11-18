# @zainkhan-bit/contractguard-core

The dependency-free foundation of [ContractGuard](../../README.md). It defines the shared domain model and deterministic utilities used by every other package. It performs **no I/O**.

## Contents

| Area                     | Exports                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical contract model | `ApiContract`, `Operation`, `Parameter`, `RequestBody`, `Response`, `Header`, `SecurityScheme`, `EffectiveSecurity`, `SchemaGraph`, `SchemaNode`, `SchemaEdge`, `SchemaReference`, …                   |
| Identity                 | `DocumentUri`, `SchemaNodeId`, `OperationKey`, `RuleId`, `ParameterKey`, `StatusKey`, `MediaTypeKey`, `SourceRef`, and normalizers `operationKey()`, `parameterKey()`, `statusKey()`, `mediaTypeKey()` |
| Changes and findings     | `ContractChange` (perspective-neutral change events), `CompatibilityFinding`, `AnalysisResult`, classification / severity / basis enums and helpers                                                    |
| Rules and perspectives   | `RuleDefinition`, `RuleAssessment`, `CompatibilityPerspective` contracts                                                                                                                               |
| Configuration            | `ResolvedConfiguration` (alias `AnalysisConfiguration`), defaults                                                                                                                                      |
| Diagnostics              | `Diagnostic`, `StageResult`, the `CGD-*` code registry, deterministic ordering                                                                                                                         |
| Deterministic utilities  | RFC 6901 JSON pointers, exact decimals (`JsonNumber`), canonical JSON (equality, ordering, serialization), SHA-256 hashing, code-unit sorting, seeded PRNG                                             |

## Guarantees

- **Exact numbers.** `JsonNumber` compares mathematically without floating-point loss (`9007199254740993 ≠ 9007199254740992`, `1 = 1.0`) and refuses hostile exponents.
- **Deterministic.** All ordering is by UTF-16 code units (never locale-dependent); canonical serialization and hashing are independent of key order.
- **Prototype-safe.** Canonical objects have a null prototype; keys like `__proto__` are plain data.

See the [architecture blueprint §7](../../docs/architecture/BLUEPRINT.md#7-canonical-contract-model) for the full model specification.
