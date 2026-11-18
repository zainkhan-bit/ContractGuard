## ContractGuard · `security`

**❌ Policy failed: 2 breaking changes**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 2 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 2 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 2 | 1 | 0 | 0 | 1 | 0 | 2 |

### ❌ Breaking (2)

#### ❌ `CG-AUTH-001` Authentication requirement tightened · critical

Authentication of GET /a is stricter: 1 previously accepted credential option(s) no longer work.

- **Why:** Consumers using the affected credentials (or none) will be rejected.
- **Affects:** GET /a → security
- **Where:** [`api/openapi.yaml:5`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L5) (baseline: `base/openapi.yaml:3`)
- **Evidence:** provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)
- **Fix:** Keep accepting the previous credentials during a transition.
- **Fingerprint:** `2ea2235ce6e276e0267a82a101f7233c`

#### ❌ `CG-AUTH-001` Authentication requirement tightened · critical

Authentication of GET /b is stricter: anonymous access is no longer allowed.

- **Why:** Consumers using the affected credentials (or none) will be rejected.
- **Affects:** GET /b → security
- **Where:** [`api/openapi.yaml:6`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L6) (baseline: `base/openapi.yaml:6`)
- **Evidence:** provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)
- **Fix:** Keep accepting the previous credentials during a transition.
- **Fingerprint:** `19fa96677a5a6a0880aeb16d2048c829`

### ⚠️ Potentially breaking (1)

#### ⚠️ `CG-AUTH-005` OAuth2 flow changed · medium

Security scheme "oauth" changed (flows.clientCredentials.tokenUrl).

- **Why:** Consumers obtaining tokens through the changed flow may fail.
- **Affects:** security
- **Where:** [`api/openapi.yaml:10`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L10) (baseline: `base/openapi.yaml:10`)
- **Evidence:** provider-backward: acceptance/incomparable/behavioral → potentially-breaking (consumer-dependent)
- **Fix:** Keep the previous flow endpoints working during a transition.
- **Fingerprint:** `3fe91bbe254171df1e5d3addd48ff945`

<details>
<summary><strong>Informational (1)</strong></summary>

#### ℹ️ `CG-AUTH-006` Security scheme renamed · info

Security scheme "key" was renamed to "apiKey".

- **Change:** `"key" → "apiKey"`
- **Why:** Scheme names are not sent on the wire.
- **Affects:** security
- **Where:** [`api/openapi.yaml:9`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L9) (baseline: `base/openapi.yaml:9`)
- **Evidence:** provider-backward: acceptance/equivalent/structural → informational (contract-guaranteed)
- **Fix:** No action needed.
- **Fingerprint:** `8eacc4316c96396dde62df483d7ed8ea`

</details>

<sub>Reproduce locally: `npx @zainkhan-bit/contractguard check --spec security` · 2 breaking · 1 potentially breaking · 0 undetermined · 0 non-breaking · 1 informational</sub>
