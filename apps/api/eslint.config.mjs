import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // `ignoreRestSiblings` allows the omit-by-rest idiom
      // (`const { secret, ...rest } = obj`), which is deliberate, not dead code.
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_|^req$|^next$', ignoreRestSiblings: true },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Test files are ES modules: Vitest 3 cannot be loaded via `require()`.
    // Vite handles the interop with the CommonJS sources they import.
    files: ['tests/**/*.js', '**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  prettier,
];
