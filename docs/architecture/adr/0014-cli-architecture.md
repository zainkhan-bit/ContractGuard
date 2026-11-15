# ADR-14: CLI architecture

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Alternatives.** commander / yargs / clipanion / `node:util.parseArgs` with an in-house command table.
- **Decision.** **`node:util.parseArgs` + a small declarative command table** (name, positionals, options with types/defaults/help, handler). Help text and shell-completion scripts are generated from the table. Colour via `node:util.styleText`, respecting `NO_COLOR` / `FORCE_COLOR` / TTY.
- **Justification.** Five commands do not justify a framework dependency (C3). `parseArgs` is stable in Node ≥ 20 and strict (unknown options are errors). The CLI holds no business logic: each handler builds an `AnalysisRequest`, calls `app.analyze()`, renders and maps to an exit code.
- **Trade-offs.** We implement help formatting and "did you mean" suggestions (~200 lines).
- **Consequences.** CLI integration tests run the built binary as a subprocess (§18.9).
