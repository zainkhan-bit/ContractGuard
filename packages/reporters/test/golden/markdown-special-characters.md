## ContractGuard · `markdown-special-characters`

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

#### ❌ `CG-RES-001` Required response property removed · high

Required property "pipe\|name" was removed from GET /a\|b: response 200 (application/json).

- **Why:** Consumers rely on "pipe\|name" always being present; it may now be missing.
- **Affects:** GET /a\|b → response 200 application/json
- **Where:** [`api/openapi.yaml:6`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L6) (baseline: `base/openapi.yaml:6`)
- **Evidence:** provider-backward: guarantee/widens/structural → breaking (contract-guaranteed)
- **Fix:** Keep returning "pipe\|name" (deprecate it first), or release as a new major version.
- **Fingerprint:** `5e54fe3b57c27700abf3fc9a81556153`

<sub>Reproduce locally: `npx contractguard check --spec markdown-special-characters` · 1 breaking · 0 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational</sub>
