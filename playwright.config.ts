import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    // Look for test files in the "tests" directory, relative to this configuration file.
    testDir: './tests',
    timeout: 100000,
    // Run all tests in parallel.
    fullyParallel: true,

    // Fail the build on CI if you accidentally left test.only in the source code.
    forbidOnly: !!process.env.CI,

    // Retry on CI only.
    retries: process.env.CI ? 2 : 0,

    // Opt out of parallel tests on CI.
    workers: process.env.CI ? 1 : undefined,

    // Reporter to use
    reporter: 'html',

    use: {
        // Base URL to use in actions like `await page.goto('/')`.
        baseURL: 'http://127.0.0.1:3000',

        headless: false,
        viewport: {
            width: 1280,
            height: 720
        },
        permissions: [ 'camera', 'microphone' ],
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    // Configure projects for major browsers.
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],

            },
        },
    ],
})
