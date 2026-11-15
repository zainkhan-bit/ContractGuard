# Security Policy

ContractGuard processes untrusted specification documents, often in CI on pull requests. We take security reports seriously.

## Supported versions

Until 1.0, only the latest published pre-release receives security fixes. After 1.0, the latest minor release of the current major is supported.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub's private vulnerability reporting:
<https://github.com/zainkhan-bit/ContractGuard/security/advisories/new>

Please include affected versions, a minimal reproducing input (spec/config), and the impact you observed.

## Response targets

- Acknowledgement within 3 business days.
- Fix or mitigation within 30 days for high-severity issues.
- Coordinated disclosure: we publish an advisory once a fix is released and credit reporters who wish to be credited.

## Scope

In scope: code execution, file disclosure or path traversal via `$ref`, SSRF via remote references, denial of service from crafted inputs (beyond documented limits), token or secret leakage in output, CI trust-boundary bypasses (e.g. a PR enabling network access). See the threat model in [docs/architecture/BLUEPRINT.md §16](docs/architecture/BLUEPRINT.md#16-security-and-performance).
