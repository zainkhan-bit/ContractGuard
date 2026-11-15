# ADR-11: Configuration format

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Alternatives.** YAML, JSON, TOML, JS/TS config files, `package.json` key.
- **Decision.** **`.contractguard.yaml`** (also `.contractguard.yml` / `.contractguard.json`), versioned (`version: 1`). Validated with a zod 4 schema that also generates `schemas/config.v1.json` for editor completion. No JS/TS config files.
- **Justification.** YAML matches the domain (OpenAPI users already write YAML). JS config would execute repository code and kill determinism (C2). Zod gives typed parsing, readable errors and JSON Schema export from one definition.
- **Trade-offs.** No computed configuration. Users who need it can generate the YAML.
- **Consequences.** Config discovery, validation and defaults live in `@contractguard/app`. The resolved config type lives in `core`.
