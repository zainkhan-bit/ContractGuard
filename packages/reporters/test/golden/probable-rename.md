## ContractGuard · `probable-rename`

**❌ Policy failed: 1 breaking change**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 3 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 3 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 0 | 0 | 0 | 1 |

### ❌ Breaking (1)

#### ❌ `CG-API-003` Operation path changed (probable rename) · critical

Operation GET /users/{} appears to have moved to GET /members/{}.

- **Change:** `"/users/{id}" → "/members/{id}"`
- **Why:** Consumers still calling GET /users/{} will fail; the match was found by operationId.
- **Affects:** GET /users/{id}
- **Where:** [`api/openapi.yaml:7`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L7) (baseline: `base/openapi.yaml:7`)
- **Evidence:** Same unique operationId and method on both sides. · provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)
- **Fix:** Keep GET /users/{} as a deprecated alias of GET /members/{}, or release the move as a new major version.
- **Fingerprint:** `dba4785d5b27766fd565831e65fd66b1`

<sub>Reproduce locally: `npx contractguard check --spec probable-rename` · 1 breaking · 0 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational</sub>
