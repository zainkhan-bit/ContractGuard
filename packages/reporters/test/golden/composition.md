## ContractGuard · `composition`

**❌ Policy failed: 2 breaking changes**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 2 | 1 | 0 | 0 | 0 | 0 | 1 |

### ❌ Breaking (2)

#### ❌ `CG-REQ-032` Request variant removed · high

A oneOf variant was removed from POST /p: the request body (application/json).

- **Why:** Consumers sending payloads of the removed variant will be rejected.
- **Affects:** POST /p → request body application/json
- **Where:** [`api/openapi.yaml:6`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L6) (baseline: `base/openapi.yaml:11`)
- **Evidence:** provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)
- **Fix:** Keep the variant, or release as a new major version.
- **Fingerprint:** `823faea4ac81075ccd4158af081ccd2d`

#### ❌ `CG-REQ-035` Request discriminator value removed · high

Discriminator values Wallet are no longer accepted in POST /p: the request body (application/json).

- **Change:** `"kind" → "kind"`
- **Why:** Consumers sending a removed discriminator value will be rejected.
- **Affects:** POST /p → request body application/json
- **Where:** [`api/openapi.yaml:6`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L6) (baseline: `base/openapi.yaml:6`)
- **Evidence:** provider-backward: acceptance/narrows/enumerated → breaking (contract-guaranteed)
- **Fix:** Keep the mapping entries, or release as a new major version.
- **Fingerprint:** `5b309b4c2b53074d5c7ae6d86f936a0a`

### ⚠️ Potentially breaking (1)

#### ⚠️ `CG-RES-014` Response variant added · medium

POST /p: response 200 (application/json) may now return payloads of a new anyOf shape.

- **Why:** Consumers that handle each variant explicitly may not handle the new one.
- **Affects:** POST /p → response 200 application/json
- **Where:** [`api/openapi.yaml:7`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L7) (baseline: `base/openapi.yaml:7`)
- **Evidence:** provider-backward: guarantee/widens/enumerated → potentially-breaking (consumer-dependent)
- **Fix:** Make sure consumers have a fallback for unknown variants.
- **Fingerprint:** `545075be91607e63206f2e1105eaf087`

<sub>Reproduce locally: `npx @zainkhan-bit/contractguard check --spec composition` · 2 breaking · 1 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational</sub>
