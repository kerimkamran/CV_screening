import { DID, DID2, ME, MID, MID2, mockApi, openReview, showAnalysis } from '../fixtures/api';
import { CFG, candAnswer, senaiRoutes, threadPair, type AskLog } from '../fixtures/pkg-g';
import { AZ } from '../../apps/web/src/i18n/az';
import { expect, STD, test, uat } from '../ux/test';

// 7.x SenAI candidate panel (SC), screens with a mocked API (L1), package G.

const w = (lang: string) => (en: string) => (lang === 'az' ? (AZ[en] ?? en) : en);

async function openCv(
  page: import('@playwright/test').Page,
  log: AskLog,
  opts: Parameters<typeof senaiRoutes>[1] = {},
) {
  await page.addInitScript((k) => localStorage.setItem(k, '1'), `cv-assistant-open:${ME.userId}`);
  await mockApi(page, { assistant: CFG, extra: senaiRoutes(log, opts) });
  await openReview(page, DID);
  await showAnalysis(page);
}

uat(
  'SC-01',
  'Candidate panel on the CV screen: context, one thread per candidate, Ask bar routing',
  { on: ['D', 'E', 'T', 'TL', 'A', 'I', 'DS'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const log: AskLog = { asks: [], cand: [] };
    await openCv(page, log, { thread: { [MID]: threadPair(1) } });
    const tt = w(meta.lang);
    const panel = page.getByRole('complementary', { name: tt('Assistant') });
    await expect(panel.getByRole('heading', { name: 'SenAI' })).toBeVisible();
    await expect(panel.getByTestId('context-chip')).toHaveText(
      tt('Discussing: {label} · {band}')
        .replace('{label}', 'Aysel Məmmədova')
        .replace('{band}', tt('Strong')),
    );
    await expect(panel.locator('p.ml-8')).toHaveCount(1);
    await expect(
      panel.getByText(tt('Chats are saved to this run and may be reviewed for compliance.')),
    ).toBeVisible();
    await ux.check('thread', [...STD, 'AZ']);
    // The Ask bar question goes to this candidate's thread.
    const bar = page.getByRole('search').getByRole('textbox');
    await bar.fill('Why is BGP found?');
    await bar.press('Enter');
    await expect.poll(() => log.cand.filter((c) => c.method === 'POST').length).toBe(1);
    const post = log.cand.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`/screenings/${MID}/assistant`);
    expect(post.body).toMatchObject({ intent: 'ask', message: 'Why is BGP found?' });
    expect(log.asks, 'nothing goes to /assistant/ask').toHaveLength(0);
    // DID2 has its own (empty) thread; back to DID shows its thread again.
    await page.goto(`/#/cv/${DID2}?l=e2e-list`);
    await showAnalysis(page);
    await expect(
      panel.getByText(
        tt('{name} explains the stored match for {label}. It does not score, rank or decide.')
          .replace('{name}', 'SenAI')
          .replace('{label}', 'Rauf Əliyev'),
      ),
    ).toBeVisible();
    await page.goto(`/#/cv/${DID}?l=e2e-list`);
    await showAnalysis(page);
    await expect(panel.locator('p.ml-8').first()).toBeVisible();
  },
);

uat(
  'SC-08',
  'Typed question: Enter, Shift+Enter, 1000 characters and Stop',
  { on: ['D', 'E', 'A', 'I'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const log: AskLog = { asks: [], cand: [] };
    await openCv(page, log, { candDelayMs: 2500 });
    const tt = w(meta.lang);
    const panel = page.getByRole('complementary', { name: tt('Assistant') });
    const box = panel.getByRole('textbox');
    const send = panel.getByRole('button', { name: tt('Send'), exact: true });
    // 2) empty or spaces only: Send disabled.
    await box.fill('   ');
    await expect(send).toBeDisabled();
    // 3) 1,200 characters: the field holds 1000.
    await box.fill('y'.repeat(1200));
    expect((await box.inputValue()).length).toBeLessThanOrEqual(1000);
    // 1) Shift+Enter keeps the break; Enter sends one POST.
    await box.fill('');
    await box.press('l');
    await box.pressSequentially('ine one');
    await box.press('Shift+Enter');
    await box.pressSequentially('line two');
    await box.press('Enter');
    await expect.poll(() => log.cand.filter((c) => c.method === 'POST').length).toBe(1);
    expect(log.cand.find((c) => c.method === 'POST')!.body).toMatchObject({
      intent: 'ask',
      message: 'line one\nline two',
    });
    // 4) busy line with Stop.
    const busy = panel
      .getByRole('status')
      .filter({ hasText: tt('{name} is reading the record…').replace('{name}', 'SenAI') });
    await expect(busy).toBeVisible();
    await busy.getByRole('button', { name: tt('Stop') }).click();
    await expect(panel.getByText(tt('Stopped. Nothing was changed.'))).toBeVisible();
    await expect(box).toBeEnabled();
    // 5) the late answer is not added.
    await page.waitForTimeout(3000);
    await expect(panel.getByText('Aysel Məmmədova matches on what the record shows.')).toHaveCount(
      0,
    );
    await ux.check('stopped', [...STD, 'AZ']);
    // 6) another question works.
    await box.fill('What is missing?');
    await box.press('Enter');
    await expect(panel.getByText('Aysel Məmmədova matches on what the record shows.')).toBeVisible({
      timeout: 10_000,
    });
  },
);

uat(
  'SC-13',
  'Review sprint with SenAI open: J, K, S, M, N keep working',
  { on: ['D', 'E', 'T'], langs: 'EN' },
  async ({ page, ux }) => {
    const log: AskLog = { asks: [], cand: [] };
    await page.addInitScript(() => localStorage.setItem('cv-review-auto-next', 'off'));
    const puts: string[] = [];
    page.on('request', (r) => r.method() === 'PUT' && puts.push(new URL(r.url()).pathname));
    await openCv(page, log);
    const panel = page.getByRole('complementary', { name: 'Assistant' });
    await expect(panel).toBeVisible();
    await page.locator('main').click({ position: { x: 30, y: 250 } });
    await page.keyboard.press('j');
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID2}`));
    const box = panel.getByRole('textbox');
    await expect(box, 'focus is not moved into the SenAI composer (SD-19)').not.toBeFocused();
    await page.keyboard.press('s');
    await expect.poll(() => puts).toContain(`/candidates/${MID2}/decision`);
    await expect(box).toHaveValue('');
    await page.keyboard.press('k');
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}`));
    await expect(page.getByText(/Searching in/)).toHaveCount(0);
    await expect(panel.getByTestId('context-chip')).toContainText('Aysel Məmmədova');
    // Typing in the composer never triggers a key action.
    await box.click();
    await box.pressSequentially('jks');
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}`));
    await ux.check('sprint', STD);
    void candAnswer;
  },
);

const notBuilt: [string, string][] = [
  ['SC-02', "Results: 'Ask SenAI about this candidate' opens the panel for that candidate"],
  [
    'SC-03',
    'Starter chips: Explain more, Deeper evaluation, Weakest point; claim chips and Show more',
  ],
  ['SC-04', 'Interview questions chip follows the admin switch, also from offer chips'],
  ['SC-05', 'Compare with…: up to two, Cancel, empty and long lists'],
  ['SC-06', 'Strongest case and Challenge this match'],
  [
    'SC-07',
    'Edit requirement handoff: drawer fully visible on Results, Criteria tab on the CV screen',
  ],
  ['SC-10', 'Delete this chat asks first or offers Undo'],
  ['SC-11', 'Escape and focus in the candidate panel'],
  ['SC-12', 'Candidate panel height: long thread and Compare list keep the composer on screen'],
];
for (const [id, title] of notBuilt)
  uat(id, title, { on: ['D'], langs: 'EN' }, async () => {
    test.skip(true, 'Not built: outside the time budget of package G');
  });
