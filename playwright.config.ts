import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    reporter: [
        ['list'],
        ['html', {open: 'never'}],
        ['allure-playwright', {resultsDir: 'allure-results'}],
    ],
    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
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
            use: {...devices['Desktop Chrome'],
              headless: !!process.env.CI
            },
        },
    ],
});
