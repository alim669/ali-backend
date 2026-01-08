module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: ['plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/'],
  rules: {
    'prettier/prettier': 'warn',

    // This repo currently uses `any` in several integration layers (Prisma/Redis/etc).
    // Keep lint usable without forcing a large refactor.
    '@typescript-eslint/no-explicit-any': 'off',

    // Allow unused vars when intentionally ignored via underscore prefix.
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],

    // Allow TS comment directives in integration code.
    '@typescript-eslint/ban-ts-comment': 'off',
  },
};
