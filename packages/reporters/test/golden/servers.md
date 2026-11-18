## ContractGuard · `servers`

**✅ Policy passed**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 0 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 0 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1 | 0 | 0 | 0 | 0 | 0 |

### ⚠️ Potentially breaking (1)

#### ⚠️ `CG-SRV-002` Server base path changed · high

Base path of server https://eu.api.example.com/v1 is no longer served by any candidate server.

- **Change:** `"https://eu.api.example.com/v1" → (none)`
- **Why:** Every operation URL under this base path moves; consumers using the old base path may fail.
- **Affects:** servers
- **Where:** [`base/openapi.yaml:3`](https://github.com/acme/api/blob/abc123/base/openapi.yaml#L3)
- **Evidence:** Servers describe deployments; consumers may be configured with any of them (§10.4).
- **Fix:** Serve both base paths during a transition, or release as a new major version.
- **Fingerprint:** `4475ad0e0a63abc7c57cd0194c506695`

<sub>Reproduce locally: `npx @zainkhan-bit/contractguard check --spec servers` · 0 breaking · 1 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational</sub>
