import { DID, DID2, DID3, MID, MID2 } from '../fixtures/api';
import {
  DID4,
  FOUR,
  MID3,
  MID4,
  docId,
  gets,
  manyRows,
  matchId,
  poolApi,
  prow,
  puts,
  report,
  statusRow,
  words,
  type Row,
} from '../fixtures/pkg-e';
import { expect, STD, uat, type Ux } from '../ux/test';
import type { Page } from '@playwright/test';

/**
 * UAT package E: the candidate pool (CP-01 … CP-28, layer L1). Every person here is invented.
 * Decision marks are PUTs; bulk marks one POST; downloads a ticket and a token GET.
 */

const row = (page: Page, id: string) => page.locator(`#cand-${id}`);
const blur = (page: Page) =>
  page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
const statusLine = (page: Page) =>
  page
    .getByRole('status')
    .filter({ hasText: /candidate|namizəd/ })
    .first();
async function open(page: Page, hash = '#/candidates') {
  await page.goto(`/${hash}`);
  await expect(statusLine(page)).toContainText(/\d/);
}
const check = (ux: Ux, step: string, extra: ('RM' | 'AZ')[] = []) =>
  ux.check(step, [...STD, ...extra]);

// ------------------------------------------------------------------------------------------ CP-01
uat(
  'CP-01',
  'Global pool: first view on desktop',
  { on: ['D', 'DW', 'DS', 'E'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    // PLAN: the row asks to fix the shared fixture's band 'possible' first (SD-64); package E may
    // not edit fixtures/api.ts, so these rows come from fixtures/pkg-e.ts with the real bands.
    await poolApi(page, { rows: FOUR() });
    await open(page);
    await expect(page.getByRole('heading', { level: 1, name: w('Candidates') })).toBeVisible();
    const search = page.getByRole('searchbox', { name: w('Search candidates') });
    await expect(search).toHaveAttribute('placeholder', w('Search by name, skill or vacancy'));
    const vac = page.getByRole('combobox', { name: w('Vacancy') });
    await expect(vac).toHaveValue('');
    await expect(vac.locator('option:checked')).toHaveText(w('All vacancies'));
    await expect(
      page.getByRole('combobox', { name: w('Show'), exact: true }).locator('option:checked'),
    ).toHaveText(w('Ranked CVs'));
    const match = page.getByRole('group', { name: w('Match') });
    for (const b of ['Strong', 'Good', 'Partial', 'Limited'])
      await expect(match.getByRole('button', { name: w(b) })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    const dec = page.getByRole('group', { name: w('Decision'), exact: true });
    for (const [m, n] of [
      ['New', 4],
      ['Shortlist', 0],
      ['Maybe', 0],
      ['Not now', 0],
    ] as const)
      await expect(dec.getByRole('button', { name: `${w(m)} ${n}`, exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: w('Out of date only') })).not.toBeChecked();
    await expect(page.getByRole('button', { name: w('Clear the filters') })).toHaveCount(0);
    const time = meta.lang === 'az' ? /\d{2}:\d{2} vəziyyətinə görə/ : /As of \d{2}:\d{2}/;
    // Only the counts are in the live region; the time beside them is not announced again on a refresh.
    const counts = `${w('{n} candidates', { n: 4 })} · ${w('{n} strong', { n: 1 })} · ${w('{n} out of date', { n: 2 })}`;
    await expect(statusLine(page)).toHaveText(new RegExp(`^${counts}$`));
    await expect(statusLine(page).locator('xpath=..')).toHaveText(
      new RegExp(`^${counts} · ${time.source}$`),
    );
    await expect(page.getByRole('button', { name: w('Export to Excel') })).toBeEnabled();
    await expect(page.getByRole('button', { name: w('Shortlist summary') })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: w('Select all shown') })).toBeVisible();
    for (const h of ['Candidate', 'Vacancy', 'Decision', 'Updated'])
      await expect(
        page.getByRole('button', { name: new RegExp(`^${w(h)}\\s*$`, 'i') }),
      ).toBeVisible();
    await expect(
      // The name also says the order in words (', sorted descending') for screen readers.
      page.getByRole('button', { name: new RegExp(`^${w('Match')} ↓`, 'i') }),
    ).toBeVisible();
    await expect(page.locator('[role=row]').first()).toContainText(w('Must-haves'), {
      ignoreCase: true,
    });
    await expect(
      page.getByText(
        w('Keys: J and K move, X selects, S shortlist, M maybe, N not now, Enter opens the CV.'),
      ),
    ).toBeVisible();
    const a = row(page, DID);
    await expect(a.getByRole('link', { name: 'Aysel Məmmədova' })).toHaveAttribute(
      'href',
      `#/cv/${DID}`,
    );
    await expect(a).toContainText('Network Engineer');
    await expect(a).toContainText('88%');
    await expect(a).toContainText(w('Strong'));
    await expect(a).toContainText(w('{a} of {b}', { a: 3, b: 4 }));
    await expect(
      a.getByRole('combobox', { name: w('Decision for {name}', { name: 'Aysel Məmmədova' }) }),
    ).toHaveValue('new');
    await expect(a.locator('span').last()).not.toBeEmpty();
    await expect(row(page, DID3)).toContainText(`Radio Planner · ${w('Closed')}`);
    await expect(row(page, DID3)).toContainText(w('Out of date'));
    await expect(row(page, DID4)).toContainText(w('Re-analyzing'));
    if (meta.lang === 'az') {
      await expect(a).toContainText('Güclü');
      await expect(a.getByRole('combobox').locator('option:checked')).toHaveText('Yeni');
    }
    await check(ux, 'first view', ['AZ']);
  },
);

// ------------------------------------------------------------------------------------------ CP-08
uat(
  'CP-08',
  'Row click, name link and opening in a new tab',
  { on: ['D', 'DS', 'E'], langs: 'EN' },
  async ({ page, ux, context }) => {
    await poolApi(page, { rows: FOUR().slice(0, 2) });
    await open(page);
    // 1) a click outside the link marks the row and opens the preview, on the list.
    await row(page, DID).getByText('88%').click();
    await expect(row(page, DID)).toHaveAttribute('data-active', 'true');
    await expect(
      page.getByRole('complementary', { name: 'Preview of Aysel Məmmədova' }),
    ).toBeVisible();
    expect(page.url()).toMatch(/#\/candidates$/);
    await ux.check('row click');
    // 2) the name link opens the review with the list.
    await row(page, DID2).getByRole('link', { name: 'Rauf Əliyev' }).click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID2}\\?l=[\\w-]{3,32}$`));
    const lid = new URL(page.url().replace('#', '')).searchParams.get('l');
    const lists = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('cv-review-lists') ?? '[]'),
    );
    const l = lists.find((x: { id: string }) => x.id === lid);
    expect(l?.ids).toEqual([DID, DID2]);
    expect(l?.back).toBe('/candidates');
    // 3) back, then Ctrl/Cmd-click opens a new tab on the CV without a list.
    await page.goBack();
    await expect(row(page, DID)).toBeVisible();
    const popup = context.waitForEvent('page');
    await row(page, DID)
      .getByRole('link', { name: 'Aysel Məmmədova' })
      .click({ modifiers: ['ControlOrMeta'] });
    const p2 = await popup;
    const flush = ux.watch(p2);
    await p2.waitForLoadState('domcontentloaded');
    expect(p2.url()).toMatch(new RegExp(`#/cv/${DID}$`));
    expect(page.url()).toMatch(/#\/candidates$/);
    flush();
    await p2.close();
    // 4) at 1000 px a row click opens the review directly.
    await page.setViewportSize({ width: 1000, height: 800 });
    await row(page, DID2).getByText('71%').click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID2}\\?l=[\\w-]{3,32}$`));
    await ux.check('narrow row click');
  },
);

// ------------------------------------------------------------------------------------------ CP-09
uat(
  'CP-09',
  'Preview panel: contents, deciding, closing and the button that opens the review',
  { on: ['D', 'DW', 'E'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    ux.allow(/500/);
    const seen = await poolApi(page, {
      rows: FOUR(),
      report: (mid) =>
        mid === MID2
          ? { delay: 1500 }
          : mid === MID3
            ? { status: 500, body: { message: 'The report could not be loaded.' } }
            : mid === MID4
              ? { body: report(MID4, 'Kamal Rzayev', { noMust: true }) }
              : undefined,
    });
    await open(page);
    await row(page, DID).getByText('88%').click();
    const aside = page.getByRole('complementary', {
      name: w('Preview of {name}', { name: 'Aysel Məmmədova' }),
    });
    await expect(aside).toBeVisible();
    await expect(aside.getByRole('heading', { name: 'Aysel Məmmədova' })).toBeVisible();
    await expect(aside).toContainText('Network Engineer');
    await expect(aside).toContainText('88%');
    await expect(aside).toContainText(w('Strong'));
    await expect(aside).toContainText(`${w('Must-haves')}: ${w('{a} of {b}', { a: 3, b: 4 })}`);
    await expect(aside).toContainText('Ten years of carrier network design');
    const must = aside.getByRole('region', { name: w('Must-haves') }).getByRole('listitem');
    await expect(must).toHaveCount(3);
    await expect(must.nth(0)).toContainText(w('Matched'));
    await expect(must.nth(2)).toContainText('CCIE certification');
    await expect(must.nth(2)).toContainText(w('Not found'));
    await expect(aside).not.toContainText(w('Missing'));
    await expect(aside).not.toContainText('Russian language');
    const grp = aside.getByRole('group', {
      name: w('Decision for {name}', { name: 'Aysel Məmmədova' }),
    });
    await expect(grp.getByRole('button')).toHaveText([w('Shortlist'), w('Maybe'), w('Not now')]);
    await expect(aside).toContainText(
      w('Keys: S shortlist, M maybe, N not now. Press again to clear it.'),
    );
    await ux.check('preview', [...STD, 'AZ']);

    // 2) Shortlist, Shortlist again (clears), Maybe.
    const sl = grp.getByRole('button', { name: w('Shortlist') });
    await sl.click();
    await expect(sl).toHaveAttribute('aria-pressed', 'true');
    await expect(row(page, DID).getByRole('combobox')).toHaveValue('shortlist');
    await sl.click();
    await expect(sl).toHaveAttribute('aria-pressed', 'false');
    await grp.getByRole('button', { name: w('Maybe') }).click();
    await expect(grp.getByRole('button', { name: w('Maybe') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect
      .poll(() => puts(seen).map((p) => (p.body as { mark: string }).mark))
      .toEqual(['shortlist', 'new', 'maybe']);
    expect(puts(seen).every((p) => p.url === `/candidates/${MID}/decision`)).toBe(true);

    // 3) Rauf while his report loads.
    await row(page, DID2).getByText('71%').click();
    const rauf = page.getByRole('complementary', {
      name: w('Preview of {name}', { name: 'Rauf Əliyev' }),
    });
    await expect(rauf.getByText(w('Loading…'))).toBeVisible();
    await expect(rauf.getByRole('listitem').first()).toBeVisible({ timeout: 5000 });
    // 4) a 500 and a vacancy without must-haves.
    await row(page, DID3).getByText('64%').click();
    await expect(
      page
        .getByRole('complementary', { name: w('Preview of {name}', { name: 'Leyla Hüseynova' }) })
        .getByRole('alert'),
    ).toBeVisible();
    await row(page, DID4).getByText('58%').click();
    await expect(page.getByText(w('No must-haves in this vacancy.'))).toBeVisible();

    // 5) Escape and the × close it; the list takes the full width.
    await blur(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: /Preview|Önbaxış|Ön baxış/ })).toHaveCount(
      0,
    );
    const list = page.getByRole('list', { name: w('Candidates') });
    const card = page.locator('div.rounded-2xl.border-line.bg-card').filter({ has: list });
    const box = await card.boundingBox();
    const main = await page.locator('main').boundingBox();
    expect(box!.width).toBeGreaterThan(main!.width * 0.8);
    await row(page, DID).getByText('88%').click();
    await expect(aside).toBeVisible();
    await aside.getByRole('button', { name: w('Close preview') }).click();
    await expect(aside).toHaveCount(0);

    // 6) The bottom button opens the CV review; its name should say so (SD-15).
    await row(page, DID).getByText('88%').click();
    const openBtn = aside.getByRole('button').last();
    const name = (await openBtn.textContent())?.trim() ?? '';
    await openBtn.click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}\\?l=[\\w-]{3,32}$`));
    // Bug SD-15 (CandidatePreview.tsx:172): the button says 'Open the full report' but opens the CV
    // review screen.
    expect(name, 'the preview button names the CV review it opens').toMatch(
      meta.lang === 'az' ? /CV/ : /\bCV\b|review/i,
    );
  },
);

// ------------------------------------------------------------------------------------------ CP-11
uat(
  'CP-11',
  'List keys J, K, X, S, M, N, Enter and Escape',
  { on: ['D', 'E', 'TL'], langs: 'EN' },
  async ({ page, ux }) => {
    const rows = [...FOUR().slice(0, 3), statusRow(1, 'Nərgiz Sadıqova', 'failed')];
    const seen = await poolApi(page, {
      rows,
      more: async (route, url) => {
        if (url.pathname !== '/candidates/shortlist-summary') return false;
        await route.fulfill({
          json: {
            subject: 'Shortlist: Network Engineer',
            body: '1. Aysel Məmmədova, 88%',
            count: 1,
          },
        });
        return true;
      },
    });
    await open(page);
    await page.locator('h1').click(); // the page background: focus on the body
    await blur(page);
    const active = () => page.locator('li[data-active=true]');
    for (const [i, id] of [DID, DID2, DID3].entries()) {
      await page.keyboard.press('j');
      await expect(active()).toHaveAttribute('id', `cand-${id}`);
      await expect(active()).toBeInViewport();
      if (i === 0)
        await expect(
          page.getByRole('complementary', { name: 'Preview of Aysel Məmmədova' }),
        ).toBeVisible();
    }
    for (const id of [DID2, DID, DID]) {
      await page.keyboard.press('k');
      await expect(active()).toHaveAttribute('id', `cand-${id}`);
    }
    await page.keyboard.press('x');
    await expect(page.getByRole('region', { name: 'Selected candidates' })).toContainText(
      '1 selected',
    );
    await ux.check('J K X');
    const toast = page
      .getByRole('status')
      .filter({ has: page.getByRole('button', { name: 'Undo' }) });
    const want: [string, string, number][] = [
      ['s', 'shortlist', 0],
      ['s', 'new', 1],
      ['m', 'maybe', 2],
      ['n', 'not_now', 3],
    ];
    const label: Record<string, string> = {
      shortlist: 'Shortlist',
      new: 'New',
      maybe: 'Maybe',
      not_now: 'Not now',
    };
    for (const [k, mark, v] of want) {
      await page.keyboard.press(k);
      await expect(toast).toContainText(`Aysel Məmmədova: ${label[mark]}.`);
      await expect.poll(() => puts(seen).length).toBe(v + 1);
      expect(puts(seen)[v]!.body).toMatchObject({ mark, expectedVersion: v });
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(active()).toHaveAttribute('id', `cand-${DID}`);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}\\?l=[\\w-]{3,32}$`));
    await page.goBack();
    await expect(row(page, DID)).toBeVisible();
    // 7) With the summary open, J does nothing.
    await page
      .getByRole('combobox', { name: 'Vacancy' })
      .selectOption({ label: 'Network Engineer' });
    await page.getByRole('button', { name: 'Shortlist summary' }).click();
    await expect(page.getByRole('heading', { name: 'Shortlist: Network Engineer' })).toBeVisible();
    await blur(page);
    const before = await active().getAttribute('id');
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    expect(await active().getAttribute('id')).toBe(before);
    await page.getByRole('button', { name: 'Close' }).click();
    // 8) S on an unranked row sends nothing.
    await blur(page);
    for (let i = 0; i < 4; i++) await page.keyboard.press('j');
    await expect(active()).toHaveAttribute('id', `cand-${docId(901)}`);
    const n = puts(seen).length;
    await page.keyboard.press('s');
    await page.waitForTimeout(300);
    expect(puts(seen).length).toBe(n);
    // Letters typed in the search box only type text.
    const search = page.getByRole('searchbox', { name: 'Search candidates' });
    await search.click();
    await search.pressSequentially('jsmn');
    await expect(search).toHaveValue('jsmn');
    await page.waitForTimeout(300);
    expect(puts(seen).length).toBe(n);
    await ux.check('keys done');
  },
);

// ------------------------------------------------------------------------------------------ CP-13
uat(
  'CP-13',
  'Row decision pill, Undo toast, version conflict and archived rows',
  { on: ['D', 'T', 'A'], langs: 'EN+AZ', timeout: 60_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    ux.allow(/409/);
    let stale = false;
    const extra = manyRows(60).slice(3);
    const rows: Row[] = [
      prow(DID, MID, 'Aysel Məmmədova', 88, 1),
      prow(DID2, MID2, 'Rauf Əliyev', 71, 2),
      prow(DID3, MID3, 'Leyla Hüseynova', 64, 3, { vacancyArchived: true }),
      ...extra,
    ];
    const seen = await poolApi(page, {
      rows,
      decision: async (route, mid, body) => {
        if (!stale) {
          // Keep the list as the server would, so the reload after a 409 shows the stored mark.
          const r = rows.find((x) => x.matchId === mid);
          if (r)
            Object.assign(r, {
              decision: body.mark,
              decisionVersion: Number(body.expectedVersion) + 1,
            });
          return false;
        }
        await route.fulfill({
          status: 409,
          json: {
            code: 'STALE_VERSION',
            message: 'Someone else changed this decision. The list was reloaded.',
          },
        });
        return true;
      },
    });
    await open(page);
    const pill = row(page, DID).getByRole('combobox', {
      name: w('Decision for {name}', { name: 'Aysel Məmmədova' }),
    });
    await pill.selectOption('shortlist');
    await expect(pill).toHaveValue('shortlist');
    await expect.poll(() => puts(seen).length).toBe(1);
    expect(puts(seen)[0]).toMatchObject({
      url: `/candidates/${MID}/decision`,
      body: { mark: 'shortlist', expectedVersion: 0 },
    });
    const undo = page.getByRole('button', { name: w('Undo') });
    const toast = page.getByRole('status').filter({ has: undo });
    await expect(toast).toContainText(`Aysel Məmmədova: ${w('Shortlist')}.`);
    const vp = page.viewportSize()!;
    // Measured once the slide-in has finished (how it moves meanwhile is CP-28, SD-103).
    await page
      .waitForFunction(
        () => !document.getAnimations().some((a) => a.playState === 'running'),
        null,
        { timeout: 3000 },
      )
      .catch(() => undefined);
    const tb = (await toast.boundingBox())!;
    expect(Math.abs(tb.x + tb.width / 2 - vp.width / 2)).toBeLessThanOrEqual(3);
    expect(tb.y + tb.height).toBeGreaterThan(vp.height * 0.75);
    const bar = page.locator('nav.fixed.bottom-0');
    if (await bar.isVisible()) {
      const bb = (await bar.boundingBox())!;
      expect(tb.y + tb.height).toBeLessThanOrEqual(bb.y + 1);
    }
    await undo.click();
    await expect.poll(() => puts(seen).length).toBe(2);
    expect(puts(seen)[1]!.body).toEqual({ mark: 'new', note: null, expectedVersion: 1 });
    await expect(pill).toHaveValue('new');
    await ux.check('after Undo', [...STD, 'AZ']);
    // 3) the toast hides after 10 s.
    await pill.selectOption('maybe');
    await expect(toast).toBeVisible();
    // Measured in the page, frame by frame, so the test's own polling adds nothing.
    const took = await page.evaluate(
      () =>
        new Promise<number>((res) => {
          const t0 = performance.now();
          const tick = () =>
            document.querySelector('.m-toast')
              ? requestAnimationFrame(tick)
              : res(performance.now() - t0);
          tick();
        }),
    );
    expect(took).toBeGreaterThan(9_300);
    expect(took).toBeLessThan(10_600);
    // 4) a version conflict rolls back, says so and reloads.
    stale = true;
    const lists = gets(seen, /^\/candidates\?/).length;
    await pill.selectOption('not_now');
    await expect(pill).toHaveValue('maybe');
    // Bug: the reload that follows a STALE_VERSION calls setError('') first (CandidatePool.tsx:228),
    // so the conflict message set at :348 is wiped at once and nothing tells the person.
    await expect
      .soft(
        page.getByText('Someone else changed this decision.', { exact: false }),
        'the 409 shows an error notice',
      )
      .toBeVisible({ timeout: 3000 });
    await expect.poll(() => gets(seen, /^\/candidates\?/).length).toBeGreaterThan(lists);
    stale = false;
    // 5) the archived row.
    await expect(row(page, DID3)).toContainText(`· ${w('Archived')}`);
    await expect(row(page, DID3).getByRole('combobox')).toBeDisabled();
    await blur(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('j');
    await expect(page.locator('li[data-active=true]')).toHaveAttribute('id', `cand-${DID3}`);
    const n = puts(seen).length;
    await page.keyboard.press('s');
    await page.waitForTimeout(300);
    expect(puts(seen).length).toBe(n);
    // 6) the page end with a toast showing: the toast covers neither 'Show 10 more' nor a pill.
    await row(page, DID2).getByRole('combobox').selectOption('maybe');
    await expect(toast).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const more = page.getByRole('button', { name: w('Show {n} more', { n: 10 }) });
    const lastPill = page.locator('li[id^=cand-]').last().getByRole('combobox');
    const t2 = (await toast.boundingBox())!;
    for (const [what, loc] of [
      ['Show 10 more', more],
      ['the last pill', lastPill],
    ] as const) {
      const b = await loc.boundingBox();
      if (!b) continue;
      const overlap = !(
        b.x + b.width <= t2.x ||
        t2.x + t2.width <= b.x ||
        b.y + b.height <= t2.y ||
        t2.y + t2.height <= b.y
      );
      expect.soft(overlap, `the toast covers ${what}`).toBe(false);
    }
    await ux.check('page end with toast', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------------------------------ CP-16
uat(
  'CP-16',
  "Bulk 'Mark as' up to 100, partial failure, archived and unanalyzed selections",
  { on: ['D', 'T'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    let variant: 'A' | 'B' = 'A';
    const rows: Row[] = [
      prow(DID, MID, 'Aysel Məmmədova', 88, 1),
      prow(DID2, MID2, 'Rauf Əliyev', 71, 2),
      prow(DID3, MID3, 'Leyla Hüseynova', 64, 3),
      prow(DID4, MID4, 'Kamal Rzayev', 58, 4, { vacancyArchived: true }),
      statusRow(1, 'Nərgiz Sadıqova', 'failed'),
      statusRow(2, 'Tural Həsənov', 'not_analyzed'),
    ];
    const prev: Record<string, [string, number]> = {
      [MID]: ['new', 0],
      [MID2]: ['maybe', 3],
      [MID3]: ['not_now', 5],
    };
    const seen = await poolApi(page, {
      rows,
      decisions: (b) => ({
        results: b.matchIds.map((id, i) =>
          variant === 'B' && i === 2
            ? { matchId: id, ok: false, error: 'Changed by someone else.' }
            : {
                matchId: id,
                ok: true,
                version: (prev[id]?.[1] ?? 0) + 1,
                previous: { mark: prev[id]?.[0] ?? 'new', note: null, version: prev[id]?.[1] ?? 0 },
              },
        ),
        changed: variant === 'B' ? 2 : 3,
      }),
    });
    await open(page);
    const tick = (name: string) =>
      page.getByRole('checkbox', { name: w('Select {name}', { name }) }).check();
    const bulk = page.getByRole('combobox', { name: w('Mark selected as') });
    const region = page.getByRole('region', { name: w('Selected candidates') });
    for (const n of ['Aysel Məmmədova', 'Rauf Əliyev', 'Leyla Hüseynova']) await tick(n);
    await expect(region).toContainText(w('{n} selected', { n: 3 }));
    await ux.check('3 selected', [...STD, 'AZ']);
    await bulk.selectOption('shortlist');
    await expect
      .poll(() => seen.posts.filter((p) => p.url === '/candidates/decisions').length)
      .toBe(1);
    expect(seen.posts.find((p) => p.url === '/candidates/decisions')!.body).toEqual({
      matchIds: [MID, MID2, MID3],
      mark: 'shortlist',
    });
    for (const id of [DID, DID2, DID3])
      await expect(row(page, id).getByRole('combobox')).toHaveValue('shortlist');
    await expect(region).toHaveCount(0);
    const undo = page.getByRole('button', { name: w('Undo') });
    await expect(page.getByRole('status').filter({ has: undo })).toContainText(
      w('{n} marked {mark}.', { n: 3, mark: w('Shortlist') }),
    );
    const lists = gets(seen, /^\/candidates\?/).length;
    await undo.click();
    await expect.poll(() => puts(seen).length).toBe(3);
    expect(puts(seen).map((p) => [p.url, p.body])).toEqual([
      [`/candidates/${MID}/decision`, { mark: 'new', note: null, expectedVersion: 1 }],
      [`/candidates/${MID2}/decision`, { mark: 'maybe', note: null, expectedVersion: 4 }],
      [`/candidates/${MID3}/decision`, { mark: 'not_now', note: null, expectedVersion: 6 }],
    ]);
    await expect.poll(() => gets(seen, /^\/candidates\?/).length).toBeGreaterThan(lists);
    // 3) variant B: one fails.
    variant = 'B';
    await expect(row(page, DID).getByRole('combobox')).toHaveValue('new');
    for (const n of ['Aysel Məmmədova', 'Rauf Əliyev', 'Leyla Hüseynova']) await tick(n);
    await bulk.selectOption('shortlist');
    await expect(page.getByRole('status').filter({ has: undo })).toContainText(
      w('{n} marked {mark}.', { n: 2, mark: w('Shortlist') }),
    );
    await expect(
      page.getByText(
        w('{n} could not be changed: {why}', { n: 1, why: 'Changed by someone else.' }),
      ),
    ).toBeVisible();
    await ux.check('partial failure', [...STD, 'AZ']);
    // 4) archived selected.
    await tick('Kamal Rzayev');
    await expect(bulk).toBeDisabled();
    await expect(region).toContainText(w('A selected vacancy is archived.'));
    await region.getByRole('button', { name: w('Clear selection') }).click();
    // 5) only CVs without a result.
    await tick('Nərgiz Sadıqova');
    await tick('Tural Həsənov');
    await expect(bulk).toBeDisabled();
    await expect(region).toContainText(w('A CV without a result is marked on its own page.'));
    await expect(bulk.locator('option:checked')).toHaveText(w('Choose…'));
    await ux.check('unanalyzed only', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------------------------------ CP-17
async function selectAll160(page: Page, w: ReturnType<typeof words>) {
  await open(page);
  const all = page.getByRole('checkbox', { name: w('Select all shown') });
  if (await all.isVisible()) await all.check();
  else await page.getByRole('checkbox', { name: w('Select all'), exact: true }).check();
  await page.getByRole('button', { name: w('Select all {n} in this list', { n: 160 }) }).click();
  await expect(page.getByRole('region', { name: w('Selected candidates') })).toContainText(
    w('{n} selected', { n: 160 }),
  );
}
uat(
  'CP-17',
  "Bulk 'Mark as' with more than 100 selected never drops CVs silently",
  { on: ['D'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const seen = await poolApi(page, { rows: manyRows(160) });
    await selectAll160(page, w);
    const region = page.getByRole('region', { name: w('Selected candidates') });
    const bulk = page.getByRole('combobox', { name: w('Mark selected as') });
    await ux.check('160 selected', [...STD, 'AZ']);
    const disabled = await bulk.isDisabled();
    if (disabled) {
      await expect(region).toContainText(w('Up to 100 at a time.'));
      return;
    }
    await bulk.selectOption('shortlist');
    await page.waitForTimeout(1500);
    const sent = new Set(
      seen.posts
        .filter((p) => p.url === '/candidates/decisions')
        .flatMap((p) => (p.body as { matchIds: string[] }).matchIds),
    );
    const left = (await region.isVisible()) ? await region.textContent() : '';
    // Bug SD-10 (CandidatePool.tsx:355, 378): only the first 100 are posted and the whole selection
    // is cleared, so 60 CVs are dropped silently.
    expect
      .soft(
        sent.size,
        'the POSTs together cover all 160 selected CVs, or the unmarked stay selected',
      )
      .toBe(160);
    if (sent.size < 160)
      expect(left, 'CVs that were not marked stay selected').toContain(
        w('{n} selected', { n: 160 - sent.size }),
      );
    else
      await expect(
        page.getByText(w('{n} marked {mark}.', { n: 160, mark: w('Shortlist') })),
      ).toBeVisible();
    expect(matchId(1)).toBeTruthy();
  },
);

// ------------------------------------------------------------------------------------------ CP-18
uat(
  'CP-18',
  'Download CVs as one ZIP',
  { on: ['D', 'T', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const token = 'A'.repeat(43);
    const zip = Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18), 'binary');
    let zipAuth: string | undefined = 'unset';
    const rows = [
      prow(DID, MID, 'Aysel Məmmədova', 88, 1),
      prow(DID2, MID2, 'Rauf Əliyev', 71, 2),
      prow(DID3, MID3, 'Candidate 03', 66, 3),
    ];
    const seen = await poolApi(page, {
      rows,
      pageSize: 2,
      more: async (route, url) => {
        if (url.pathname === '/downloads' && route.request().method() === 'POST') {
          await new Promise((r) => setTimeout(r, 1000));
          await route.fulfill({
            status: 201,
            json: {
              url: `/downloads/${token}`,
              files: 2,
              bytes: 2 * 1024 * 1024,
              archiveName: 'CVs - Network Engineer - 2026-11-03.zip',
              expiresAt: new Date(Date.now() + 120_000).toISOString(),
              excluded: [{ documentId: DID3, label: 'Candidate 03', reason: 'erased' }],
            },
          });
          return true;
        }
        if (url.pathname === `/downloads/${token}`) {
          zipAuth = route.request().headers()['authorization'];
          await route.fulfill({
            body: zip,
            headers: {
              'content-type': 'application/zip',
              'content-disposition': `attachment; filename*=UTF-8''CVs%20-%20Network%20Engineer.zip`,
            },
          });
          return true;
        }
        return false;
      },
    });
    const errors: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(`/downloads/${token}`)) zipAuth = r.headers()['authorization'];
    });
    page.on(
      'console',
      (m) =>
        m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()),
    );
    await open(page);
    const all = page.getByRole('checkbox', { name: w('Select all shown') });
    if (await all.isVisible()) await all.check();
    else await page.getByRole('checkbox', { name: w('Select all'), exact: true }).check();
    await page.getByRole('button', { name: w('Select all {n} in this list', { n: 3 }) }).click();
    const region = page.getByRole('region', { name: w('Selected candidates') });
    await expect(region).toContainText(w('{n} selected', { n: 3 }));
    const download = page.waitForEvent('download');
    await region.getByRole('button', { name: w('Download CVs') }).click();
    const prep = region.getByRole('button', { name: w('Preparing…') });
    await expect(prep).toBeVisible();
    await expect(prep).toBeDisabled();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.zip$/);
    expect(seen.posts.find((x) => x.url === '/downloads')?.body).toEqual({
      documentIds: [DID, DID2, DID3],
    });
    // The ZIP is fetched by the browser's download manager from a plain link, so no session header
    // can be attached; Playwright reports no page request for it, so the URL is checked instead.
    expect(file.url()).toContain(`/downloads/${token}`);
    expect(zipAuth === undefined || zipAuth === 'unset').toBe(true);
    const notice =
      meta.lang === 'az'
        ? /^2 CV \(2\.0 MB\) bir ZIP faylı kimi endirilir\. 1 daxil edilmədi:/
        : /^Downloading 2 CVs \(2\.0 MB\) as one ZIP\. 1 left out: Candidate 03 \(the CV was erased\)\.$/;
    await expect(page.getByRole('status').filter({ hasText: notice }).first()).toBeVisible();
    await expect(region).toContainText(w('{n} selected', { n: 3 }));
    expect(errors).toEqual([]);
    await ux.check('downloaded', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------------------------------ CP-26
uat(
  'CP-26',
  'Tablet and phone list layout and row taps',
  { on: ['T', 'A', 'I'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const longName = 'Gülnarə Məmmədqulu qızı Əhmədova-Şıxəliyeva Xəlilbəyli Nəcəfov';
    const longVac = 'Baş şəbəkə mühəndisi (IP/MPLS, 5G nəqliyyat şəbəkəsi və GPON) — Bakı';
    const rows = manyRows(60);
    rows[0] = prow(docId(1), matchId(1), longName.slice(0, 60), 96, 1, {
      vacancyTitle: longVac.padEnd(70, '.'),
    });
    await poolApi(page, { rows });
    await open(page);
    const r1 = row(page, docId(1));
    await expect(r1).toContainText(`${w('Must-haves')}: ${w('{a} of {b}', { a: 3, b: 4 })}`);
    await expect(page.getByRole('combobox', { name: w('Sort by') })).toBeVisible();
    const selAll = page
      .locator('label')
      .filter({ has: page.getByRole('checkbox', { name: w('Select all'), exact: true }) });
    await expect(selAll).toBeVisible();
    expect((await selAll.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('checkbox', { name: w('Select all shown') })).toBeHidden();
    await expect(page.locator('[role=row]')).toBeHidden();
    await expect(page.getByText(/^Keys: J and K/)).toBeHidden();
    // Stacked: the vacancy is below the name.
    const nb = (await r1.getByRole('link').boundingBox())!;
    const vb = (await r1.getByText(longVac.slice(0, 20)).boundingBox())!;
    expect(vb.y).toBeGreaterThanOrEqual(nb.y + nb.height - 2);
    // Truncated, with the full text still in the accessible name.
    await expect(r1.getByRole('link')).toHaveAccessibleName(longName.slice(0, 60));
    // (At 820 px a 60-character name may fit; when it does not, it is cut with an ellipsis.)
    const cut = await r1
      .getByRole('link')
      .evaluate(
        (e) => e.scrollWidth <= e.clientWidth || getComputedStyle(e).textOverflow === 'ellipsis',
      );
    expect(cut).toBe(true);
    await ux.check('stacked rows', [...STD, 'AZ']);
    // 2) pill and checkbox do not navigate.
    const pill = r1.getByRole('combobox');
    await pill.tap();
    await page.waitForTimeout(300);
    expect(page.url()).toMatch(/#\/candidates$/);
    await page.keyboard.press('Escape');
    const cb = r1.getByRole('checkbox');
    const cell = cb.locator('xpath=..');
    const cbox = (await cell.boundingBox())!;
    expect(cbox.width).toBeGreaterThanOrEqual(44);
    expect(cbox.height).toBeGreaterThanOrEqual(44);
    await cell.tap();
    await expect(cb).toBeChecked();
    expect(page.url()).toMatch(/#\/candidates$/);
    // 3) the vacancy text opens the review; so does the name.
    await row(page, docId(2)).getByText('Network Engineer').tap();
    await expect(page).toHaveURL(new RegExp(`#/cv/${docId(2)}\\?l=[\\w-]{3,32}$`));
    await page.goBack();
    await expect(row(page, docId(3))).toBeVisible();
    await row(page, docId(3)).getByRole('link').tap();
    await expect(page).toHaveURL(new RegExp(`#/cv/${docId(3)}\\?l=[\\w-]{3,32}$`));
    await page.goBack();
    await expect(row(page, docId(3))).toBeVisible();
    // 4) a decision, then the page end with the toast showing.
    const pillH = (await row(page, docId(2)).getByRole('combobox').boundingBox())!.height;
    await row(page, docId(2)).getByRole('combobox').selectOption('maybe');
    const toast = page
      .getByRole('status')
      .filter({ has: page.getByRole('button', { name: w('Undo') }) });
    await expect(toast).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const bar = page.locator('nav.fixed.bottom-0');
    if (await bar.isVisible()) {
      const bb = (await bar.boundingBox())!;
      for (const [what, loc] of [
        ['Show 10 more', page.getByRole('button', { name: w('Show {n} more', { n: 10 }) })],
        ['the last row', page.locator('li[id^=cand-]').last()],
        ['the toast', toast],
      ] as const) {
        const b = (await loc.boundingBox())!;
        expect.soft(b.y + b.height, `the bottom nav covers ${what}`).toBeLessThanOrEqual(bb.y + 1);
      }
    }
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide).toBeLessThanOrEqual(1);
    expect.soft(pillH, 'the row decision pill is at least 44 px tall').toBeGreaterThanOrEqual(44);
    await ux.check('page end', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------------------------------ CP-02
uat(
  'CP-02',
  'Pool loading, empty, filtered-empty and error states',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    ux.allow(/500/);
    let mode: 'slow' | 'error' = 'slow';
    const seen = await poolApi(page, {
      rows: [],
      delayMs: (u) => (mode === 'slow' && !u.searchParams.get('q') ? 2000 : 0),
      list: () =>
        mode === 'error' ? { status: 500, body: { message: 'The list could not be loaded.' } } : [],
    });
    await page.goto('/#/candidates');
    await page.waitForTimeout(600);
    await expect(page.locator('p[role=status]').first()).toHaveText('');
    await expect(page.locator('li[id^=cand-]')).toHaveCount(0);
    await ux.check('loading', [...STD, 'AZ']);
    const empty = page.getByText(
      w('No analyzed CVs yet. Add CVs to a vacancy and choose “Find the best fit”.'),
    );
    await expect(empty).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: w('Export to Excel') })).toBeDisabled();
    await page.getByRole('searchbox', { name: w('Search candidates') }).fill('zzz');
    await expect(page.getByText(w('No candidates match.'))).toBeVisible();
    await ux.check('filtered empty', [...STD, 'AZ']);
    const card = page.locator('div.border-dashed');
    await card.getByRole('button', { name: w('Clear the filters') }).click();
    await expect(page.getByRole('searchbox', { name: w('Search candidates') })).toHaveValue('');
    await expect.poll(() => gets(seen, /^\/candidates\?/).at(-1)?.url).not.toContain('q=');
    mode = 'error';
    await page.reload();
    await expect(page.getByText('The list could not be loaded.')).toBeVisible();
    await expect(page.locator('li[id^=cand-]')).toHaveCount(0);
    await ux.check('error', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------------------------------ CP-03
uat(
  'CP-03',
  "Search, Vacancy filter and when 'Shortlist summary' can be used",
  { on: ['D', 'E', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const seen = await poolApi(page, { rows: FOUR().slice(0, 2) });
    await open(page);
    await expect(page.getByRole('searchbox', { name: w('Search candidates') })).toBeVisible();
    await page
      .getByRole('checkbox', { name: w('Select {name}', { name: 'Aysel Məmmədova' }) })
      .check();
    const region = page.getByRole('region', { name: w('Selected candidates') });
    await expect(region).toBeVisible();
    const before = seen.requests.length;
    const search = page.getByRole('searchbox', { name: w('Search candidates') });
    await search.click();
    const sentAt: Record<string, number> = {};
    page.on('request', (r) => {
      if (/\/candidates\?.*q=BGP/.test(r.url())) sentAt[r.url()] = Date.now();
    });
    await search.pressSequentially('BGP', { delay: 50 });
    const last = Date.now();
    await page.waitForTimeout(600);
    const after = seen.requests
      .slice(before)
      .filter((r) => r.method === 'GET' && /^\/candidates(\/ids)?\?/.test(r.url));
    const lists = after.filter((r) => /^\/candidates\?/.test(r.url));
    expect(lists.filter((r) => r.url.includes('q=BGP'))).toHaveLength(1);
    expect(lists).toHaveLength(1);
    const at = Object.values(sentAt)[0]! - last;
    expect(at).toBeGreaterThan(150);
    expect(at).toBeLessThan(450);
    // Bug SD-98 (CandidatePool.tsx:239-252): GET /candidates/ids follows every keystroke.
    expect
      .soft(
        after.filter((r) => r.url.startsWith('/candidates/ids')).length,
        'no request per keystroke',
      )
      .toBeLessThanOrEqual(1);
    await expect(region).toHaveCount(0);
    await expect(page.getByRole('button', { name: w('Clear the filters') })).toBeVisible();
    await search.fill('');
    await expect(page.getByRole('button', { name: w('Clear the filters') })).toHaveCount(0);
    const vac = page.getByRole('combobox', { name: w('Vacancy') });
    await expect(vac.locator('option')).toHaveText([
      w('All vacancies'),
      'Network Engineer',
      'Radio Planner',
    ]);
    expect(gets(seen, /^\/vacancies\?sort=title&order=asc$/).length).toBeGreaterThan(0);
    const sum = page.getByRole('button', { name: w('Shortlist summary') });
    await expect(sum).toBeDisabled();
    await expect(sum).toHaveAttribute('title', w('Choose a vacancy first'));
    await ux.check('summary disabled', [...STD, 'AZ']);
    await vac.selectOption({ label: 'Network Engineer' });
    await expect(sum).toBeEnabled();
    await expect
      .poll(() => gets(seen, /^\/candidates\?/).at(-1)?.url)
      .toContain('vacancy=01K0000000000000000000000V');
    await vac.selectOption({ label: w('All vacancies') });
    await expect(sum).toBeDisabled();
    // Bug SD-95 (CandidatePool.tsx:737-745): the reason is only a title on a disabled button.
    const describedBy = await sum.getAttribute('aria-describedby');
    const visible = await page
      .getByText(w('Choose a vacancy first'), { exact: true })
      .isVisible()
      .catch(() => false);
    expect(!!describedBy || visible, 'the reason is reachable by keyboard and touch').toBe(true);
  },
);

// ------------------------------------------------------------------------------------------ CP-10
uat(
  'CP-10',
  'Preview stays below the app header while the list scrolls',
  { on: ['D', 'DS', 'DW'], langs: 'EN' },
  async ({ page, ux }) => {
    await poolApi(page, { rows: manyRows(60) });
    await open(page);
    await row(page, docId(1))
      .getByText(/^\d+%$/)
      .click();
    const aside = page.getByRole('complementary');
    await expect(aside).toBeVisible();
    const header = await page.locator('header, [role=banner]').first().boundingBox();
    const top = header ? header.y + header.height : 57;
    const hit = async (what: string) => {
      const name = aside.getByRole('heading').first();
      const close = aside.getByRole('button', { name: 'Close preview' });
      const ab = (await aside.boundingBox())!;
      expect
        .soft(ab.y, `${what}: the preview starts below the header`)
        .toBeGreaterThanOrEqual(top - 1);
      for (const [n, l] of [
        ['name', name],
        ['Close preview', close],
      ] as const) {
        const b = (await l.boundingBox())!;
        const ok = await l.evaluate(
          (e, p) => {
            const h = document.elementFromPoint(p.x, p.y);
            return !!h && (h === e || e.contains(h));
          },
          { x: b.x + b.width / 2, y: b.y + b.height / 2 },
        );
        expect.soft(ok, `${what}: ${n} is on top`).toBe(true);
      }
    };
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(200);
    await hit('600 px');
    await page.evaluate(() => window.scrollBy(0, 900));
    await page.waitForTimeout(200);
    await hit('1500 px');
    await ux.check('scrolled');
    // Bug SD-11 (CandidatePreview.tsx:92): lg:sticky lg:top-4 puts the panel under the 57 px header.
    await aside.getByRole('button', { name: 'Shortlist' }).click({ timeout: 3000 });
    await aside.getByRole('button', { name: 'Close preview' }).click({ timeout: 3000 });
    await expect(aside).toHaveCount(0);
  },
);

// ------------------------------------------------------------------------------------------ CP-12
uat(
  'CP-12',
  'List keys keep working after a click; arrow keys; the active row is announced',
  { on: ['D', 'E'], langs: 'EN' },
  async ({ page, ux }) => {
    const seen = await poolApi(page, { rows: FOUR() });
    await open(page);
    const active = () =>
      page.evaluate(() => document.querySelector('li[data-active=true]')?.id ?? null);
    const strong = page
      .getByRole('group', { name: 'Match' })
      .getByRole('button', { name: 'Strong' });
    await strong.click();
    await strong.click();
    await expect(page.locator(`#cand-${DID4}`)).toBeVisible();
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    // Bug SD-12 (CandidatePool.tsx:515): after a click on a chip the focus is on a BUTTON and the
    // list keys do nothing.
    expect.soft(await active(), 'J works after a chip click').toBe(`cand-${DID}`);
    await row(page, DID2).getByRole('checkbox').check();
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    const n = puts(seen).length;
    expect.soft(await active(), 'J works after a checkbox click').toMatch(/cand-/);
    await page.keyboard.press('s');
    await page.waitForTimeout(300);
    expect.soft(puts(seen).length, 'S works after a checkbox click').toBe(n + 1);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('j');
    const a0 = await active();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    expect.soft(await active(), 'ArrowDown moves like J').not.toBe(a0);
    const li = page.locator('li[data-active=true]');
    const attrs = await li.evaluate((e) => ({
      tab: e.getAttribute('tabindex'),
      cur: e.getAttribute('aria-current'),
      sel: e.getAttribute('aria-selected'),
    }));
    expect.soft(attrs.tab !== null, 'the active row is focusable').toBe(true);
    expect
      .soft(!!attrs.cur || attrs.sel === 'true', 'the active row is exposed as current or selected')
      .toBe(true);
    await ux.check('keys after clicks');
  },
);

// ------------------------------------------------------------------------------------------ CP-22
uat(
  'CP-22',
  "Shortlist summary: Copy, 'Open in e-mail', Close",
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta, context }) => {
    const w = words(meta);
    const body = '1. Aysel Məmmədova, 88% — Strong, must-haves 3 of 4';
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await poolApi(page, {
      rows: FOUR().slice(0, 2),
      more: async (route, url) => {
        if (url.pathname !== '/candidates/shortlist-summary') return false;
        expect(url.searchParams.get('vacancy')).toBe('01K0000000000000000000000V');
        await route.fulfill({ json: { subject: 'Shortlist: Network Engineer', body, count: 1 } });
        return true;
      },
    });
    await open(page);
    await page
      .getByRole('combobox', { name: w('Vacancy') })
      .selectOption({ label: 'Network Engineer' });
    await page.getByRole('button', { name: w('Shortlist summary') }).click();
    await expect(page.getByRole('heading', { name: 'Shortlist: Network Engineer' })).toBeVisible();
    const ta = page.getByRole('textbox', { name: w('Shortlist summary') });
    await expect(ta).toHaveValue(body);
    await expect(ta).toHaveAttribute('readonly', '');
    await page.getByRole('button', { name: w('Copy'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: w('Copied.') })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body);
    await expect(page.getByRole('link', { name: w('Open in e-mail') })).toHaveAttribute(
      'href',
      `mailto:?subject=${encodeURIComponent('Shortlist: Network Engineer')}&body=${encodeURIComponent(body)}`,
    );
    await expect(
      page.getByText(w('Nothing is sent from here. You send it yourself.')),
    ).toBeVisible();
    await ux.check('summary card', [...STD, 'AZ']);
    await blur(page);
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    await expect(page.locator('li[data-active=true]')).toHaveCount(0);
    await page.getByRole('button', { name: w('Close'), exact: true }).click();
    await blur(page);
    await page.keyboard.press('j');
    await expect(page.locator('li[data-active=true]')).toHaveCount(1);
    // Without clipboard access, Copy must say it failed (SD-101, CandidatePool.tsx:778-781).
    await page.getByRole('button', { name: w('Shortlist summary') }).click();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      });
    });
    await page.getByRole('button', { name: w('Copy'), exact: true }).click();
    await page.waitForTimeout(500);
    const card = page
      .locator('div.rounded-2xl')
      .filter({ has: page.getByRole('heading', { name: 'Shortlist: Network Engineer' }) })
      .last();
    const said = await card
      .getByText(/could not|did not work|failed|not copied|denied|alınmadı|olmadı/i)
      .count();
    expect(said, 'a visible message says copying failed').toBeGreaterThan(0);
    // PLAN step 7 (the vacancy Candidates tab) is covered by CP-25, which is not built in this run.
  },
);

// ------------------------------------------------------------------------------------------ CP-27
uat(
  'CP-27',
  'Accessibility of the pool on all four backgrounds',
  { on: ['D', 'T', 'A'], langs: 'EN+AZ', timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    for (const bg of ['white', 'grey', 'cream', 'dark']) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await poolApi(page, {
        rows: manyRows(60),
        me: { background: bg },
        more: async (route, url) => {
          if (url.pathname !== '/candidates/shortlist-summary') return false;
          await route.fulfill({
            json: { subject: 'Shortlist: Network Engineer', body: '1. Aysel', count: 1 },
          });
          return true;
        },
      });
      await page.goto('/#/candidates');
      await page.reload();
      await expect(statusLine(page)).toContainText(/\d/);
      await row(page, docId(1)).getByRole('checkbox').check();
      await row(page, docId(2)).getByRole('checkbox').check();
      if (!meta.touch)
        await row(page, docId(1))
          .getByText(/^\d+%$/)
          .click();
      await page
        .getByRole('combobox', { name: w('Vacancy') })
        .selectOption({ label: 'Network Engineer' });
      await row(page, docId(1)).getByRole('checkbox').check();
      await row(page, docId(2)).getByRole('checkbox').check();
      await page.getByRole('button', { name: w('Shortlist summary') }).click();
      await ux.check(`background ${bg}`, [...STD, 'AZ']);
    }
    // The list header is a real table/grid header (SD-63, CandidatePool.tsx:928, 954-981).
    if (!meta.touch) {
      const bad = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[role=row]')].filter(
          (r) => !r.closest('table,[role=table],[role=grid],[role=treegrid],[role=rowgroup]'),
        ).length;
        const sortOnNonHeader = [...document.querySelectorAll('[aria-sort]')].filter(
          (e) =>
            !['columnheader', 'rowheader'].includes(e.getAttribute('role') ?? '') &&
            e.tagName !== 'TH',
        ).length;
        const heads = document.querySelectorAll('[role=columnheader], th').length;
        return { rows, sortOnNonHeader, heads };
      });
      expect.soft(bad.rows, 'no role=row outside a table or grid').toBe(0);
      expect.soft(bad.sortOnNonHeader, 'aria-sort only on column headers').toBe(0);
      expect.soft(bad.heads, 'columnheader cells').toBeGreaterThan(0);
    }
    const unnamed = await page.evaluate(
      () =>
        [...document.querySelectorAll('button, select, input, a[href]')].filter((e) => {
          const el = e as HTMLElement;
          if (!el.offsetParent) return false;
          const lab =
            el.getAttribute('aria-label') ||
            el.textContent?.trim() ||
            (el as HTMLInputElement).labels?.[0]?.textContent?.trim();
          return !lab;
        }).length,
    );
    expect(unnamed, 'every control has an accessible name').toBe(0);
  },
);
