import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'openapi',
          root: './packages/openapi',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'engine',
          root: './packages/engine',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'reporters',
          root: './packages/reporters',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/index.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      // Raised per package as packages land (§18.10: core and engine ≥ 90%, target 95% for core).
      thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 },
    },
  },
});
