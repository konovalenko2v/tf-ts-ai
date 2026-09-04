import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Flat config (ESLint 10). Type-aware linting is on via projectService — the rules that actually
// catch bugs in this codebase (floating promises, unsafe argument types, misused promises) all
// need type information, and a lint pass that can't see types would duplicate what `tsc --noEmit`
// already does in CI without adding anything.
export default tseslint.config(
  {
    // Generated output and vendored artifacts — never linted.
    ignores: [
      'node_modules/**',
      'coverage/**',
      'allure-report/**',
      'allure-results/**',
      'playwright-report/**',
      'test-results/**',
      '.observability/**',
      '.self-heal/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // This config file itself isn't in tsconfig's `include` (which covers src/tests/playwright
    // config only), so type-aware linting has no program for it — lint it untyped rather than
    // widening tsconfig to cover tooling files.
    files: ['eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An un-awaited promise in a test step is a silent false-pass: the assertion never runs and
      // the test goes green. This is the single highest-value rule here.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Unused code is a maintenance signal, not a style preference — but an intentionally-unused
      // destructured field (used in the specs to drop a key) stays legal via the ^_ convention.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],

      // The codebase already avoids `any` almost entirely (one deliberate Goal<any>); keep it a
      // warning rather than an error so the existing justified case doesn't need an inline
      // disable, but a new one still shows up in review.
      '@typescript-eslint/no-explicit-any': 'warn',

      // These fire ~100 times today, almost entirely on `response.json()` — Playwright types it as
      // `any`, so every field read off an API/GraphQL response body is "unsafe" by this rule's
      // definition. That IS real debt (a typo in a field name is currently caught by nothing), but
      // clearing it means typing every response body, which is a deliberate piece of work rather
      // than a lint autofix. Kept as warnings so the count stays visible and can't grow silently
      // into a green CI, without blocking today's pipeline on a pre-existing backlog.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',

      // `let x = ''` before a try/catch that assigns it: the initializer is what lets TypeScript
      // infer the type and see it as definitely-assigned, so removing it (which is all this rule
      // asks) would force an explicit annotation and change nothing about the code's behaviour.
      'no-useless-assignment': 'off',

      // Async `main()` bodies whose work is all synchronous still have to be async: every CLI
      // entry point here is invoked as `main().catch(...)`, and a Promise-returning signature is
      // what makes that error path exist at all.
      '@typescript-eslint/require-await': 'off',

      // Numbers and booleans in a template are unambiguous and used throughout the reporting code
      // (counts, durations, flags); anything else has to be stringified explicitly, which is what
      // keeps an accidental "[object Object]" out of a log line or a URL.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNever: false, allowRegExp: false },
      ],
    },
  },
  {
    // Node CLI entry points legitimately write to the console — that IS their output channel.
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Playwright's Reporter interface dictates the full parameter list of every hook (onBegin
    // receives (config, suite), onTestEnd receives (test, result)); an implementation that doesn't
    // need one of them still has to declare it to match the interface. Same for spec-file hooks.
    files: ['src/observability/reporter.ts', 'tests/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  // Must stay last: turns off every stylistic rule that would fight Prettier.
  prettier,
);
