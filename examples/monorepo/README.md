# Example: monorepo

Three services, one `.contractguard.yaml`:

- `users` splits its schema into `schemas/user.yaml` (relative `$ref`s are followed, also at the base revision);
- `billing` is OpenAPI 3.0 and has an accepted change (`rules.ignore` with a reason);
- `catalog` has an experimental endpoint that is excluded by tag, and `/internal/**` is excluded for every service.

```bash
# from this folder, comparing with your main branch
npx contractguard check --base-ref origin/main
```

Each service gets its own report (`users.md`, `billing.json`, …) and its own section in the GitHub Action's summary.
