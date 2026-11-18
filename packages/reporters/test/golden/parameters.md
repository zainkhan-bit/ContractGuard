## ContractGuard · `parameters`

**❌ Policy failed: 4 breaking changes**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 4 | 0 | 0 | 0 | 0 | 0 | 1 |

### ❌ Breaking (4)

#### ❌ `CG-REQ-002` Request parameter became required · high

GET /s: query parameter "q" became required.

- **Change:** `false → true`
- **Why:** Consumers that omit this parameter will be rejected.
- **Affects:** GET /s → query parameter q
- **Where:** [`api/openapi.yaml:7`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L7) (baseline: `base/openapi.yaml:7`)
- **Evidence:** provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)
- **Fix:** Keep the parameter optional with a documented default, or release as a new major version.
- **Fingerprint:** `e74c953fa8006fd2ac0ae05d949c7253`

#### ❌ `CG-REQ-004` New required request parameter · high

New required GET /s: header parameter "x-tenant".

- **Change:** `(none) → "X-Tenant"`
- **Why:** Existing consumers do not send this parameter, so their requests will be rejected.
- **Affects:** GET /s → header parameter x-tenant
- **Where:** [`api/openapi.yaml:10`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L10)
- **Evidence:** provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)
- **Fix:** Make the parameter optional with a default, or release as a new major version.
- **Fingerprint:** `f1a9d80eb62656b5b920e8b3df8c52b2`

#### ❌ `CG-REQ-007` Request parameter location changed · high

Parameter moved from query to header (GET /s: query parameter "api_key").

- **Change:** `"query" → "header"`
- **Why:** Consumers still send it in query; the provider now reads it from header.
- **Affects:** GET /s → query parameter api_key
- **Where:** [`api/openapi.yaml:9`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L9) (baseline: `base/openapi.yaml:9`)
- **Evidence:** provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)
- **Fix:** Accept the parameter in both locations during a transition.
- **Fingerprint:** `cd05e1e0b588a6cd581ebc4402b2581e`

#### ❌ `CG-REQ-009` Request parameter serialization changed · high

Serialization of GET /s: query parameter "ids" changed (explode).

- **Why:** Consumers encode the value the old way (for example `a=1&a=2` vs `a=1,2`); the provider may misread it.
- **Affects:** GET /s → query parameter ids
- **Where:** [`api/openapi.yaml:8`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L8) (baseline: `base/openapi.yaml:8`)
- **Evidence:** provider-backward: acceptance/incomparable/structural → breaking (contract-guaranteed)
- **Fix:** Keep the previous serialization, or accept both encodings.
- **Fingerprint:** `7820dc621254cabfd230a476fc15edbe`

<sub>Reproduce locally: `npx @zainkhan-bit/contractguard check --spec parameters` · 4 breaking · 0 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational</sub>
