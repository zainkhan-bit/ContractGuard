## ContractGuard · `undetermined`

**❌ Policy failed: 1 undetermined finding**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 1 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 1 | 0 | 0 | 0 | 1 |

### ❔ Undetermined (needs review) (1)

#### ❔ `CG-REQ-027` Request pattern changed · medium

Pattern of POST /x: the request body (application/json) changed from `^[a-z]+$` to `^[a-z0-9]+$`.

- **Change:** `"^[a-z]+$" → "^[a-z0-9]+$"`
- **Why:** ContractGuard does not decide whether one regular expression accepts everything the other accepts.
- **Affects:** POST /x → request body application/json
- **Where:** [`api/openapi.yaml:6`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L6) (baseline: `base/openapi.yaml:6`)
- **Evidence:** provider-backward: acceptance/unknown/value-space → undetermined (indeterminate)
- **Fix:** Review whether every value matching `^[a-z]+$` also matches `^[a-z0-9]+$`.
- **Fingerprint:** `c878dbfe1462e288a02176dd7663b7ec`

<sub>Reproduce locally: `npx contractguard check --spec undetermined` · 0 breaking · 0 potentially breaking · 1 undetermined · 0 non-breaking · 0 informational</sub>
