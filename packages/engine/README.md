# @zainkhan-bit/contractguard-engine

Protocol-independent comparison engine for [ContractGuard](https://github.com/zainkhan-bit/ContractGuard).

- `diffContracts(base, candidate, options)` compares two canonical `ApiContract`s and returns a
  deterministic, sorted list of perspective-neutral `ContractChange`s (operations, parameters,
  bodies, responses, headers, security, servers and schemas).
- Schemas are compared coinductively with a pair memo, so recursive and shared component schemas
  are compared once and projected into every usage site.

Compatibility classification (rules and perspectives) builds on these changes.

MIT licensed.
