# ADR-07: Schema representation: arena graph with pair-memoized comparison

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Problem.** Schemas are shared (one component used by hundreds of operations) and can be recursive. Tree-expanding them is exponential in the worst case and infinite for cycles.
- **Alternatives.** (a) Tree (inline every `$ref`). (b) Graph keyed by source location (arena `Map<SchemaNodeId, SchemaNode>`, children referenced by id). (c) Hash-consed structural graph (nodes deduplicated by structural hash).
- **Criteria.** Bounded work on shared and recursive schemas, traceability, predictable identity, implementation risk.
- **Decision.** **(b), a hybrid**: nodes are identified by _source location_ (`documentUri#pointer`), so traceability is exact. Structural fingerprints are computed lazily as an _attribute_ and used for matching heuristics (oneOf branch matching, rename hints), never as identity.
- **Justification.** With source-location identity, every finding maps back to one place in a file. Hash-consing (c) would merge structurally identical schemas defined in different places, losing that. Comparison memoizes on `(baseNodeId, candidateNodeId)` pairs, which bounds work by the number of distinct reachable pairs, not paths (§9.6).
- **Trade-offs.** Two identical inline schemas in different places are compared twice (cheap). The memo table needs memory proportional to the number of compared pairs (bounded by `limits.maxSchemaPairs`).
- **Consequences.** Findings need a _projection_ step from pair-level deltas to usage paths (§9.7). Report grouping by root cause comes from this naturally.
