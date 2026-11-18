---
'@zainkhan-bit/contractguard-openapi': minor
---

Add reference resolution (relative files, JSON-pointer and 3.1 `$id`/`$anchor` fragments, deterministic multi-document loading, document/byte limits, `$ref` sibling warnings for 3.0, chain following with cycle and hop-limit detection), an SSRF-hardened remote loader (off by default; exact host allowlist, blocked private/link-local/metadata ranges, connection pinned to the vetted IP, no redirects, size and time caps), and structural validation against the official OpenAPI 3.0/3.1 schemas via @hyperjump/json-schema.
