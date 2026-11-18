# ContractGuard

**Deterministic, evidence-backed compatibility analysis for OpenAPI contracts.**

ContractGuard compares a baseline and a candidate API specification and tells you, for every change, **what changed**, **whether it is compatible under a named compatibility perspective**, **how certain that conclusion is**, and **exactly where the evidence lives** in your source files.

> **Status: 1.0 release candidate.** The CLI, the GitHub Action and the libraries are complete; the first npm release is pending. Documentation: https://zainkhan-bit.github.io/ContractGuard/ The architecture is complete and approved ([blueprint](docs/architecture/BLUEPRINT.md)); implementation proceeds milestone by milestone (see [roadmap](docs/architecture/BLUEPRINT.md#19-implementation-roadmap)).

## What makes it different

- **Directional, formal semantics.** Requests must not narrow (everything old clients could send is still accepted); responses must not widen (everything the new provider can return still satisfies old clients). Every verdict is derived from a published table, not ad-hoc rules.
- **Honest uncertainty.** Five classifications (`breaking`, `potentially-breaking`, `non-breaking`, `informational`, `undetermined`), separate severities, and a _basis_ that says whether a verdict is guaranteed by the contract, depends on consumer behaviour, depends on your policy, or cannot be determined.
- **Root-cause grouping.** A change in a shared schema is reported once as a cause, with every affected operation listed — not as N unrelated warnings.
- **No false alarms from refactors.** Moving schemas into `components`, renaming components, reordering keys, or migrating `nullable` (3.0) to `type: [T, "null"]` (3.1) produce no findings.
- **Local-first and safe.** No network access by default, no code execution from specs or config, hard limits on hostile input.

## Progress

| Milestone | Scope                                                       | Status  |
| --------- | ----------------------------------------------------------- | ------- |
| M0        | Repository foundations + `@zainkhan-bit/contractguard-core` | ✅ Done |
| M1        | Parsing with source maps                                    | ✅ Done |
| M2        | Reference resolution + validation                           | ✅ Done |
| M3        | Normalization to the canonical model                        | ✅ Done |
| M4        | Diff engine                                                 | ✅ Done |
| M5        | Compatibility engine + 83-rule catalog                      | ✅ Done |
| M6        | Reporters (console, Markdown, JSON, SARIF)                  | ✅ Done |
| M7        | CLI                                                         | ✅ Done |
| M8        | GitHub Action                                               | ✅ Done |
| M9        | 1.0 production readiness                                    | ✅ Done |

## Try the CLI (from a clone)

```bash
pnpm install && pnpm build
node packages/cli/bin/contractguard.js check git:origin/main:openapi.yaml openapi.yaml
node packages/cli/bin/contractguard.js init        # writes a commented .contractguard.yaml
node packages/cli/bin/contractguard.js explain --list
```

Exit codes: `0` passed · `1` policy failed · `2` invalid input · `3` usage/config error · `4` internal error · `130` interrupted.
See [packages/cli/README.md](packages/cli/README.md) for every command and source type.

## GitHub Action

```yaml
- uses: actions/checkout@v7
- uses: zainkhan-bit/ContractGuard/integrations/github-action@main
  with:
    specs: api/openapi.yaml
    comment: true # needs permissions: pull-requests: write
```

Annotations on the changed lines, the report in the job summary, a sticky PR comment and SARIF. It works on fork pull
requests with a read-only token. See [integrations/github-action](integrations/github-action/README.md).

## Development

Requirements: Node.js ≥ 24, pnpm 11 (`corepack enable`).

```bash
pnpm install
pnpm build          # tsc project references
pnpm test           # vitest
pnpm coverage       # vitest with coverage thresholds
pnpm lint           # eslint + prettier + dependency boundaries
pnpm check          # all of the above
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [docs/architecture](docs/architecture/) for the design.

## License

[MIT](LICENSE)
