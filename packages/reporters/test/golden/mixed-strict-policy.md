## ContractGuard · `mixed-strict-policy`

**❌ Policy failed: 3 breaking changes, 4 potentially breaking changes**

| | |
|---|---|
| Perspective | provider-backward |
| Base | `base/openapi.yaml` (OpenAPI 3.1.0, 3 operations) |
| Candidate | `api/openapi.yaml` (OpenAPI 3.1.0, 3 operations) |
| Tool | ContractGuard 0.1.0 (rules 1.0.0) |

| Breaking | Potentially breaking | Undetermined | Non-breaking | Informational | Suppressed | Affected operations |
|---:|---:|---:|---:|---:|---:|---:|
| 3 | 6 | 0 | 1 | 0 | 0 | 3 |

### ❌ Breaking (3)

#### ❌ `CG-RES-002` Response property became optional · high

Property "email" is no longer guaranteed in GET /users: response 200 (application/json) at `[]`.

- **Change:** `true → false`
- **Why:** Consumers that read "email" without checking for absence may fail.
- **Affects:** GET /users → response 200 application/json → `[]`; GET /users/{id} → response 200 application/json
- **Where:** [`api/openapi.yaml:25`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L25) (baseline: `base/openapi.yaml:26`)
- **Evidence:** provider-backward: guarantee/widens/structural → breaking (contract-guaranteed)
- **Fix:** Keep "email" required, or release as a new major version.
- **Fingerprint:** `9a6266fb325fa86eb61fdd0bfb0c8e70` (+1 related)

#### ❌ `CG-REQ-001` New required request body property · high

New required property "role" in POST /users: the request body (application/json).

- **Why:** Existing consumers do not send "role", so a provider that enforces the candidate will reject their requests.
- **Affects:** POST /users → request body application/json
- **Where:** [`api/openapi.yaml:34`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L34) (baseline: `base/openapi.yaml:30`)
- **Evidence:** provider-backward: acceptance/narrows/structural → breaking (contract-guaranteed)
- **Fix:** Make "role" optional (with a server-side default), or release as a new major version.
- **Fingerprint:** `4db4542940402ca20ab6a41f3886234e`

### ⚠️ Potentially breaking (6)

#### ⚠️ `CG-RES-006` Response enum value added · medium

GET /users: response 200 (application/json) at `[].status` may now return deleted.

- **Why:** Consumers that handle the enum exhaustively may not handle the new values.
- **Affects:** GET /users → response 200 application/json → `[].status`; GET /users/{id} → response 200 application/json → `status`
- **Where:** [`api/openapi.yaml:26`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L26) (baseline: `base/openapi.yaml:27`)
- **Evidence:** responseEnumAdditions: potentially-breaking
- **Fix:** Document the enum as extensible (x-extensible-enum) or make sure consumers have a fallback.
- **Fingerprint:** `618c88bdc8d69a34ca97e0074699563f` (+1 related)

#### ⚠️ `CG-REQ-024` Request value constraint tightened · medium

`maxLength` became stricter in POST /users: the request body (application/json) at `email`.

- **Why:** Values that satisfied the old `maxLength` may now be rejected.
- **Affects:** POST /users → request body application/json → `email`
- **Where:** [`api/openapi.yaml:32`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L32) (baseline: `base/openapi.yaml:33`)
- **Evidence:** provider-backward: acceptance/narrows/value-space → potentially-breaking (policy-dependent)
- **Fix:** Keep the previous limit, or confirm that no consumer sends values in the excluded range.
- **Fingerprint:** `7aaa2471c52fc9d5c78bf855a894f568`

#### ⚠️ `CG-REQ-026` Request pattern added · medium

Pattern `^[a-z]+$` now restricts POST /users: the request body (application/json) at `nickname`.

- **Change:** `(none) → "^[a-z]+$"`
- **Why:** Strings that do not match the pattern will be rejected.
- **Affects:** POST /users → request body application/json → `nickname`
- **Where:** [`api/openapi.yaml:33`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L33) (baseline: `base/openapi.yaml:34`)
- **Evidence:** Patterns are compared as text only. · provider-backward: acceptance/narrows/value-space → potentially-breaking (policy-dependent)
- **Fix:** Confirm that consumers only send matching values.
- **Fingerprint:** `592eeb9aead2a8cdef17467ec32b86b7`

#### ⚠️ `CG-RES-011` Response value constraint relaxed · low

`maximum` was relaxed in GET /users: response 200 (application/json) at `[].score`.

- **Why:** Values outside the previous limit may now be returned; consumer buffers or UI limits may not handle them.
- **Affects:** GET /users → response 200 application/json → `[].score`; GET /users/{id} → response 200 application/json → `score`
- **Where:** [`api/openapi.yaml:27`](https://github.com/acme/api/blob/abc123/api/openapi.yaml#L27) (baseline: `base/openapi.yaml:28`)
- **Evidence:** provider-backward: guarantee/widens/value-space → potentially-breaking (consumer-dependent)
- **Fix:** Confirm that consumers handle the wider range.
- **Fingerprint:** `7e023eb5df611649cf8b23e515bec154` (+1 related)

<details>
<summary><strong>Non-breaking (1)</strong></summary>

#### ✅ `CG-RES-017` Non-success response removed · info

Response 404 of GET /users/{id} is no longer documented.

- **Change:** `"404" → (none)`
- **Why:** The provider may still return it undocumented.
- **Affects:** GET /users/{id} → response 404
- **Where:** [`base/openapi.yaml:10`](https://github.com/acme/api/blob/abc123/base/openapi.yaml#L10)
- **Evidence:** The provider may still return it undocumented. · provider-backward: guarantee/narrows/structural → non-breaking (contract-guaranteed)
- **Fix:** No action needed.
- **Fingerprint:** `cd3afcccd007c80752646f1b558adbd2`

</details>

<sub>Reproduce locally: `npx contractguard check --spec mixed-strict-policy` · 3 breaking · 6 potentially breaking · 0 undetermined · 1 non-breaking · 0 informational</sub>
