---
'contractguard': minor
'@zainkhan-bit/contractguard-app': minor
---

Add the `contractguard` CLI (`check`, `validate`, `explain`, `baseline create`, `init`) with stable exit codes
(0/1/2/3/4/130), `--stdout json|sarif|markdown` with human output on stderr, report files per spec, NO_COLOR /
FORCE_COLOR, and did-you-mean suggestions for unknown commands, options and keys. Add `@zainkhan-bit/contractguard-app`:
`.contractguard.yaml` v1 loading with line:column errors and a published JSON Schema
(`@zainkhan-bit/contractguard-app/schemas/config.v1.json`), path / `git:<ref>:<path>` / `snapshot:<file>` / URL / stdin sources
with hardened git invocation, the CI trust boundary for remote references, include/exclude/tag/extension filters,
timeouts, and the `analyze()` use case.
