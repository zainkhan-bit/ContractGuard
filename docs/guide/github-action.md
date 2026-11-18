# GitHub Action

Checks OpenAPI 3.0/3.1 contracts for breaking changes on every pull request: annotations on the changed lines, the
full report in the job summary, an optional sticky PR comment, SARIF for code scanning, and a failing check when the
policy says so.

```yaml
name: API contract
on:
  pull_request:
    paths: ['**/openapi*.yaml', '**/openapi*.json', '.contractguard.yaml']
permissions:
  contents: read
jobs:
  contract:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write # only for comment: true
    steps:
      - uses: actions/checkout@v7
      - uses: zainkhan-bit/ContractGuard/integrations/github-action@main
        with:
          specs: api/openapi.yaml # or commit a .contractguard.yaml (npx @zainkhan-bit/contractguard init)
          comment: true
```

The default shallow checkout is enough: the Action fetches the base commit on its own with `contents: read`.

## Inputs

| Input                     | Default                                  | Meaning                                                                                            |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `config`                  | discovered                               | Path to `.contractguard.yaml`                                                                      |
| `specs`                   | —                                        | Spec paths (one per line) when there is no config; each is compared with the same path at the base |
| `base-ref`                | PR base commit / previous commit on push | Revision to compare against; required for other events                                             |
| `fail-on`                 | `breaking`                               | Classifications that fail the job                                                                  |
| `min-severity`            | `low`                                    | Findings below this severity never fail the job                                                    |
| `undetermined`            | `review`                                 | `fail`, `review` or `ignore`                                                                       |
| `annotations`             | `true`                                   | Up to 10 errors and 10 warnings (GitHub's limit), then "+N more"                                   |
| `summary`                 | `true`                                   | Markdown report in the job summary                                                                 |
| `comment`                 | `false`                                  | One sticky PR comment, updated in place on every run                                               |
| `sarif-file`              | —                                        | Write SARIF 2.1.0 here; upload it with `github/codeql-action/upload-sarif`                         |
| `allow-remote-references` | `false`                                  | Let `references.allowRemote` from the config take effect                                           |
| `working-directory`       | `.`                                      | Where to run, relative to the repository                                                           |
| `token`                   | `github.token`                           | Used only for the comment                                                                          |

In a config file, `git:@base:<path>` means "this path at the base revision".

## Outputs

`result` (`passed`, `failed`, `input-error`), `breaking`, `potentially-breaking`, `undetermined`, `non-breaking`,
`report-json` (path of the JSON report) and `fingerprints` (findings that failed the policy).

## Behaviour

- **Events.** `pull_request` compares the merge result with the PR base commit; `push` with the previous commit
  (`HEAD^` for a new branch); anything else needs `base-ref`. `pull_request_target` works but prints a warning.
- **New specifications** (the file does not exist at the base) pass with a notice: nothing to compare yet.
- **Unchanged specifications** (identical files on both sides) are reported without running the comparison.
- **Fork pull requests** get a read-only token: the check runs fully, the comment is skipped with a notice. The
  Action never executes code from the pull request; it reads the specification files as data.
- **Comments** are found by a hidden marker, so re-runs update the same comment. Comment failures are warnings and
  never change the result. GitHub API calls retry on 5xx and rate limits, honouring `retry-after`.

## SARIF upload

```yaml
sarif:
  runs-on: ubuntu-latest
  permissions: { contents: read, security-events: write }
  steps:
    - uses: actions/checkout@v7
    - uses: zainkhan-bit/ContractGuard/integrations/github-action@main
      with: { specs: api/openapi.yaml, sarif-file: contractguard.sarif }
      continue-on-error: true
    - uses: github/codeql-action/upload-sarif@v4
      with: { sarif_file: contractguard.sarif }
```
