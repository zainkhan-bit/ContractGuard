# ADR-15: CI integration

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Alternatives.** (a) JavaScript action wrapping `@zainkhan-bit/contractguard-app`. (b) Composite action running `npx contractguard`. (c) Docker action. (d) GitHub App.
- **Decision.** **(a)** bundled with esbuild to `dist/index.js`, `runs.using: node24`. Publishing channels, in order of reliance: **job summary** (always), **annotations** (top-N), **outputs**, **SARIF file** (for users who upload it), **sticky PR comment** (opt-in; skipped with a notice when the token is read-only). No Checks API in v1. The job itself is the check, and Checks API writes are unavailable on fork PRs.
- **Justification.** (a) starts quickly, needs no network install, can use the library directly and allows rich outputs. (b) depends on registry availability at run time. (c) is slow and Linux-only. (d) needs hosted infrastructure (out of scope).
- **Consequences.** The Action's `dist` must be rebuilt and verified in CI (`git diff --exit-code dist/`).
