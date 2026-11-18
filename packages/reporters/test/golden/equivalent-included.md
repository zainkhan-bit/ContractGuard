## ContractGuard · `equivalent-included`

**✅ Policy passed**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.0.3, 3 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 3 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 3 | 0 | 0 |

<details>
<summary><strong>Informational (3)</strong></summary>

#### ℹ️ `CG-SCHEMA-002` Schema representation changed (equivalent) · info

Representation of GET /users: response 200 (application/json) at `[].email` changed (nullability (oas30-nullable → type-includes-null)) without changing its meaning.

- **Why:** Validation behaviour is unchanged.
- **Affects:** GET /users → response 200 application/json → `[].email`; GET /users/{id} → response 200 application/json → `email`
- **Where:** [`api/openapi.yaml:26`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L26) (baseline: `base/openapi.yaml:26`)
- **Evidence:** provider-backward: guarantee/equivalent/structural → informational (contract-guaranteed)
- **Fix:** No action needed.
- **Fingerprint:** `3d9ccd89c16a92a42a5d833dd5ada68f` (+1 related)

#### ℹ️ `CG-API-006` operationId changed · info

operationId of GET /users/{id} changed from "getUser" to "fetchUser".

- **Change:** `"getUser" → "fetchUser"`
- **Why:** The wire contract is unchanged, but generated SDK method names derived from operationId change.
- **Affects:** GET /users/{id}
- **Where:** [`api/openapi.yaml:7`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L7) (baseline: `base/openapi.yaml:7`)
- **Evidence:** provider-backward: acceptance/equivalent/behavioral → informational (contract-guaranteed)
- **Fix:** Keep operationIds stable, or treat SDK regeneration as a breaking release for SDK users.
- **Fingerprint:** `8ce4a1d8a98faea91d06886b3e681324`

</details>

<sub>Reproduce locally: `npx @zainkhan-bit/contractguard check --spec equivalent-included` · 0 breaking · 0 potentially breaking · 0 undetermined · 0 non-breaking · 3 informational</sub>
