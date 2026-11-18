# Getting started

ContractGuard needs Node.js 24 or later.

## Compare two versions

```sh
npx contractguard check git:origin/main:openapi.yaml openapi.yaml
```

The first argument is the **base** (what consumers use today), the second the **candidate** (your change).
`git:<ref>:<path>` reads the file at a git revision, so you do not need a copy of the old version. Relative `$ref`s
are resolved inside the same commit.

```text
✖ BREAKING  CG-REQ-003  Request body property became required                 high
  what:     Property "author" became required in POST /books: the request body (application/json).
  where:    openapi.yaml:58
  affects:  POST /books → request body application/json
  why:      Consumers that omit "author" will be rejected.
  fix:      Keep "author" optional with a server-side default, or release as a new major version.

Summary: 1 breaking · 0 potentially breaking · 0 undetermined · 0 non-breaking · 0 informational
Policy: FAILED (1 gating finding)
```

The exit code is `1` because a breaking change fails the default policy. See [exit codes](/reference/cli#exit-codes).

## Add a configuration

```sh
npx contractguard init
```

`init` finds your OpenAPI files and writes a commented `.contractguard.yaml`:

```yaml
version: 1
specs:
  - id: openapi
    candidate: openapi.yaml
    base: git:origin/main:openapi.yaml
policy:
  failOn: [breaking]
```

Now `npx contractguard check` with no arguments checks every spec in the file. See
[Configuration](/guide/configuration) for policies, filters and accepted changes.

## Run it in CI

- GitHub: use the [GitHub Action](/guide/github-action). It adds annotations, a job summary and an optional PR comment.
- Anything else: run the CLI and keep the reports. See [Other CI systems](/guide/other-ci).

## Other things to try

```sh
npx contractguard validate openapi.yaml            # is the document valid?
npx contractguard explain CG-REQ-003               # what does this rule mean?
npx contractguard check git:v1.0.0:openapi.yaml openapi.yaml --stdout json > report.json
npx contractguard baseline create openapi.yaml -o api-v1.snapshot.json   # freeze a version
npx contractguard check snapshot:api-v1.snapshot.json openapi.yaml
```
