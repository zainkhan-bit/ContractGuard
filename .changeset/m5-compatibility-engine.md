---
'@contractguard/engine': minor
'@contractguard/core': minor
---

Add the compatibility engine and the v1 rule catalog: `checkCompatibility()` diffs two contracts and classifies
every change with 83 rules (`CG-API`, `CG-SRV`, `CG-REQ`, `CG-RES`, `CG-SCHEMA`, `CG-AUTH`) through the
provider-backward perspective table, with classification policies, per-rule options and overrides, severity
computation (deprecated operations downgrade one level), stable fingerprints, suppression with expiry, and
`explainRule()` metadata. Core: distributive `ChangeOfKind`, `RuleContext.includeEquivalentChanges`, scope
additions carry their base alternative, and schema path keys are cached.
