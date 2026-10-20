import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (Stage 2, S2-FE9 and S2-FE14): the production build of the web app, served with
 * the production security headers, on three screens. The API is answered by each test, so the
 * flows run without a database or an AI provider.
 *   npm run build -w apps/web && npm run e2e
 */
const port = Number(process.env.E2E_PORT ?? 4310);
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.E2E_CHROMIUM
      ? { executablePath: process.env.E2E_CHROMIUM }
      : undefined,
  },
  webServer: {
    command: 'node serve.mjs',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    // Owner decision #17: an iPhone-class phone on WebKit. CI installs WebKit and sets E2E_WEBKIT=1.
    ...(process.env.E2E_WEBKIT === '1'
      ? [{ name: 'iphone', use: { ...devices['iPhone 14'] } }]
      : []),
  ],
});
