import type { Page } from '@playwright/test';
import { hasRing, vview } from '../fixtures/pkg-c';
import {
  docId,
  FOUR,
  gets,
  manyRows,
  matchId,
  poolApi,
  reviewApi,
  statusRow,
  words,
  type Row,
} from '../fixtures/pkg-e';
import { expect, STD, uat, type Ux } from '../ux/test';

// 7.14 Candidate pool (CP), layer L1: the cases the first pass left out. UAT plan v1.1; each case
// is the row of the same ID. Every person here is invented.

const row = (page: Page, id: string) => page.locator(`#cand-${id}`);
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
const lastList = (seen: { requests: { method: string; url: string }[] }) =>
  seen.requests.filter((r) => r.method === 'GET' && /^\/candidates\?/.test(r.url)).at(-1)!.url;
const bar = (page: Page, w: ReturnType<typeof words>) =>
  page.getByRole('region', { name: w('Selected candidates') });
const selectAll = (page: Page, w: ReturnType<typeof words>) =>
  page.viewportSize()!.width >= 1024
    ? page.getByRole('checkbox', { name: w('Select all shown') })
    : page.getByRole('checkbox', { name: w('Select all'), exact: true });
const pick = (page: Page, w: ReturnType<typeof words>, label: string) =>
  page.getByRole('checkbox', { name: w('Select {name}', { name: label }) });

uat(
  'CP-04',
  "'Show' options and rows without a result",
  { on: ['D', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const unranked: Row[] = [
      statusRow(1, 'Failed Person', 'failed'),
      statusRow(2, 'Reading Person', 'analyzing'),
      statusRow(3, 'Look Person', 'needs_look'),
      statusRow(4, 'Blank Person', 'unreadable'),
      statusRow(5, 'Stopped Person', 'stopped'),
      statusRow(6, 'Waiting Person', 'not_analyzed'),
    ];
    const seen = await poolApi(page, {
      rows: FOUR(),
      list: (url) => (url.searchParams.has('status') ? unranked : undefined),
    });
    await open(page);
    const show = page.getByRole('combobox', { name: w('Show'), exact: true });
    const options = await show.locator('option').allTextContents();
    expect(options).toEqual(
      [
        'Ranked CVs',
        'All CVs',
        'Needs a human look',
        'Analysis failed',
        'Being analyzed',
        'Stopped',
        'Not analyzed for the current criteria',
      ].map((o) => w(o)),
    );
    const want = [
      ['Ranked CVs', null],
      ['All CVs', 'all'],
      ['Needs a human look', 'needs_look,unreadable'],
      ['Analysis failed', 'failed'],
      ['Being analyzed', 'analyzing'],
      ['Stopped', 'stopped'],
      ['Not analyzed for the current criteria', 'not_analyzed'],
    ] as const;
    for (const [label, status] of want) {
      if (label !== 'Ranked CVs') await show.selectOption({ label: w(label) });
      else if ((await show.inputValue()) !== '') await show.selectOption({ label: w(label) });
      await expect
        .poll(() => new URL(`http://x${lastList(seen)}`).searchParams.get('status'), {
          message: `request for ${label}`,
        })
        .toBe(status);
    }
    // Rows without a result.
    await show.selectOption({ label: w('Analysis failed') });
    const failed = page.locator('#cand-' + unranked[0]!.documentId);
    await expect(failed).toBeVisible();
    await expect(failed).toContainText(w('Analysis failed'));
    const dashes = failed.locator('span', { hasText: /^—$/ });
    await expect.soft(dashes).toHaveCount(2); // Must-haves and Decision
    await expect.soft(failed.getByRole('combobox')).toHaveCount(0);
    await check(ux, 'rows without a result', ['AZ']);
    // A checkbox can still be ticked; a click opens the CV directly, no preview.
    await pick(page, w, 'Failed Person').check();
    await expect(pick(page, w, 'Failed Person')).toBeChecked();
    await failed.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${unranked[0]!.documentId}\\?l=`));
  },
);

uat(
  'CP-05',
  "Match and Decision chips, counts and 'Out of date only'",
  { on: ['D', 'T'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const seen = await poolApi(page, {
      rows: FOUR(),
      counts: { byMark: { shortlist: 3, maybe: 1, not_now: 2 } },
    });
    await open(page);
    const match = page.getByRole('group', { name: w('Match'), exact: true });
    const decision = page.getByRole('group', { name: w('Decision'), exact: true });
    const chip = (g: typeof match, name: string) =>
      g.getByRole('button', { name: new RegExp(`^${w(name)}`) });
    const q = () => new URL(`http://x${lastList(seen)}`).searchParams;
    // Counts show while no filter is on.
    await expect.soft(chip(decision, 'Shortlist')).toContainText('3');
    // 1) Strong, Good, Strong again.
    await chip(match, 'Strong').click();
    await expect(chip(match, 'Strong')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => q().get('band')).toBe('strong');
    await chip(match, 'Good').click();
    await expect.poll(() => q().get('band')).toBe('strong,good');
    await chip(match, 'Strong').click();
    await expect.poll(() => q().get('band')).toBe('good');
    await expect(chip(match, 'Strong')).toHaveAttribute('aria-pressed', 'false');
    await expect
      .soft(chip(decision, 'Shortlist'), 'counts are hidden while a filter is on')
      .not.toContainText('3');
    // 2) Decision chips.
    await chip(decision, 'Shortlist').click();
    await chip(decision, 'Not now').click();
    await expect.poll(() => q().get('decision')).toBe('shortlist,not_now');
    // 3) Out of date only.
    await page.getByRole('checkbox', { name: w('Out of date only') }).check();
    await expect.poll(() => q().get('outOfDate')).toBe('true');
    await check(ux, 'filters on', ['AZ']);
    // The filter change cleared the scroll in the remembered state.
    const saved = await page.evaluate(() => sessionStorage.getItem('cv-pool:all'));
    expect.soft(JSON.parse(saved ?? '{}').scroll).toBe(0);
    // 4) Undo every filter: the counts return.
    await page.getByRole('checkbox', { name: w('Out of date only') }).uncheck();
    await chip(decision, 'Shortlist').click();
    await chip(decision, 'Not now').click();
    await chip(match, 'Good').click();
    await expect.poll(() => q().get('band')).toBeNull();
    await expect(chip(decision, 'Shortlist')).toContainText('3');
    // 5) Keyboard: Tab to a chip, a focus ring, Space toggles.
    const strong = chip(match, 'Strong');
    // A ring shows for keyboard focus only: arrive by Tab, not by a script or a click.
    await strong.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(strong).toBeFocused();
    expect.soft(await hasRing(strong), 'visible focus ring').toBe(true);
    await page.keyboard.press('Space');
    await expect(strong).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(strong).toHaveAttribute('aria-pressed', 'false');
  },
);

uat(
  'CP-06',
  "'Clear the filters' resets the list",
  { on: ['D'], langs: 'EN', timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const rows = FOUR();
    const seen = await poolApi(page, { rows });
    await open(page);
    await page.getByRole('searchbox', { name: w('Search candidates') }).fill('Aysel');
    await page
      .getByRole('combobox', { name: w('Vacancy') })
      .selectOption({ label: 'Network Engineer' });
    await page
      .getByRole('combobox', { name: w('Show'), exact: true })
      .selectOption({ label: w('All CVs') });
    const matchChip = page
      .getByRole('group', { name: w('Match'), exact: true })
      .getByRole('button', { name: /^Strong/ });
    const maybeChip = page
      .getByRole('group', { name: w('Decision'), exact: true })
      .getByRole('button', { name: /^Maybe/ });
    await matchChip.click();
    await maybeChip.click();
    await page.getByRole('checkbox', { name: w('Out of date only') }).check();
    await page
      .getByRole('table', { name: w('Sort the list') })
      .getByRole('button', { name: /^Vacancy/ })
      .click();
    // 2) Open a preview.
    await row(page, rows[0]!.documentId).click();
    await expect(page.getByRole('complementary').or(page.locator('aside')).first()).toBeVisible();
    // 3) Clear.
    await page.getByRole('button', { name: w('Clear the filters') }).click();
    await expect(page.getByRole('searchbox', { name: w('Search candidates') })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: w('Vacancy') })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: w('Show'), exact: true })).toHaveValue('');
    await expect(matchChip).toHaveAttribute('aria-pressed', 'false');
    await expect(maybeChip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('checkbox', { name: w('Out of date only') })).not.toBeChecked();
    await expect(page.getByRole('button', { name: w('Clear the filters') })).toHaveCount(0);
    await expect.poll(() => lastList(seen)).toBe('/candidates?sort=match&order=desc&limit=50');
    // The preview stays on the active row.
    await expect(row(page, rows[0]!.documentId)).toHaveAttribute('data-active', 'true');
    const saved = JSON.parse(
      (await page.evaluate(() => sessionStorage.getItem('cv-pool:all'))) ?? '{}',
    );
    expect.soft(saved.scroll).toBe(0);
    expect.soft(saved.q ?? '').toBe('');
    expect.soft(saved.sort ?? 'match').toBe('match');
    await check(ux, 'cleared');
  },
);

uat(
  'CP-07',
  "Sorting by column header and by the 'Sort by' select",
  { on: ['D', 'DS', 'T', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const rows = FOUR();
    const seen = await poolApi(page, { rows });
    await open(page);
    const q = () => new URL(`http://x${lastList(seen)}`).searchParams;
    await pick(page, w, rows[0]!.label).check();
    if (page.viewportSize()!.width >= 1024) {
      const table = page.getByRole('table', { name: w('Sort the list') });
      const btn = (n: string) => table.getByRole('button', { name: new RegExp(`^${w(n)}`) });
      const steps: [string, string, string][] = [
        ['Candidate', 'candidate', 'asc'],
        ['Candidate', 'candidate', 'desc'],
        ['Vacancy', 'vacancy', 'asc'],
        ['Match', 'match', 'desc'],
        ['Decision', 'decision', 'asc'],
        ['Updated', 'updated', 'desc'],
      ];
      for (const [name, sort, order] of steps) {
        await btn(name).click();
        await expect
          .poll(() => [q().get('sort'), q().get('order')], { message: name })
          .toEqual([sort, order]);
        await expect(btn(name)).toHaveAttribute('aria-pressed', 'true');
        await expect(btn(name)).toContainText(order === 'asc' ? '↑' : '↓');
        await expect(
          table.getByRole('columnheader').filter({
            has: page.getByRole('button', { name: new RegExp(`^${w(name)}`) }),
          }),
        ).toHaveAttribute('aria-sort', order === 'asc' ? 'ascending' : 'descending');
        await expect(pick(page, w, rows[0]!.label), 'selection stays after sorting').toBeChecked();
      }
      await expect(
        table.getByRole('columnheader', { name: w('Must-haves') }).getByRole('button'),
      ).toHaveCount(0);
      await check(ux, 'sorted', ['AZ']);
    } else {
      await expect(page.getByRole('table', { name: w('Sort the list') })).toBeHidden();
      const sel = page.getByRole('combobox', { name: w('Sort by') });
      const options = await sel.locator('option').allTextContents();
      const keys = ['Match', 'Updated', 'Candidate', 'Vacancy', 'Decision'];
      expect(options).toHaveLength(10);
      for (const k of keys) {
        expect(options).toContain(`${w(k)} ↓`);
        expect(options).toContain(`${w(k)} ↑`);
      }
      await expect(sel.locator('option:checked')).toHaveText(`${w('Match')} ↓`);
      await sel.selectOption({ label: `${w('Candidate')} ↑` });
      await expect.poll(() => [q().get('sort'), q().get('order')]).toEqual(['candidate', 'asc']);
      await expect(pick(page, w, rows[0]!.label)).toBeChecked();
      await check(ux, 'sort by', ['AZ']);
    }
  },
);

uat(
  'CP-14',
  'Selecting rows: checkboxes, select all shown and the selection bar',
  { on: ['D', 'T', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const all = manyRows(60);
    const listed = all.map((r) => ({
      documentId: r.documentId,
      matchId: r.matchId!,
      label: r.label,
      score: r.score!,
    }));
    await reviewApi(page, listed, { rows: all });
    await open(page);
    // 1) Tick two, untick one; the cell is 44 by 44.
    await pick(page, w, all[0]!.label).check();
    await pick(page, w, all[1]!.label).check();
    expect(page.url(), 'ticking does not open the row').toContain('#/candidates');
    await pick(page, w, all[1]!.label).uncheck();
    const region = bar(page, w);
    await expect(region).toContainText(w('{n} selected', { n: 1 }));
    for (const b of ['Download CVs', 'Clear selection'])
      await expect.soft(region.getByRole('button', { name: w(b) })).toBeVisible();
    await expect.soft(region.getByRole('combobox', { name: w('Mark selected as') })).toBeVisible();
    const cell = await pick(page, w, all[0]!.label).locator('xpath=..').boundingBox();
    expect
      .soft([Math.round(cell!.width), Math.round(cell!.height)], 'the cell is 44 by 44')
      .toEqual([44, 44]);
    // The bar sticks 56 px below the top and nothing covers it.
    const css = await region.evaluate((e) => ({
      pos: getComputedStyle(e).position,
      top: getComputedStyle(e).top,
    }));
    expect.soft(css).toEqual({ pos: 'sticky', top: '56px' });
    await check(ux, 'one selected', ['AZ']);
    // 2) Select all shown: the 50 loaded rows only.
    const sa = selectAll(page, w);
    if (page.viewportSize()!.width < 1024)
      expect
        .soft((await sa.locator('xpath=ancestor::label').boundingBox())!.height)
        .toBeGreaterThanOrEqual(44);
    await sa.check();
    await expect(region).toContainText(w('{n} selected', { n: 50 }));
    // 3) Show 10 more and sort: the selection stays.
    await page.getByRole('button', { name: w('Show {n} more', { n: 10 }) }).click();
    await expect(page.locator('[id^="cand-"]')).toHaveCount(60);
    await expect(region).toContainText(w('{n} selected', { n: 50 }));
    if (page.viewportSize()!.width >= 1024)
      await page
        .getByRole('table', { name: w('Sort the list') })
        .getByRole('button', { name: new RegExp(`^${w('Candidate')}`) })
        .click();
    else
      await page
        .getByRole('combobox', { name: w('Sort by') })
        .selectOption({ label: `${w('Candidate')} ↑` });
    await expect(region).toContainText(w('{n} selected', { n: 50 }));
    // 5) A trip to a CV and back keeps them (sessionStorage).
    expect
      .soft(await page.evaluate(() => sessionStorage.getItem('cv-pool-selection:cv-pool:all')))
      .toBeTruthy();
    await page.locator(`#cand-${all[3]!.documentId} a`).first().click();
    await expect(page).toHaveURL(/#\/cv\//);
    await page.goBack();
    await expect(statusLine(page)).toContainText(/\d/);
    await expect(bar(page, w)).toContainText(w('{n} selected', { n: 50 }));
    // 6) A filter change empties the selection.
    await page.getByRole('button', { name: new RegExp(`^${w('Strong')}`) }).click();
    await expect(bar(page, w)).toHaveCount(0);
    // 7) Tick a row and clear the selection.
    await page.getByRole('button', { name: new RegExp(`^${w('Strong')}`) }).click();
    await pick(page, w, all[0]!.label).check();
    await bar(page, w)
      .getByRole('button', { name: w('Clear selection') })
      .click();
    await expect(bar(page, w)).toHaveCount(0);
  },
);

uat(
  'CP-15',
  "'Select all n in this list' banners",
  { on: ['D', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const seen = await poolApi(page, { rows: manyRows(160) });
    await open(page);
    await selectAll(page, w).check();
    const banner = page.getByText(w('All {n} shown are selected.', { n: 50 }));
    await expect(banner).toBeVisible();
    await check(ux, 'first banner', ['AZ']);
    await page.getByRole('button', { name: w('Select all {n} in this list', { n: 160 }) }).click();
    await expect(bar(page, w)).toContainText(w('{n} selected', { n: 160 }));
    await expect(page.getByText(w('All {n} in this list are selected.', { n: 160 }))).toBeVisible();
    expect(gets(seen, /^\/candidates\/ids/).length, 'one ids request').toBeGreaterThan(0);
    await check(ux, 'second banner', ['AZ']);
    await page
      .getByRole('button', { name: w('Clear selection') })
      .last()
      .click();
    await expect(bar(page, w)).toHaveCount(0);
    await expect(page.getByText(w('All {n} in this list are selected.', { n: 160 }))).toHaveCount(
      0,
    );
    await expect(page.getByText(w('All {n} shown are selected.', { n: 50 }))).toHaveCount(0);
  },
);

uat(
  'CP-19',
  'Download limit and download errors, in EN and AZ',
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    let variant: 'limit' | 'none' | 'size' | 'excluded' = 'limit';
    const body = {
      limit: { status: 413, json: { statusCode: 413, message: 'Up to 500 CVs per download.' } },
      none: {
        status: 422,
        json: { statusCode: 422, message: 'None of the chosen CVs can be downloaded.' },
      },
      size: {
        status: 413,
        json: { statusCode: 413, message: 'Up to 1 GB per download. Choose fewer CVs.' },
      },
    } as const;
    await poolApi(page, {
      rows: manyRows(501),
      more: async (route, url) => {
        if (url.pathname === '/downloads' && route.request().method() === 'POST') {
          if (variant === 'excluded') {
            await route.fulfill({
              json: {
                url: '/downloads/once',
                files: 3,
                bytes: 3000,
                archiveName: 'cvs.zip',
                excluded: Array.from({ length: 7 }, (_, i) => ({
                  documentId: docId(500 + i),
                  label: `Left Out ${i + 1}`,
                  reason: 'erased',
                })),
              },
            });
          } else await route.fulfill(body[variant]);
          return true;
        }
        if (url.pathname === '/downloads/once') {
          await route.fulfill({
            body: 'PK',
            contentType: 'application/zip',
            headers: { 'content-disposition': 'attachment; filename="cvs.zip"' },
          });
          return true;
        }
        return false;
      },
      pageSize: 50,
    });
    await open(page);
    // 1) Select all 501: the button is off and the reason shows.
    await selectAll(page, w).check();
    await page.getByRole('button', { name: w('Select all {n} in this list', { n: 501 }) }).click();
    const region = bar(page, w);
    await expect(region).toContainText(w('{n} selected', { n: 501 }));
    await expect(region.getByRole('button', { name: w('Download CVs') })).toBeDisabled();
    await expect(region.getByText(w('Up to 500 CVs per download. Narrow the list.'))).toBeVisible();
    await check(ux, '501 selected', ['AZ']);
    await region.getByRole('button', { name: w('Clear selection') }).click();
    // 2) Ten rows against each error.
    for (const v of ['limit', 'none', 'size'] as const) {
      variant = v;
      await selectAll(page, w).check();
      for (let i = 10; i < 50; i++) await pick(page, w, manyRows(50)[i]!.label).uncheck();
      await region.getByRole('button', { name: w('Download CVs') }).click();
      const err = page.getByRole('alert').first();
      await expect(err, `error for ${v}`).toBeVisible();
      if (meta.lang === 'az')
        expect
          .soft((await err.textContent()) ?? '', 'no English sentence in AZ')
          .not.toMatch(/Up to|None of the chosen/);
      await expect(
        region.getByRole('button', { name: w('Download CVs') }),
        'usable again',
      ).toBeEnabled();
      await check(ux, `error ${v}`, ['AZ']);
      await region.getByRole('button', { name: w('Clear selection') }).click();
    }
    // 3) A ticket with 7 left out: the notice names 5 and 'and 2 more'.
    variant = 'excluded';
    await pick(page, w, manyRows(50)[0]!.label).check();
    const [dl] = await Promise.all([
      page.waitForEvent('download').catch(() => null),
      region.getByRole('button', { name: w('Download CVs') }).click(),
    ]);
    void dl;
    // Two live regions carry the sentence (the box and the spoken copy inside it): look at the box.
    const notice = page.locator('div[role="status"]').filter({ hasText: /Left Out 1/ });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(w('and {n} more', { n: 2 }));
    await check(ux, 'excluded', ['AZ']);
  },
);

uat(
  'CP-23',
  "Paging with 'Show n more' and an expired list",
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    let expire = false;
    await poolApi(page, {
      rows: manyRows(160),
      delayMs: () => 250,
      list: (url) =>
        expire && url.searchParams.get('cursor') === '100'
          ? { status: 410, body: { statusCode: 410, message: 'This list has expired.' } }
          : undefined,
    });
    await open(page);
    const count = () => page.locator('[id^="cand-"]').count();
    const more = (n: number) => page.getByRole('button', { name: w('Show {n} more', { n }) });
    await expect(more(50)).toBeVisible();
    await more(50).click();
    await expect(page.getByRole('button', { name: w('Loading…') })).toBeDisabled();
    await expect.poll(count).toBe(100);
    await expect(more(50)).toBeVisible();
    await more(50).click();
    await expect.poll(count).toBe(150);
    await expect(more(10)).toBeVisible();
    await more(10).click();
    await expect.poll(count).toBe(160);
    await expect(page.getByRole('button', { name: /^(Show \d+ more|Daha \d+)/ })).toHaveCount(0);
    // No duplicates, in order, and the status line keeps the total.
    const ids = await page.locator('[id^="cand-"]').evaluateAll((els) => els.map((e) => e.id));
    expect(new Set(ids).size).toBe(160);
    expect.soft(ids[0]).toBe(`cand-${docId(1)}`);
    expect.soft(ids[159]).toBe(`cand-${docId(160)}`);
    await expect(statusLine(page)).toContainText('160');
    await check(ux, 'all rows', ['AZ']);
    // 410 on the third page.
    expire = true;
    await ux.allow(/410|expired/);
    await page.reload();
    await expect(more(50)).toBeVisible();
    await more(50).click();
    await expect.poll(count).toBe(100);
    await more(50).click();
    const notice = page.getByText(w('This list was opened a while ago. Reload it to continue.'));
    await expect(notice).toBeVisible();
    await check(ux, 'expired', ['AZ']);
    expire = false;
    await page.getByRole('button', { name: w('Reload'), exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect.poll(count).toBe(50);
  },
);

uat(
  'CP-24',
  'Coming back from a CV restores filters, sort, scroll and the active row',
  { on: ['D', 'T'], langs: 'EN', timeout: 150_000 },
  async ({ page, meta }) => {
    const w = words(meta);
    const all = manyRows(160);
    const listed = all.map((r) => ({
      documentId: r.documentId,
      matchId: r.matchId!,
      label: r.label,
      score: r.score!,
    }));
    await reviewApi(page, listed, { rows: all });
    await open(page);
    // 1) Chip Strong and sort Candidate ↑.
    await page.getByRole('button', { name: new RegExp(`^${w('Strong')}`) }).click();
    if (page.viewportSize()!.width >= 1024)
      await page
        .getByRole('table', { name: w('Sort the list') })
        .getByRole('button', { name: /^Candidate/ })
        .click();
    else
      await page
        .getByRole('combobox', { name: w('Sort by') })
        .selectOption({ label: 'Candidate ↑' });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // 2) J 20 times, Enter, Back.
    for (let i = 0; i < 20; i++) await page.keyboard.press('j');
    const active = page.locator('[data-active="true"]');
    await expect(active).toHaveCount(1);
    const activeId = await active.getAttribute('id');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/cv\//);
    await page
      .getByRole('link', { name: /Back to Candidates/ })
      .first()
      .click();
    await expect(statusLine(page)).toContainText(/\d/);
    await expect(page.getByRole('button', { name: new RegExp(`^${w('Strong')}`) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-active="true"]')).toHaveAttribute('id', activeId!);
    await expect(page.locator('[data-active="true"]')).toBeInViewport();
    // 3) Show 50 more twice, open row 120 by its name, Back.
    const more = page.getByRole('button', { name: /^Show \d+ more/ });
    await more.click();
    await expect(page.locator('[id^="cand-"]').nth(99)).toBeAttached();
    if (await more.count()) await more.click();
    const n = await page.locator('[id^="cand-"]').count();
    expect(n).toBeGreaterThanOrEqual(100);
    const target = page.locator('[id^="cand-"]').nth(Math.min(119, n - 1));
    const targetId = await target.getAttribute('id');
    await target.scrollIntoViewIfNeeded();
    await target.getByRole('link').first().click();
    await expect(page).toHaveURL(/#\/cv\//);
    await page
      .getByRole('link', { name: /Back to Candidates/ })
      .first()
      .click();
    await expect(page.locator(`#${targetId}`)).toBeAttached({ timeout: 15_000 });
    await expect(page.locator(`#${targetId}`)).toHaveAttribute('data-active', 'true');
    await expect(page.locator(`#${targetId}`)).toBeInViewport();
  },
);

uat(
  'CP-25',
  "Vacancy Candidates tab and 'Latest upload only'",
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const rows = FOUR().slice(0, 2);
    const VID = rows[0]!.vacancyId;
    const seen = await poolApi(page, {
      rows,
      // The vacancy page around the Candidates tab.
      more: async (route, url) => {
        if (url.pathname === `/vacancies/${VID}` && route.request().method() === 'GET') {
          await route.fulfill({ json: vview({ id: VID, title: 'Network Engineer' }) });
          return true;
        }
        return false;
      },
    });
    await page.goto(`/#/vacancies/${VID}/candidates`);
    // The vacancy page has its own live region (what is missing before a start): take the pool's.
    await expect(
      page.locator('p[role="status"]').filter({ hasText: /\d+ (candidates?|namizəd)/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: w('Candidates') })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: w('Vacancy') })).toHaveCount(0);
    expect(new URL(`http://x${lastList(seen)}`).searchParams.get('vacancy')).toBe(VID);
    // 2) The batch filter, as the batch panel's See results does it.
    const fire = () =>
      page.evaluate((v) => {
        sessionStorage.setItem(`cv-batch-filter:${v}`, 'BATCH0000000000000000000A');
        window.dispatchEvent(new Event('cv-batch-filter'));
      }, VID);
    await fire();
    const chip = page.getByRole('button', { name: new RegExp(`^${w('Latest upload only')}`) });
    await expect(chip).toBeVisible();
    await expect
      .poll(() => new URL(`http://x${lastList(seen)}`).searchParams.get('batch'))
      .toBe('BATCH0000000000000000000A');
    await check(ux, 'filtered', ['AZ']);
    // 3) The chip removes it.
    await chip.click();
    await expect(chip).toHaveCount(0);
    // 4) Again, then Clear the filters.
    await fire();
    await expect(chip).toBeVisible();
    await page.getByRole('button', { name: w('Clear the filters') }).click();
    await expect(chip).toHaveCount(0);
    const keys = await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith('cv-pool:')),
    );
    expect
      .soft(keys, 'state lives under the vacancy key, apart from the global one')
      .toContain(`cv-pool:${VID}`);
    // 5) Open a CV: Back reads the vacancy's title.
    await row(page, rows[0]!.documentId).getByRole('link').click();
    await expect(page).toHaveURL(/#\/cv\//);
  },
);

uat(
  'CP-28',
  'Motion and reduced motion on the pool',
  { on: ['D', 'A'], langs: 'EN', timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const rows = FOUR();
    await poolApi(page, { rows });
    const animations = () =>
      page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    // 1) Reduced motion: no animation after any step.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    expect(await animations(), 'on arrival').toBe(0);
    await pick(page, w, rows[0]!.label).check();
    expect(await animations(), 'after ticking').toBe(0);
    await pick(page, w, rows[0]!.label).uncheck();
    const wide = page.viewportSize()!.width >= 1024;
    if (wide) {
      await row(page, rows[1]!.documentId).click();
      await expect(page.locator('aside, [aria-label]').first()).toBeVisible();
      expect(await animations(), 'after opening the preview').toBe(0);
    }
    await ux.check('reduced motion', [...STD, 'RM']);
    // 2) Motion allowed: it moves, and a second later it has settled.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(statusLine(page)).toContainText(/\d/);
    await pick(page, w, rows[0]!.label).check();
    await page.waitForTimeout(1200);
    expect(await animations(), 'a second later nothing is still animating').toBe(0);
    await ux.check('motion settled', STD);
  },
);

void matchId;
