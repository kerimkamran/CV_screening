import { ulidOf } from '../fixtures/files';
import {
  daysAgo,
  esc,
  hasRing,
  minsAgo,
  must,
  nice,
  onBackgrounds,
  OWNER,
  pageScrollsSideways,
  reqs,
  smallTargets,
  T,
  tabTo,
  vacApi,
  vrow,
  vview,
} from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';

// 7.6 Vacancy list (VL) and 7.8 Vacancy page (VP), layer L1. UAT plan v1.1; each case is the row of the same ID.

const id = (n: number) => ulidOf('VAC', n);
const SIX = () => [
  vrow({ id: id(11), title: 'UAT Draft role', status: 'draft' }),
  vrow({
    id: id(12),
    title: 'UAT Open role',
    status: 'open',
    department: 'Network',
    location: 'Bakı',
    documents: 4,
    analyzed: 4,
    strong: 1,
  }),
  vrow({ id: id(13), title: 'UAT On hold role', status: 'on_hold' }),
  vrow({ id: id(14), title: 'UAT Closed role', status: 'closed', updatedAt: daysAgo(20) }),
  vrow({ id: id(15), title: 'UAT Archived role', status: 'open', archived: true }),
  vrow({
    id: id(16),
    title: 'UAT Decided role',
    status: 'open',
    documents: 6,
    analyzed: 6,
    strong: 3,
    decisions: { shortlist: 3, maybe: 1, notNow: 2 },
  }),
];
/** The cells of a list row: title block, status, analyzed, strong, decisions, owner, updated. */
const cells = (li: import('@playwright/test').Locator) =>
  li.evaluate((el) =>
    [...el.children]
      .slice(0, 7)
      .map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
  );

/** The date the app should show for an old row, in the app language (not the browser's). */
const longAgo = (page: import('@playwright/test').Page, iso: string, lang: 'en' | 'az') =>
  page.evaluate(
    ([d, l]) =>
      new Date(d!).toLocaleDateString(l === 'az' ? 'az-AZ' : 'en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [iso, lang],
  );

uat(
  'VL-01',
  'Vacancy list on desktop: header, columns, rows, title link, 4 backgrounds',
  { on: ['D', 'DW', 'DS', 'E'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const rows = SIX();
    await vacApi(page, {
      list: rows,
      views: [vview({ id: id(11), title: 'UAT Draft role', status: 'draft' })],
    });
    await page.goto('/#/vacancies');

    await expect(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
    await expect(page.getByRole('link', { name: t('New vacancy'), exact: true })).toHaveAttribute(
      'href',
      '#/vacancies/new',
    );
    const list = page.getByRole('list', { name: t('Vacancies') });
    await expect(list.getByRole('listitem')).toHaveCount(6);
    // From 1024 px: the column header row.
    const header = list.locator('xpath=preceding-sibling::div[1]');
    await expect(header).toBeVisible();
    // The header is uppercase by CSS; Azerbaijani case rules (İ/i) need the language's own lowercasing.
    const lc = (x: string) => x.toLocaleLowerCase(meta.lang === 'az' ? 'az' : 'en');
    expect((await header.innerText()).split(/\n+/).map((s) => lc(s.trim()))).toEqual(
      ['Title', 'Status', 'Analyzed', 'Strong', 'Decisions', 'Owner', 'Updated'].map((x) =>
        lc(t(x)),
      ),
    );
    // The rows, found by content so they stay found after the language changes.
    const li = (n: number) =>
      page
        .locator('ul[aria-label]')
        .filter({ hasText: 'UAT Draft role' })
        .getByRole('listitem')
        .nth(n);
    const status = ['Draft', 'Open', 'On hold', 'Closed', 'Archived', 'Open'];
    for (let i = 0; i < 6; i++) {
      const c = await cells(li(i));
      expect.soft(c[1], `row ${i + 1} status`).toBe(t(status[i]!));
      expect.soft(c[5], `row ${i + 1} owner`).toBe(OWNER.name);
    }
    // The archived row: a grey badge.
    await expect.soft(li(4).getByText(t('Archived'), { exact: true })).toHaveClass(/bg-neutral/);
    const draft = await cells(li(0));
    expect.soft(draft[2], 'nothing analyzed').toBe('—');
    expect.soft(draft[3]).toBe('—');
    expect.soft(draft[6], 'updated 3 min ago').toBe(t('{n} min ago', { n: 3 }));
    const decided = li(5);
    for (const p of [`3 ${t('Shortlist')}`, `1 ${t('Maybe')}`, `2 ${t('Not now')}`])
      await expect.soft(decided.getByText(p, { exact: true })).toBeVisible();
    await expect.soft(li(1).getByText('Network · Bakı', { exact: true })).toBeVisible();
    // SD-131: the 20-day-old date in the app language.
    expect
      .soft((await cells(li(3)))[6], 'old date in the app language')
      .toBe(await longAgo(page, rows[3]!.updatedAt as string, meta.lang));

    // KEY: the first title link is reachable by Tab with a visible focus ring.
    const first = li(0).getByRole('link', { name: 'UAT Draft role' });
    expect.soft(await tabTo(page, first), 'Tab reaches the first title').toBe(true);
    expect.soft(await hasRing(first), 'focus ring on the title link').toBe(true);
    await ux.check('list', [...STD, 'AZ']);

    // 3) The title link opens the vacancy; 4) back.
    await first.click();
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${id(11)}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'UAT Draft role' })).toBeVisible();
    await page.goBack();
    await expect(list.getByRole('listitem')).toHaveCount(6);

    // The 4 backgrounds.
    await onBackgrounds(page, meta.lang, async (bg) => {
      await ux.check(`background ${bg}`, [...STD, 'AZ']);
    });

    // 5) Switch to Azerbaijani (in the English run, the browser stays en-GB: SD-131).
    if (meta.lang === 'en') {
      const az = T('az');
      await page.getByLabel(t('Account menu')).click();
      await page.getByLabel(t('Language')).selectOption('az');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { level: 1, name: az('Vacancies') })).toBeVisible();
      expect.soft((await cells(li(0)))[1]).toBe(az('Draft'));
      const shown = (await cells(li(3)))[6]!;
      expect
        .soft(shown, 'no English month name in the Azerbaijani UI')
        .not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
      expect
        .soft(shown, 'old date formatted for the app language (az-AZ), not the browser (en-GB)')
        .toBe(await longAgo(page, rows[3]!.updatedAt as string, 'az'));
      await ux.check('switched to Azerbaijani', [...STD]);
    }
  },
);

uat(
  'VL-02',
  'Vacancy list on tablet and phone: 2-column rows, labels, long titles',
  { on: ['T', 'TL', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const long =
      `UAT ${'Şəbəkə mühəndisi və IP/MPLS nüvə arxitekturası üzrə aparıcı mütəxəssis '.repeat(3)}`.slice(
        0,
        180,
      );
    const dept =
      'Şəbəkə əməliyyatları və informasiya texnologiyaları departamenti, Bakı baş ofisi, 3-cü mərtəbə'.slice(
        0,
        90,
      );
    const rows = [
      ...SIX(),
      vrow({
        id: id(17),
        title: long,
        department: dept,
        status: 'open',
        documents: 3,
        analyzed: 3,
        strong: 2,
      }),
    ];
    await vacApi(page, { list: rows });
    await page.goto('/#/vacancies');
    const list = page.getByRole('list', { name: t('Vacancies') });
    await expect(list.getByRole('listitem')).toHaveCount(7);
    const vw = page.viewportSize()!.width;

    expect.soft(await pageScrollsSideways(page), 'page scrolls sideways').toBe(false);
    const last = list.getByRole('listitem').last();
    if (vw < 1024) {
      // The title spans the row; the values carry their labels.
      const title = last.locator(':scope > div').first();
      const tb = (await title.boundingBox())!;
      const lb = (await last.boundingBox())!;
      expect.soft(tb.width, 'title spans the row').toBeGreaterThan(lb.width * 0.8);
      await expect.soft(last.getByText(`${t('Analyzed')}:`)).toBeVisible();
      await expect.soft(last.getByText(`${t('Strong')}:`)).toBeVisible();
    }
    // Chips and the search box stay inside the viewport.
    for (const el of [
      page.getByRole('group', { name: t('Status') }),
      page.getByRole('searchbox', { name: t('Search vacancies') }),
    ]) {
      const b = (await el.boundingBox())!;
      expect.soft(b.x, 'left edge inside').toBeGreaterThanOrEqual(0);
      expect.soft(b.x + b.width, 'right edge inside').toBeLessThanOrEqual(vw + 1);
    }
    // The long title: one line, full text reachable.
    const link = last.getByRole('link').first();
    // One line = every piece of its text sits on the same line box (the link itself may be taller:
    // touch screens give it a 44 px target).
    const one = await link.evaluate((a) => {
      const r = document.createRange();
      r.selectNodeContents(a);
      return {
        lines: new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size,
        nowrap: getComputedStyle(a).whiteSpace === 'nowrap',
      };
    });
    expect.soft(one.nowrap && one.lines === 1, 'long title on one line').toBe(true);
    const full =
      (await link.getAttribute('title')) ??
      (await link.evaluate((a) => (a as HTMLElement).innerText || a.textContent));
    expect.soft(full?.trim(), 'full title reachable').toBe(long.trim());
    await ux.check('rows', [...STD, 'AZ']);

    // 2) Scroll to the end; 3) the '⋯' menu of the last row.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await last.getByLabel(t('Actions for {title}', { title: long })).click();
    const menu = last.locator('details[open] > div');
    await expect(menu).toBeVisible();
    await menu.scrollIntoViewIfNeeded();
    const mb = (await menu.boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect
      .soft(
        mb.x >= 0 && mb.x + mb.width <= vw + 1 && mb.y >= 0 && mb.y + mb.height <= vh + 1,
        `menu inside the viewport (${JSON.stringify(mb)})`,
      )
      .toBe(true);
    await ux.check('last row menu', [...STD, 'AZ'], { overlay: 'details[open] > div' });
    // Every visible control meets the touch target size (44 px on touch screens).
    expect
      .soft(await smallTargets(page.locator('main').first()), 'controls under 44×44 px')
      .toEqual([]);
  },
);

uat(
  'VL-03',
  'Status chips filter the list (All, Draft, Open, On hold, Closed, Archived)',
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const two = [
      vrow({ id: id(21), title: 'UAT Chip one' }),
      vrow({ id: id(22), title: 'UAT Chip two', status: 'closed' }),
    ];
    const { seen } = await vacApi(page, {
      list: (u) =>
        u.searchParams.get('status') === 'draft'
          ? [vrow({ id: id(23), title: 'UAT Chip draft', status: 'draft' })]
          : u.searchParams.get('archived') === 'true'
            ? [vrow({ id: id(24), title: 'UAT Chip archived', archived: true })]
            : two,
    });
    await page.goto('/#/vacancies');
    const list = page.getByRole('list', { name: t('Vacancies') });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    const group = page.getByRole('group', { name: t('Status') });
    const gets = () => reqs(seen, 'GET', /^\/vacancies\?/);
    const pressed = () => group.locator('button[aria-pressed=true]');
    const want: [string, Record<string, string | null>][] = [
      ['Draft', { status: 'draft', archived: null }],
      ['Open', { status: 'open', archived: null }],
      ['On hold', { status: 'on_hold', archived: null }],
      ['Closed', { status: 'closed', archived: null }],
      ['Archived', { status: null, archived: 'true' }],
      ['All', { status: null, archived: null }],
    ];
    for (const [label, params] of want) {
      const before = gets().length;
      await group.getByRole('button', { name: t(label), exact: true }).click();
      await expect
        .poll(() => gets().length, { message: `a request for ${label}` })
        .toBeGreaterThan(before);
      const q = new URL(`http://x${gets().at(-1)!.url}`).searchParams;
      for (const [k, v] of Object.entries(params)) expect.soft(q.get(k), `${label}: ${k}`).toBe(v);
      expect.soft(q.get('sort'), `${label}: sort`).toBe('updated');
      expect.soft(q.get('order'), `${label}: order`).toBe('desc');
      await expect.soft(pressed()).toHaveCount(1);
      await expect.soft(pressed()).toHaveText(t(label));
    }
    await ux.check('chips', [...STD, 'AZ']);
    // KEY: Tab to the chips, Space on 'Closed'.
    await page.locator('h1').click();
    const closed = group.getByRole('button', { name: t('Closed'), exact: true });
    expect.soft(await tabTo(page, closed), 'Tab reaches the chips').toBe(true);
    expect.soft(await hasRing(closed), 'focus ring on a chip').toBe(true);
    await ux.shot('focus on Closed');
    await page.keyboard.press('Space');
    await expect.soft(closed).toHaveAttribute('aria-pressed', 'true');
    await expect.soft(pressed()).toHaveCount(1);
    // In Azerbaijani no chip label is English.
    if (meta.lang === 'az') {
      const labels = await group.getByRole('button').allInnerTexts();
      for (const [i, en] of ['All', 'Draft', 'Open', 'On hold', 'Closed', 'Archived'].entries())
        expect
          .soft(labels[i] !== en && labels[i] === t(en), `chip ${en} in Azerbaijani`)
          .toBe(true);
    }
  },
);

uat(
  'VL-04',
  "Search, sort, 'Clear the filters' and remembering them on return",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const rows = [
      vrow({ id: id(31), title: 'UAT Network lead', department: 'Network' }),
      vrow({ id: id(32), title: 'UAT Netops engineer' }),
    ];
    const { seen } = await vacApi(page, {
      list: (u) => (u.searchParams.get('q') === 'zzz' ? [] : rows),
      views: [vview({ id: id(31), title: 'UAT Network lead' })],
    });
    const times: { url: string; at: number }[] = [];
    page.on('request', (r) => {
      if (/\/vacancies\?/.test(r.url())) times.push({ url: r.url(), at: Date.now() });
    });
    await page.goto('/#/vacancies');
    await expect(
      page.getByRole('list', { name: t('Vacancies') }).getByRole('listitem'),
    ).toHaveCount(2);
    const search = page.getByRole('searchbox', { name: t('Search vacancies') });
    await expect
      .soft(search)
      .toHaveAttribute('placeholder', t('Search by title, department or place'));
    // The chip is part of what is remembered (step 6 expects it to return to All).
    await page
      .getByRole('group', { name: t('Status') })
      .getByRole('button', { name: t('Open'), exact: true })
      .click();
    await expect
      .poll(() => times.filter((x) => /status=open/.test(x.url)).length)
      .toBeGreaterThan(0);

    // 1) 'net' one key at a time.
    await search.click();
    let lastKey = 0;
    for (const k of 'net') {
      await page.keyboard.type(k);
      lastKey = Date.now();
      await page.waitForTimeout(80);
    }
    await expect.poll(() => times.filter((x) => /[?&]q=net(&|$)/.test(x.url)).length).toBe(1);
    await page.waitForTimeout(400);
    const qs = times.filter((x) => /[?&]q=/.test(x.url));
    expect
      .soft(
        qs.map((x) => new URL(x.url).searchParams.get('q')),
        'one request, not one per key',
      )
      .toEqual(['net']);
    // Both times are taken in the test process (about ±30 ms of transport each way), so 250 ms in the
    // page reads as 200 to 300 ms here; a request per key would be under 100 ms.
    expect
      .soft(qs[0]!.at - lastKey, 'sent about 250 ms after the last key')
      .toBeGreaterThanOrEqual(200);
    await ux.check('searched', [...STD, 'AZ']);

    // 2) Sort.
    await page.getByLabel(t('Sort by')).selectOption({ label: t('Title A to Z') });
    await expect.poll(() => reqs(seen, 'GET', /sort=title&order=asc/).length).toBeGreaterThan(0);

    // 3) A title, then '← Vacancies'; 4) reload.
    const check = async (when: string) => {
      await expect
        .soft(
          page.getByRole('group', { name: t('Status') }).locator('[aria-pressed=true]'),
          `${when}: chip`,
        )
        .toHaveText(t('Open'));
      await expect.soft(search, `${when}: search`).toHaveValue('net');
      await expect.soft(page.getByLabel(t('Sort by')), `${when}: sort`).toHaveValue('title');
    };
    await page.getByRole('link', { name: 'UAT Network lead' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'UAT Network lead' })).toBeVisible();
    await page.getByRole('link', { name: t('← Vacancies') }).click();
    await expect(page).toHaveURL(/#\/vacancies$/);
    await check('after returning');
    const stored = await page.evaluate(() => sessionStorage.getItem('cv-vacancy-list'));
    expect.soft(JSON.parse(stored ?? '{}')).toEqual({ chip: 'open', q: 'net', sort: 'title' });
    await page.reload();
    await check('after reload');

    // 5) 'zzz'; 6) Clear the filters.
    await search.fill('zzz');
    await expect(page.getByText(t('No vacancies match.'))).toBeVisible();
    const clear = page.getByRole('button', { name: t('Clear the filters') });
    await expect(clear).toBeVisible();
    await ux.check('no match', [...STD, 'AZ']);
    await clear.click();
    await expect
      .soft(page.getByRole('group', { name: t('Status') }).locator('[aria-pressed=true]'))
      .toHaveText(t('All'));
    await expect.soft(search).toHaveValue('');
    await expect.soft(page.getByLabel(t('Sort by'))).toHaveValue('title');
  },
);

uat(
  'VL-05',
  'Vacancy list loading, empty and error states',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    let mode: 'slow' | 'empty' | 'error' = 'slow';
    await vacApi(page, {
      extra: async (route, url, method) => {
        if (url.pathname !== '/vacancies' || method !== 'GET') return false;
        if (mode === 'slow') {
          await new Promise((r) => setTimeout(r, 2000));
          await route.fulfill({ json: [vrow({ id: id(41), title: 'UAT Slow role' })] });
        } else if (mode === 'empty') await route.fulfill({ json: [] });
        else
          await route.fulfill({
            status: 500,
            json: { statusCode: 500, message: 'Database not reachable' },
          });
        return true;
      },
    });
    ux.allow(/500/);
    // Delayed.
    await page.goto('/#/vacancies');
    await expect(page.getByText(t('Loading…'))).toBeVisible();
    await ux.check('loading', [...STD, 'AZ']);
    await expect(page.getByRole('link', { name: 'UAT Slow role' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t('Loading…'))).toHaveCount(0);

    // Empty, with no filter.
    mode = 'empty';
    await page.reload();
    const box = page.getByText(t('No vacancies yet. Add the first one.')).locator('..');
    await expect(box).toBeVisible();
    await ux.check('empty', [...STD, 'AZ']);
    await box.getByRole('link', { name: t('New vacancy') }).click();
    await expect(page).toHaveURL(/#\/vacancies\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: t('New vacancy') })).toBeVisible();

    // Error.
    mode = 'error';
    await page.goto('/#/vacancies');
    await page.reload();
    const alert = page.getByRole('alert').filter({ hasText: t('Database not reachable') });
    await expect(alert).toBeVisible();
    await expect.soft(page.getByText(t('Loading…'))).toHaveCount(0);
    await ux.check('error', [...STD, 'AZ']);
  },
);

uat(
  'VL-06',
  "Row '⋯' menu: items, Escape, outside click, one menu at a time, not painted under the next rows",
  { on: ['D', 'T', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const rows = Array.from({ length: 8 }, (_, i) =>
      vrow({
        id: id(51 + i),
        title: `UAT Menu row ${i + 1}`,
        archived: i === 4,
        documents: 2,
        analyzed: 2,
        strong: 1,
      }),
    );
    await vacApi(page, { list: rows });
    await page.goto('/#/vacancies');
    const list = page.getByRole('list', { name: 'Vacancies' });
    await expect(list.getByRole('listitem')).toHaveCount(8);
    await page.waitForTimeout(800); // the rows have risen
    const dots = (n: number) => page.getByLabel(`Actions for UAT Menu row ${n}`);
    const menuOf = (n: number) =>
      list
        .getByRole('listitem')
        .nth(n - 1)
        .locator('details > div');
    const openCount = () => list.locator('details[open]').count();
    const closeAll = () =>
      list
        .locator('details[open]')
        .evaluateAll((ds) => ds.forEach((d) => d.removeAttribute('open')));

    // 1-2) Row 2: Open, Duplicate, Archive; the archived row: Open and Restore only.
    await dots(2).click();
    await expect(menuOf(2)).toBeVisible();
    expect
      .soft((await menuOf(2).locator('a, button').allInnerTexts()).map((s) => s.trim()))
      .toEqual(['Open', 'Duplicate', 'Archive']);
    await ux.check('row 2 menu', STD, { overlay: 'details[open] > div' });
    await closeAll();
    await dots(5).click();
    expect
      .soft((await menuOf(5).locator('a, button').allInnerTexts()).map((s) => s.trim()))
      .toEqual(['Open', 'Restore']);
    await closeAll();

    // 3) Escape while focus is on '⋯' (SD-89).
    await dots(2).click();
    await expect(menuOf(2)).toBeVisible();
    await dots(2).focus();
    await page.keyboard.press('Escape');
    expect.soft(await openCount(), 'Escape on ⋯ closes the menu').toBe(0);
    expect
      .soft(await dots(2).evaluate((e) => e === document.activeElement), 'focus stays on ⋯')
      .toBe(true);
    await closeAll();

    // 4) A click outside closes it (SD-36).
    await dots(2).click();
    await expect(menuOf(2)).toBeVisible();
    await page.getByRole('heading', { level: 1, name: 'Vacancies' }).click();
    expect.soft(await openCount(), 'outside click closes the menu').toBe(0);
    await closeAll();

    // 5) Row 2, then row 3: at most one menu open.
    await dots(2).click();
    await dots(3).click();
    expect.soft(await openCount(), 'one menu at a time').toBeLessThanOrEqual(1);
    await closeAll();

    // 6) The menu of the row above the last one is on top of the later rows.
    await dots(7).click();
    await expect(menuOf(7)).toBeVisible();
    await menuOf(7).scrollIntoViewIfNeeded();
    const hits = await menuOf(7)
      .locator('a, button')
      .evaluateAll((items) =>
        items.map((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            item: (el as HTMLElement).innerText.trim(),
            onTop: !!hit && (el === hit || el.contains(hit)),
            hit: hit ? `${hit.tagName} ${(hit as HTMLElement).innerText?.slice(0, 30)}` : '',
          };
        }),
      );
    for (const h of hits) expect.soft(h.onTop, `"${h.item}" is on top (hit: ${h.hit})`).toBe(true);
    await ux.check('menu above the last row', STD, { overlay: 'details[open] > div' });
  },
);

uat(
  'VL-10',
  'Running row progress, 5 s auto refresh, refresh on tab return, out-of-date pill',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    let n = 0;
    const row2 = vrow({
      id: id(62),
      title: 'UAT Out of date role',
      documents: 5,
      analyzed: 5,
      strong: 2,
      outOfDate: 3,
    });
    const { seen } = await vacApi(page, {
      list: () => {
        n++;
        const run = n <= 2;
        return [
          vrow({
            id: id(61),
            title: 'UAT Running role',
            documents: 10,
            analyzed: run ? 4 : 10,
            running: run ? 6 : 0,
          }),
          row2,
        ];
      },
      views: [
        vview({
          id: id(62),
          title: 'UAT Out of date role',
          counts: { documents: 5, analyzed: 5, outOfDate: 3, strong: 2 },
        }),
      ],
    });
    await page.clock.install();
    await page.goto('/#/vacancies');
    const row1 = page.getByRole('listitem').filter({ hasText: 'UAT Running role' });
    await expect(row1).toContainText(t('{n} analyzed, {m} running', { n: 4, m: 6 }));
    const bar = row1.locator('span[aria-hidden=true] > span');
    expect
      .soft(await bar.evaluate((b) => (b as HTMLElement).style.width), 'progress about 40 %')
      .toBe('40%');
    await ux.check('running', [...STD, 'AZ']);
    const gets = () => reqs(seen, 'GET', /^\/vacancies\?/).length;
    expect(gets()).toBe(1);
    await page.clock.pauseAt(Date.now() + 1500);
    // 2) Two times 5 s: one GET each.
    await page.clock.runFor(5000);
    await expect.poll(gets).toBe(2);
    await page.clock.runFor(5000);
    await expect.poll(gets).toBe(3);
    await expect(row1).toContainText(t('{a} of {b}', { a: 10, b: 10 }));
    // 3) 15 s more: nothing runs, no GET.
    await page.clock.runFor(15000);
    await page.waitForTimeout(300);
    expect.soft(gets(), 'no GET once nothing runs').toBe(3);
    // 4) The tab is hidden, then visible again: one GET.
    await page.evaluate(() => {
      const set = (v: string) =>
        Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      set('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      set('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(gets).toBe(4);
    await page.waitForTimeout(300);
    expect.soft(gets(), 'exactly one GET on return').toBe(4);
    // 5) The out-of-date pill.
    await page.clock.resume();
    await page
      .getByRole('link', { name: `${t('{n} out of date', { n: 3 })} · ${t('Re-analyze')}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${id(62)}$`));
    const notice = page.getByText(
      t('{n} results were scored against earlier requirements.', { n: 3 }),
    );
    await expect(notice).toBeVisible();
    await expect(page.getByRole('button', { name: t('Review and re-analyze') })).toBeVisible();
    await ux.check('vacancy out of date', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ 7.8 Vacancy page (VP), L1

const NE = (over: Record<string, any> = {}) =>
  vview({
    title: 'Network Engineer',
    status: 'open',
    department: 'Network',
    location: 'Bakı',
    ...over,
  });

uat(
  'VP-01',
  "Vacancy page header: back link, title, status, details and owner, 'Last run' line, 4 backgrounds",
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    let scenario: 'A' | 'B' = 'A';
    const a = NE();
    const b = NE({
      id: id(72),
      counts: { documents: 10, analyzed: 10, strong: 4, outOfDate: 3 },
      requirements: [must('BGP routing', 1)],
      hasFrozen: true,
    });
    await vacApi(page, {
      views: [a, b],
      runs: () =>
        scenario === 'A'
          ? []
          : [
              {
                id: ulidOf('RUN', 2),
                version: 2,
                requirementsVersion: 2,
                frozenAt: minsAgo(30),
                total: 10,
                read: 8,
                scored: 8,
                running: 0,
                finishedAt: minsAgo(5),
              },
            ],
    });
    const header = async () => {
      await expect(page.getByRole('heading', { level: 1, name: 'Network Engineer' })).toBeVisible();
      await expect.soft(page.locator('h1 + span')).toHaveText(t('Open'));
      await expect
        .soft(
          page.getByText(`Network · Bakı · ${t('Owner: {name}', { name: OWNER.name })}`, {
            exact: true,
          }),
        )
        .toBeVisible();
      const levels = await page
        .locator('main h1, main h2, main h3, main h4')
        .evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
      expect.soft(levels[0], 'first heading is h1').toBe(1);
      expect
        .soft(
          levels.every((l, i) => i === 0 || l <= levels[i - 1]! + 1),
          `heading order ${levels.join(',')}`,
        )
        .toBe(true);
      if (meta.dev === 'A' || meta.dev === 'I')
        expect.soft(await pageScrollsSideways(page), 'page overflow').toBe(false);
    };
    // 1) Scenario A.
    await page.goto(`/#/vacancies/${a.id}`);
    await header();
    await expect
      .soft(page.getByTestId('last-run'))
      .toHaveText(`${t('Last run')}: ${t('none yet')} · ${t('History')}`);
    await ux.check('scenario A', [...STD, 'AZ']);
    await onBackgrounds(page, meta.lang, async (bg) => {
      await ux.check(`A on ${bg}`, [...STD, 'AZ']);
    });
    // 2) Scenario B.
    scenario = 'B';
    await page.goto(`/#/vacancies/${b.id}`);
    await header();
    await expect
      .soft(page.getByTestId('last-run'))
      .toHaveText(
        `${t('Last run')}: ${t('{n} min ago', { n: 5 })} · ${t('{a} of {b} read', { a: 8, b: 10 })} · ${t('{n} out of date', { n: 3 })} · ${t('History')}`,
      );
    await ux.check('scenario B', [...STD, 'AZ']);
    // 3) The back link.
    await page.getByRole('link', { name: t('← Vacancies') }).click();
    await expect(page).toHaveURL(/#\/vacancies$/);
    await expect(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
  },
);

uat(
  'VP-04',
  'Vacancy tabs: hash URLs, default tab, deep links, Back, unknown tab, keyboard',
  { on: ['D', 'E', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const v = NE({
      counts: { documents: 2, analyzed: 2, strong: 1 },
      requirements: [must('BGP routing', 1), must('OSPF', 2), nice('Python scripting', 3)],
      hasFrozen: true,
    });
    await vacApi(page, {
      views: [v],
      runs: [
        {
          id: ulidOf('RUN', 1),
          version: 1,
          requirementsVersion: 1,
          frozenAt: minsAgo(60),
          total: 2,
          read: 2,
          scored: 2,
          running: 0,
          finishedAt: minsAgo(50),
        },
      ],
    });
    await page.goto(`/#/vacancies/${v.id}`);
    const tabs = page.getByRole('tablist', { name: t('Vacancy views') });
    await expect(tabs).toBeVisible();
    const names = ['Candidates', 'Results', 'Report', 'Runs', 'Criteria'];
    const keys = ['candidates', 'results', 'report', 'runs', 'criteria'];
    expect
      .soft((await tabs.getByRole('tab').allInnerTexts()).map((s) => s.trim()))
      .toEqual(names.map((n) => t(n)));
    await expect
      .soft(tabs.getByRole('tab', { name: t('Candidates') }))
      .toHaveAttribute('aria-selected', 'true');
    await ux.check('default tab', [...STD, 'AZ']);
    // 2) Press each tab.
    for (const [i, n] of names.entries()) {
      const tab = tabs.getByRole('tab', { name: t(n) });
      await tab.click();
      await expect(page).toHaveURL(new RegExp(`#/vacancies/${v.id}/${keys[i]}$`));
      await expect.soft(tab).toHaveAttribute('aria-selected', 'true');
      await expect.soft(tabs.locator('[aria-selected=true]')).toHaveCount(1);
    }
    await ux.check('criteria tab', [...STD, 'AZ']);
    // 4) Back returns to the previous tab (Runs).
    await page.goBack();
    await expect.soft(page).toHaveURL(new RegExp(`#/vacancies/${v.id}/runs$`));
    await expect
      .soft(tabs.getByRole('tab', { name: t('Runs') }))
      .toHaveAttribute('aria-selected', 'true');
    // 3) Direct URLs.
    for (const [i, n] of names.entries()) {
      await page.goto(`/#/vacancies/${v.id}/${keys[i]}`);
      await page.reload();
      await expect
        .soft(
          page.getByRole('tablist', { name: t('Vacancy views') }).getByRole('tab', { name: t(n) }),
          `deep link ${keys[i]}`,
        )
        .toHaveAttribute('aria-selected', 'true');
    }
    // 5) An unknown tab falls back to the vacancy list.
    await page.goto(`/#/vacancies/${v.id}/nonsense`);
    await expect.soft(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
    // 6) Keyboard: focus ring, ArrowRight, aria-controls (SD-130).
    await page.goto(`/#/vacancies/${v.id}`);
    await page.reload();
    const first = tabs.getByRole('tab', { name: t('Candidates') });
    await expect(first).toBeVisible();
    expect.soft(await tabTo(page, first, 80), 'Tab reaches the tab list').toBe(true);
    expect.soft(await hasRing(first), 'focus ring on a tab').toBe(true);
    await ux.shot('tab focus');
    await page.keyboard.press('ArrowRight');
    expect
      .soft(
        await tabs
          .getByRole('tab', { name: t('Results') })
          .evaluate((e) => e === document.activeElement),
        'ArrowRight moves to the next tab',
      )
      .toBe(true);
    const controls = await tabs
      .getByRole('tab')
      .evaluateAll((ts) => ts.map((x) => x.getAttribute('aria-controls')));
    const panelId = await page.getByRole('tabpanel').getAttribute('id');
    expect
      .soft(
        controls.every((c) => !!c),
        'every tab has aria-controls',
      )
      .toBe(true);
    expect
      .soft(!!panelId && controls.includes(panelId), 'aria-controls points at the tabpanel')
      .toBe(true);
    // On phones the tab row scrolls inside itself.
    if (meta.dev === 'A' || meta.dev === 'I') {
      expect
        .soft(await tabs.evaluate((x) => getComputedStyle(x).overflowX), 'tab row scrolls')
        .toMatch(/auto|scroll/);
      expect.soft(await pageScrollsSideways(page)).toBe(false);
    }
  },
);

uat(
  'VP-05',
  'Vacancy page loading and error states (404, 500)',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    let mode: 'slow' | '404' | '500' = 'slow';
    const v = NE();
    await vacApi(page, {
      views: [v],
      list: [vrow()],
      extra: async (route, url, method) => {
        if (url.pathname !== `/vacancies/${v.id}` || method !== 'GET') return false;
        if (mode === 'slow') {
          await new Promise((r) => setTimeout(r, 2000));
          await route.fulfill({ json: v });
        } else if (mode === '404')
          await route.fulfill({ status: 404, json: { statusCode: 404, message: 'Not Found' } });
        else
          await route.fulfill({
            status: 500,
            json: { statusCode: 500, message: 'Database not reachable' },
          });
        return true;
      },
    });
    ux.allow(/404|500/);
    await page.goto(`/#/vacancies/${v.id}`);
    await expect(page.getByText(t('Loading…'))).toBeVisible();
    await ux.check('loading', [...STD, 'AZ']);
    await expect(page.getByRole('heading', { level: 1, name: 'Network Engineer' })).toBeVisible({
      timeout: 5000,
    });
    for (const [m, text] of [
      ['404', 'Not Found'],
      ['500', 'Database not reachable'],
    ] as const) {
      mode = m;
      await page.reload();
      await expect(
        page.getByRole('alert').filter({ hasText: new RegExp(esc(t(text))) }),
      ).toBeVisible();
      await expect.soft(page.getByRole('link', { name: t('← Vacancies') })).toBeVisible();
      await expect.soft(page.getByRole('tablist')).toHaveCount(0);
      await expect.soft(page.getByRole('heading', { name: t('The role') })).toHaveCount(0);
      await expect.soft(page.getByRole('heading', { name: t('CVs') })).toHaveCount(0);
      await ux.check(`error ${m}`, [...STD, 'AZ']);
    }
    await page.getByRole('link', { name: t('← Vacancies') }).click();
    await expect(page).toHaveURL(/#\/vacancies$/);
    await expect(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
  },
);
