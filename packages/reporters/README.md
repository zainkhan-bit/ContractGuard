# @zainkhan-bit/contractguard-reporters

Renderers for [ContractGuard](https://github.com/zainkhan-bit/ContractGuard) analysis results.

| Function                                            | Output                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `renderConsole(results, { color, width, groupBy })` | Human terminal output, grouped by cause, width-aware                                  |
| `renderMarkdown(results, { groupBy, maxBytes })`    | Pull-request / job-summary Markdown, capped at GitHub's 1 MiB                         |
| `renderJson(results, { deterministic })`            | Canonical machine report (`reportVersion` 1.x), validated by `schemas/report.v1.json` |
| `renderSarif(results, { srcRoot, rules })`          | SARIF 2.1.0 for GitHub code scanning, with stable `partialFingerprints`               |

All renderers are pure and deterministic. The JSON Schema is exported as
`@zainkhan-bit/contractguard-reporters/schemas/report.v1.json`.

MIT licensed.
