## ContractGuard · `input-error`

**❌ Analysis failed: input error**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 3 operations) |
| Candidate | _not loaded_ |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Diagnostics

- `CGD-PARSE-001` error (candidate): `api/openapi.yaml:3` Flow map in block collection must be sufficiently indented and end with a }

<sub>Reproduce locally: `npx @zainkhan-bit/contractguard check --spec input-error` · 0 breaking · 0 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational</sub>
