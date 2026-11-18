## ContractGuard · `degraded`

**✅ Policy passed** _(degraded: invalid input was tolerated)_

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 3 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 4 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 1 | 0 | 0 | 0 |

<details>
<summary><strong>Non-breaking (1)</strong></summary>

#### ✅ `CG-API-002` Operation added · info

Operation GET /dup/{a} was added.

- **Change:** `(none) → "/dup/{a}"`
- **Why:** New operations do not affect existing consumers.
- **Affects:** GET /dup/{a}
- **Where:** [`api/openapi.yaml:20`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L20)
- **Evidence:** provider-backward: acceptance/widens/structural → non-breaking (contract-guaranteed)
- **Fix:** No action needed.
- **Fingerprint:** `11934d6a15ed9b0bf19727ad36db227f`

</details>

### Diagnostics

- `CGD-SEM-002` error (candidate): `api/openapi.yaml:7` Duplicate operationId "getUser"
- `CGD-SEM-003` error (candidate): `api/openapi.yaml:20` Path template variable "{a}" has no path parameter in GET /dup/{a}

<sub>Reproduce locally: `npx @zainkhan-bit/contractguard check --spec degraded` · 0 breaking · 0 potentially breaking · 0 undetermined · 1 non-breaking · 0 informational</sub>
