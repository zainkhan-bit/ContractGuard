---
'contractguard': minor
'@zainkhan-bit/contractguard-app': minor
'@zainkhan-bit/contractguard-core': minor
'@zainkhan-bit/contractguard-reporters': patch
---

GitHub Action support. `git:@base:<path>` sources resolve against a base revision (`--base-ref` on the CLI),
ad-hoc comparisons accept several specs, identical document sets skip the comparison (reported as unchanged), and
`analyze({ newSpecs: 'pass' })` reports a specification without a base document as new (`CGD-FS-101`). Git sources
report a path missing at a revision as `CGD-FS-001`. Reports show git documents as `path@sha7`, and a base revision
that is a commit SHA is shown once.
