import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices, type Project } from '@playwright/test';
import type { Dev, Lang, Meta } from './ux/test';

/**
 * End-to-end and UAT tests, layer L1 (UAT plan section 3.1): the production build of the web app,
 * served with the production security headers; each test answers the API itself.
 *   npm run build -w apps/web && npm run e2e
 *
 * Projects are device × language (plan section 4): D, DW, DS, T, TL, A always; E (Edge) when
 * E2E_EDGE=1 and I (iPhone, WebKit) when E2E_WEBKIT=1, because those browsers are not in every
 * environment. UAT_DEVICES and UAT_LANGS narrow the matrix (e.g. UAT_DEVICES=D UAT_LANGS=en).
 */
const port = Number(process.env.E2E_PORT ?? 4310);
/** A preinstalled Chromium (sandboxes ship one under /opt/pw-browsers) when E2E_CHROMIUM is not set. */
function preinstalled(): string | undefined {
  if (process.env.E2E_CHROMIUM) return process.env.E2E_CHROMIUM;
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base)
    .filter((x) => /^chromium-\d+$/.test(x))
    .sort()
    .reverse())
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome'])
      if (existsSync(join(base, d, sub))) return join(base, d, sub);
  return undefined;
}
const exe = preinstalled();
// No background traffic to Google services (autofill, component updates): it is blocked in
// sandboxes anyway and only slows the runs down.
const quiet = ['--disable-background-networking', '--disable-component-update', '--no-first-run'];
const launch = exe ? { executablePath: exe, args: quiet } : { args: quiet };

const DEVICES: Record<Dev, Project['use'] & { touch: boolean }> = {
  D: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, touch: false },
  DW: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 }, touch: false },
  DS: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, touch: false },
  E: {
    ...devices['Desktop Edge'],
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    touch: false,
  },
  T: {
    ...devices['Desktop Chrome'],
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: false,
    touch: true,
  },
  TL: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
    isMobile: false,
    touch: true,
  },
  A: { ...devices['Pixel 7'], touch: true },
  I: { ...devices['iPhone 14'], touch: true },
};

const wantDev = (process.env.UAT_DEVICES ?? '').split(',').filter(Boolean);
const wantLang = (process.env.UAT_LANGS ?? 'en,az').split(',').filter(Boolean) as Lang[];
const available = (d: Dev) =>
  (d !== 'E' || process.env.E2E_EDGE === '1') && (d !== 'I' || process.env.E2E_WEBKIT === '1');

export function uatProjects(layer: 'L1' | 'L2'): Project[] {
  const out: Project[] = [];
  for (const dev of Object.keys(DEVICES) as Dev[]) {
    if (!available(dev) || (wantDev.length && !wantDev.includes(dev))) continue;
    for (const lang of wantLang) {
      const { touch, ...use } = DEVICES[dev];
      const metadata: Meta = { dev, lang, touch, layer };
      out.push({
        name: `${dev}-${lang}`,
        metadata,
        use: {
          ...use,
          locale: lang === 'az' ? 'az-AZ' : 'en-GB',
          timezoneId: 'Asia/Baku',
          launchOptions: dev === 'E' || dev === 'I' ? undefined : launch,
        },
      });
    }
  }
  return out;
}

export default defineConfig({
  testDir: './specs',
  outputDir: `./test-results/l1${process.env.UAT_TAG ? `-${process.env.UAT_TAG}` : ''}`,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.UAT_RETRIES ? Number(process.env.UAT_RETRIES) : process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `./test-results/uat/results-l1${process.env.UAT_TAG ? `-${process.env.UAT_TAG}` : ''}.json`,
      },
    ],
    ...(process.env.CI
      ? [['html', { open: 'never', outputFolder: './playwright-report' }] as const]
      : []),
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node serve.mjs',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
  },
  projects: uatProjects('L1'),
});
