---
'@zainkhan-bit/contractguard': patch
'@zainkhan-bit/contractguard-core': patch
'@zainkhan-bit/contractguard-openapi': patch
'@zainkhan-bit/contractguard-engine': patch
'@zainkhan-bit/contractguard-reporters': patch
'@zainkhan-bit/contractguard-app': patch
---

The CLI is published as `@zainkhan-bit/contractguard` (npm does not accept the unscoped name `contractguard`, which is
too close to an existing package). The command is still `contractguard`: run `npx @zainkhan-bit/contractguard check` or
install it with `npm install -D @zainkhan-bit/contractguard`. "Reproduce locally" lines in reports use the new name.
