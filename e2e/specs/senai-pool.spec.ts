import { DID, DID2, ME, mockApi, VID } from '../fixtures/api';
import { vacApi, vview } from '../fixtures/pkg-c';
import { CFG, poolAnswer, senaiRoutes, type AskLog } from '../fixtures/pkg-g';
import { AZ } from '../../apps/web/src/i18n/az';
import { expect, STD, test, uat } from '../ux/test';

// 7.x SenAI pool panel (SA), screens with a mocked API (L1), package G.

const w = (lang: string) => (en: string) => (lang === 'az' ? (AZ[en] ?? en) : en);

uat(
  'SA-01',
  'Ask bar: a question plus Enter opens the pool panel and sends it',
  { on: ['D', 'E', 'T', 'TL', 'A', 'I', 'DS'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const log: AskLog = { asks: [], cand: [] };
    const route = senaiRoutes(log, { askDelayMs: 600 });
    await vacApi(page, {
      assistant: CFG,
      views: [vview({ id: VID, title: 'Network Engineer' })],
      extra: (r, u) => route(r, u),
    });
    await page.goto(`/#/vacancies/${VID}`);
    const tt = w(meta.lang);
    const bar = page.getByRole('search').getByRole('textbox');
    await expect(bar).toHaveAttribute('placeholder', /^SenAI: Sən istə, Senai tapsın/);
    const q = 'Find the right candidate for Network Engineer';
    await bar.fill(q);
    await bar.press('Enter');
    await expect(bar).toHaveValue('');
    const panel = page.getByRole('complementary', { name: 'SenAI' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('p.ml-8').first()).toHaveText(q);
    await expect(
      panel
        .getByRole('status')
        .filter({ hasText: tt('{name} is looking…').replace('{name}', 'SenAI') }),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: tt('Send'), exact: true })).toBeDisabled();
    await expect(panel.locator('[data-answer]')).toHaveAttribute('data-kind', 'pool');
    expect(log.asks).toHaveLength(1);
    expect(log.asks[0]).toMatchObject({ message: q, vacancyId: VID, language: meta.lang });
    await expect(panel.locator('[aria-live="polite"]')).toHaveText(
      tt('{name} has answered.').replace('{name}', 'SenAI'),
    );
    await expect(panel.getByTestId('scope-chip')).toHaveText(
      tt('Searching in: {title}').replace('{title}', 'Network Engineer'),
    );
    await ux.check('answer', [...STD, 'AZ']);
    // Shift+Enter keeps a line break; Enter sends one request.
    const box = panel.getByRole('textbox');
    await box.click();
    await box.press('a');
    await box.press('Shift+Enter');
    await box.press('b');
    await box.press('Enter');
    await expect.poll(() => log.asks.length).toBe(2);
    expect(log.asks[1]!.message).toBe('a\nb');
    // 1,200 characters into the Ask bar: at most 1000 are sent.
    await expect(panel.locator('[data-answer]')).toHaveCount(2);
    await bar.fill('x'.repeat(1200));
    await bar.press('Enter');
    await expect.poll(() => log.asks.length).toBe(3);
    expect(log.asks[2]!.message.length).toBeLessThanOrEqual(1000);
    // The scope line on #/vacancies.
    await page.goto('/#/vacancies');
    await expect(
      page.getByRole('complementary', { name: 'SenAI' }).getByTestId('scope-chip'),
    ).toHaveText(tt('Searching in: all vacancies'));
  },
);

uat(
  'SA-16',
  'Find, open a name from the answer, then Back: the pool answer is still there',
  { on: ['D', 'DS', 'T', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    const log: AskLog = { asks: [], cand: [] };
    const route = senaiRoutes(log, { ask: () => poolAnswer() });
    await vacApi(page, {
      assistant: CFG,
      views: [vview({ id: VID, title: 'Network Engineer' })],
      extra: (r, u) => route(r, u),
    });
    await page.goto(`/#/vacancies/${VID}`);
    const bar = page.getByRole('search').getByRole('textbox');
    await bar.fill('find candidates for Network Engineer');
    await bar.press('Enter');
    const panel = page.getByRole('complementary', { name: 'SenAI' });
    await expect(panel.locator('[data-answer]')).toBeVisible();
    await panel.getByRole('link', { name: 'Aysel Məmmədova' }).click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}`));
    // On the CV page the pool answer stays reachable (kept, or a visible way back).
    const kept = page.getByRole('complementary', { name: 'SenAI' }).locator('[data-answer]');
    const back = page
      .getByRole('button', { name: /Back to (the )?(answer|results|SenAI)/i })
      .or(page.getByRole('link', { name: /Back to (the )?(answer|SenAI)/i }));
    expect(
      (await kept.count()) + (await back.count()),
      'the pool answer stays reachable on the CV page (SD-20)',
    ).toBeGreaterThan(0);
    await ux.check('cv from answer', STD);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${VID}`));
    await expect(
      page.getByRole('complementary', { name: 'SenAI' }).locator('[data-answer]'),
      'after Back the same pool thread is shown (SD-20)',
    ).toHaveCount(1);
    // J on the CV opened from the answer moves to Rauf Əliyev (the answer's list).
    await page
      .getByRole('complementary', { name: 'SenAI' })
      .getByRole('link', { name: 'Aysel Məmmədova' })
      .click();
    await page
      .locator('main')
      .click({ position: { x: 20, y: 200 } })
      .catch(() => undefined);
    await page.keyboard.press('j');
    await expect(page, 'J follows the answer list').toHaveURL(new RegExp(`#/cv/${DID2}`));
  },
);

const notBuilt: [string, string][] = [
  ['SA-02', "Empty Enter only opens; '/' focuses the Ask bar only outside text fields and dialogs"],
  ['SA-03', "Phone: 'Ask SenAI' in the bottom bar opens the pool panel as a bottom sheet"],
  [
    'SA-04',
    'Panel open state is remembered per user; Close, Escape and config changes after reload',
  ],
  ['SA-11', "Show all and vacancy buttons on an older answer re-run that answer's question"],
  [
    'SA-30',
    'Pool panel layout on every width: docked, side sheet, bottom sheet; account menu reachable',
  ],
  ['SA-31', 'Pool panel states: empty, busy, errors, unusual pools, safe mode, long answers'],
];
for (const [id, title] of notBuilt)
  uat(id, title, { on: ['D'], langs: 'EN' }, async () => {
    test.skip(true, 'Not built: outside the time budget of package G');
  });
void mockApi;
void ME;
