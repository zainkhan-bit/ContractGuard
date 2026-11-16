// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'integrations/*/dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.ts', '.dependency-cruiser.cjs', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Explicit `as T` is preferred over `!`; both are reviewed the same way.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      // Determinism (ADR-19): no locale-dependent comparison in analysis code.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message: 'localeCompare is locale-dependent; use compareCodeUnits (ADR-19).',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'Dynamic code execution is forbidden (C2).',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // Library code must not throw anything except InternalError via assert helpers (ADR-18).
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message: 'localeCompare is locale-dependent; use compareCodeUnits (ADR-19).',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'Dynamic code execution is forbidden (C2).',
        },
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message: 'Report expected failures as Diagnostics; use InternalError/assert for invariants (ADR-18).',
        },
      ],
    },
  },
  {
    files: ['**/test/**/*.ts', 'vitest.config.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
