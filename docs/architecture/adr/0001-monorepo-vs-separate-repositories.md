# ADR-01: Monorepo vs separate repositories

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Problem.** Several packages (core, parser, engine, reporters, CLI, Action) evolve together, especially before 1.0.
- **Alternatives.** (a) One repo per package. (b) Single repository with a pnpm workspace. (c) Single package with subpath exports.
- **Criteria.** Atomic cross-package changes, enforceable boundaries, release overhead, contributor onboarding.
- **Decision.** **(b) pnpm-workspace monorepo.** The GitHub Action is developed in the monorepo. Whether to mirror its built `dist` to a dedicated `contractguard-action` repo for Marketplace listing is an open question (Q3, §22).
- **Justification.** Interfaces between parser, engine and reporters will change often before 1.0. Atomic PRs and a single CI are worth far more than independent repo lifecycles. Option (c) cannot enforce dependency direction or give separate `engines`/dependency sets to the CLI and the library.
- **Trade-offs.** Workspace tooling complexity; one release pipeline publishes several packages (handled by Changesets).
- **Consequences.** Boundaries must be enforced by tooling (dependency-cruiser + TS project references) rather than repo walls.
