# Classification, severity and basis

Every finding carries three independent labels.

## Classification: is it breaking?

| Classification           | Meaning                                                                                   | Fails the build by default |
| ------------------------ | ----------------------------------------------------------------------------------------- | -------------------------- |
| **breaking**             | Existing consumers that follow the contract will fail                                     | yes                        |
| **potentially-breaking** | Some consumers may fail, depending on how they use the API                                | no                         |
| **undetermined**         | The specification does not allow a decision (e.g. a changed regex)                        | no, shown for review       |
| **non-breaking**         | Safe for existing consumers                                                               | no                         |
| **informational**        | No semantic change (e.g. a renamed path parameter, a different `$ref` to an equal schema) | no                         |

`policy.failOn`, `policy.minSeverity` and `policy.undetermined` decide which findings fail the check.

## Severity: how bad is it?

`critical`, `high`, `medium`, `low` or `info`. It comes from the rule's severity profile for the classification:
removing an operation is critical, a new required query parameter high, a tightened `maxLength` medium. Changes to an
operation that was already `deprecated` in the base are one level lower. `rules.overrides` can set it per rule.

## Basis: why that classification?

| Basis               | Meaning                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| contract-guaranteed | Follows from the specification alone                                                      |
| consumer-dependent  | Depends on what consumers do (which fields they read, whether they handle unknown values) |
| policy-dependent    | Follows from a choice in `analysis` (e.g. `constraintTightening`)                         |
| indeterminate       | Cannot be decided from the documents                                                      |

The evidence line of each finding shows the chain, e.g.
`provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)`.

## Changing a classification

```yaml
rules:
  overrides:
    CG-RES-006: { classification: non-breaking } # our consumers handle unknown response enum values
```

Seven rules allow it (`contractguard explain <rule>` shows "Classification overridable"): CG-API-006, CG-REQ-006,
CG-REQ-024, CG-REQ-026, CG-RES-004, CG-RES-005, CG-RES-006. Rules whose change is breaking by definition (a new
required request property) cannot be downgraded; use an
[ignore entry](/guide/configuration#accept-a-known-change) with a reason instead, so the decision stays visible.
