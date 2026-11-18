import type { Page } from '@playwright/test';
import {
  DID,
  DID2,
  DOCS,
  ME,
  MID,
  MID2,
  mockApi,
  openReview,
  row,
  ROWS,
  showAnalysis,
  VID,
} from '../fixtures/api';
import { vacApi, vview } from '../fixtures/pkg-c';
import { AYSEL, crow, DVID, REQS, resultsApi, scrOf } from '../fixtures/pkg-d';
import {
  CFG,
  candAnswer,
  senaiAnswers,
  senaiRoutes,
  threadPair,
  type AskLog,
} from '../fixtures/pkg-g';
import { AZ } from '../../apps/web/src/i18n/az';
import { expect, STD, uat } from '../ux/test';

// 7.x SenAI candidate panel (SC), screens with a mocked API (L1), package G.

const w = (lang: string) => (en: string) => (lang === 'az' ? (AZ[en] ?? en) : en);

async function openCv(
  page: import('@playwright/test').Page,
  log: AskLog,
  opts: Parameters<typeof senaiRoutes>[1] = {},
) {
  await page.addInitScript((k) => {
    try {
      localStorage.setItem(k, '1');
    } catch {
      /* a blank page has no storage */
    }
  }, `cv-assistant-open:${ME.userId}`);
  await mockApi(page, { assistant: CFG, extra: senaiRoutes(log, opts) });
  await openReview(page, DID);
  await showAnalysis(page);
}

/** On a phone the panel is a bottom sheet over the page: what it covers is covered on purpose. */
const phoneSheet = (page: Page) => ({
  overlay: (page.viewportSize()?.width ?? 1280) < 640 ? 'aside' : undefined,
});

uat(
  'SC-01',
  'Candidate panel on the CV screen: context, one thread per candidate, Ask bar routing',
  { on: ['D', 'E', 'T', 'TL', 'A', 'I', 'DS'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const log: AskLog = { asks: [], cand: [] };
    await openCv(page, log, { thread: { [MID]: threadPair(1) } });
    const tt = w(meta.lang);
    const panel = page.getByRole('complementary', { name: 'SenAI' });
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
    await ux.check('thread', [...STD, 'AZ'], phoneSheet(page));
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
    const panel = page.getByRole('complementary', { name: 'SenAI' });
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
    await expect(panel.getByText(tt('Stopped. Nothing was changed.')).first()).toBeVisible();
    await expect(box).toBeEnabled();
    // 5) the late answer is not added.
    await page.waitForTimeout(3000);
    await expect(panel.getByText('Aysel Məmmədova matches on what the record shows.')).toHaveCount(
      0,
    );
    await ux.check('stopped', [...STD, 'AZ'], phoneSheet(page));
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
    const panel = page.getByRole('complementary', { name: 'SenAI' });
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
    await ux.check('sprint', STD, phoneSheet(page));
    void candAnswer;
  },
);

// ---------------------------------------------------------------- package G2: SC-02..07, 10..12

type Opts = Parameters<typeof senaiRoutes>[1] & {
  cfg?: Record<string, unknown>;
  /** Other analyzed candidates of the vacancy (for "Compare with…"). */
  others?: { label: string }[];
  /** The band of the open CV (DID). */
  band?: string;
};
const otherRow = (i: number, label: string) =>
  row(
    `01K0000000000000000000D${String(i).padStart(3, '0')}`,
    `01K0000000000000000000S${String(i).padStart(3, '0')}`,
    label,
    80 - i,
    i + 2,
  );

/** The CV screen of DID with the candidate panel open and the SenAI routes answered. */
async function cvWith(page: Page, log: AskLog, o: Opts = {}) {
  await page.addInitScript((k) => {
    try {
      localStorage.setItem(k, '1');
    } catch {
      /* a blank page has no storage */
    }
  }, `cv-assistant-open:${ME.userId}`);
  const route = senaiRoutes(log, o);
  await mockApi(page, {
    assistant: o.cfg ?? CFG,
    extra: async (r, u) => {
      if (u.pathname === '/candidates' && o.others) {
        await r.fulfill({
          json: {
            rows: [ROWS[0], ...o.others.map((x, i) => otherRow(i, x.label))],
            total: o.others.length + 1,
            counts: { byMark: { new: 1 }, outOfDate: 0, strong: 1 },
            nextCursor: null,
            asOf: new Date().toISOString(),
          },
        });
        return true;
      }
      if (u.pathname === `/documents/${DID}` && o.band) {
        const d = DOCS[DID] as { analysis: Record<string, unknown> };
        await r.fulfill({
          json: { ...d, analysis: { ...d.analysis, band: o.band, score: 60 } },
        });
        return true;
      }
      return route(r, u);
    },
  });
  await openReview(page, DID);
  await showAnalysis(page);
}
const cpanel = (page: Page, lang: string) => page.getByRole('complementary', { name: 'SenAI' });
const posts = (log: AskLog) => log.cand.filter((c) => c.method === 'POST');
const claim = (state: string, id: string, text: string, quote?: string) => ({
  text: `${text}: ${state.toLowerCase()}.`,
  source: id,
  ...(quote ? { quote } : {}),
  requirement: { id, text, state, candidate: 'Aysel Məmmədova' },
});
const rich = (over: Record<string, unknown> = {}) =>
  candAnswer({
    claims: [
      claim('Found', 'R1', 'BGP routing', 'BGP route reflectors'),
      claim('Partly found', 'R3', '5G transport experience'),
      claim('Not found in this CV', 'R4', 'CCIE certification'),
      claim('Unclear', 'R2', 'OSPF'),
    ],
    questions: [
      { text: 'Tell me about a recent BGP project.', source: 'R1' },
      { text: 'Which CCIE track did you prepare for?', source: 'R4' },
    ],
    facts: ['Score 88%', '3 of 4 must-haves found'],
    ...over,
  });

uat(
  'SC-02',
  "Results: 'Ask SenAI about this candidate' opens the panel for that candidate",
  { on: ['D', 'T', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    let cfg: Record<string, unknown> = CFG;
    const rows = [
      crow(1, { score: 92, name: 'Aysel Məmmədova' }),
      crow(2, { score: 60, name: 'Rauf Əliyev' }),
      crow(3, { score: null, state: 'manual', name: 'Leyla Həsənova' }),
    ];
    await resultsApi(page, {
      rows,
      answers: {
        'GET /assistant/config': () => cfg,
        ...senaiAnswers(log),
      },
    });
    await page.goto(`/#/vacancies/${DVID}/results`);
    // Below 1024 px the star map starts hidden: open it first (it sits behind the sheet on a phone).
    await expect(
      page.getByRole('heading', { level: 2, name: tt('Your constellation') }),
    ).toBeVisible();
    const showMap = page.getByRole('button', { name: tt('Show star map'), exact: true });
    if (await showMap.isVisible()) await showMap.click();
    const ask = tt('Ask {name} about this candidate').replace('{name}', 'SenAI');
    const strong = page.locator('article').filter({ hasText: 'Aysel Məmmədova' }).first();
    const btn = strong.getByRole('button', { name: ask });
    if (!(await btn.isVisible().catch(() => false)))
      await strong.getByRole('button').first().click();
    await expect(btn).toBeVisible();
    if (meta.touch)
      expect((await btn.boundingBox())!.height, 'Ask button ≥ 44 px').toBeGreaterThanOrEqual(44);
    await btn.click();
    const panel = cpanel(page, meta.lang);
    await expect(panel.getByTestId('context-chip')).toHaveText(
      tt('Discussing: {label} · {band}')
        .replace('{label}', 'Aysel Məmmədova')
        .replace('{band}', tt('Strong')),
    );
    await ux.check('ask about', [...STD, 'AZ'], phoneSheet(page));
    // 3) The Partial star: the context follows and the strongest-case chip is offered.
    const partialStar = page.locator('[data-testid="star-map"] button[data-star]').nth(1);
    // On a phone the sheet lies over the map: the person closes it to tap, so the tap is sent directly.
    if ((page.viewportSize()?.width ?? 1280) < 640) await partialStar.dispatchEvent('click');
    else await partialStar.click();
    await expect(panel.getByTestId('context-chip')).toHaveText(
      tt('Discussing: {label} · {band}')
        .replace('{label}', 'Rauf Əliyev')
        .replace('{band}', tt('Partial')),
    );
    await expect(
      panel.getByRole('button', { name: tt('What is the strongest case for this one?') }),
    ).toBeVisible();
    // 4) The human-look card: no Ask button, and no candidate thread for it.
    const human = page.locator('article').filter({ hasText: 'Leyla Həsənova' }).first();
    if (await human.count()) {
      await human.getByRole('button').first().click();
      await expect(human.getByRole('button', { name: ask })).toHaveCount(0);
      await expect(page.getByText(/Leyla Həsənova · /)).toHaveCount(0);
    }
    // 5) SenAI off: no Ask button anywhere.
    cfg = { ...CFG, enabled: false };
    await page.reload();
    await expect(page.locator('article').first()).toBeVisible();
    await expect(page.getByRole('button', { name: ask })).toHaveCount(0);
  },
);

uat(
  'SC-03',
  'Starter chips: Explain more, Deeper evaluation, Weakest point; claim chips and Show more',
  { on: ['D', 'A', 'I'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    await cvWith(page, log, {
      candDelayMs: 700,
      cand: () =>
        rich({
          cantSee: 'The CV does not say which BGP version was used.',
        }),
    });
    const panel = cpanel(page, meta.lang);
    const chips = panel.getByRole('list', { name: tt('Suggested questions') });
    // In AZ every chip label is Azerbaijani.
    for (const l of ['Explain more', 'Deeper evaluation', 'Weakest point', 'Interview questions'])
      await expect(chips.getByRole('button', { name: tt(l), exact: true })).toBeVisible();
    if (meta.lang === 'az')
      for (const l of ['Explain more', 'Deeper evaluation', 'Weakest point', 'Interview questions'])
        expect.soft(tt(l), `${l} is translated`).not.toBe(l);
    const want: [string, string][] = [
      ['Explain more', 'why'],
      ['Deeper evaluation', 'missing'],
      ['Weakest point', 'weakest'],
    ];
    for (const [k, [label, intent]] of want.entries()) {
      await chips.getByRole('button', { name: tt(label), exact: true }).click();
      await expect(
        chips.getByRole('button').first(),
        'chips are disabled while busy',
      ).toBeDisabled();
      await expect.poll(() => posts(log).length).toBe(k + 1);
      expect(posts(log)[k]!.body).toMatchObject({ intent, message: '', language: meta.lang });
      await expect(panel.locator('p.ml-8').nth(k)).toHaveText(tt(label));
      await expect(chips.getByRole('button').first()).toBeEnabled();
    }
    const ans = panel.locator('div.mr-4').last();
    await expect(ans.getByRole('button', { name: tt('AI'), exact: true })).toBeVisible();
    const claims = ans
      .getByRole('list', { name: tt('Where this comes from') })
      .getByRole('listitem');
    await expect(claims).toHaveCount(4);
    const marks = ['✓', '~', '✗', '?'];
    const words = ['Found', 'Partly found', 'Not found in this CV', 'Unclear'];
    for (let i = 0; i < 4; i++) {
      await expect(claims.nth(i)).toContainText(marks[i]!);
      await expect(claims.nth(i)).toContainText(tt(words[i]!));
    }
    await expect(ans.getByText(tt('What I can’t see:'))).toBeVisible();
    const more = ans.getByRole('button', { name: tt('Show more') });
    await more.click();
    await expect(ans.getByRole('button', { name: tt('Show less') })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(ans.getByText('BGP route reflectors')).toBeVisible();
    await expect(ans.locator('ol > li')).toHaveCount(2);
    await expect(
      ans.getByText(
        tt('From the record: {facts}').replace('{facts}', 'Score 88% | 3 of 4 must-haves found'),
      ),
    ).toBeVisible();
    await ux.check('answer', [...STD, 'AZ'], phoneSheet(page));
    await ans.getByRole('button', { name: tt('Show less') }).click();
    await expect(ans.locator('ol > li')).toHaveCount(0);
    // 5) The 'AI' badge is reachable by keyboard and by touch.
    const badge = ans.getByRole('button', { name: tt('AI'), exact: true });
    await badge.focus();
    await expect(badge).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(ans.getByText(tt('Written by an AI from the stored match'))).toBeVisible();
    if (meta.touch) {
      await badge.tap();
      await badge.tap();
      await expect(ans.getByText(tt('Written by an AI from the stored match'))).toBeVisible();
    }
  },
);

uat(
  'SC-04',
  'Interview questions chip follows the admin switch, also from offer chips',
  { on: ['D'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    let cfg: Record<string, unknown> = CFG;
    const refusal = {
      id: '01K000000000000000000TA900',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      content: candAnswer({
        kind: 'decline',
        headline: "That isn't related to the job requirements, so I can't use it.",
        claims: [],
        questions: [],
        cantSee: '',
        offer: ['Why this band?', 'What should I ask in the interview?'],
      }),
    };
    await cvWith(page, log, {
      cfg,
      thread: { [MID]: [threadPair(1)[0], refusal] },
      cand: (b) =>
        b.intent === 'interview'
          ? rich({ headline: 'Interview questions for Aysel Məmmədova.' })
          : candAnswer(),
    });
    const panel = cpanel(page, meta.lang);
    await panel.getByRole('button', { name: tt('Interview questions'), exact: true }).click();
    await expect.poll(() => posts(log).length).toBe(1);
    expect(posts(log)[0]!.body).toMatchObject({ intent: 'interview' });
    const ans = panel.locator('div.mr-4').last();
    await expect(ans).toContainText('Interview questions for Aysel Məmmədova.');
    await ans.getByRole('button', { name: tt('Show more') }).click();
    await expect(ans.locator('ol > li')).toHaveCount(2);
    await ux.check('interview', [...STD, 'AZ'], phoneSheet(page));
    // 3) Interview switched off: no chip after a reload.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    cfg = { ...CFG, features: { ...CFG.features, interview: false } };
    await cvWith(page, log, {
      cfg,
      thread: { [MID]: [threadPair(1)[0], refusal] },
      cand: () => candAnswer(),
    });
    await page.reload();
    await showAnalysis(page);
    await expect(panel.getByTestId('context-chip')).toBeVisible();
    await expect(
      panel.getByRole('button', { name: tt('Interview questions'), exact: true }),
    ).toHaveCount(0);
    // 4) The offer chip under the refusal does not get round the switch.
    const before = posts(log).length;
    const offer = panel.getByRole('button', { name: tt('What should I ask in the interview?') });
    if (await offer.count()) {
      await offer.click();
      await page.waitForTimeout(500);
      const sent = posts(log).slice(before);
      expect(
        sent.filter((x) => x.body?.intent === 'ask'),
        'no free question is counted (SD-115)',
      ).toHaveLength(0);
    }
    await expect(
      offer,
      'the interview offer is hidden while interview is off (SD-115)',
    ).toHaveCount(0);
    await expect(panel.getByRole('button', { name: tt('Why this band?') })).toBeVisible();
  },
);

uat(
  'SC-05',
  'Compare with…: up to two, Cancel, empty and long lists',
  { on: ['D', 'T'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    const cmp = () =>
      candAnswer({
        headline: 'Side by side on the same requirements.',
        about: ['Aysel Məmmədova', 'Rauf Əliyev'],
        claims: [
          {
            ...claim('Found', 'R1', 'BGP routing'),
            requirement: {
              id: 'R1',
              text: 'BGP routing',
              state: 'Found',
              candidate: 'Aysel Məmmədova',
            },
          },
          {
            ...claim('Not found in this CV', 'R1', 'BGP routing'),
            requirement: {
              id: 'R1',
              text: 'BGP routing',
              state: 'Not found in this CV',
              candidate: 'Rauf Əliyev',
            },
          },
        ],
      });
    // 1) No others: no chip.
    await cvWith(page, log, { others: [], cand: cmp });
    const panel = cpanel(page, meta.lang);
    await expect(panel.getByTestId('context-chip')).toBeVisible();
    await expect(panel.getByRole('button', { name: tt('Compare with…') })).toHaveCount(0);
    // 2) Two others.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await cvWith(page, log, {
      others: [{ label: 'Rauf Əliyev' }, { label: 'Leyla Həsənova' }],
      cand: cmp,
    });
    await page.reload();
    await showAnalysis(page);
    await panel.getByRole('button', { name: tt('Compare with…') }).click();
    const legend = tt('Compare {label} with (up to 2)').replace('{label}', 'Aysel Məmmədova');
    const fs = panel.getByRole('group', { name: legend });
    await expect(fs).toBeVisible();
    await fs.getByRole('checkbox', { name: 'Rauf Əliyev' }).check();
    await fs.getByRole('button', { name: tt('Compare'), exact: true }).click();
    await expect.poll(() => posts(log).length).toBe(1);
    expect(posts(log)[0]!.body).toMatchObject({
      intent: 'compare',
      compareWith: ['01K0000000000000000000S000'],
    });
    await expect(panel.locator('p.ml-8').last()).toHaveText(tt('Compare these candidates'));
    const chips = panel.locator('div.mr-4').last().getByRole('listitem');
    await expect(chips.first()).toContainText('Aysel Məmmədova: ');
    await expect(chips.nth(1)).toContainText('Rauf Əliyev: ');
    await ux.check('compared', [...STD, 'AZ'], phoneSheet(page));
    // 5) Cancel: chips return, nothing sent.
    await panel.getByRole('button', { name: tt('Compare with…') }).click();
    await panel.getByRole('button', { name: tt('Cancel') }).click();
    await expect(panel.getByRole('button', { name: tt('Compare with…') })).toBeVisible();
    expect(posts(log)).toHaveLength(1);
    // 4) and 6) 35 others with two equal names: at most two ticks, all reachable, names told apart.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const many = Array.from({ length: 35 }, (_, i) => ({
      label: i === 3 || i === 30 ? 'Aysel Mammadova' : `Person ${String(i + 1).padStart(2, '0')}`,
    }));
    await cvWith(page, log, { others: many, cand: cmp });
    await page.reload();
    await showAnalysis(page);
    await panel.getByRole('button', { name: tt('Compare with…') }).click();
    const boxes = fs.getByRole('checkbox');
    await expect(boxes, 'all 35 can be reached (SD-116)').toHaveCount(35);
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(boxes.nth(2), 'the third checkbox is disabled after two').toBeDisabled();
    const twins = fs.locator('label').filter({ hasText: 'Aysel Mammadova' });
    await expect(twins).toHaveCount(2);
    expect(await twins.nth(0).innerText(), 'the two equal names are told apart').not.toBe(
      await twins.nth(1).innerText(),
    );
    await boxes.nth(34).scrollIntoViewIfNeeded();
    await expect(boxes.nth(34)).toBeInViewport();
    await expect(fs.getByRole('button', { name: tt('Compare'), exact: true })).toBeInViewport();
    await expect(fs.getByRole('button', { name: tt('Cancel') })).toBeInViewport();
    await ux.check('long list', [...STD, 'AZ'], phoneSheet(page));
  },
);

uat(
  'SC-06',
  'Strongest case and Challenge this match',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    const STRONGEST = tt('What is the strongest case for this one?');
    let n = 0;
    const cand = (b: any) =>
      b.intent === 'challenge' ? candAnswer({ outcome: ++n === 1 ? 'gap' : 'held' }) : candAnswer();
    // 1) A Strong CV: no strongest chip.
    await cvWith(page, log, { cand });
    const panel = cpanel(page, meta.lang);
    await expect(panel.getByTestId('context-chip')).toBeVisible();
    await expect(panel.getByRole('button', { name: STRONGEST })).toHaveCount(0);
    // 2) A Partial CV.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await cvWith(page, log, { cand, band: 'partial' });
    await page.reload();
    await showAnalysis(page);
    await panel.getByRole('button', { name: STRONGEST }).click();
    await expect.poll(() => posts(log).length).toBe(1);
    expect(posts(log)[0]!.body).toMatchObject({ intent: 'strongest' });
    // 3) Challenge with a 420-character read: 400 kept and sent.
    await panel.getByRole('button', { name: tt('Challenge this match') }).click();
    const read = panel.getByLabel(tt('Your own read (optional)'));
    await read.fill('r'.repeat(420));
    expect((await read.inputValue()).length).toBe(400);
    await ux.check('challenge form', [...STD, 'AZ'], phoneSheet(page));
    await panel.getByRole('button', { name: tt('Challenge this match') }).click();
    await expect.poll(() => posts(log).length).toBe(2);
    expect(posts(log)[1]!.body).toMatchObject({ intent: 'challenge', read: 'r'.repeat(400) });
    await expect(panel.locator('p.ml-8').last()).toHaveText(tt('Challenge this match'));
    await expect(panel.getByText(tt('A gap was found in the evidence.'))).toBeVisible();
    // 4) Again with an empty read: no read is sent.
    await panel.getByRole('button', { name: tt('Challenge this match') }).click();
    await panel.getByRole('button', { name: tt('Challenge this match') }).click();
    await expect.poll(() => posts(log).length).toBe(3);
    expect(posts(log)[2]!.body.read).toBeUndefined();
    await expect(panel.getByText(tt('The match held up.'))).toBeVisible();
    // 5) Open and Cancel: chips back, nothing sent.
    await panel.getByRole('button', { name: tt('Challenge this match') }).click();
    await panel.getByRole('button', { name: tt('Cancel') }).click();
    await expect(panel.getByRole('button', { name: STRONGEST })).toBeVisible();
    expect(posts(log)).toHaveLength(3);
    // 6) Challenge switched off: the dashed chip is gone.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await cvWith(page, log, {
      cand,
      band: 'partial',
      cfg: { ...CFG, features: { ...CFG.features, challenge: false } },
    });
    await page.reload();
    await showAnalysis(page);
    await expect(panel.getByRole('button', { name: STRONGEST })).toBeVisible();
    await expect(panel.getByRole('button', { name: tt('Challenge this match') })).toHaveCount(0);
  },
);

uat(
  'SC-07',
  'Edit requirement handoff: drawer fully visible on Results, Criteria tab on the CV screen',
  { on: ['D', 'DS', 'T'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    const CCIE = REQS[2].id;
    const handoff = () =>
      candAnswer({
        handoff: [{ requirementId: CCIE, text: 'CCIE certification', to: 'preferred' }],
      });
    await page.addInitScript((k) => {
      try {
        localStorage.setItem(k, '1');
      } catch {
        /* a blank page has no storage */
      }
    }, `cv-assistant-open:${AYSEL.userId}`);
    const previews: unknown[] = [];
    await resultsApi(page, {
      rows: [
        crow(1, { score: 92, name: 'Aysel Məmmədova' }),
        crow(2, { score: 75, name: 'Rauf Əliyev' }),
      ],
      assistant: CFG,
      answers: {
        [`POST /vacancies/${DVID}/adjustments/preview`]: (
          _r: unknown,
          _u: unknown,
          _m: unknown,
          b: unknown,
        ) => {
          previews.push(b);
          return { scores: {} };
        },
        ...senaiAnswers(log, { cand: handoff }),
      },
    });
    await page.goto(`/#/vacancies/${DVID}/results`);
    const panel = cpanel(page, meta.lang);
    await expect(panel.getByTestId('context-chip')).toContainText('Aysel Məmmədova');
    const box = panel.getByRole('textbox');
    await box.fill('Why is CCIE not found?');
    await box.press('Enter');
    const edit = panel.getByRole('button', {
      name: tt('Edit requirement: {text}').replace('{text}', 'CCIE certification'),
    });
    await edit.click();
    await expect.poll(() => previews.length).toBe(1);
    expect(previews[0]).toEqual({ requirementId: CCIE, to: 'preferred' });
    // 2) The drawer is fully visible: every probe hits the drawer, not the SenAI panel.
    const drawer = page.getByRole('dialog', { name: tt('Requirements') });
    await expect(drawer).toBeVisible();
    const misses = await drawer.evaluate((d) => {
      const r = d.getBoundingClientRect();
      const out: string[] = [];
      for (const fx of [0.1, 0.5, 0.9])
        for (const fy of [0.1, 0.5, 0.9]) {
          const x = r.left + r.width * fx;
          const y = Math.min(innerHeight - 2, r.top + r.height * fy);
          const h = document.elementFromPoint(x, y);
          if (!h || !d.contains(h)) out.push(`${Math.round(x)},${Math.round(y)}`);
        }
      return out;
    });
    expect(misses, 'every probe hits the drawer (SD-17)').toEqual([]);
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('dialog')),
      'focus moves into the drawer',
    ).toBe(true);
    await expect(drawer.locator(`#req-row-${CCIE}`)).toBeInViewport();
    await expect(drawer.getByText(/CCIE certification/).first()).toBeVisible();
    await expect(
      page.getByText(
        new RegExp(
          tt(
            'What if “{text}” were nice-to-have: {line} Nothing changes until you choose it below.',
          )
            .split('{line}')[0]!
            .replace('{text}', 'CCIE certification')
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        ),
      ),
    ).toBeVisible();
    await ux.check('drawer', STD, { overlay: 'dialog[open]' });
    // 3) Close the drawer.
    await drawer.getByRole('button', { name: tt('Close'), exact: true }).click();
    await expect(drawer).toHaveCount(0);
    // 4) On the CV screen the same button opens the Criteria tab.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto('about:blank'); // a hash-only change would keep the Results page and its panel
    // On the CV screen the requirement ids are the CV fixture's (R4 is 'CCIE certification').
    await openCv(page, log, {
      cand: () =>
        candAnswer({
          handoff: [{ requirementId: 'R4', text: 'CCIE certification', to: 'preferred' }],
        }),
    });
    await expect(cpanel(page, meta.lang).getByTestId('context-chip')).toContainText(
      'Aysel Məmmədova',
    );
    await cpanel(page, meta.lang).getByRole('textbox').fill('Why is CCIE not found?');
    await cpanel(page, meta.lang).getByRole('textbox').press('Enter');
    const editCv = cpanel(page, meta.lang).getByRole('button', {
      name: tt('Edit requirement: {text}').replace('{text}', 'CCIE certification'),
    });
    await editCv.click();
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${VID}/criteria`));
    const covered = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      if (!aside) return [];
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        'main button, main input, main select, main a[href]',
      )) {
        const b = el.getBoundingClientRect();
        if (!b.width || b.top < 57 || b.top > innerHeight) continue;
        const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (h && aside.contains(h)) out.push(el.innerText.slice(0, 30));
      }
      return out;
    });
    expect(covered, 'the panel does not cover the form').toEqual([]);
  },
);

uat(
  'SC-10',
  'Delete this chat asks first or offers Undo',
  { on: ['D', 'T', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    const thread: Record<string, unknown[]> = {
      [MID]: [...threadPair(1), threadPair(2, 'What is missing?')[0]!],
    };
    await cvWith(page, log, { thread, candDelayMs: 2500 });
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && r.url().includes(`/screenings/${MID}/assistant`))
        delete thread[MID];
    });
    const panel = cpanel(page, meta.lang);
    await expect(panel.locator('p.ml-8')).toHaveCount(2);
    const dels = () => log.cand.filter((c) => c.method === 'DELETE');
    const del = panel.getByRole('button', { name: tt('Delete this chat'), exact: true });
    if (meta.touch) expect((await del.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // 1) A confirmation (or Undo) and no DELETE yet.
    await del.click();
    const ask = panel.getByRole('alertdialog').or(panel.getByRole('button', { name: /Undo|Geri/ }));
    await expect(ask, 'a confirmation or Undo appears (SD-24)').toBeVisible();
    expect(dels(), 'no DELETE before confirming').toHaveLength(0);
    await ux.check('confirm', [...STD, 'AZ'], phoneSheet(page));
    // 2) Cancel: the thread stays.
    await panel.getByRole('button', { name: tt('Cancel') }).click();
    await expect(panel.locator('p.ml-8')).toHaveCount(2);
    // 3) Delete and confirm.
    await del.click();
    await panel
      .getByRole('alertdialog')
      .getByRole('button', { name: tt('Delete') })
      .click();
    await expect.poll(() => dels().length).toBe(1);
    expect(dels()[0]!.url).toBe(`/screenings/${MID}/assistant`);
    await expect(
      panel.getByText(
        tt('{name} explains the stored match for {label}. It does not score, rank or decide.')
          .replace('{name}', 'SenAI')
          .replace('{label}', 'Aysel Məmmədova'),
      ),
    ).toBeVisible();
    // 4) Reload: still empty.
    await page.reload();
    await showAnalysis(page);
    await expect(panel.getByTestId('context-chip')).toBeVisible();
    await expect(panel.locator('p.ml-8')).toHaveCount(0);
    // 5) Delete while an answer is on its way: the late answer is not added.
    await panel.getByRole('textbox').fill('Why this band?');
    await panel.getByRole('textbox').press('Enter');
    await panel.getByRole('button', { name: tt('Delete this chat'), exact: true }).click();
    await panel
      .getByRole('alertdialog')
      .getByRole('button', { name: tt('Delete') })
      .click();
    await page.waitForTimeout(3000);
    await expect(panel.getByText('Aysel Məmmədova matches on what the record shows.')).toHaveCount(
      0,
    );
  },
);

uat(
  'SC-11',
  'Escape and focus in the candidate panel',
  { on: ['D', 'E'], langs: 'EN' },
  async ({ page, ux }) => {
    const log: AskLog = { asks: [], cand: [] };
    const long = Array.from({ length: 6 }, (_, i) => threadPair(i + 1)).flat();
    await cvWith(page, log, { thread: { [MID]: long }, others: [{ label: 'Rauf Əliyev' }] });
    const panel = cpanel(page, 'en');
    const bar = page.getByRole('search').getByRole('textbox');
    // 1) Escape in the composer closes the panel; focus back on the Ask bar.
    await panel.getByRole('textbox').press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(bar).toBeFocused();
    await bar.press('Enter');
    await expect(panel).toBeVisible();
    // 2) The Compare picker: the first Escape closes only the picker.
    await panel.getByRole('button', { name: 'Compare with…' }).click();
    await panel.getByRole('checkbox').first().focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('checkbox')).toHaveCount(0);
    // 3) The Challenge form: the typed read is kept; a second Escape closes the panel.
    await panel.getByRole('button', { name: 'Challenge this match' }).click();
    await panel.getByLabel('Your own read (optional)').fill('She led the BGP migration.');
    await page.keyboard.press('Escape');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Challenge this match' }).click();
    await expect(panel.getByLabel('Your own read (optional)')).toHaveValue(
      'She led the BGP migration.',
    );
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await panel.getByRole('textbox').focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await bar.press('Enter');
    // 4) Tab order: Close, conversation, chips, composer, Send, Delete this chat.
    // Send is only in the order when there is something to send.
    await panel.getByRole('textbox').fill('Why this band?');
    await panel.getByRole('button', { name: 'Close' }).focus();
    const order: string[] = [];
    for (let i = 0; i < 40 && order.length < 40; i++) {
      await page.keyboard.press('Tab');
      const d = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        if (!a?.closest('aside')) return null;
        const label = a.getAttribute('aria-label') || a.innerText || a.tagName;
        const cs = getComputedStyle(a);
        const ring = cs.outlineStyle !== 'none' || cs.boxShadow !== 'none';
        return { label: label.trim().slice(0, 40), tag: a.tagName, ring };
      });
      if (!d) break;
      order.push(`${d.tag}:${d.label}`);
      expect.soft(d.ring, `visible focus ring on ${d.label}`).toBe(true);
    }
    const idx = (re: RegExp) => order.findIndex((x) => re.test(x));
    expect(idx(/:Conversation/), 'the conversation is focusable (SD-118)').toBeGreaterThan(-1);
    const seq = [/:Conversation/, /:Explain more/, /^TEXTAREA/, /:Send/, /:Delete this chat/].map(
      idx,
    );
    expect(
      seq.every((x) => x >= 0),
      `order ${order.join(' | ')}`,
    ).toBe(true);
    expect(
      [...seq].sort((a, b) => a - b),
      'tab order',
    ).toEqual(seq);
    // 5) The conversation scrolls with the arrow keys.
    const conv = panel.getByRole('region', { name: 'Conversation' });
    await conv.evaluate((el) => (el.scrollTop = 0));
    await conv.focus();
    await page.keyboard.press('PageDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => conv.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await ux.check('focus', STD, phoneSheet(page));
  },
);

uat(
  'SC-12',
  'Candidate panel height: long thread and Compare list keep the composer on screen',
  { on: ['D', 'DS', 'T', 'TL'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    const longAns = (n: number) => ({
      id: `01K000000000000000000TL${String(n).padStart(3, '0')}`,
      role: 'assistant',
      createdAt: new Date().toISOString(),
      content: candAnswer({
        headline: `Answer ${n}: ${'BGP route reflectors and OSPF areas. '.repeat(8)}`,
      }),
    });
    const thread = Array.from({ length: 12 }, (_, i) => [
      threadPair(i + 1)[0],
      longAns(i + 1),
    ]).flat();
    const others = Array.from({ length: 30 }, (_, i) => ({ label: `Person ${i + 1}` }));
    const measure = async (where: string) => {
      const panel = cpanel(page, meta.lang);
      await expect(panel.locator('div.mr-4')).toHaveCount(12);
      const m = await panel.evaluate((el) => el.getBoundingClientRect().bottom - innerHeight);
      expect(m, `${where}: the aside ends inside the viewport`).toBeLessThanOrEqual(1);
      await expect(panel.getByRole('textbox')).toBeInViewport();
      await expect(panel.getByRole('button', { name: tt('Send'), exact: true })).toBeInViewport();
      await expect(
        panel.getByRole('button', { name: tt('Delete this chat'), exact: true }),
      ).toBeInViewport();
      const conv = panel.locator(`[aria-label="${tt('Conversation')}"]`);
      expect(await conv.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      const b = (await conv.boundingBox())!;
      const t0 = await conv.evaluate((el) => (el.scrollTop = 0));
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.wheel(0, 400);
      await expect
        .poll(
          () => conv.evaluate((el) => el.scrollTop),
          `${where}: the wheel scrolls the conversation`,
        )
        .toBeGreaterThan(t0);
      await ux.check(`${where} thread`, STD, phoneSheet(page));
      await panel.getByRole('button', { name: tt('Compare with…') }).click();
      await expect(
        panel.getByRole('button', { name: tt('Compare'), exact: true }),
      ).toBeInViewport();
      await expect(panel.getByRole('button', { name: tt('Cancel') })).toBeInViewport();
      await expect(panel.getByRole('textbox')).toBeInViewport();
      const list = panel.getByRole('checkbox').last();
      await list.scrollIntoViewIfNeeded();
      await expect(list).toBeInViewport();
      await ux.check(`${where} compare`, STD, phoneSheet(page));
    };
    await cvWith(page, log, { thread: { [MID]: thread }, others });
    await measure('CV');
    // 5) The same on Results.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.addInitScript((k) => {
      try {
        localStorage.setItem(k, '1');
      } catch {
        /* a blank page has no storage */
      }
    }, `cv-assistant-open:${AYSEL.userId}`);
    const rows = Array.from({ length: 31 }, (_, i) => crow(i + 1, { score: 95 - i }));
    await resultsApi(page, {
      rows,
      assistant: CFG,
      answers: senaiAnswers(log, { thread: { [scrOf(1)]: thread } }),
    });
    await page.goto(`/#/vacancies/${DVID}/results`);
    await measure('Results');
  },
);

uat(
  'RQ-05',
  "'Edit requirement' from SenAI opens the drawer fully visible above the SenAI panel",
  { on: ['D', 'DS'], langs: 'EN+AZ', timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    const CCIE = REQS[2].id;
    const previews: unknown[] = [];
    const seenAdj: string[] = [];
    await page.addInitScript((k) => {
      try {
        localStorage.setItem(k, '1');
      } catch {
        /* a blank page has no storage */
      }
    }, `cv-assistant-open:${AYSEL.userId}`);
    const { seen } = await resultsApi(page, {
      rows: [
        crow(1, { score: 92, name: 'Aysel Məmmədova' }),
        crow(2, { score: 75, name: 'Rauf Əliyev' }),
      ],
      assistant: CFG,
      answers: {
        [`POST /vacancies/${DVID}/adjustments/preview`]: async (
          _r: unknown,
          _u: unknown,
          _m: unknown,
          b: unknown,
        ) => {
          await new Promise((r) => setTimeout(r, 900));
          previews.push(b);
          return { scores: {} };
        },
        ...senaiAnswers(log, {
          cand: () =>
            candAnswer({
              handoff: [{ requirementId: CCIE, text: 'CCIE certification', to: 'preferred' }],
            }),
        }),
      },
    });
    const edit = () =>
      cpanel(page, meta.lang).getByRole('button', {
        name: tt('Edit requirement: {text}').replace('{text}', 'CCIE certification'),
      });
    const drawer = page.getByRole('dialog', { name: tt('Requirements') });
    const what = new RegExp(
      tt('What if “{text}” were nice-to-have: {line} Nothing changes until you choose it below.')
        .split('{line}')[0]!
        .replace('{text}', 'CCIE certification')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    /** Every probe at the drawer's Close, its radios and Back to original hits the drawer itself. */
    const onTop = () =>
      drawer.evaluate((d) => {
        const bad: string[] = [];
        const probes = [...d.querySelectorAll<HTMLElement>('button, input[type=radio]')];
        for (const el of probes) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const y = Math.min(innerHeight - 2, r.top + r.height / 2);
          const h = document.elementFromPoint(r.left + r.width / 2, y);
          if (!h || !d.contains(h))
            bad.push(el.getAttribute('aria-label') ?? el.textContent ?? el.tagName);
        }
        return { bad, n: probes.length };
      });
    const scenario = async (size: string) => {
      previews.length = 0;
      await page.goto('about:blank');
      await page.goto(`/#/vacancies/${DVID}/results`);
      const panel = cpanel(page, meta.lang);
      await expect(panel.getByTestId('context-chip')).toContainText('Aysel Məmmədova');
      const box = panel.getByRole('textbox');
      await box.fill('Why is CCIE not found?');
      await box.press('Enter');
      // 2) The button opens the drawer; while the preview is out the note says so.
      await edit().click();
      await expect(drawer).toBeVisible();
      await expect(
        drawer.getByText(tt('Checking what this would change…')),
        `${size}: checking note`,
      ).toBeVisible();
      await expect.poll(() => previews.length, { message: `${size}: preview asked` }).toBe(1);
      await expect(page.getByText(what), `${size}: what-if note`).toBeVisible();
      const top = await onTop();
      expect(top.n, 'Close, three radios per requirement and Back to original').toBeGreaterThan(5);
      expect(top.bad, `${size}: every control is above the SenAI panel`).toEqual([]);
      const group = drawer.locator(`#req-row-${CCIE}`);
      await expect(group, `${size}: the group is pointed at`).toHaveClass(/border-accent/);
      await expect(
        group.locator('input:checked'),
        `${size}: its checked radio has focus`,
      ).toBeFocused();
      await ux.check(`drawer ${size}`, STD, { overlay: 'dialog[open]' });
      // Nothing is saved until a radio is chosen.
      seenAdj.length = 0;
      seenAdj.push(
        ...seen.requests
          .filter((r) => r.method === 'POST' && /\/adjustments(\/reset)?$/.test(r.url))
          .map((r) => r.url),
      );
      expect(seenAdj, `${size}: no adjustment saved by opening`).toEqual([]);
    };
    // 1) At the project's screen size.
    await scenario(`${page.viewportSize()!.width} px`);
    // 3) The same at 1024 x 768.
    await page.setViewportSize({ width: 1024, height: 768 });
    await scenario('1024 px');
    // 4) Close and open it again with the Requirements button: the earlier what-if is gone.
    await drawer.getByRole('button', { name: tt('Close'), exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await page
      .getByRole('button', { name: new RegExp(`^${tt('Requirements')}`) })
      .first()
      .click();
    await expect(drawer).toBeVisible();
    await expect(page.getByText(what), 'the earlier what-if note is gone').toHaveCount(0);
    await expect(drawer.locator(`#req-row-${CCIE}`)).not.toHaveClass(/border-accent/);
    expect(
      seen.requests.filter((r) => r.method === 'POST' && /\/adjustments(\/reset)?$/.test(r.url)),
      'still nothing saved',
    ).toHaveLength(0);
    await ux.check('drawer reopened', STD, { overlay: 'dialog[open]' });
  },
);
