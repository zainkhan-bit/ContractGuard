## ContractGuard · `deprecated-removal`

**❌ Policy failed: 1 breaking change**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 3 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 2 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 0 | 0 | 0 | 1 |

### ❌ Breaking (1)

#### ❌ `CG-API-001` Operation removed · high

Operation POST /users was removed.

- **Change:** `"/users" → (none)`
- **Why:** Consumers that call POST /users will receive an error (typically 404 or 405) from a provider that implements the candidate.
- **Affects:** POST /users
- **Where:** [`base/openapi.yaml:17`](https://github.com/acme/api/blob/abc123/base/openapi.yaml#L17)
- **Evidence:** provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)
- **Fix:** Keep the operation (mark it deprecated first), or release the removal as a new major version.
- **Fingerprint:** `07daf660dfd3b5c31338a6081278fdc9`

<sub>Reproduce locally: `npx contractguard check --spec deprecated-removal` · 1 breaking · 0 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational</sub>
