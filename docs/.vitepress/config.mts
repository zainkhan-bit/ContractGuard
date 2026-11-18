import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitepress';

const rules = JSON.parse(readFileSync(new URL('./rules-sidebar.json', import.meta.url), 'utf8'));
const repo = 'https://github.com/zainkhan-bit/ContractGuard';

export default defineConfig({
  title: 'ContractGuard',
  description: 'Detect breaking changes between versions of an OpenAPI contract, with clear explanations.',
  base: '/ContractGuard/',
  cleanUrls: true,
  lastUpdated: false,
  // The architecture blueprint and ADRs are long engineering documents; they are linked on GitHub instead.
  srcExclude: ['architecture/**'],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Concepts', link: '/concepts/perspectives' },
      { text: 'Rules', link: '/rules/' },
      { text: 'Reference', link: '/reference/cli' },
    ],
    sidebar: {
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'GitHub Action', link: '/guide/github-action' },
            { text: 'Other CI systems', link: '/guide/other-ci' },
          ],
        },
        {
          text: 'Concepts',
          items: [
            { text: 'Compatibility perspectives', link: '/concepts/perspectives' },
            { text: 'Classification and severity', link: '/concepts/classification' },
            { text: 'One cause, one finding', link: '/concepts/cause-grouping' },
            { text: 'What cannot be decided', link: '/concepts/uncertainty' },
            { text: 'Supported OpenAPI and JSON Schema', link: '/concepts/json-schema' },
          ],
        },
        { text: 'Rules', link: '/rules/', items: rules },
        {
          text: 'Reference',
          items: [
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Configuration file', link: '/reference/config' },
            { text: 'Library API', link: '/library' },
            { text: 'Versioning and stability', link: '/stability' },
            { text: 'Architecture (GitHub)', link: `${repo}/blob/main/docs/architecture/BLUEPRINT.md` },
          ],
        },
        { text: 'FAQ', link: '/faq' },
        {
          text: 'Reports',
          items: [
            { text: 'Security review (1.0)', link: '/reports/security-review-1.0' },
            { text: 'Performance (1.0)', link: '/reports/performance-1.0' },
            { text: 'Real-world corpus', link: '/reports/corpus-1.0' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    footer: { message: 'Released under the MIT License.', copyright: 'Copyright © Muhammad Zain Khan' },
  },
});
