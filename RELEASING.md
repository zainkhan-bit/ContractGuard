# Releasing

Releases are automated (`.github/workflows/release.yml`); this page lists what a maintainer does and the one-time
setup.

## Every release

1. Pull requests that change behaviour add a changeset: `pnpm changeset`.
2. On every push to `main`, the workflow opens or updates the **"Release: version packages"** pull request. It bumps
   all packages to the same version, writes the changelogs, rebuilds the Action bundle and the generated docs.
3. Review and merge it. Pull requests opened with the workflow token do not trigger CI by themselves (a GitHub
   rule); close and reopen it, or push a commit to its branch, to run the checks before merging.
4. The next run sees an unpublished version and starts **Publish**. Approve it in the `release` environment.
   It runs the full test suite and the pack smoke test, publishes to npm with provenance, tags `vX.Y.Z`, moves the
   `vX` tag that GitHub Action users reference, and creates the GitHub Release with the tarballs and a manifest of
   their SHA-256 hashes.
5. Verify the release is reproducible: `pnpm build && node scripts/release-verify.mjs --ref vX.Y.Z` rebuilds the tag
   from a clean clone and compares every tarball with the one on npm, byte for byte.

Dry run at any time: `node scripts/release.mjs --dry-run` packs everything and writes `release/manifest.json`.

## One-time setup

1. **GitHub → Settings → Actions → General → Workflow permissions**: enable "Allow GitHub Actions to create and approve
   pull requests" (for the version pull request).
2. **GitHub → Settings → Environments**: create `release` with yourself as a required reviewer.
3. **npm**: create the account or organization that owns `@zainkhan-bit` (your npm user name must be `zainkhan-bit`).
4. **First publish**: npm trusted publishing can only be configured for packages that exist. Either publish 1.0.0 once
   with a token (add an npm automation token as the `NPM_TOKEN` repository secret; the workflow uses it), or
   publish from your machine with `node scripts/release.mjs` after `npm login`.
5. **Trusted publishing**: on npmjs.com, for each of the six packages, add a trusted publisher: GitHub Actions,
   repository `zainkhan-bit/ContractGuard`, workflow `release.yml`, environment `release`. Then delete `NPM_TOKEN`.
6. **GitHub Pages** (documentation): Settings → Pages → Source: **GitHub Actions**.
