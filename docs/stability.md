# Versioning and stability

ContractGuard follows [Semantic Versioning](https://semver.org). All packages (`contractguard` and
`@zainkhan-bit/contractguard-*`) are released together with the same version number. The GitHub Action uses the same
version, with a moving major tag (`v1`).

## What 1.x promises

| Surface               | Needs a major version                                                                              | Minor                      | Patch                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| CLI                   | Removing or renaming commands or flags, changing what an exit code means, changing default formats | New commands and flags     | Fixes                                                            |
| `.contractguard.yaml` | A new `version`, removing keys                                                                     | New optional keys          | —                                                                |
| JSON report           | A new major `reportVersion`                                                                        | Additive fields (`1.x`)    | —                                                                |
| Rules                 | Changing a rule's default classification or what it detects                                        | **New rules**, new options | Message wording; fixing a rule to match its documented behaviour |
| Fingerprints          | A new algorithm (`cg-fp-v2`)                                                                       | —                          | —                                                                |
| Library APIs          | Changing exported types or functions                                                               | Additions                  | Fixes                                                            |
| Node.js               | Dropping a Node.js major                                                                           | —                          | —                                                                |

## Two things to know

- **New rules arrive in minor versions** and can find problems that older versions missed. Pin the version in CI
  (`npx contractguard@1.2.3`, or `@v1.2.3` for the Action) if you need reproducible builds.
- **Fixing a missed breaking change is a patch.** If a rule failed to detect something it documents, the fix ships in
  a patch release even though it can newly fail a build. An analyzer that keeps known false negatives for
  compatibility's sake would defeat its purpose.

## Public library API

The supported entry points are the package roots of `@zainkhan-bit/contractguard-core`, `-openapi`, `-engine`,
`-reporters` and `-app`. Deep imports are not supported. The canonical contract model is an in-memory format, not a
serialization format: do not store it.

## Support

The latest minor release of the current major version receives fixes, including security fixes. See [SECURITY.md](https://github.com/zainkhan-bit/ContractGuard/blob/main/SECURITY.md).
