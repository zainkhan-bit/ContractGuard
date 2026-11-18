# Governance

ContractGuard is maintained by **Muhammad Zain Khan** ([@zainkhan-bit](https://github.com/zainkhan-bit)). This
document says how decisions are made, so contributors know what to expect.

## Roles

| Role        | Who                               | Can                                                      |
| ----------- | --------------------------------- | -------------------------------------------------------- |
| Maintainer  | @zainkhan-bit                     | Merge, release, triage, decide on rules and architecture |
| Contributor | Anyone with a merged pull request | Propose changes, review others' pull requests            |

New maintainers are invited after sustained, high-quality contributions (reviews count as much as code). With more
than one maintainer, every change needs one approving review from a maintainer other than its author.

## How decisions are made

- **Everyday changes** (fixes, docs, tests): a pull request with green CI and a maintainer's approval.
- **Architecture** (package boundaries, the canonical model, the rule engine, public APIs): an Architecture Decision
  Record in `docs/architecture/adr/`, discussed in its pull request for at least 7 days before merging.
- **Rule changes** follow the rule policy below.
- **Disagreements** are settled by the maintainers, with the reasoning written in the issue or pull request.

## Rule policy

Rules decide whether builds fail, so they change carefully.

1. **New rules and changes to what a rule detects** start as a [rule proposal](https://github.com/zainkhan-bit/ContractGuard/issues/new/choose)
   with before/after examples and the place in the perspective tables (blueprint §10.3).
2. Every rule ships with at least one fixture that fires and one that does not
   (`packages/engine/test/compat/fixtures.ts`); the documentation page is generated from them.
3. **Changing a rule's default classification** is a breaking change (major version). Fixing a rule so it matches its
   documented behaviour is a patch, even when it newly fails a build (see [stability](docs/stability.md)).
4. **False positives come first.** A confirmed false-positive report gets a fix or a documented decision within one
   release cycle.

## Releases

Releases are cut from `main` by merging the "Version Packages" pull request that Changesets maintains. Publishing
needs approval in the protected `release` environment and produces npm provenance. See [RELEASING.md](RELEASING.md).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Code of conduct

Everyone participating follows the [Code of Conduct](CODE_OF_CONDUCT.md).
