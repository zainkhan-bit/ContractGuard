## ContractGuard · `multi-file`

**❌ Policy failed: 1 breaking change**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 0 | 0 | 0 | 1 |

### ❌ Breaking (1)

#### ❌ `CG-RES-008` Response type widened · high

GET /orders: response 200 (application/json) at `total` may now be number (was integer).

- **Why:** Consumers parsing the previous type may fail on values of the new types.
- **Affects:** GET /orders → response 200 application/json → `total`
- **Where:** [`api/schemas/order.yaml:5`](https://github.com/acme/api/blob/abc123/api/schemas/order.yaml#L5) (baseline: `base/schemas/order.yaml:5`)
- **Evidence:** provider-backward: guarantee/widens/structural → breaking (contract-guaranteed)
- **Fix:** Keep the previous type, or release as a new major version.
- **Fingerprint:** `e029135c4577e0d269940cd784ebdd95`

<sub>Reproduce locally: `npx contractguard check --spec multi-file` · 1 breaking · 0 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational</sub>
