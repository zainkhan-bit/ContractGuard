# Example: basic API

A small OpenAPI 3.1 contract with a `.contractguard.yaml`. ContractGuard checks it on every pull request in this
repository (`.github/workflows/contract.yml`), so a change to `openapi.yaml` shows the Action's annotations, job
summary and PR comment.

Try it locally from the repository root after `pnpm build`:

```bash
node packages/cli/bin/contractguard.js check --config examples/basic-api/.contractguard.yaml --base-ref origin/main
```
