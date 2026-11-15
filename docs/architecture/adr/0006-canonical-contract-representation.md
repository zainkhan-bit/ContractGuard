# ADR-06: Canonical contract representation

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Problem.** Comparison must not depend on YAML/JSON formatting, key order, `$ref` placement, OAS version spelling or defaults that are written out in one version and implied in the other.
- **Alternatives.** (a) Compare the raw OpenAPI object trees with special cases. (b) Normalize to a canonical, immutable, version-independent model. (c) Compile to a lower-level IR (e.g. JSON Schema only).
- **Criteria.** False-positive elimination, traceability, extensibility to 3.2, clarity for rule authors.
- **Decision.** **(b)** (specified in §7): deeply readonly TypeScript types. User-keyed collections are `ReadonlyMap`s sorted by key (prototype-pollution-safe, deterministic). Every element carries a `SourceRef`, and inlined referenced elements also carry a `via` chain.
- **Justification.** Rules read semantic facts (`allowsNull`, effective `style`, effective security) instead of re-deriving them from spellings. This is the main defence against false positives. (c) would lose HTTP-level concepts (parameters, status codes, security).
- **Trade-offs.** The normalizer is a large component with its own test burden. The canonical model must be versioned internally whenever it evolves (it is not a public serialization format; §7.9).
- **Consequences.** Version adapters (`Oas30Adapter`, `Oas31Adapter`, later `Oas32Adapter`) are the only places that know OAS spelling differences.
