# Example: one change at a time

`base.yaml` is a small Orders API. Each folder holds a `candidate.yaml` with **one** change, so you can see how
ContractGuard classifies it. The same pairs run as tests (`packages/cli/test/examples.test.ts`), so this table is
always true.

```bash
npx contractguard check examples/breaking-changes/base.yaml examples/breaking-changes/request-property-required/candidate.yaml
```

| Case                         | Change                              | Findings                                                                        | Exit code |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- | --------- |
| `operation-removed`          | DELETE /orders/{orderId} removed    | CG-API-001 breaking                                                             | 1         |
| `request-property-required`  | `coupon` became required            | CG-REQ-003 breaking                                                             | 1         |
| `request-enum-value-removed` | `Status` lost `shipped`             | CG-REQ-020 breaking (query parameter), CG-RES-007 non-breaking (responses)      | 1         |
| `response-property-removed`  | `total` removed from `Order`        | CG-RES-001 breaking                                                             | 1         |
| `response-became-nullable`   | `total` can be `null`               | CG-RES-009 breaking                                                             | 1         |
| `request-limit-tightened`    | `limit` maximum 100 → 50            | CG-REQ-024 potentially breaking                                                 | 0         |
| `response-enum-value-added`  | `Status` gained `refunded`          | CG-RES-006 potentially breaking (responses), CG-REQ-021 non-breaking (requests) | 0         |
| `scope-added`                | an extra OAuth scope required       | CG-AUTH-002 potentially breaking                                                | 0         |
| `server-moved`               | server URL /v1 → /v2                | CG-SRV-002 potentially breaking                                                 | 0         |
| `compatible-additions`       | new optional property, new endpoint | CG-RES-005, CG-API-002 non-breaking                                             | 0         |
| `refactor-only`              | path parameter renamed              | CG-API-005 informational                                                        | 0         |

Note how the same schema change (an enum value added or removed) is breaking in one direction and safe in the other:
requests may not narrow, responses may not widen. See [Compatibility perspectives](../../docs/concepts/perspectives.md).
