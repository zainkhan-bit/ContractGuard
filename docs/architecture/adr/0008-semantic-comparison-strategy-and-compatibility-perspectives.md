# ADR-08: Semantic comparison strategy and compatibility perspectives

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Problem.** Compatibility depends on direction (request vs response) and on whose compatibility we are asking about. Hard-coding "adding X is safe" rules gives wrong answers and cannot be extended.
- **Alternatives.** (a) Per-change hard-coded classification. (b) Severity levels only (oasdiff-style). (c) A formal model: rules report a change's **effect on the set of valid instances** and its **strength**, and a **perspective** maps (role, effect, strength) to a classification.
- **Criteria.** Correctness, explainability, extensibility to new perspectives, configurability without editing rules.
- **Decision.** **(c).** Definitions:
  - For operation _o_, let **Acc(o)** be the set of requests the provider accepts (operation present, parameters, body, credentials), and **Out(o)** the set of responses the provider may produce (status codes, headers, bodies).
  - **Provider-backward compatibility** (default): Acc_base(o) ⊆ Acc_cand(o) and Out_cand(o) ⊆ Out_base(o) for every baseline operation _o_.
  - **Consumer-forward compatibility** (designed, post-1.0): Acc_cand(o) ⊆ Acc_base(o) and Out_base(o) ⊆ Out_cand(o) (new consumers against the old provider).
  - Each contract area has a **role** under a perspective: _acceptance_ (must not narrow) or _guarantee_ (must not widen). Provider-backward: requests, operations and credentials → acceptance; responses → guarantee. Consumer-forward swaps them.
  - Rules return `effect ∈ {widens, narrows, incomparable, equivalent, unknown}` and `strength ∈ {structural, enumerated, value-space, additive, behavioral}`. The perspective's classification table (§10.3) gives the default classification.
- **Justification.** One table explains every default classification. Configuration knobs change table cells for specific strengths (e.g. "treat value-space narrowing of requests as breaking") instead of patching rules. New perspectives are new tables.
- **Trade-offs.** Some changes are not naturally set-shaped (serialization style changes, default-value changes). These use strength `behavioral` or a documented rule-level override with written justification (§10.4).
- **Consequences.** Every finding records its perspective, role, effect and strength. The test suite includes metamorphic tests that swap base and candidate (§18.6).
