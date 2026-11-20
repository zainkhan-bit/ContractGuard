# @zainkhan-bit/contractguard-core

## 1.0.1

### Patch Changes

- b3328bc: The CLI is published as `@zainkhan-bit/contractguard` (npm does not accept the unscoped name `contractguard`, which is
  too close to an existing package). The command is still `contractguard`: run `npx @zainkhan-bit/contractguard check` or
  install it with `npm install -D @zainkhan-bit/contractguard`. "Reproduce locally" lines in reports use the new name.

## 1.0.0

### Major Changes

- 6b23ab7: ContractGuard 1.0: the CLI, the GitHub Action and the libraries are stable. See the versioning and stability
  commitments in the documentation. Libraries are published under `@zainkhan-bit/contractguard-*` (the
  `@contractguard` scope belongs to an unrelated project).

### Minor Changes

- a162c9f: Add the core domain package: canonical contract model types, change events, findings, rule and perspective contracts, configuration types and defaults, diagnostics registry, and deterministic utilities (JSON pointers, exact decimals, canonical JSON, hashing, sorting, seeded PRNG).
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
- 046a183: GitHub Action support. `git:@base:<path>` sources resolve against a base revision (`--base-ref` on the CLI),
  ad-hoc comparisons accept several specs, identical document sets skip the comparison (reported as unchanged), and
  `analyze({ newSpecs: 'pass' })` reports a specification without a base document as new (`CGD-FS-101`). Git sources
  report a path missing at a revision as `CGD-FS-001`. Reports show git documents as `path@sha7`, and a base revision
  that is a commit SHA is shown once.

### Patch Changes

- 47a32c2: Add `@zainkhan-bit/contractguard-openapi` with document loading (file loader with root confinement, symlink and Windows path checks; in-memory and composite loaders), JSON/YAML parsing into canonical JSON with an exact source-position index (strict-JSON fast path, YAML 1.2 core schema, alias/depth/size limits, exact numbers), and OpenAPI version detection.
- 6b23ab7: Fixes from the 1.0 security review and the real-world corpus: secret-like defaults are redacted and long values
  truncated in findings; control characters and HTML are escaped in console and Markdown reports; very deep `$ref`
  chains no longer overflow the stack, and projection work is bounded (rest reported as CG-SCHEMA-902); compositions
  with more than 64 branches compare exactly when branches are only added or removed; OpenAPI 3.0 `$ref` siblings no
  longer fail structural validation; discriminator mappings through a `$ref` resolve (CGD-SEM-107); content keys that
  are not media types are ignored (CGD-SPEC-107); the normalizer no longer slows down quadratically on large specs.
  Config keys now have descriptions in the JSON Schema. The default `analysis.limits.maxDocuments` is 5,000 (was 500)
  so large split specifications load, and specifications producing very many changes no longer fail with
  "Maximum call stack size exceeded".
