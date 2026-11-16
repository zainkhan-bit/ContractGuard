## ContractGuard · `responses`

**❌ Policy failed: 1 breaking change**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 0 | 2 | 0 | 0 | 1 |

### ❌ Breaking (1)

#### ❌ `CG-RES-016` Success response removed · critical

Success response 200 of GET /r was removed.

- **Change:** `"200" → (none)`
- **Why:** Consumers expecting 200 will receive a different status or shape.
- **Affects:** GET /r → response 200
- **Where:** [`base/openapi.yaml:7`](https://github.com/acme/api/blob/abc123/base/openapi.yaml#L7)
- **Evidence:** provider-backward: guarantee/incomparable/structural → breaking (contract-guaranteed)
- **Fix:** Keep returning 200, or release as a new major version.
- **Fingerprint:** `17c578d19ca5bd73a317882ef328edce`

### ⚠️ Potentially breaking (1)

#### ⚠️ `CG-RES-018` Success response added · medium

New success response 201 for GET /r.

- **Change:** `(none) → "201"`
- **Why:** Consumers that only handle the previous success statuses may not handle 201.
- **Affects:** GET /r → response 201
- **Where:** [`api/openapi.yaml:7`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L7)
- **Evidence:** provider-backward: guarantee/widens/enumerated → potentially-breaking (consumer-dependent)
- **Fix:** Make sure consumers treat any 2xx as success.
- **Fingerprint:** `39fb029efc6c50747acab8a68dac0496`

<details>
<summary><strong>Non-breaking (2)</strong></summary>

#### ✅ `CG-RES-017` Non-success response removed · info

Response 404 of GET /r is no longer documented.

- **Change:** `"404" → (none)`
- **Why:** The provider may still return it undocumented.
- **Affects:** GET /r → response 404
- **Where:** [`base/openapi.yaml:8`](https://github.com/acme/api/blob/abc123/base/openapi.yaml#L8)
- **Evidence:** The provider may still return it undocumented. · provider-backward: guarantee/narrows/structural → non-breaking (contract-guaranteed)
- **Fix:** No action needed.
- **Fingerprint:** `649f7d87bb3b97696aeca9ce556b4058`

#### ✅ `CG-RES-019` Non-success response added · info

Response 429 is now documented for GET /r.

- **Change:** `(none) → "429"`
- **Why:** Its schema is compared against what the previous fallback response documented.
- **Affects:** GET /r → response 429
- **Where:** [`api/openapi.yaml:8`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L8)
- **Evidence:** provider-backward: guarantee/widens/additive → non-breaking (contract-guaranteed)
- **Fix:** No action needed.
- **Fingerprint:** `a2daffd67c376dc00707fc11dc898dc8`

</details>

<sub>Reproduce locally: `npx contractguard check --spec responses` · 1 breaking · 1 potentially breaking · 0 undetermined · 2 non-breaking · 0 informational</sub>
