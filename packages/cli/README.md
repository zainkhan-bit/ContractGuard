# contractguard

Detect breaking changes between two versions of an OpenAPI 3.0/3.1 contract — with clear explanations,
CI-ready Markdown, JSON and SARIF reports, and stable exit codes.

```sh
npx @zainkhan-bit/contractguard check git:origin/main:api/openapi.yaml api/openapi.yaml
```

| Command                                          | Purpose                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `contractguard check [base] [candidate]`         | Compare and apply the policy (no arguments: every spec in `.contractguard.yaml`) |
| `contractguard validate <spec...>`               | Load, parse, resolve and validate specifications                                 |
| `contractguard explain <rule-id>` / `--list`     | Rule documentation                                                               |
| `contractguard baseline create <spec> -o <file>` | Write a snapshot to compare against later (`snapshot:<file>`)                    |
| `contractguard init`                             | Write a commented `.contractguard.yaml`                                          |

Sources: a path, `git:<ref>:<path>`, `snapshot:<file>`, an `https://` URL (when allowed), or `-` for stdin.

Exit codes: `0` passed · `1` policy failed · `2` invalid input · `3` usage or configuration error ·
`4` internal error · `130` interrupted.

MIT licensed.
