# ADR-13: Persistence and caching

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Alternatives.** (a) No persistence. (b) Content-addressed on-disk cache of parse/normalize results. (c) Database for history.
- **Decision.** **(a) for v1.** In-memory memoization only (resolver document cache, schema pair memo, fingerprint cache). No database. Historical comparison uses JSON reports with stable fingerprints, which users store as CI artifacts.
- **Justification.** Master prompt §16: no caching without measured need. Analysis of a large spec is expected to take seconds. A persistent cache adds invalidation risk and correctness bugs for little gain.
- **Consequences.** If M7 benchmarks show parse/normalize dominating repeated runs, §15 specifies the cache design to adopt (keys, invalidation, guarantees).
