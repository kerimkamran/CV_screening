import type { Page } from '@playwright/test';
import { DID, DID2, ME, mockApi, openReview, showAnalysis, VID } from '../fixtures/api';
import { vacApi, vview } from '../fixtures/pkg-c';
import { DVID, resultsApi } from '../fixtures/pkg-d';
import { CFG, poolAnswer, senaiAnswers, senaiRoutes, type AskLog } from '../fixtures/pkg-g';
import { press } from '../fixtures/pkg-h';
import { AZ } from '../../apps/web/src/i18n/az';
import { expect, STD, uat } from '../ux/test';

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
    await ux.check('cv from answer', STD, {
      overlay: (page.viewportSize()?.width ?? 1280) < 640 ? 'aside' : undefined,
    });
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

// ---------------------------------------------------------------- package G2: SA-02..04, 11, 30, 31

/** The vacancy page (Network Engineer) with the SenAI routes on top. */
async function onVacancy(
  page: Page,
  log: AskLog,
  opts: Parameters<typeof senaiRoutes>[1] & { me?: Record<string, unknown>; cfg?: unknown } = {},
) {
  const route = senaiRoutes(log, opts);
  return vacApi(page, {
    me: opts.me,
    assistant: (opts.cfg as Record<string, unknown>) ?? CFG,
    views: [vview({ id: VID, title: 'Network Engineer' })],
    extra: (r, u) => route(r, u),
  });
}
const pool = (page: Page) => page.getByRole('complementary', { name: 'SenAI' });

uat(
  'SA-02',
  "Empty Enter only opens; '/' focuses the Ask bar only outside text fields and dialogs",
  { on: ['D', 'E', 'DS', 'T'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const log: AskLog = { asks: [], cand: [] };
    await onVacancy(page, log);
    await page.goto('/#/vacancies');
    const tt = w(meta.lang);
    const bar = page.getByRole('search').getByRole('textbox');
    // 1) Empty Enter opens the panel, sends nothing and puts the focus in the composer.
    await bar.click();
    await bar.press('Enter');
    await expect(pool(page)).toBeVisible();
    await expect(pool(page).getByRole('textbox')).toBeFocused();
    expect(log.asks, 'empty Enter sends nothing').toHaveLength(0);
    await ux.check('empty enter', STD);
    // 2) Close; 3) '/' on the page body focuses the Ask bar and types nothing; 4) typing goes there.
    await pool(page)
      .getByRole('button', { name: tt('Close'), exact: true })
      .click();
    await expect(pool(page)).toHaveCount(0);
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(bar).toBeFocused();
    await expect(bar).toHaveValue('');
    await page.keyboard.type('Excel');
    await expect(bar).toHaveValue('Excel');
    await bar.fill('');
    // 5) In the vacancy search field '/' is typed.
    const search = page
      .getByRole('main')
      .getByRole('searchbox')
      .or(page.getByRole('main').getByRole('textbox'))
      .first();
    await search.click();
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('/');
    // 6) The language select in the account menu keeps the focus.
    await page.getByLabel(tt('Account menu')).click();
    const sel = page.getByRole('combobox').first();
    await sel.focus();
    await page.keyboard.press('/');
    await expect(sel, "the select keeps the focus on '/' (SD-111)").toBeFocused();
    await page.keyboard.press('Escape');
    // 7) The full-screen CV viewer keeps the focus.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockApi(page, { assistant: CFG, extra: senaiRoutes(log) });
    await openReview(page, DID);
    await showAnalysis(page);
    const full = page.getByRole('button', { name: tt('Full screen') }).first();
    if (await full.isVisible().catch(() => false)) {
      await full.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('/');
      await expect(bar, 'full screen: the Ask bar stays unfocused').not.toBeFocused();
      expect(
        await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"],dialog')),
        'full screen: the focus stays in the viewer',
      ).toBe(true);
      await page.keyboard.press('Escape');
    }
    // 8) The Requirements drawer on Results keeps the focus.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { assistant: CFG, answers: senaiAnswers(log) });
    await page.goto(`/#/vacancies/${DVID}/results`);
    await page.getByRole('button', { name: tt('Requirements'), exact: true }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('/');
    await expect(bar, 'drawer: the Ask bar stays unfocused').not.toBeFocused();
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('dialog')),
      'drawer: the focus stays in the drawer',
    ).toBe(true);
    await ux.check('drawer', STD, { overlay: 'dialog[open]' });
  },
);

uat(
  'SA-03',
  "Phone: 'Ask SenAI' in the bottom bar opens the pool panel as a bottom sheet",
  { on: ['A', 'I'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    const big = poolAnswer({
      rows: Array.from({ length: 12 }, (_, i) => ({
        ...poolAnswer().rows[i % 2],
        matchId: `01K00000000000000000000R${String(i).padStart(2, '0')}`,
        label: `Person ${i + 1}`,
      })),
    });
    await onVacancy(page, log, { ask: () => big });
    await page.goto('/#/vacancies');
    const bottom = page.getByRole('navigation', { name: tt('Main') }).last();
    const item = bottom.getByRole('button', {
      name: tt('Ask {name}').replace('{name}', 'SenAI'),
    });
    await expect(item).toBeVisible();
    expect((await item.boundingBox())!.height, 'bottom-bar item ≥ 44 px').toBeGreaterThanOrEqual(
      44,
    );
    await item.tap();
    const sheet = pool(page);
    await expect(sheet).toBeVisible();
    // 2) The sheet: fixed to the bottom, full width, at most 85% of the visual viewport, rounded top.
    const m = await sheet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const vv = window.visualViewport ?? { height: innerHeight, width: innerWidth };
      return {
        pos: cs.position,
        left: r.left,
        width: r.width,
        vw: innerWidth,
        h: r.height,
        vh: vv.height,
        bottom: r.bottom,
        ih: innerHeight,
        radius: parseFloat(cs.borderTopLeftRadius) + parseFloat(cs.borderTopRightRadius),
      };
    });
    expect(m.pos).toBe('fixed');
    expect(Math.round(m.left)).toBe(0);
    expect(Math.round(m.width)).toBe(m.vw);
    expect(m.h, 'height ≤ 85% of the visual viewport').toBeLessThanOrEqual(m.vh * 0.85 + 1);
    expect(m.radius, 'top corners rounded').toBeGreaterThan(0);
    const bb = await bottom.boundingBox();
    // PLAN: 'covers the bottom bar while open' — the sheet sits right above the bottom bar, which
    // stays usable; nothing overlaps (OVL), so the person keeps both.
    expect(m.bottom, 'the sheet ends where the bottom bar starts').toBeLessThanOrEqual(bb!.y + 1);
    // 3) Compose and send: composer and Send inside the viewport.
    const box = sheet.getByRole('textbox');
    await box.tap();
    await box.fill('find candidates for Network Engineer');
    await sheet.getByRole('button', { name: tt('Send'), exact: true }).tap();
    await expect(sheet.locator('[data-answer]')).toBeVisible();
    await expect(box).toBeInViewport();
    await expect(sheet.getByRole('button', { name: tt('Send'), exact: true })).toBeInViewport();
    await ux.check('sheet', [...STD, 'AZ']);
    // 4) The conversation scrolls inside the sheet; the page behind does not move.
    const conv = sheet
      .getByRole('region', { name: tt('Conversation') })
      .or(sheet.locator(`[aria-label="${tt('Conversation')}"]`));
    const y0 = await page.evaluate(() => scrollY);
    const moved = await conv.first().evaluate((el) => {
      const before = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      return el.scrollTop - before;
    });
    expect(moved, 'the conversation scrolls inside the sheet').toBeGreaterThan(0);
    const cb = (await conv.first().boundingBox())!;
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY), 'the page behind does not move').toBe(y0);
    // 5) Close: the bottom bar is there again.
    await sheet.getByRole('button', { name: tt('Close'), exact: true }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(item).toBeVisible();
    // 6) Lead: the same.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await onVacancy(page, log, { me: { roles: ['TA_LEAD'] } });
    await page.reload();
    await expect(item).toBeVisible();
    await item.tap();
    await expect(pool(page)).toBeVisible();
    // 7) ADMIN only: no bottom bar and no 'Ask SenAI'.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await onVacancy(page, log, { me: { roles: ['ADMIN'] } });
    await page.goto('/#/');
    await page.reload();
    await expect(page.getByLabel(tt('Account menu'))).toBeVisible();
    await expect(item).toHaveCount(0);
    await expect(page.getByText(tt('Ask {name}').replace('{name}', 'SenAI'))).toHaveCount(0);
  },
);

uat(
  'SA-04',
  'Panel open state is remembered per user; Close, Escape and config changes after reload',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    const OTHER = '01K000000000000000000000R2';
    let me: Record<string, unknown> = {};
    let cfg: unknown = CFG;
    let cfgStatus = 200;
    const route = senaiRoutes(log);
    await vacApi(page, {
      views: [vview({ id: VID, title: 'Network Engineer' })],
      extra: async (r, u) => {
        if (u.pathname === '/me') {
          await r.fulfill({ json: { ...ME, ...me } });
          return true;
        }
        if (u.pathname === '/assistant/config') {
          await r.fulfill({ status: cfgStatus, json: cfgStatus === 200 ? cfg : { message: 'x' } });
          return true;
        }
        return route(r, u);
      },
    });
    const key = (id: string) => `cv-assistant-open:${id}`;
    const stored = (id: string) => page.evaluate((k) => localStorage.getItem(k), key(id));
    const bar = page.getByRole('search').getByRole('textbox');
    await page.goto('/#/vacancies');
    // 1) Open, reload: open again.
    await bar.press('Enter');
    await expect(pool(page)).toBeVisible();
    await page.reload();
    await expect(pool(page)).toBeVisible();
    expect(await stored(ME.userId)).toBe('1');
    // 2) Close, reload: closed.
    await pool(page)
      .getByRole('button', { name: tt('Close'), exact: true })
      .click();
    await page.reload();
    await expect(page.getByLabel(tt('Account menu'))).toBeVisible();
    await expect(pool(page)).toHaveCount(0);
    expect(await stored(ME.userId)).toBe('0');
    // 3) Escape in the composer: closed, focus back on the Ask bar.
    await bar.press('Enter');
    await pool(page).getByRole('textbox').press('Escape');
    await expect(pool(page)).toHaveCount(0);
    await expect(bar, 'after Escape the focus returns to the Ask bar (SD-128)').toBeFocused();
    await page.reload();
    await expect(pool(page)).toHaveCount(0);
    expect(await stored(ME.userId)).toBe('0');
    // 4) Another person in the same browser starts with their own state.
    await page.evaluate((k) => localStorage.setItem(k, '1'), key(ME.userId));
    me = { userId: OTHER, displayName: 'Orxan Quliyev', email: 'orxan@example.az' };
    await page.reload();
    await expect(page.getByLabel(tt('Account menu'))).toBeVisible();
    await expect(pool(page), "recruiter2 does not inherit recruiter's open panel").toHaveCount(0);
    await ux.check('per user', STD);
    // 5) Config off: an empty spacer, no panel, no bottom-bar item.
    await page.evaluate((k) => localStorage.setItem(k, '1'), key(OTHER));
    cfg = { ...CFG, enabled: false };
    await page.reload();
    await expect(page.getByLabel(tt('Account menu'))).toBeVisible();
    await expect(bar).toHaveCount(0);
    await expect(pool(page)).toHaveCount(0);
    await expect(page.getByText(tt('Ask {name}').replace('{name}', 'SenAI'))).toHaveCount(0);
    // 6) Config 500: SenAI hidden, no page error and no error box.
    ux.allow(/500|Internal Server Error/);
    cfgStatus = 500;
    await page.reload();
    await expect(page.getByLabel(tt('Account menu'))).toBeVisible();
    await expect(bar).toHaveCount(0);
    await expect(pool(page)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  },
);

uat(
  'SA-11',
  "Show all and vacancy buttons on an older answer re-run that answer's question",
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const log: AskLog = { asks: [], cand: [] };
    const QA = [
      { id: '01K0000000000000000000QA01', title: 'QA Engineer 1', status: 'open' },
      { id: '01K0000000000000000000QA02', title: 'QA Engineer 2', status: 'open' },
    ];
    await onVacancy(page, log, {
      ask: (b) => {
        if (b.message.startsWith('find candidates for QA') && !b.pick)
          return poolAnswer({
            kind: 'ask_which',
            headline: 'Which vacancy do you mean?',
            rows: [],
            vacancy: null,
            options: QA,
          });
        if (b.message === 'who knows Excel' || b.without)
          return poolAnswer({
            headline: 'Candidates whose CV mentions Excel: 5 (Network Engineer).',
            more: 3,
            used: [
              { kind: 'vacancy', text: 'Network Engineer' },
              { kind: 'skill', text: 'Excel' },
              ...(b.without ? [] : [{ kind: 'band', text: 'Strong' }]),
            ],
          });
        return poolAnswer({ more: 7 });
      },
    });
    await page.goto('/#/vacancies');
    const bar = page.getByRole('search').getByRole('textbox');
    const panel = pool(page);
    const q = async (text: string, n: number) => {
      await panel.getByRole('textbox').fill(text);
      await panel.getByRole('textbox').press('Enter');
      await expect(panel.locator('[data-answer]')).toHaveCount(n);
    };
    await bar.press('Enter');
    await q('find candidates for Backend Engineer', 1);
    await q('who knows Excel', 2);
    await q('find candidates for QA', 3);
    const ans = panel.locator('[data-answer]');
    // 2) Show all on the Q1 answer sends Q1 with showAll and Q1's vacancy.
    await ans.nth(0).getByRole('button', { name: 'Show all (7 more)' }).click();
    await expect.poll(() => log.asks.length).toBe(4);
    expect(log.asks[3]).toMatchObject({
      message: 'find candidates for Backend Engineer',
      showAll: true,
      pick: VID,
    });
    await expect(ans).toHaveCount(4);
    // 3) An option on the Q3 answer sends Q3 with pick, also after later questions.
    await ans.nth(2).getByRole('button', { name: 'QA Engineer 2' }).click();
    await expect.poll(() => log.asks.length).toBe(5);
    expect(log.asks[4]).toMatchObject({ message: 'find candidates for QA', pick: QA[1]!.id });
    await expect(ans).toHaveCount(5);
    await q('who knows Excel', 6);
    await ans.nth(2).getByRole('button', { name: 'QA Engineer 1' }).click();
    await expect.poll(() => log.asks.length).toBe(7);
    expect(log.asks[6]).toMatchObject({ message: 'find candidates for QA', pick: QA[0]!.id });
    await expect(ans).toHaveCount(7);
    // 4) × on 'Strong' of the latest Excel answer, then Show all on the new answer.
    await q('who knows Excel', 8);
    await ans.nth(7).getByRole('button', { name: 'Remove filter Strong' }).click();
    await expect.poll(() => log.asks.length).toBe(9);
    expect(log.asks[8]!.without).toMatchObject({ kind: 'band', text: 'Strong' });
    await expect(ans).toHaveCount(9);
    await ans.nth(8).getByRole('button', { name: 'Show all (3 more)' }).click();
    await expect.poll(() => log.asks.length).toBe(10);
    const last = log.asks[9]!;
    expect(last.showAll).toBe(true);
    expect(
      last.without ?? last.message,
      "Show all repeats the refinement, never the bare text '− Strong'",
    ).toMatchObject(last.without ? { kind: 'band', text: 'Strong' } : {});
    if (!last.without) expect(last.message).not.toBe('− Strong');
    await ux.check('older answers', STD);
  },
);

uat(
  'SA-30',
  'Pool panel layout on every width: docked, side sheet, bottom sheet; account menu reachable',
  { on: ['D', 'E', 'T', 'TL', 'A', 'I', 'DS', 'DW'], langs: 'EN+AZ', timeout: 150_000 },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    const wide = poolAnswer({
      table: {
        head: [
          'Requirement',
          ...Array.from({ length: 6 }, (_, i) => `Candidate ${i + 1} long name`),
        ],
        rows: [
          { cells: ['BGP routing', 'Met', 'Partly', 'Not met', 'Not found', 'Unclear', 'Met'] },
        ],
      },
      rows: Array.from({ length: 5 }, (_, i) => ({
        ...poolAnswer().rows[i % 2],
        matchId: `01K00000000000000000000R${String(i).padStart(2, '0')}`,
        label: `Person ${i + 1}`,
      })),
    });
    ux.allow(/404|Not Found/);
    await onVacancy(page, log, { ask: () => wide });
    await page.addInitScript((k) => localStorage.setItem(k, '1'), `cv-assistant-open:${ME.userId}`);
    const vw = page.viewportSize()!.width;
    const probe = async (where: string) => {
      const panel = pool(page);
      await expect(panel, `${where}: panel open`).toBeVisible();
      if (!(await panel.locator('[data-answer]').count())) {
        await panel.getByRole('textbox').fill('find candidates');
        await panel.getByRole('textbox').press('Enter');
        await expect(panel.locator('[data-answer]').first()).toBeVisible();
      }
      // A screen change in progress puts its own layer over the page (hit tests land on <html>).
      await page
        .waitForFunction(
          () =>
            !document
              .getAnimations()
              .some((a) =>
                ((a.effect as KeyframeEffect | null)?.pseudoElement ?? '').startsWith(
                  '::view-transition',
                ),
              ),
          null,
          { timeout: 3000 },
        )
        .catch(() => undefined);
      const r = await page.evaluate(() => {
        const aside = document.querySelector('aside')!.getBoundingClientRect();
        const covered: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          'main a[href], main button, main input, main select, main textarea, main [role="tab"]',
        )) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          const cx = b.left + b.width / 2;
          const cy = b.top + b.height / 2;
          if (cy < 57 || cy > innerHeight || cx < 0 || cx > innerWidth) continue;
          // Part of a strip that scrolls (the vacancy tabs): where its box is cut off, the control is
          // not on screen; scrolling the strip brings it into the visible part.
          let cut = false;
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const st = getComputedStyle(a);
            if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
            const ab = a.getBoundingClientRect();
            if (cx < ab.left || cx > ab.right || cy < ab.top || cy > ab.bottom) cut = true;
          }
          if (cut) continue;
          const hit = document.elementFromPoint(cx, cy);
          if (hit && document.querySelector('aside')!.contains(hit))
            covered.push(
              (el.innerText || el.getAttribute('aria-label') || el.tagName).slice(0, 40),
            );
        }
        const av = document.querySelector('header summary[aria-label]') as HTMLElement;
        const ab = av.getBoundingClientRect();
        const avHit = document.elementFromPoint(ab.left + ab.width / 2, ab.top + ab.height / 2);
        return {
          aside: { left: aside.left, top: aside.top, bottom: aside.bottom, width: aside.width },
          covered,
          avatarHit: !!avHit && av.contains(avHit),
          avatarCover: avHit
            ? `${avHit.tagName}.${String(avHit.className).slice(0, 60)} ${(avHit.textContent ?? '').slice(0, 30)}`
            : 'none',
          scrollX: document.documentElement.scrollWidth > innerWidth + 1,
          ih: innerHeight,
        };
      });
      if (vw >= 640) {
        expect
          .soft(r.covered, `${where}: no page control lies under the panel (SD-16)`)
          .toEqual([]);
        if (vw >= 1280) {
          expect.soft(Math.round(r.aside.top), `${where}: docked below the header`).toBe(57);
          expect.soft(Math.round(r.aside.bottom), `${where}: docked full height`).toBe(r.ih);
        }
      } else {
        expect.soft(Math.round(r.aside.left), `${where}: bottom sheet`).toBe(0);
      }
      expect
        .soft(r.avatarHit, `${where}: the avatar is clickable (covered by ${r.avatarCover})`)
        .toBe(true);
      expect.soft(r.scrollX, `${where}: no horizontal page scroll`).toBe(false);
    };
    for (const route of ['/#/vacancies', `/#/vacancies/${VID}`, '/#/candidates', '/#/reports']) {
      await page.goto(route);
      await expect(page.getByLabel(tt('Account menu'))).toBeVisible();
      await probe(route);
      if (route === `/#/vacancies/${VID}`) {
        const tabs = page.getByRole('main').getByRole('tab');
        const n = Math.min(await tabs.count(), 6);
        for (let i = 1; i < n; i++) {
          await press(tabs.nth(i), vw);
          await probe(`${route} tab ${i + 1}`);
        }
      }
    }
    await ux.check('panel open', STD);
    // The wide table scrolls inside the panel.
    const scroller = pool(page).locator('table').first().locator('xpath=..');
    expect(
      await scroller.evaluate(
        (el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX !== 'visible',
      ),
      'the wide table scrolls inside the panel',
    ).toBe(true);
    // 2) The account menu paints above the panel.
    await page.getByLabel(tt('Account menu')).click();
    for (const name of [tt('Sign out'), tt('What {name} remembers').replace('{name}', 'SenAI')]) {
      const el = page.getByText(name, { exact: true }).first();
      await expect(el).toBeVisible();
      const b = (await el.boundingBox())!;
      const hit = await page.evaluate(
        ([x, y]) => {
          const h = document.elementFromPoint(x!, y!);
          return !!h?.closest('details');
        },
        [b.x + b.width / 2, b.y + b.height / 2],
      );
      expect.soft(hit, `${name} paints above the panel`).toBe(true);
    }
    await expect(page.getByRole('combobox').first()).toBeVisible();
    await ux.check('account menu', STD);
  },
);

uat(
  'SA-31',
  'Pool panel states: empty, busy, errors, unusual pools, safe mode, long answers',
  { on: ['D', 'A'], langs: 'EN+AZ', timeout: 60_000 },
  async ({ page, ux, meta }) => {
    const tt = w(meta.lang);
    const log: AskLog = { asks: [], cand: [] };
    let mode: {
      status?: number;
      body?: unknown;
      delay?: number;
      abort?: boolean;
      answer?: unknown;
    } = {};
    ux.allow(/500|403|404|Failed to load resource|net::ERR/);
    await vacApi(page, {
      assistant: CFG,
      views: [vview({ id: VID, title: 'Network Engineer' })],
      extra: async (r, u) => {
        if (u.pathname === '/assistant/ask') {
          log.asks.push(r.request().postDataJSON());
          if (mode.delay) await new Promise((x) => setTimeout(x, mode.delay));
          if (mode.abort) {
            await r.abort('failed');
            return true;
          }
          if (mode.status) {
            await r.fulfill({
              status: mode.status,
              json: mode.body ?? { statusCode: mode.status, message: 'Internal server error' },
            });
            return true;
          }
          await r.fulfill({
            json: {
              conversationId: '01K00000000000000000000CV1',
              messageId: `01K0000000000000000000M${log.asks.length}`.slice(0, 26),
              answer: mode.answer ?? poolAnswer(),
            },
          });
          return true;
        }
        if (u.pathname === '/assistant/conversations') {
          await r.fulfill({ json: [] });
          return true;
        }
        return false;
      },
    });
    await page.goto(`/#/vacancies/${VID}`);
    const bar = page.getByRole('search').getByRole('textbox');
    await bar.press('Enter');
    const panel = pool(page);
    // 1) Empty: intro and starter chips.
    await expect(
      panel.getByText(
        tt(
          '{name} finds candidates in your pool. It shows the matches; it does not decide.',
        ).replace('{name}', 'SenAI'),
      ),
    ).toBeVisible();
    await expect(
      panel.getByRole('list', { name: tt('Suggested questions') }).getByRole('button'),
    ).toHaveCount(3);
    await ux.check('empty', [...STD, 'AZ']);
    const box = panel.getByRole('textbox');
    const send = async (text: string) => {
      await box.fill(text);
      await box.press('Enter');
    };
    // 2) Busy: status line, Send disabled, the composer editable.
    mode = { delay: 3000 };
    await send('find candidates');
    const busy = panel.getByRole('status').filter({
      hasText: tt('{name} is looking…').replace('{name}', 'SenAI'),
    });
    await expect(busy).toBeVisible();
    await box.fill('typing while busy');
    await expect(box).toBeEditable();
    await expect(panel.getByRole('button', { name: tt('Send'), exact: true })).toBeDisabled();
    await expect(busy).toBeInViewport();
    await expect(busy).toHaveCount(0, { timeout: 8000 });
    // 3) Errors: a readable alert in the UI language, never 'Failed to fetch' or a raw code.
    const errs: [typeof mode, RegExp | null][] = [
      [{ status: 500 }, null],
      [
        { status: 404, body: { message: 'The assistant is off' } },
        meta.lang === 'az' ? /[əğışçöü]/i : /assistant is off/i,
      ],
      [
        { status: 403, body: { message: 'Forbidden' } },
        meta.lang === 'az' ? /[əğışçöü]/i : /account|access|permission|SenAI/i,
      ],
      [{ abort: true }, null],
    ];
    for (const [m, want] of errs) {
      mode = m;
      await send('find candidates');
      const alert = panel.getByRole('alert').last();
      await expect(alert).toBeVisible();
      const text = (await alert.textContent()) ?? '';
      expect
        .soft(text, `error ${JSON.stringify(m)}: no raw text`)
        .not.toMatch(/Failed to fetch|^\d{3}$|stub error|^x$/);
      if (want) expect.soft(text, `error ${JSON.stringify(m)}: readable`).toMatch(want);
      if (m.status === 403)
        expect
          .soft(text, '403 says the account cannot use SenAI')
          .toMatch(meta.lang === 'az' ? /SenAI/ : /SenAI|cannot use|not allowed/i);
    }
    await ux.check('errors', [...STD, 'AZ']);
    // 4) Unusual pools: each sentence exactly; the safe-mode note as a note.
    const SAFE =
      'The AI reader is not available right now, so your question was read by fixed rules only. The results come from the stored records.';
    const unusual = [
      'Network Engineer has no CVs yet. Add some on the vacancy page.',
      'No CV for Network Engineer has a result yet.',
      'There are no vacancies to search yet.',
    ];
    for (const u of unusual) {
      mode = { answer: poolAnswer({ kind: 'help', headline: u, rows: [], counts: null }) };
      await send('find candidates');
      await expect(panel.locator('[data-answer]').last().locator('p').first()).toHaveText(u);
    }
    mode = { answer: poolAnswer({ notes: [SAFE, 'n'.repeat(600)] }) };
    await send('find candidates for Network Engineer please');
    await expect(panel.locator('[data-answer]').last().getByText(SAFE)).toBeVisible();
    // 5) The 50-row answer is scrolled to its first line; nothing overflows the panel.
    mode = {
      answer: poolAnswer({
        rows: Array.from({ length: 50 }, (_, i) => ({
          ...poolAnswer().rows[0],
          matchId: `01K0000000000000000000R${String(i).padStart(3, '0')}`,
          label: `Person ${i + 1}`,
        })),
      }),
    };
    await send('show all');
    const last = panel.locator('[data-answer]').last();
    await expect(last.getByRole('link', { name: 'Person 50' })).toBeAttached();
    await expect(last.locator('p').first()).toBeInViewport();
    const over = await panel.evaluate((el) => {
      const w = el.getBoundingClientRect().right;
      return [...el.querySelectorAll('*')].filter(
        (c) => c.getBoundingClientRect().right > w + 1 && !c.closest('.overflow-x-auto'),
      ).length;
    });
    expect.soft(over, 'nothing overflows the panel width').toBe(0);
    await ux.check('long answers', [...STD, 'AZ']);
  },
);
void mockApi;
