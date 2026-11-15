# ADR-04: Parser architecture

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Problem.** We need parsing that (1) handles JSON and YAML, (2) keeps exact source positions for every value, (3) resists hostile input, and (4) feeds a reference resolver that builds a graph without duplicating schemas.
- **Alternatives.**
  - (a) `@apidevtools/swagger-parser` / `json-schema-ref-parser` → dereferenced plain objects.
  - (b) `@scalar/openapi-parser` / `@redocly/openapi-core` as an all-in-one.
  - (c) `yaml` (eemeli) for both YAML and JSON, plus our own resolver and normalizer.
- **Criteria.** Source-map fidelity through refs, control over network/file access, cycle handling without object duplication, determinism, dependency weight, ability to model 3.0 vs 3.1 `$ref` semantics exactly.
- **Decision.** **(c).** `yaml` v2 parses both formats with `LineCounter`, `uniqueKeys: true`, `maxAliasCount: 50`, YAML 1.2 core schema, no custom tags, no merge keys. Our `ReferenceResolver` builds a `DocumentSet` and an index of reference edges. The normalizer turns this into the canonical graph.
- **Justification.** Dereferencing libraries (a) lose positions and turn cycles into object cycles. They also bundle their own network fetching, which fights our SSRF policy. All-in-one parsers (b) have the same position/graph mismatch, and their internal models would become our de-facto canonical model. Reference resolution is about 1–2k lines of carefully tested code, and it is central to correctness and security. Owning it is justified.
- **Trade-offs.** We write and maintain the resolver (including 3.1 `$id`/`$anchor`; `$dynamicRef` is resolved for structure but marked unsupported for comparison). Parsing JSON via `yaml` is slower than `JSON.parse`. Acceptable: parsing is never the bottleneck, and one code path means one source-map implementation.
- **Consequences.** We need extensive resolver fixtures (relative paths, Windows paths, URL-encoded pointers, `~0`/`~1` escapes, `$id` re-basing, cycles, missing targets, forbidden targets). See §8.
