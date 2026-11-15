# ADR-10: Classification, severity and basis

- **Status:** Accepted (2026-11-15)
- **Source:** [Blueprint §4](../BLUEPRINT.md#4-architecture-decision-records)

- **Problem.** The brief requires classification separate from severity, and distinguishing guaranteed / possible / policy-dependent / undeterminable outcomes.
- **Decision.**
  - **Classification** (what it means for compatibility): `breaking`, `potentially-breaking`, `non-breaking`, `informational`, `undetermined`.
  - **Basis** (why we believe it): `contract-guaranteed` (follows from the contract alone), `consumer-dependent` (depends on consumer behaviour, e.g. exhaustive enum handling), `policy-dependent` (set by a configuration knob or override), `indeterminate` (engine cannot decide).
  - **Severity** (how much attention it deserves): `critical`, `high`, `medium`, `low`, `info`. Computed deterministically (§10.5) from the rule's severity profile, the classification, the operation's deprecation state and config overrides.
- **Justification.** Gating uses classification. Ordering and triage use severity. Trust comes from basis. Mixing these three is the most common failure of existing tools.
- **Consequences.** `undetermined` findings always have basis `indeterminate`. `breaking` requires `contract-guaranteed` or `policy-dependent` (a breaking verdict may never rest on a guess).
