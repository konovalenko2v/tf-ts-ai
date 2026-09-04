import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  globalSetup: './src/core/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Playwright has no per-attempt hook to grant or deny a retry based on why the previous attempt
  // failed — `retries` above is a single static number, decided before the run starts. A per-test
  // "smart" retry budget (see failure-analysis's retry-dispatcher) is therefore not reachable
  // without replacing the runner. maxFailures is the reachable version of the same idea in CI:
  // once a genuinely unfixable cause (e.g. an exhausted AI quota) starts failing tests, stop the
  // run instead of burning the full retry budget on every remaining test to rediscover the same
  // cause. 10 is deliberately above this suite's normal failure count (single digits) so a run
  // with a handful of real, unrelated failures still completes and reports all of them.
  maxFailures: process.env.CI ? 10 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['allure-playwright', { resultsDir: 'allure-results' }],
    ['./src/observability/reporter.ts'],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // Pure-logic unit tests for the AI layer (cli-fallback.ts, classify.ts, etc) — no
      // browser, no network, no real CLI calls. Kept as a Playwright Test project rather
      // than pulling in jest/vitest as a second test runner for a handful of files: Playwright
      // Test's own `test`/`expect` work fine for plain function calls, and this project just
      // never uses any browser/API fixture.
      name: 'unit',
      testDir: './tests/unit',
      fullyParallel: true,
    },
    {
      name: 'api',
      testDir: './tests/api',
      fullyParallel: false,
    },
    {
      name: 'graphql',
      testDir: './tests/graphql',
      fullyParallel: false,
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      timeout: 60_000,
      use: { ...devices['Desktop Chrome'], headless: !!process.env.CI },
    },
  ],
});
