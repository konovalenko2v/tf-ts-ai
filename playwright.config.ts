import { defineConfig, devices } from '@playwright/test';
// This import's module-level dotenv.config() (src/core/config.ts) must run before the reporter
// array below is evaluated: globalSetup's own dotenv.config() runs too late for that, since
// Playwright locks in `reporter` by synchronously evaluating this whole file first and only
// imports globalSetup afterwards — so process.env.RP_ENDPOINT was always undefined here on a
// local run, silently dropping the ReportPortal reporter even with RP_ENDPOINT set in .env.
import { config } from './src/core/config';

export default defineConfig({
  testDir: './tests',
  // Order matters: clean-allure-results must run before global-setup so a fresh allure-results/
  // exists before any worker (and allure-playwright's reporter) starts writing to it.
  globalSetup: ['./src/core/clean-allure-results.ts', './src/core/global-setup.ts'],
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
    // blob is what the CI sharding example (regression.yml's test-shard job) merges across
    // shards — CI-only so a local run doesn't grow a blob-report/ directory. test:affected's
    // fixed argv can't add CLI reporters (see that job's comment), so this has to live in config
    // to fire on both the PR (affected) and push (full/--shard) paths alike.
    ...(process.env.CI ? [['blob'] as const] : []),
    // ReportPortal is opt-in and off by default (local self-hosted instance, see
    // docker/reportportal/) — gated on RP_ENDPOINT the same way `blob` is gated on CI, so a run
    // with no ReportPortal instance configured never tries to reach one. test:affected's fixed
    // argv can't add CLI reporters (see the blob comment above), so this has to live in config too.
    ...(process.env.RP_ENDPOINT
      ? [
          [
            '@reportportal/agent-js-playwright',
            {
              apiKey: process.env.RP_API_KEY,
              endpoint: process.env.RP_ENDPOINT,
              project: process.env.RP_PROJECT,
              launch: process.env.RP_LAUNCH ?? 'tf-ts-ai',
              attributes: [{ key: 'project', value: process.env.RP_PROJECT ?? 'tf-ts-ai' }],
              description: 'tf-ts-ai regression run',
              // RP_MODE=DEBUG routes the launch to ReportPortal's Debug page (/userdebug/all)
              // instead of Launches — same knob for a local ad-hoc run and a CI debug run, so
              // neither clutters the real regression launch history.
              mode: process.env.RP_MODE === 'DEBUG' ? 'DEBUG' : 'DEFAULT',
              // Set by src/reportportal/start-launch.ts across a sharded CI run (regression.yml's
              // test-shard matrix) so every shard attaches to the SAME launch instead of each
              // starting its own — see that file's comment for why. Absent for a normal local
              // single-process run, where the agent starts (and finishes) its own launch as usual.
              launchId: process.env.RP_LAUNCH_ID,
            },
          ] as const,
        ]
      : []),
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
      // Scoped via testMatch against the top-level testDir, not a per-project testDir — a
      // per-project testDir is what made the WebStorm/IntelliJ Playwright plugin's gutter-icon
      // run unable to resolve which --project a file belongs to (each project claimed its own
      // isolated root, and the plugin's file->project matching doesn't reliably handle that
      // shape). A single shared testDir + testMatch per project is the same scheme
      // ui-automation-tests (wlt) uses, and gutter-icon runs resolve correctly there.
      testMatch: '**/tests/unit/**/*.spec.ts',
      // contract.spec.ts has its own project below — split out so it shows as its own row in
      // ReportPortal/Allure (grouped by project name) instead of being buried among the 140
      // other unit tests. Same testDir/testMatch scheme, so the WebStorm gutter-icon note above
      // still applies; testIgnore is what keeps the two projects from double-running this file.
      testIgnore: '**/tests/unit/contract.spec.ts',
      fullyParallel: true,
    },
    {
      // Response-contract (Zod schema) validation for src/api/contract.ts and src/api/schemas/
      // — pure unit-style tests (mocked APIResponse, no network), split from the `unit` project
      // above purely for reporting: the CLAUDE.md-documented `contract` failure category in
      // failure-analysis/classify.ts already treats these as a distinct concern, and it was
      // invisible in ReportPortal/Allure while lumped into `unit`'s 140 tests.
      name: 'contract',
      testMatch: '**/tests/unit/contract.spec.ts',
      fullyParallel: true,
    },
    {
      name: 'api',
      testMatch: '**/tests/api/**/*.spec.ts',
      fullyParallel: false,
      // auth.client.ts / booking.client.ts build relative paths against this. BookStoreClient
      // (a goal-evolution driver, src/goal-evolution/goals/book-store-*.ts) stays on absolute
      // URLs against config.bookStoreHost — a different host — so baseURL is simply unused for
      // those calls, not a conflict.
      use: { baseURL: config.apiBaseURL },
    },
    {
      name: 'graphql',
      testMatch: '**/tests/graphql/**/*.spec.ts',
      fullyParallel: false,
    },
    {
      name: 'ui',
      testMatch: '**/tests/ui/**/*.spec.ts',
      // demo-failure.spec.ts and demo-flaky.spec.ts always fail (or flake) on purpose (see their
      // own header comments) — excluded by default so neither ever runs in CI or a normal
      // `npm test`, where they would permanently redden the required `test` check and block
      // agent-fixer-verify-and-merge. DEMO_FAILURE=1 opts in for a one-off local run producing
      // real red/flaky results across every report (Playwright HTML, Allure, ReportPortal, this
      // project's own dashboard) for a demo/presentation.
      testIgnore: process.env.DEMO_FAILURE ? [] : ['**/tests/ui/demo-failure.spec.ts', '**/tests/ui/demo-flaky.spec.ts'],
      timeout: 60_000,
      // process.env.HEADFUL is always a string (or undefined) — `!process.env.HEADFUL` was
      // truthy-checking existence, so HEADFUL=false still opened a headful browser. Accept the
      // documented '1' (.env.example) and 'true' as the only ways to opt in.
      use: {
        ...devices['Desktop Chrome'],
        headless: process.env.HEADFUL !== '1' && process.env.HEADFUL !== 'true',
      },
    },
  ],
});
