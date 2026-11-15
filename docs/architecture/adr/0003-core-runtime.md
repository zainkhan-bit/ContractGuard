# ADR-03: Core runtime

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Problem.** Pick the supported runtime and module system.
- **Alternatives.** Node ≥ 22 / ≥ 24; Bun/Deno support; CJS+ESM dual vs ESM-only.
- **Criteria.** LTS horizon at 1.0 (mid-2027 estimate), GitHub Action runtime, dependency requirements, maintenance.
- **Decision.** **Node.js ≥ 24, ESM-only.** CI matrix: 24 and 26 on Linux/macOS/Windows. Bun/Deno are not targeted (no Node-specific APIs beyond `node:` built-ins, so they may work, untested).
- **Justification.** Node 22 reaches EOL in April 2027, before the expected 1.0. The Action must run on `node24` anyway. Node 24 has stable `util.parseArgs`, `util.styleText`, `fetch`, and `require(esm)` interop for CJS consumers. ESM-only avoids dual-package hazards. CJS consumers on Node 24 can still `require()` ESM without top-level await (§20.4 forbids top-level await in published entry points).
- **Trade-offs.** Excludes users pinned to Node 22 CI images (they can use the Action or `setup-node`).
- **Consequences.** `"type": "module"`, `"exports"` maps only, `engines.node: ">=24"`.
