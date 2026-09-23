import { defineConfig, devices } from '@playwright/test';

/**
 * BASE_URL and ADMIN_PATH must be set per test run — see README.md.
 * ADMIN_PATH is the obscured admin URL segment; it is intentionally NOT
 * committed anywhere. Pass it via env var.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // storefront checkout tests are stateful (cart), keep sequential
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true, // local/staging installs often run self-signed certs
    // launchOptions lives only here, not repeated in the project below, since
    // Playwright replaces this whole key rather than merging it per-field;
    // a second launchOptions at the project level would silently drop slowMo.
    launchOptions: { slowMo: 1000, args: ['--start-maximized'] },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // devices['Desktop Chrome'] bundles a fixed viewport + deviceScaleFactor.
        // Cleared here (not just per-spec-file) so every context this project
        // creates, including whatever --debug spins up on its own, never
        // carries the conflicting deviceScaleFactor in the first place.
        viewport: null,
        deviceScaleFactor: undefined,
      },
    },
  ],
});
