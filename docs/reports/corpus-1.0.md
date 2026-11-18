# Real-world corpus and differential report (1.0)

510 consecutive version pairs from 12 public API histories, compared with ContractGuard and
[oasdiff](https://github.com/oasdiff/oasdiff) 1.39.0 (`oasdiff breaking`). Source list: `corpus/sources.json`.
Produced by the [corpus workflow](https://github.com/zainkhan-bit/ContractGuard/actions/workflows/corpus.yml) on a
GitHub-hosted runner (4 pairs in parallel); the workflow runs weekly and on demand, and its step summary has the
latest numbers.

## Per source

A pair is a pair of consecutive commits that changed the specification. "Breaking" means at least one finding
classified _breaking_ (ContractGuard) or one `ERR` (oasdiff). "Agreeing" counts pairs where both tools completed and
agree on whether the pair is breaking.

| Source         | Pairs | CG completed | Pairs breaking (CG) | Pairs breaking (oasdiff) | Agreeing |  CG p50 / p95 |
| -------------- | ----: | -----------: | ------------------: | -----------------------: | -------: | ------------: |
| openai         |    50 |           50 |                   2 |                       14 |    34/50 | 10.2 / 10.7 s |
| discord        |    50 |           41 |                   5 |                       14 |    34/41 |   2.2 / 2.4 s |
| pagerduty      |    50 |           50 |                   7 |        — (oasdiff fails) |        — |   2.6 / 2.9 s |
| twilio         |    50 |           50 |                  10 |                       13 |    47/50 |   3.2 / 4.1 s |
| box            |    50 |           50 |                   4 |                        4 |    48/50 |   1.6 / 1.8 s |
| adyen-checkout |    50 |           50 |                  12 |                       15 |    45/50 |   0.8 / 1.1 s |
| asana          |    50 |           50 |                   4 |                       11 |    41/50 |   3.8 / 4.2 s |
| plaid          |    50 |           50 |                  34 |                       40 |    44/50 |   5.2 / 6.7 s |
| stripe         |    10 |           10 |  0 (8 undetermined) |                        8 |     2/10 |  9.2 / 10.6 s |
| digitalocean   |    50 |            0 |                   — |        — (oasdiff fails) |        — |             — |
| cloudflare     |    25 |            0 |                   — |                        9 |        — |             — |
| github         |    25 |            0 |                   — |                        5 |        — |             — |
| **Total**      |   510 |          401 |                  78 |                      133 |  295/351 |               |

## Success metrics (§2.9)

- **Self-comparison:** `check(A, A)` on two independent loads of every candidate: **0** non-informational findings
  across all versions that load.
- **Differential coverage:** 351 pairs compared with both tools completing (target ≥ 500 pairs attempted: 510).
- **Agreement on "is this pair breaking?":** 295 of 351 (84%). The differences are explained below.
- **Robustness:** no crash, hang or out-of-memory on any pair. Every pair ends with a report or a precise input error.

## Why the tools disagree

Measured at operation level on a 385-pair development run of the same sources:

| oasdiff check behind oasdiff-only `ERR`s                               | Operations | ContractGuard                                                                                                                   |
| ---------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------- |
| `response-property-enum-value-added`                                   |      1,746 | _potentially-breaking_ by default ([`compatibility.responseEnumAdditions`](../reference/config))                                |
| `request-property-const-added` + `request-property-enum-value-removed` |  223 + 223 | the value moved from `enum` into a `const` branch; `const` normalizes to a one-value enum, so the accepted values are unchanged |
| `request-parameter-type-changed` (format only)                         |         61 | `CG-REQ-028`, _potentially-breaking_: format validation is optional in JSON Schema                                              |
| `request-property-min-length-set` / `max-length-set`                   |         28 | tighter constraint → _potentially-breaking_ (`compatibility.constraintTightening`)                                              |
| `response-property-one-of-added` / `any-of-added`                      |         24 | new response shape → _potentially-breaking_                                                                                     |
| `api-security-scope-added`                                             |          8 | `CG-AUTH-002`, _potentially-breaking_: existing tokens may already carry the scope                                              |

In the other direction, ContractGuard reported 11 breaking operations that oasdiff did not: required response
properties removed (`CG-RES-001`), request properties no longer allowed under `additionalProperties: false`
(`CG-REQ-029`), path parameter enum narrowing (`CG-REQ-020`) and responses that became nullable or untyped
(`CG-RES-008`, `CG-RES-009`). Each finding names the two revisions, so it can be checked against the published history.

The pair-level difference is therefore mostly policy: oasdiff treats new response enum values and new response
variants as errors; ContractGuard flags them for review and lets a team make them failing in configuration.

## Specifications ContractGuard rejects

ContractGuard stops with an input error when a specification violates OpenAPI in a way that changes meaning. These
are genuine violations in the published files, not parser gaps:

| Source       | Pairs | Diagnostic   | Problem                                                                                              |
| ------------ | ----: | ------------ | ---------------------------------------------------------------------------------------------------- |
| discord      |     9 | CGD-SPEC-005 | `oneOf: []` (must have at least one schema)                                                          |
| github       |    25 | CGD-SEM-001  | equivalent path templates (`/repos/{owner}/{repo}` declared twice with different parameter names)    |
| cloudflare   |    25 | CGD-SEM-004  | security requirements name schemes that are not defined (`assets_jwt`, `pages_upload_token`)         |
| digitalocean |    50 | CGD-SPEC-005 | `$ref` in place of Operation objects (not allowed by OpenAPI 3.0 or 3.1); oasdiff fails on YAML here |

`--allow-invalid-spec` (or `analysis.allowInvalidSpec: true`) continues past these errors and marks the run
_completed-degraded_; affected parts are skipped and reported, never guessed.

**Limits raised for 1.0 from the corpus:** DigitalOcean's split specification has about 3,600 files, so the default
`analysis.limits.maxDocuments` is now 5,000 (was 500).

## Known limitations

- **Stripe** (11 MB JSON, deeply nested `anyOf` expansions) exceeds the default comparison budget
  (`analysis.limits.maxSchemaPairs`, 250,000): 8 of 10 pairs end with _undetermined_ findings (`CG-SCHEMA-902`) for the
  affected operations instead of a verdict. These fail nothing by default (`--undetermined review`) and are listed in
  the report. Raising the budget far enough for Stripe needs more than 6 GB of memory today; summarising projections
  for very wide schema graphs is planned work.
- **PagerDuty:** oasdiff cannot load any of the 50 pairs (`expecting ref to response object`); ContractGuard completes
  all of them, so there is no differential for this source.
- **Loading split specifications from git** costs one `git show` per file; the first DigitalOcean pair took 150 s on
  the development container. Batch loading is planned.

Reproduce locally (needs git and the oasdiff binary):

```sh
pnpm build
node scripts/corpus/fetch.mjs
node scripts/corpus/run.mjs --oasdiff ./oasdiff --jobs 4
node scripts/corpus/report.mjs corpus/results/<date>
```
