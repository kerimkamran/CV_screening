import { LINK, OBATCH, oracleVacancy, ostate, OVID, run } from '../fixtures/oracle';
import { T } from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';

// 7.31 Oracle import on the vacancy page (OR), layer L1: Parallax's own Oracle routes are mocked;
// the fake Oracle is not used at L1 (plan 18.2). Every name and number is invented.

const open = async (page: import('@playwright/test').Page) => {
  await page.goto('about:blank');
  await page.goto(`/#/vacancies/${OVID}`);
};

uat(
  'OR-01',
  'Switch off: the vacancy page shows nothing about Oracle and asks once (S3-INT-14 B1)',
  { on: ['D', 'A'] },
  async ({ page, meta }) => {
    const t = T(meta.lang);
    const { seen } = await oracleVacancy(page, { script: () => 404 });
    await open(page);
    await expect(page.getByRole('heading', { name: t('CVs') })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByText(/Oracle/)).toHaveCount(0);
    expect(seen.requests.filter((r) => /\/oracle$/.test(r.url))).toHaveLength(1);
  },
);

uat(
  'OR-11',
  'Available but not connected for this tab: {available: false} hides the field; no Oracle chunk loads (B1)',
  { on: ['D'] },
  async ({ page, meta }) => {
    const t = T(meta.lang);
    const chunks: string[] = [];
    page.on('request', (r) => {
      if (/Oracle(Link|Strip)/.test(r.url())) chunks.push(r.url());
    });
    await oracleVacancy(page, { script: () => ostate({ available: false }) });
    await open(page);
    await expect(page.getByRole('heading', { name: t('CVs') })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: t('Import CVs from Oracle') })).toHaveCount(0);
    expect(chunks).toEqual([]);
  },
);

uat(
  'OR-02',
  'The field, one lookup, the dialog, Start; the strip shows the listing line with no reload (B2, B4-B7)',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    let started = false;
    const { seen } = await oracleVacancy(page, {
      script: () =>
        started ? ostate({ link: LINK, run: run({ counts: { seen: 40 } }) }) : ostate(),
      lookup: {
        body: {
          found: true,
          number: 'REQ-2026-0042',
          title: 'Senior Network Engineer',
          state: 'Open',
          estimate: 12,
          room: 500,
        },
      },
    });
    await open(page);
    const field = page.getByRole('textbox', { name: new RegExp(t('Oracle vacancy ID')) });
    await expect(field).toBeVisible();
    await field.fill('REQ-2026-0042');
    await page.getByRole('button', { name: t('Import CVs from Oracle') }).click();
    const dlg = page.getByRole('dialog', { name: t('Import CVs from Oracle?') });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Senior Network Engineer · Open');
    await expect(dlg).toContainText(
      t('About {n} applications. Their CVs will be copied and analyzed by AI. Room for {r}.', {
        n: 12,
        r: 500,
      }),
    );
    await ux.check('the confirm dialog', [...STD, 'AZ']);
    started = true;
    await dlg.getByRole('button', { name: t('Start') }).click();
    const strip = page.getByTestId('oracle-strip');
    await expect(strip).toContainText(
      t('Reading the application list from Oracle… {n} read so far.', { n: 40 }),
      { timeout: 8_000 },
    );
    const posts = seen.requests
      .filter((r) => r.method === 'POST')
      .map((r) => r.url.replace(/^\/api/, '').replace(/\?.*$/, ''));
    expect(posts).toEqual([
      `/vacancies/${OVID}/oracle/lookup`,
      `/vacancies/${OVID}/oracle/imports`,
    ]);
    expect(posts.some((p) => p.endsWith('/start'))).toBe(false);
  },
);

uat(
  'OR-04',
  'Fetching, then finished with Download report; Cancel import asks once (B8, B12, B13)',
  { on: ['D'] },
  async ({ page, meta }) => {
    const t = T(meta.lang);
    let phase: 'fetch' | 'done' = 'fetch';
    await oracleVacancy(page, {
      script: () =>
        phase === 'fetch'
          ? ostate({
              link: LINK,
              run: run({
                phase: 'fetching',
                listed: 12,
                batchId: OBATCH,
                counts: { seen: 12, listed: 12, fetched: 5 },
              }),
            })
          : ostate({
              link: LINK,
              lastRun: run({
                state: 'completed',
                phase: 'fetching',
                listed: 12,
                batchId: OBATCH,
                finishedAt: new Date().toISOString(),
                counts: { seen: 14, listed: 12, fetched: 12, noFile: 2 },
              }),
            }),
    });
    await open(page);
    const strip = page.getByTestId('oracle-strip');
    await expect(strip).toContainText(t('Fetched {sent} of {total}', { sent: 5, total: 12 }));
    await strip.getByRole('button', { name: t('Cancel import') }).click();
    await expect(strip.getByRole('button', { name: t('Keep importing') })).toBeFocused();
    await strip.getByRole('button', { name: t('Keep importing') }).click();
    phase = 'done';
    await expect(strip).toContainText(
      t('{copied} CVs copied of {total} applications', { copied: 12, total: 14 }),
      { timeout: 8_000 },
    );
    await expect(strip.getByRole('button', { name: t('Download report') })).toBeVisible();
    await expect(strip.getByRole('button', { name: t('Refresh') })).toBeVisible();
  },
);

uat(
  'OR-12',
  'One line per refusal under the field, never a code or an HTTP number (B4)',
  { on: ['D'] },
  async ({ page, meta }) => {
    const t = T(meta.lang);
    const refusals: [number, string, string][] = [
      [
        409,
        'AI_NOT_EU',
        'CVs from Oracle can be analyzed only by an AI model hosted in the EU. Ask an administrator to check AI models.',
      ],
      [429, 'LOOKUP_LIMIT', 'Too many lookups. Wait a minute and try again.'],
      [503, 'ORACLE_UNAVAILABLE', 'Oracle is not answering. Try again in a few minutes.'],
    ];
    for (const [status, code, message] of refusals) {
      await oracleVacancy(page, {
        script: () => ostate(),
        lookup: { status, body: { message, code } },
      });
      await open(page);
      const field = page.getByRole('textbox', { name: new RegExp(t('Oracle vacancy ID')) });
      await field.fill('REQ-1');
      await page.getByRole('button', { name: t('Import CVs from Oracle') }).click();
      await expect(page.getByText(t(message))).toBeVisible();
      await expect(page.getByText(code)).toHaveCount(0);
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  },
);
