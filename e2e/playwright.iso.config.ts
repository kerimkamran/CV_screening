import { defineConfig } from '@playwright/test';
import { uatProjects } from './playwright.config';

/**
 * UAT layer L2, isolated stack: the cases that change global settings (the active AI model, the
 * retention period, the last administrator, link review) or need their own database. It has its own
 * API on port 4340 against its own database cv_uat_iso, dropped and rebuilt at start, so nothing
 * here can disturb the shared L2 stack on 4320. One worker: the cases change settings every other
 * case on this stack would see.
 *   npx playwright test -c playwright.iso.config.ts
 */
process.env.UAT_PORT ??= '4340';
process.env.UAT_OWNER_URL ??= 'postgresql://cv:cv@127.0.0.1:5432/cv_uat_iso';
process.env.UAT_APP_URL ??= 'postgresql://cv_api:cv_api@127.0.0.1:5432/cv_uat_iso';
process.env.UAT_ACCOUNTS_FILE ??= new URL(
  './test-results/uat/accounts-iso.json',
  import.meta.url,
).pathname;
const port = Number(process.env.UAT_PORT);
export default defineConfig({
  testDir: './isolated',
  testMatch: /.*\.spec\.ts$/,
  outputDir: `./test-results/iso${process.env.UAT_TAG ? `-${process.env.UAT_TAG}` : ''}`,
  fullyParallel: false,
  workers: 1,
  retries: process.env.UAT_RETRIES ? Number(process.env.UAT_RETRIES) : 0,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  globalSetup: './fullstack/seed.ts',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `./test-results/uat/results-iso${process.env.UAT_TAG ? `-${process.env.UAT_TAG}` : ''}.json`,
      },
    ],
  ],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'node fullstack/server.mjs',
    url: `http://127.0.0.1:${port}/readyz`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      UAT_RESET: process.env.UAT_RESET ?? '1',
      UAT_LINK_LOOPBACK: '1',
      UAT_PORT: String(port),
      UAT_OWNER_URL: process.env.UAT_OWNER_URL,
      UAT_APP_URL: process.env.UAT_APP_URL,
    },
  },
  projects: uatProjects('L2'),
});
