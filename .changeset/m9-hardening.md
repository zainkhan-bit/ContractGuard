---
'contractguard': patch
'@zainkhan-bit/contractguard-core': patch
'@zainkhan-bit/contractguard-openapi': patch
'@zainkhan-bit/contractguard-engine': patch
'@zainkhan-bit/contractguard-reporters': patch
'@zainkhan-bit/contractguard-app': patch
---

Fixes from the 1.0 security review and the real-world corpus: secret-like defaults are redacted and long values
truncated in findings; control characters and HTML are escaped in console and Markdown reports; very deep `$ref`
chains no longer overflow the stack, and projection work is bounded (rest reported as CG-SCHEMA-902); compositions
with more than 64 branches compare exactly when branches are only added or removed; OpenAPI 3.0 `$ref` siblings no
longer fail structural validation; discriminator mappings through a `$ref` resolve (CGD-SEM-107); content keys that
are not media types are ignored (CGD-SPEC-107); the normalizer no longer slows down quadratically on large specs.
Config keys now have descriptions in the JSON Schema.
