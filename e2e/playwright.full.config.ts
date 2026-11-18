import { defineConfig } from '@playwright/test';
import { uatProjects } from './playwright.config';

/**
 * UAT layer L2 (plan 3.1): full-app journeys against the compiled API, Postgres (cv_uat),
 * pdftotext, LibreOffice and the fake AI. The server is e2e/fullstack/server.mjs on port 4320.
 *   npm run build && npm run e2e:full
 * Journeys share one database, so each test makes its own vacancies with unique titles; workers
 * are kept low because the screening queue and LibreOffice run in the same process.
 */
const port = Number(process.env.UAT_PORT ?? 4320);
export default defineConfig({
  testDir: './fullstack',
  testMatch: /.*\.spec\.ts$/,
  outputDir: `./test-results/l2${process.env.UAT_TAG ? `-${process.env.UAT_TAG}` : ''}`,
  fullyParallel: true,
  workers: Number(process.env.UAT_WORKERS ?? 2),
  retries: process.env.UAT_RETRIES ? Number(process.env.UAT_RETRIES) : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: './fullstack/seed.ts',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `./test-results/uat/results-l2${process.env.UAT_TAG ? `-${process.env.UAT_TAG}` : ''}.json`,
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node fullstack/server.mjs',
    url: `http://127.0.0.1:${port}/readyz`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: uatProjects('L2'),
});
