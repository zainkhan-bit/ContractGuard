# Contributing to ContractGuard

Thanks for helping! ContractGuard is a correctness-first tool, so contributions are held to a high bar for tests and evidence. This guide explains how to work in the repository.

## Setup

```bash
corepack enable            # uses the pnpm version pinned in package.json
pnpm install
pnpm check                 # build + lint + tests with coverage
```

Node.js ≥ 24 is required.

## Architecture first

Read [docs/architecture/BLUEPRINT.md](docs/architecture/BLUEPRINT.md) — at least §1 (summary), §6 (module responsibilities) and §10 (rules). Architectural decisions live in [docs/architecture/adr](docs/architecture/adr/). A change that contradicts an ADR needs a new or amended ADR in the same PR.

Key rules enforced by CI:

- **Dependency boundaries** (dependency-cruiser): `core` depends on nothing; the engine never imports the OpenAPI package; file/network/process APIs only in loaders, adapters, the CLI and the Action.
- **Determinism**: no `localeCompare`, no wall-clock data in analysis output, sort with `compareCodeUnits`.
- **Errors**: expected failures are `Diagnostic`s; only invariant violations throw (`InternalError` / `assert`).
- **No `any`**, strict TypeScript, exhaustive `switch`es.

## Workflow

1. Open or pick an issue. For a new compatibility rule, use the _Rule proposal_ template first — rule semantics are discussed before code.
2. Write tests with the change. Every bug fix adds a regression test or fixture that fails before the fix.
3. Add a changeset if behaviour changes: `pnpm changeset`.
4. Run `pnpm check` locally.
5. Sign off your commits (Developer Certificate of Origin): `git commit -s`.

## Tests

| Kind                             | Location                          |
| -------------------------------- | --------------------------------- |
| Unit                             | `packages/*/test/unit`            |
| Property-based (fast-check)      | `packages/*/test/property`        |
| Compatibility fixtures (from M4) | `fixtures/compat/<topic>/<case>/` |

Property-test failures print a seed; replay with `FC_SEED=<seed>`.

## Adding a compatibility rule (from M5)

1. Add the rule to the catalog in `packages/engine/src/rules/` with metadata (summary, rationale, limitations, examples, severity profile).
2. Add at least one positive and one negative fixture under `fixtures/compat/`.
3. Regenerate docs (`pnpm docs:rules`, added in M5).
4. Never reuse or repurpose a released rule ID.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
