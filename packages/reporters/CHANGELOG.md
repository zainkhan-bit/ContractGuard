# @zainkhan-bit/contractguard-reporters

## 1.0.0

### Major Changes

- 6b23ab7: ContractGuard 1.0: the CLI, the GitHub Action and the libraries are stable. See the versioning and stability
  commitments in the documentation. Libraries are published under `@zainkhan-bit/contractguard-*` (the
  `@contractguard` scope belongs to an unrelated project).

### Minor Changes

- 7488915: Add `@zainkhan-bit/contractguard-reporters` with deterministic console (colour, width-aware), Markdown (cause grouping, GitHub
  1 MiB cap with priority-based truncation), JSON (sorted keys, exact decimals, published `schemas/report.v1.json`)
  and SARIF 2.1.0 (catalog rules, stable `partialFingerprints`, suppressions, one run per spec) renderers.
  Engine: `assembleResult()` builds the versioned `AnalysisResult` (summary, cause groups, policy verdict), and
  messages show declared operation paths instead of internal keys.

### Patch Changes

- 046a183: GitHub Action support. `git:@base:<path>` sources resolve against a base revision (`--base-ref` on the CLI),
  ad-hoc comparisons accept several specs, identical document sets skip the comparison (reported as unchanged), and
  `analyze({ newSpecs: 'pass' })` reports a specification without a base document as new (`CGD-FS-101`). Git sources
  report a path missing at a revision as `CGD-FS-001`. Reports show git documents as `path@sha7`, and a base revision
  that is a commit SHA is shown once.
- 6b23ab7: Fixes from the 1.0 security review and the real-world corpus: secret-like defaults are redacted and long values
  truncated in findings; control characters and HTML are escaped in console and Markdown reports; very deep `$ref`
  chains no longer overflow the stack, and projection work is bounded (rest reported as CG-SCHEMA-902); compositions
  with more than 64 branches compare exactly when branches are only added or removed; OpenAPI 3.0 `$ref` siblings no
  longer fail structural validation; discriminator mappings through a `$ref` resolve (CGD-SEM-107); content keys that
  are not media types are ignored (CGD-SPEC-107); the normalizer no longer slows down quadratically on large specs.
  Config keys now have descriptions in the JSON Schema. The default `analysis.limits.maxDocuments` is 5,000 (was 500)
  so large split specifications load, and specifications producing very many changes no longer fail with
  "Maximum call stack size exceeded".
- Updated dependencies [a162c9f]
- Updated dependencies [47a32c2]
- Updated dependencies [5346151]
- Updated dependencies [7062025]
- Updated dependencies [046a183]
- Updated dependencies [6b23ab7]
- Updated dependencies [6b23ab7]
  - @zainkhan-bit/contractguard-core@1.0.0
