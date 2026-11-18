---
'@zainkhan-bit/contractguard-reporters': minor
'@zainkhan-bit/contractguard-engine': minor
---

Add `@zainkhan-bit/contractguard-reporters` with deterministic console (colour, width-aware), Markdown (cause grouping, GitHub
1 MiB cap with priority-based truncation), JSON (sorted keys, exact decimals, published `schemas/report.v1.json`)
and SARIF 2.1.0 (catalog rules, stable `partialFingerprints`, suppressions, one run per spec) renderers.
Engine: `assembleResult()` builds the versioned `AnalysisResult` (summary, cause groups, policy verdict), and
messages show declared operation paths instead of internal keys.
