import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'infra/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Nest DI needs runtime class imports even when used only as types (emitDecoratorMetadata).
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Screens load their data from the API on mount (async, then setState). The rule's
      // alternative (a data library / Suspense) is not worth a dependency for this app.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  { files: ['**/*.{mjs,cjs}', 'scripts/**'], languageOptions: { globals: globals.node } },
  {
    files: ['**/*.spec.ts', '**/*.test.{ts,tsx}', '**/__tests__/**'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
  },
);
