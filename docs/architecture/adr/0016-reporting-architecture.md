# ADR-16: Reporting architecture

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Decision.** Reporters are pure functions `render(result: AnalysisResult, options) → string` in `@zainkhan-bit/contractguard-reporters`. The engine produces structured data only: explanations are composed from rule message templates plus structured parameters, and wording lives with rule metadata (in `engine`), not in reporters. Reporters do layout only. The JSON report is the canonical machine format, with a versioned JSON Schema (`schemas/report.v1.json`). SARIF is derived from the same `AnalysisResult`.
- **Consequences.** Golden-file tests per reporter. No reporter may reach into canonical models or source files. Everything it needs is in `AnalysisResult` (including pre-resolved line/column ranges).
