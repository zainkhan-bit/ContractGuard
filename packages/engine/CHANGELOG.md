# @zainkhan-bit/contractguard-engine

## 1.0.0

### Major Changes

- 6b23ab7: ContractGuard 1.0: the CLI, the GitHub Action and the libraries are stable. See the versioning and stability
  commitments in the documentation. Libraries are published under `@zainkhan-bit/contractguard-*` (the
  `@contractguard` scope belongs to an unrelated project).

### Minor Changes

- 5346151: Add `@zainkhan-bit/contractguard-engine` with `diffContracts()`: a deterministic, perspective-neutral semantic diff of
  two canonical contracts. Operations are matched by key with rename hints; parameters, bodies, effective
  responses, headers, security (credential satisfiability with scheme-rename detection) and servers are
  compared; schemas are compared coinductively with a shared pair memo, lazy `allOf` merging, deterministic
  composition branch matching, type-scoped keyword families and direction-aware projection.
  Core: `integerBound()`, `UnsupportedKeyword.valueHash`, and `enumChanged.facts.constrained`.
- 7062025: Add the compatibility engine and the v1 rule catalog: `checkCompatibility()` diffs two contracts and classifies
  every change with 83 rules (`CG-API`, `CG-SRV`, `CG-REQ`, `CG-RES`, `CG-SCHEMA`, `CG-AUTH`) through the
  provider-backward perspective table, with classification policies, per-rule options and overrides, severity
  computation (deprecated operations downgrade one level), stable fingerprints, suppression with expiry, and
  `explainRule()` metadata. Core: distributive `ChangeOfKind`, `RuleContext.includeEquivalentChanges`, scope
  additions carry their base alternative, and schema path keys are cached.
- 7488915: Add `@zainkhan-bit/contractguard-reporters` with deterministic console (colour, width-aware), Markdown (cause grouping, GitHub
  1 MiB cap with priority-based truncation), JSON (sorted keys, exact decimals, published `schemas/report.v1.json`)
  and SARIF 2.1.0 (catalog rules, stable `partialFingerprints`, suppressions, one run per spec) renderers.
  Engine: `assembleResult()` builds the versioned `AnalysisResult` (summary, cause groups, policy verdict), and
  messages show declared operation paths instead of internal keys.

### Patch Changes

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
