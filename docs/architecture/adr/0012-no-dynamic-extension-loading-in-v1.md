# ADR-12: No dynamic extension loading in v1

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Decision.** No plugin loading from config or CLI. Extension points (rules, perspectives, consumer evidence providers, reporters) exist as **TypeScript interfaces in the programmatic API**. Library users can pass custom rules to `evaluate()`, but the CLI loads only built-ins.
- **Justification.** Security (no code execution from repository config), determinism, and master prompt §21 ("no premature plugin system").
- **Consequences.** A future plugin system needs its own ADR (signed/allowlisted modules, explicit CLI flag).
