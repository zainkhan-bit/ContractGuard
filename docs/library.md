# Library API

Everything the CLI and the Action do is available as a library.

```sh
npm install @zainkhan-bit/contractguard-app
```

```ts
import { analyze } from '@zainkhan-bit/contractguard-app';

const run = await analyze({
  cwd: process.cwd(),
  configPath: false, // or a path; omit to discover .contractguard.yaml
  adHoc: { base: 'git:origin/main:openapi.yaml', candidate: 'openapi.yaml' },
  today: new Date().toISOString().slice(0, 10),
  toolVersion: 'my-tool',
});
if (run.value === undefined) throw new Error(run.diagnostics.map((d) => d.message).join('\n'));
for (const result of run.value.results) {
  for (const f of result.findings) console.log(f.classification, f.ruleId, f.message);
}
console.log(run.value.outcome); // 'passed' | 'policy-failed' | 'input-error'
```

Expected failures never throw: every stage returns `{ value?, diagnostics }`. Results follow the
[JSON report schema](https://github.com/zainkhan-bit/ContractGuard/blob/main/packages/reporters/schemas/report.v1.json).

| Package                                 | Use it for                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@zainkhan-bit/contractguard-app`       | `analyze()`, `validateSource()`, `createBaseline()`, configuration loading                           |
| `@zainkhan-bit/contractguard-engine`    | `checkCompatibility(base, candidate)` on loaded contracts; the rule catalog (`RULES`, `explainRule`) |
| `@zainkhan-bit/contractguard-openapi`   | `loadContract()`: load, parse, resolve, validate and normalize a specification                       |
| `@zainkhan-bit/contractguard-reporters` | `renderMarkdown`, `renderJson`, `renderSarif`, `renderConsole`                                       |
| `@zainkhan-bit/contractguard-core`      | Types, diagnostics, identifiers                                                                      |
