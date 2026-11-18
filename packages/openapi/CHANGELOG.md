# @zainkhan-bit/contractguard-openapi

## 1.0.1

### Patch Changes

- b3328bc: The CLI is published as `@zainkhan-bit/contractguard` (npm does not accept the unscoped name `contractguard`, which is
  too close to an existing package). The command is still `contractguard`: run `npx @zainkhan-bit/contractguard check` or
  install it with `npm install -D @zainkhan-bit/contractguard`. "Reproduce locally" lines in reports use the new name.
- Updated dependencies [b3328bc]
  - @zainkhan-bit/contractguard-core@1.0.1

## 1.0.0

### Major Changes

- 6b23ab7: ContractGuard 1.0: the CLI, the GitHub Action and the libraries are stable. See the versioning and stability
  commitments in the documentation. Libraries are published under `@zainkhan-bit/contractguard-*` (the
  `@contractguard` scope belongs to an unrelated project).

### Minor Changes

- 47a32c2: Add `@zainkhan-bit/contractguard-openapi` with document loading (file loader with root confinement, symlink and Windows path checks; in-memory and composite loaders), JSON/YAML parsing into canonical JSON with an exact source-position index (strict-JSON fast path, YAML 1.2 core schema, alias/depth/size limits, exact numbers), and OpenAPI version detection.
- e8c25de: Add reference resolution (relative files, JSON-pointer and 3.1 `$id`/`$anchor` fragments, deterministic multi-document loading, document/byte limits, `$ref` sibling warnings for 3.0, chain following with cycle and hop-limit detection), an SSRF-hardened remote loader (off by default; exact host allowlist, blocked private/link-local/metadata ranges, connection pinned to the vetted IP, no redirects, size and time caps), and structural validation against the official OpenAPI 3.0/3.1 schemas via @hyperjump/json-schema.
- d9a5b9b: Normalize OpenAPI 3.0/3.1 documents into the canonical, version-independent `ApiContract`
  (operations, parameters, bodies, responses, headers, security, servers and the schema graph),
  with semantic checks (CGD-SEM-001…005, 106) and the `loadContract()` front-end pipeline.

### Patch Changes

- 5346151: Add `@zainkhan-bit/contractguard-engine` with `diffContracts()`: a deterministic, perspective-neutral semantic diff of
  two canonical contracts. Operations are matched by key with rename hints; parameters, bodies, effective
  responses, headers, security (credential satisfiability with scheme-rename detection) and servers are
  compared; schemas are compared coinductively with a shared pair memo, lazy `allOf` merging, deterministic
  composition branch matching, type-scoped keyword families and direction-aware projection.
  Core: `integerBound()`, `UnsupportedKeyword.valueHash`, and `enumChanged.facts.constrained`.
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
