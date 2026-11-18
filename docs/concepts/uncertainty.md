# What cannot be decided

ContractGuard compares documents. Some questions cannot be answered from documents, and the tool says so instead of
guessing. These limits are reflected in classifications (_potentially breaking_, _undetermined_) and in each rule's
limitations.

1. **What consumers actually do**: which fields they read, whether they handle unknown enum values or status codes.
   → _consumer-dependent_ findings.
2. **Implementation vs specification**: the running service may already differ from either version.
3. **Meaning not written in the spec**: units (cents → dollars), ordering, pagination, idempotency, rate limits.
   Not detectable.
4. **Regular expressions**: whether one pattern accepts a subset of another is not decidable in general.
   → _undetermined_.
5. **`format`**: whether either side enforces it. → _potentially breaking_.
6. **`oneOf` overlap** after new branches. → _potentially breaking_.
7. **Defaults**: whether the server applies documented defaults. → _potentially breaking_.
8. **Credentials consumers hold**: extra scopes or schemes. → _potentially breaking_.
9. **Deployment**: gateways, base paths, servers. → _potentially breaking_.
10. **JSON Schema keywords not analysed in 1.0**: `if`/`then`/`else`, `not`, `unevaluated*`, `patternProperties`,
    `prefixItems`, `contains`, `dependentSchemas`, `$dynamicRef`. Changes to them → _undetermined_.
11. **`x-*` extensions**, except `x-extensible-enum`.
12. **Callbacks and webhooks**. → _undetermined_.

"Non-breaking" therefore means _non-breaking under the provider-backward perspective, according to the
specification_. It is not a guarantee about the running system.
