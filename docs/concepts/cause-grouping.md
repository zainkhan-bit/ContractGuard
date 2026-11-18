# One cause, one finding

A schema shared through `$ref` can appear in many operations. When a property is removed from it, each affected
location is a finding of its own (so the summary counts them, and each can be ignored separately), but the report
shows them as **one root cause** with every affected operation:

```text
✖ BREAKING  CG-RES-001  Required response property removed                          high
  what:     Required property "email" was removed from GET /teams/{id}/members: response 200
            (application/json) at `[]`.
  where:    openapi.yaml:18
  affects:  GET /teams/{id}/members → response 200 application/json → `[]`
            GET /users → response 200 application/json → `[]`
            GET /users/{id} → response 200 application/json
            + 1 more
  why:      Consumers rely on "email" always being present; it may now be missing.
  fix:      Keep returning "email" (deprecate it first), or release as a new major version.

Summary: 4 breaking · 0 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational
```

`where` points at the schema in the candidate document, so the fix happens in one place.

## Fingerprints

Every finding has a **fingerprint**, a stable 32-character id computed from the rule, the operation, the location in
the contract and the schema path. It does not change when unrelated parts of the document move or the file is
reformatted, so it works for `rules.ignore`, SARIF deduplication in code scanning, and tracking a finding across runs.

`--group-by operation` (or `report.groupBy: operation`) groups human reports by operation instead.
