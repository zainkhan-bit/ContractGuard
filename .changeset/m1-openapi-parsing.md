---
'@contractguard/openapi': minor
'@contractguard/core': patch
---

Add `@contractguard/openapi` with document loading (file loader with root confinement, symlink and Windows path checks; in-memory and composite loaders), JSON/YAML parsing into canonical JSON with an exact source-position index (strict-JSON fast path, YAML 1.2 core schema, alias/depth/size limits, exact numbers), and OpenAPI version detection.
