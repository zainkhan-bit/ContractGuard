/** Enforced module boundaries — blueprint §5.2 and §6.3. */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No cycles at package or module level (§6.3 rule 1).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-is-a-leaf',
      severity: 'error',
      comment: '@contractguard/core must not depend on any other workspace package (§5.2).',
      from: { path: '^packages/core/' },
      to: { path: '^packages/(?!core/)' },
    },
    {
      name: 'engine-not-openapi',
      severity: 'error',
      comment: 'The engine is protocol-independent and must not import @contractguard/openapi (§5.2).',
      from: { path: '^packages/engine/src/' },
      to: { path: '^packages/openapi/' },
    },
    {
      name: 'reporters-only-core',
      severity: 'error',
      comment: 'Reporters render AnalysisResult only (ADR-16).',
      from: { path: '^packages/reporters/src/' },
      to: { path: '^packages/(engine|openapi|app|cli)/' },
    },
    {
      name: 'nothing-depends-on-cli',
      severity: 'error',
      from: { path: '^packages/(?!cli/)' },
      to: { path: '^packages/cli/' },
    },
    {
      name: 'diff-not-compat',
      severity: 'error',
      comment: 'engine/diff must not import engine/compat or engine/rules (§6.2).',
      from: { path: '^packages/engine/src/diff/' },
      to: { path: '^packages/engine/src/(compat|rules)/' },
    },
    {
      name: 'io-only-in-adapters',
      severity: 'error',
      comment: 'Filesystem, process and network modules only in loaders/adapters/CLI/Action (§6.3 rule 4).',
      from: {
        path: '^packages/',
        pathNot: '^packages/(openapi/src/load|app/src/(sources|config)|cli)/|/test/',
      },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(fs|fs/promises|child_process|net|dns|http|https|http2|tls|dgram|worker_threads)$',
      },
    },
    {
      name: 'no-test-imports-in-src',
      severity: 'error',
      from: { path: '^packages/[^/]+/src/' },
      to: { path: '(^|/)(test|fixtures)/' },
    },
    {
      name: 'no-github-outside-action',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '@actions/|@octokit/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'types', 'default'] },
  },
};
