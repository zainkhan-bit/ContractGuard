---
'@zainkhan-bit/contractguard-engine': minor
'@zainkhan-bit/contractguard-core': minor
'@zainkhan-bit/contractguard-openapi': patch
---

Add `@zainkhan-bit/contractguard-engine` with `diffContracts()`: a deterministic, perspective-neutral semantic diff of
two canonical contracts. Operations are matched by key with rename hints; parameters, bodies, effective
responses, headers, security (credential satisfiability with scheme-rename detection) and servers are
compared; schemas are compared coinductively with a shared pair memo, lazy `allOf` merging, deterministic
composition branch matching, type-scoped keyword families and direction-aware projection.
Core: `integerBound()`, `UnsupportedKeyword.valueHash`, and `enumChanged.facts.constrained`.
