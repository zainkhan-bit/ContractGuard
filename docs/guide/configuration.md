# Configuration

`.contractguard.yaml` lives at the repository root or next to your specs. Every key is listed in the
[configuration reference](/reference/config); this page shows the common tasks.

## Several APIs in one repository

```yaml
version: 1
specs:
  - id: orders
    candidate: services/orders/openapi.yaml
    base: git:origin/main:services/orders/openapi.yaml
  - id: billing
    candidate: services/billing/openapi.yaml
    base: git:origin/main:services/billing/openapi.yaml
```

Each spec gets its own report (`orders.md`, `billing.json`, …). `--spec orders` runs one of them. In the GitHub Action,
write `git:@base:<path>` and the Action fills in the pull request's base commit.

## Decide what fails the build

```yaml
policy:
  failOn: [breaking, potentially-breaking] # default: [breaking]
  minSeverity: medium # ignore low-severity findings for the verdict
  undetermined: review # fail | review (default) | ignore
```

Findings that do not fail the build are still reported. See [Classification and severity](/concepts/classification).

## Tune how changes are classified

```yaml
analysis:
  constraintTightening: breaking # a lower maximum in a request is breaking, not just potentially breaking
  responseEnumAdditions: non-breaking # our consumers handle unknown enum values
  strictResponseValidation: true # our consumers reject unknown response properties
```

## Accept a known change

```yaml
rules:
  ignore:
    - rule: CG-RES-001
      operation: 'GET /users/{id}'
      reason: 'phone moved to /users/{id}/contact; all clients migrated (ticket API-412)'
      expires: 2027-03-01
```

A `reason` is required. Ignored findings stay in the reports as _suppressed_, so the decision is visible. An expiring
entry warns 30 days ahead and stops applying after its date. To silence exactly one finding, use its `fingerprint`
(shown in every report) instead of `rule`.

## Skip parts of the API

```yaml
filters:
  exclude: ['*:/internal/**', 'DELETE:/admin/*']
  excludeTags: [experimental]
  excludeExtensions: [x-internal]
```

## Split specifications and remote references

Local `$ref`s are followed anywhere inside the repository (`references.root`). Remote `$ref`s (`https://…`) are off by
default; enable them only for hosts you trust:

```yaml
references:
  allowRemote: true
  allowedHosts: [schemas.example.com]
```

In CI, a committed configuration cannot turn on network access by itself: the run also needs
`--allow-remote-references` (CLI) or `allow-remote-references: true` (Action). This keeps a pull request from making
CI fetch arbitrary URLs.
