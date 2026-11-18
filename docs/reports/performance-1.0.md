# Performance (1.0)

**Benchmark:** `bench/run.mjs` generates the NFR-03 API (1,000 operations, 2,000 component schemas of 12 properties,
short `$ref` chains), a candidate with a few changes of each kind, and runs `contractguard check` in a fresh process.
Wall time includes Node.js startup, loading, structural validation of both sides, comparison and reporting.

## Results

**GitHub-hosted runner** (`ubuntu-latest`, 4 vCPU, Node.js 24, corpus workflow):

| Scenario                                                                  | Size per side |  Time | Peak RSS |
| ------------------------------------------------------------------------- | ------------: | ----: | -------: |
| YAML, changed                                                             |        3.8 MB | 7.9 s |   996 MB |
| JSON, changed                                                             |        4.9 MB | 5.3 s |   843 MB |
| YAML, self-comparison                                                     |        3.8 MB | 7.1 s |   871 MB |
| Pathological: one 2,000-schema `$ref` cycle reached from 1,000 operations |        2.3 MB | 8.4 s |   774 MB |

**Development container** (2 vCPU, Node.js 24.12, median of 3 runs):

| Scenario                                                                  | Size per side |  Time | Peak RSS |
| ------------------------------------------------------------------------- | ------------: | ----: | -------: |
| YAML, changed                                                             |        3.8 MB | 6.9 s | 1,039 MB |
| JSON, changed                                                             |        4.9 MB | 4.6 s |   846 MB |
| YAML, self-comparison                                                     |        3.8 MB | 7.2 s |   826 MB |
| Pathological: one 2,000-schema `$ref` cycle reached from 1,000 operations |        2.3 MB | 8.2 s |   779 MB |

The pathological case finishes with 1,000 _undetermined_ findings (`CG-SCHEMA-902`, projection budget) instead of
running out of stack or memory; before the 1.0 fixes it crashed (stack overflow) or ran for more than 10 minutes.

## Where the time goes (YAML, changed)

| Stage                                                                                | Share |
| ------------------------------------------------------------------------------------ | ----: |
| YAML parsing (`yaml` library)                                                        |   28% |
| Garbage collection                                                                   |   20% |
| Structural validation against the official OpenAPI schema (`@hyperjump/json-schema`) |   15% |
| Building the canonical document and pointer index                                    |   10% |
| Normalization into the contract model                                                |    9% |
| Comparison and compatibility rules                                                   |    2% |

Comparison is cheap; loading dominates. JSON input avoids most of the parsing cost.

## NFR-03 status

NFR-03 asks for < 5 s and < 1 GB on a GitHub-hosted runner for this size. **It is not met in 1.0:** on the runner JSON
takes 5.3 s (just over) and YAML 7.9 s, with peak memory just under the 1 GB line. Real APIs of this size in the
[corpus](./corpus-1.0.md) take 1–11 s per pair. Mitigations in 1.0: the work queue fix (the normalizer was
quadratic), pointer helpers that do not allocate in the common case, and bounded comparison work. Planned:
validating and loading the two sides in parallel worker threads, and a streaming YAML front end.

Large real-world specifications from the [corpus](./corpus-1.0.md) (OpenAI 4 MB YAML, GitHub 11 MB YAML,
Cloudflare 20 MB YAML) load within the default limits.

Reproduce: `pnpm build && node bench/run.mjs --runs 3`.
