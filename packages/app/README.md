# @contractguard/app

The application layer behind the `contractguard` CLI and GitHub Action: configuration loading and validation
(`.contractguard.yaml`, JSON Schema at `@contractguard/app/schemas/config.v1.json`), sources (`path`,
`git:<ref>:<path>`, `snapshot:<file>`, `https://` URLs, stdin), and the `analyze()`, `validateSource()` and
`createBaseline()` use cases.

Most users want the CLI: `npx contractguard check`. See the
[repository](https://github.com/zainkhan-bit/ContractGuard) for documentation.

MIT licensed.
