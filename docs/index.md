---
layout: home
hero:
  name: ContractGuard
  text: Breaking changes in OpenAPI, explained
  tagline: Compare two versions of an OpenAPI 3.0/3.1 contract. Every finding says what changed, who it breaks, why, and how to fix it.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: GitHub Action
      link: /guide/github-action
    - theme: alt
      text: Rules
      link: /rules/
features:
  - title: A precise compatibility model
    details: Schemas are compared as sets of valid values, keyword by keyword, in the direction data flows. Requests may not narrow, responses may not widen.
  - title: Honest about uncertainty
    details: When the specification cannot decide (a changed regex, an unsupported keyword), the finding is "undetermined", never silently "fine".
  - title: One cause, one finding
    details: A property removed from a shared schema is reported once, with every affected operation, instead of fifty times.
  - title: Built for CI
    details: Stable exit codes, Markdown for PR comments, JSON with a published schema, SARIF 2.1.0, and a GitHub Action that works on fork PRs.
---
