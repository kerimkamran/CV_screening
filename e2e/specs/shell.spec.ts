import { createServer } from 'node:net';
import type { Locator, Page, Route } from '@playwright/test';
import { DID, ME, MID, mockApi, openReview, showAnalysis, SENAI_ON } from '../fixtures/api';
import {
  ADMIN_ANSWERS,
  answers,
  box,
  hitsItself,
  MFA_OFF,
  openWith,
  reloadAt,
  REPORT_ID,
  REPORT_OPENED,
  RUN_VID,
  RUNNING_VACANCY,
  SHARED_ROWS,
  vacItem,
  words,
} from '../fixtures/pkg-a';
import { expect, uat } from '../ux/test';
import { appDayAndTime } from '../fixtures/dates';

// 7.1 Shell and navigation (SH). UAT plan v1.1; each case is the row of the same ID.

uat(
  'SH-01',
  'Recruiter frame on desktop and tablet: brand, rail, footer',
  { on: ['D', 'DW', 'DS', 'E', 'T', 'TL'] },
  async ({ page, ux, tx }) => {
    await mockApi(page);
    await page.goto('/#/vacancies');
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    expect(
      await header.evaluate((h) => [getComputedStyle(h).position, getComputedStyle(h).top]),
    ).toEqual(['sticky', '0px']);
    const brand = header.getByRole('link', { name: /parallax/ }).first();
    await expect(brand).toHaveAttribute('title', 'parallax by Azerconnect Group');
    await expect(brand).toHaveAttribute('href', '#/'); // the brand leads to Home
    await expect(
      page
        .getByRole('button', { name: tx('Account menu', 'Hesab menyusu') })
        .or(page.getByLabel(tx('Account menu', 'Hesab menyusu'))),
    ).toContainText('AK');
    const rail = page.getByRole('navigation', { name: tx('Main', 'Əsas') });
    await expect(rail).toBeVisible();
    expect(Math.round((await rail.boundingBox())!.width)).toBe(96);
    const vac = rail.getByRole('link', { name: tx('Vacancies', 'Vakansiyalar') });
    const cand = rail.getByRole('link', { name: tx('Candidates', 'Namizədlər') });
    const home = rail.getByRole('link', { name: tx('Home', 'Ana səhifə') });
    await expect(home).toHaveAttribute('href', '#/');
    await expect(home).not.toHaveAttribute('aria-current', 'page');
    await expect(vac).toHaveAttribute('aria-current', 'page');
    await expect(cand).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('contentinfo')).toContainText(
      tx(
        'AI-assisted screening: scores and rankings are recommendations. Every decision about a candidate is made by a person and recorded under their name.',
        'Süni intellekt',
      ),
    );
    await expect(page.getByRole('search')).toHaveCount(0); // no Ask bar while SenAI is off
    await ux.check('frame', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    await cand.click();
    await expect(page).toHaveURL(/#\/candidates$/);
    await expect(cand).toHaveAttribute('aria-current', 'page');
    await expect(vac).not.toHaveAttribute('aria-current', 'page');
    await vac.click();
    await expect(page).toHaveURL(/#\/vacancies$/);
    await page.goto('/#/candidates');
    await brand.click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(vac).not.toHaveAttribute('aria-current', 'page');
    await ux.check('after navigation');
  },
);

// ---------------------------------------------------------------- helpers for this file

const AVATAR = 'header details > summary';
// The OCC grid starts 4 px inside an overlay; on the menu's 16 px rounded corners those points fall
// outside the panel's shape and hit the page below (a checker artefact, reported as infrastructure).
// The panel's content blocks and the picker's list are checked instead.
const MENU_OVERLAY = 'header details[open] > div > div, header details[open] > div > p';
const PICKER_OVERLAY = 'header details[open] fieldset > div';
const avatarOf = (page: Page, t: ReturnType<typeof words>) =>
  page.getByLabel(t('Account menu'), { exact: true });
const menuPanel = (page: Page) => page.locator('header details[open] > div').first();
const menuOpen = (page: Page) =>
  page
    .locator('header > div > details')
    .first()
    .evaluate((d) => (d as HTMLDetailsElement).open);
async function openMenu(page: Page, t: ReturnType<typeof words>) {
  if (!(await menuOpen(page))) await avatarOf(page, t).click();
  await expect(menuPanel(page)).toBeVisible();
  return menuPanel(page);
}
const scrollBottom = (page: Page) =>
  page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
/** Bottom of the last footer line that has text. */
const footerTextBottom = (page: Page) =>
  page.evaluate(() => {
    const ps = [...document.querySelectorAll('footer p')].filter((p) =>
      (p.textContent ?? '').trim(),
    );
    return Math.max(...ps.map((p) => p.getBoundingClientRect().bottom));
  });
const PUTS = (seen: { requests: { method: string; url: string; body: unknown }[] }, path: string) =>
  seen.requests.filter((r) => r.method === 'PUT' && r.url === path);

const DIRECT = {
  ...ADMIN_ANSWERS,
  'GET /reports/mine': { reports: [] },
  'GET /auth/mfa': MFA_OFF,
  'GET /assistant/preferences': { top: null },
  'PUT /me/preferences': {},
};

// ---------------------------------------------------------------- SH

uat(
  'SH-02',
  'Phone frame: compact brand, bottom bar, content clear of the bar',
  { on: ['A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    let senai = false;
    const rows = Array.from({ length: 12 }, (_, i) => vacItem(i + 1));
    await openWith(page, '#/vacancies', {
      vacancies: rows,
      table: {
        ...DIRECT,
        '/assistant/config': (route: Route) =>
          route.fulfill({ json: senai ? SENAI_ON : { enabled: false } }),
      },
      extra: async (route, url) => {
        if (/^\/vacancies\/\w{26}\/(archive|restore)$/.test(url.pathname))
          return void (await route.fulfill({ json: {} })) ?? true;
        return false;
      },
    });
    await expect(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
    // 1) No rail; compact brand; a fixed bottom nav 'Main'.
    const navs = page.getByRole('navigation', { name: t('Main') });
    await expect(navs).toHaveCount(1);
    const bar = navs.first();
    expect(await bar.evaluate((n) => getComputedStyle(n).position)).toBe('fixed');
    const vp = page.viewportSize()!;
    const barBox = (await bar.boundingBox())!;
    expect(Math.round(barBox.y + barBox.height)).toBe(vp.height);
    await expect(page.locator('header a[title] .sm\\:hidden')).toBeVisible();
    for (const b of await page.locator('header').getByText('by Azerconnect Group').all())
      await expect(b).toBeHidden();
    const items = async () => bar.locator('a, button').all();
    for (const it of await items())
      expect((await it.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(bar.getByRole('link', { name: t('Vacancies') })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(bar.getByRole('link', { name: t('Candidates') })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    await ux.check('phone frame', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);

    // 2) At the bottom the footer's last line ends above the bar.
    const clear = async (why: string) => {
      await scrollBottom(page);
      await page.waitForTimeout(150);
      const top = (await bar.boundingBox())!.y;
      expect
        .soft(
          await footerTextBottom(page),
          `${why}: footer text bottom must not be below the bar top (${top})`,
        )
        .toBeLessThanOrEqual(top + 0.5);
    };
    await clear('SenAI off');

    // 3) Bottom bar navigation.
    await bar.getByRole('link', { name: t('Candidates') }).tap();
    await expect(page).toHaveURL(/#\/candidates$/);
    await expect(bar.getByRole('link', { name: t('Candidates') })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await bar.getByRole('link', { name: t('Vacancies') }).tap();
    await expect(page).toHaveURL(/#\/vacancies$/);
    await expect(bar.getByRole('link', { name: t('Vacancies') })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const toastClear = async (why: string) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page
        .getByLabel(t('Actions for {title}', { title: rows[0]!.title }), { exact: true })
        .click();
      const archive = page.getByRole('button', { name: t('Archive'), exact: true });
      await expect(archive).toBeVisible();
      const covered = await archive.evaluate((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && !b.contains(hit)
          ? (hit.textContent ?? hit.tagName).trim().slice(0, 40)
          : '';
      });
      expect
        .soft(
          covered,
          `${why}: the row menu's 'Archive' is painted above the next row (a tap would hit "${covered}")`,
        )
        .toBe('');
      // A tap cannot reach it when it is covered; the keyboard can, so the toast can still be checked.
      await archive.focus();
      await page.keyboard.press('Enter');
      const toast = page
        .getByRole('status')
        .filter({ hasText: t('Archived “{title}”.', { title: rows[0]!.title }) });
      await expect(toast).toBeVisible();
      const tb = (await toast.boundingBox())!;
      const bb = (await bar.boundingBox())!;
      expect
        .soft(tb.y + tb.height, `${why}: the Undo toast must sit fully above the bar`)
        .toBeLessThanOrEqual(bb.y + 0.5);
      for (const it of await items()) {
        const r = (await it.boundingBox())!;
        const overlap =
          Math.min(r.x + r.width, tb.x + tb.width) - Math.max(r.x, tb.x) > 0 &&
          Math.min(r.y + r.height, tb.y + tb.height) - Math.max(r.y, tb.y) > 0;
        expect
          .soft(overlap, `${why}: the toast covers the bar item "${await it.innerText()}"`)
          .toBe(false);
      }
      await ux.check(
        `toast ${why}`,
        ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'],
        { overlay: '.m-toast > *' } /* the toast's rounded corners fool the OCC grid */,
      );
      await toast.getByRole('button').click();
    };
    await toastClear('SenAI off');

    // 4) SenAI on: 'Ask SenAI' in the bar, the text fits, the footer is still clear.
    senai = true;
    await page.reload();
    const ask = bar.getByRole('button', { name: t('Ask {name}', { name: 'SenAI' }) });
    await expect(ask).toBeVisible();
    for (const it of await items())
      expect((await it.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const fits = await ask.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(b);
      const tr = range.getBoundingClientRect();
      return (
        b.scrollWidth <= b.clientWidth + 1 &&
        tr.left >= r.left - 1 &&
        tr.right <= r.right + 1 &&
        tr.bottom <= r.bottom + 1
      );
    });
    expect
      .soft(fits, `"${t('Ask {name}', { name: 'SenAI' })}" must stay inside its bar item`)
      .toBe(true);
    await ux.check('bar with SenAI', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    await clear('SenAI on');

    // 5) The Undo toast with SenAI on.
    await toastClear('SenAI on');
  },
);

uat(
  'SH-03',
  'Frame for admin, governance and report-viewer accounts: header only',
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    ux.allow(/Transition was skipped/); // the test changes routes faster than a person; see SH-06
    const t = words(meta);
    const cases: [string, string[], () => Promise<void>][] = [
      [
        'admin',
        ['ADMIN'],
        async () => {
          await expect(page.getByRole('heading', { level: 1, name: t('Home') })).toBeAttached();
          await expect(
            page.getByText(
              t(
                'Administrators manage users and AI models under Administration. Candidate data is available only to recruiters.',
              ),
            ),
          ).toBeVisible();
        },
      ],
      [
        'governance',
        ['GOVERNANCE'],
        async () => {
          await expect(page.getByRole('heading', { level: 1, name: t('Home') })).toBeAttached();
          await expect(page.getByRole('region', { name: t('Oversight') })).toBeVisible();
        },
      ],
      [
        'viewer',
        [],
        async () => {
          await expect(
            page.getByRole('heading', { level: 1, name: t('Shared with me') }),
          ).toBeVisible();
        },
      ],
    ];
    for (const [who, roles, home] of cases) {
      await openWith(page, '#/', { me: { roles }, table: DIRECT });
      await home();
      await expect(
        page.locator(`nav[aria-label="${t('Main')}"]`),
        `${who}: no rail and no bottom bar`,
      ).toHaveCount(0);
      expect(
        await page
          .locator('main')
          .evaluate((m) => getComputedStyle(m.parentElement!).paddingBottom),
        `${who}: no room kept for a bar`,
      ).toBe('0px');
      const brand = page.locator('header a[title]').first();
      await expect(brand).toHaveAttribute('href', '#/');
      await ux.check(`${who} home`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
      await page.goto('/#/security');
      await expect(page.getByRole('heading', { name: t('Two-step sign-in') })).toBeVisible();
      await brand.click();
      await expect(page).toHaveURL(/#\/$/);
      await home();
    }
  },
);

uat(
  'SH-04',
  "Ask bar presence and the '/' shortcut",
  { on: ['D', 'DS', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const railMeetsHeader = async (why: string) => {
      if (meta.dev === 'A') {
        await expect(page.locator(`nav[aria-label="${t('Main')}"]`).first()).toBeHidden();
        await expect(page.getByRole('navigation', { name: t('Main') })).toBeVisible();
        return;
      }
      const h = (await page.locator('header').first().boundingBox())!;
      const r = (await page.getByRole('navigation', { name: t('Main') }).boundingBox())!;
      expect
        .soft(
          Math.abs(r.y - (h.y + h.height)),
          `${why}: the rail's top edge must equal the header's bottom edge (rail ${r.y}, header ${h.y + h.height})`,
        )
        .toBeLessThanOrEqual(1);
    };
    const seen = await openWith(page, '#/vacancies', { assistant: SENAI_ON, table: DIRECT });
    const search = page.getByRole('search');
    await expect(search).toHaveCount(1);
    const ask = search.getByRole('textbox');
    await expect(ask).toHaveCount(1);
    await expect(ask).toHaveAttribute('placeholder', 'SenAI: Sən istə, Senai tapsın');
    await expect(ask).toHaveAccessibleName(t('Ask {name}', { name: 'SenAI' }));
    await expect(ask).toHaveAttribute('maxlength', '1000');
    await railMeetsHeader('SenAI on');
    await ux.check('ask bar', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);

    // 2) '/' from the page body.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('/');
    await expect(ask).toBeFocused();
    await expect(ask).toHaveValue('');
    // 3) '/' inside the vacancy search box is typed there.
    const vs = page.getByRole('searchbox', { name: t('Search vacancies') });
    await vs.click();
    await vs.pressSequentially('x');
    await page.keyboard.press('/');
    await expect(vs).toBeFocused();
    await expect(vs).toHaveValue('x/');
    // 4) An empty Ask bar and Enter opens the panel without asking anything.
    await ask.fill('');
    await ask.press('Enter');
    await expect(page.getByRole('complementary', { name: 'SenAI' })).toBeVisible();
    expect(seen.posts.filter((p) => p.url === '/assistant/ask')).toHaveLength(0);
    await ux.check('panel open', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], { overlay: 'aside' });

    // 5) SenAI off: no search landmark, no phone item, no panel.
    await openWith(page, '#/vacancies', { assistant: { enabled: false }, table: DIRECT });
    await expect(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
    await expect(page.getByRole('search')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: t('Ask {name}', { name: 'SenAI' }) }),
    ).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'SenAI' })).toHaveCount(0);
    await railMeetsHeader('SenAI off');
    await ux.check('SenAI off', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
  },
);

uat(
  'SH-05',
  "Booting: 'Loading…' while /me is pending, no flash of Sign in",
  { on: ['D', 'A'] },
  async ({ page, context, ux, meta }) => {
    const t = words(meta);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let answered = false;
    await mockApi(page, {
      extra: async (route, url) => {
        if (url.pathname !== '/me') return false;
        await new Promise((r) => setTimeout(r, 2000));
        answered = true;
        await route.fulfill({ json: ME });
        return true;
      },
    });
    await page.goto('/#/vacancies');
    const samples: { loading: boolean; signIn: boolean; shell: boolean; header: boolean }[] = [];
    let shots = 0;
    while (!answered) {
      const s = await page.evaluate(
        (loadingText) => ({
          loading: document.body.innerText.includes(loadingText),
          signIn: !!document.querySelector('input[type=password]'),
          shell: !!document.querySelector('nav, details'),
          header: !!document.querySelector('header'),
        }),
        t('Loading…'),
      );
      if (answered) break; // this sample may already show the answer
      samples.push(s);
      if (shots < 6) {
        shots++;
        await ux.shot(`booting ${shots}`);
      }
      await page.waitForTimeout(200);
    }
    expect(samples.length).toBeGreaterThan(3);
    expect(
      samples.filter((s) => s.signIn),
      'no Sign in form before /me answers',
    ).toHaveLength(0);
    expect(
      samples.filter((s) => s.shell),
      'no Shell before /me answers',
    ).toHaveLength(0);
    expect(
      samples.filter((s) => s.header && s.loading).length,
      "the plain header and 'Loading…' show while booting",
    ).toBe(samples.filter((s) => s.header).length);
    await expect(avatarOf(page, t)).toBeVisible();
    await ux.check('after /me', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ', 'RM']);

    // 4) No token: no GET /me, the Sign in card at once.
    const p2 = await context.newPage();
    const flush = ux.watch(p2);
    await p2.addInitScript((lang) => localStorage.setItem('cv-lang', lang), meta.lang);
    await p2.emulateMedia({ reducedMotion: 'reduce' });
    const seen2 = await mockApi(p2, { signedIn: false });
    const t0 = Date.now();
    await p2.goto('/#/');
    await expect(p2.getByRole('button', { name: t('Sign in') })).toBeVisible({ timeout: 1500 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(seen2.requests.filter((r) => r.url === '/me')).toHaveLength(0);
    flush();
    await p2.close();
  },
);

uat(
  'SH-06',
  "Unknown routes fall back to each role's home",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const ROUTES = ['#/nope', '#/vacancies/xyz', '#/reports/abc', '#/admin/unknown'];
    const vacList = page.getByRole('heading', { level: 1, name: t('Vacancies') });
    const adminOnly = page.getByRole('alert').filter({ hasText: t('Administrators only.') });
    const expectFor: Record<string, Record<string, () => Promise<void>>> = {
      'signed-out': Object.fromEntries(
        ROUTES.map((r) => [
          r,
          () => expect(page.getByRole('button', { name: t('Sign in') })).toBeVisible(),
        ]),
      ),
      recruiter: {
        '#/nope': () => expect(vacList).toBeVisible(),
        '#/vacancies/xyz': () => expect(vacList).toBeVisible(),
        '#/reports/abc': () => expect(vacList).toBeVisible(),
        '#/admin/unknown': () => expect(adminOnly).toBeVisible(),
      },
      admin: {
        '#/nope': () =>
          expect(
            page.getByText(
              t(
                'Administrators manage users and AI models under Administration. Candidate data is available only to recruiters.',
              ),
            ),
          ).toBeVisible(),
        '#/admin/unknown': () =>
          expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible(),
      },
      governance: {
        '#/nope': async () => {
          await expect(
            page.getByRole('heading', { level: 1, name: t('Fairness monitoring') }),
          ).toBeVisible();
          await expect(page.getByRole('navigation', { name: t('Administration') })).toHaveCount(0);
        },
        '#/admin/unknown': () => expect(adminOnly).toBeVisible(),
      },
      viewer: {
        '#/nope': () =>
          expect(page.getByRole('heading', { level: 1, name: t('Shared with me') })).toBeVisible(),
      },
    };
    const roles: Record<string, string[] | null> = {
      'signed-out': null,
      recruiter: ['TA_PARTNER'],
      admin: ['ADMIN'],
      governance: ['GOVERNANCE'],
      viewer: [],
    };
    for (const [who, r] of Object.entries(roles)) {
      await openWith(page, '#/', { signedIn: r !== null, me: { roles: r ?? [] }, table: DIRECT });
      for (const route of ROUTES) {
        await page.goto(`/${route}`);
        const want = expectFor[who]![route];
        if (want) await want();
        await page.waitForTimeout(400); // a person's pace: the screen change finishes before the next
        expect(
          (await page.locator('#root').innerText()).trim().length,
          `${who} ${route}: not a blank page`,
        ).toBeGreaterThan(20);
      }
      await ux.check(`${who} routes`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    }
  },
);

uat(
  'SH-07',
  'Old links #/candidates/<id> and #/screenings/<id> open the CV review',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    ux.allow(/Transition was skipped/); // the test changes routes faster than a person; see SH-06
    const t = words(meta);
    const GONE = '01K00000000000000000000ZZZ';
    await openWith(page, '#/vacancies', {
      table: {
        [`GET /screenings/${MID}`]: { $status: 200, $body: { documentId: DID }, $delay: 600 },
        [`GET /screenings/${GONE}`]: { $status: 404, $body: { message: 'Not found' } },
      },
    });
    await expect(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
    for (const old of [`/candidates/${MID}`, `/screenings/${MID}`]) {
      await page.evaluate((h) => (window.location.hash = h), old);
      await expect(page.getByText(t('Loading…')).first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#/cv/${DID}$`));
      await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' }).first()).toBeAttached();
      await showAnalysis(page);
      await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' }).first()).toBeVisible();
      // location.replace: Back skips the old link.
      await page.goBack();
      await expect(page).not.toHaveURL(new RegExp(old.replace(/\//g, '\\/')));
      await expect(page).toHaveURL(/#\/vacancies$/);
    }
    await page.goto(`/#/cv/${DID}`);
    await showAnalysis(page);
    await ux.check('review from old link', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    await page.goto(`/#/candidates/${GONE}`);
    await expect(page.getByRole('alert')).toHaveText(
      t('This CV is not available to you, or it no longer exists.'),
    );
    await ux.check('gone', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
  },
);

uat(
  'SH-08',
  'Footer health line when /readyz fails at load',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    ux.allow(/readyz/);
    for (const mode of ['503', 'abort', '200'] as const) {
      const ready: string[] = [];
      await page.evaluate(() => sessionStorage.removeItem('cv.session')).catch(() => undefined);
      await openWith(page, '#/', {
        signedIn: false,
        table: {
          '/readyz': async (route: Route) => {
            ready.push(route.request().url());
            if (mode === '503') await route.fulfill({ status: 503, json: { status: 'down' } });
            else if (mode === 'abort') await route.abort('failed');
            else await route.fulfill({ json: { status: 'ok' } });
          },
          '/me': (route: Route) =>
            route.request().headers().authorization === 'Bearer t-sh08'
              ? route.fulfill({ json: ME })
              : route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
          'POST /auth/login': { token: 't-sh08', expiresIn: 3600, mustChangePassword: false },
        },
      });
      const footer = page.getByRole('contentinfo');
      const line = footer.getByRole('status');
      const notice = footer.locator('p').first();
      await expect(page.getByRole('button', { name: t('Sign in') })).toBeVisible();
      await expect(line).toHaveAttribute('aria-live', 'polite');
      if (mode === '200') {
        await page.waitForTimeout(300);
        await expect(line).toHaveText('');
        await expect(page.getByText(t('Service ready'))).toHaveCount(0);
      } else await expect(line).toHaveText(t('Service unavailable'));
      await expect(notice).toHaveText(
        t(
          'AI-assisted screening: scores and rankings are recommendations. Every decision about a candidate is made by a person and recorded under their name.',
        ),
      );
      expect(await notice.evaluate((p) => getComputedStyle(p).textAlign)).toBe('center');
      expect((await footer.boundingBox())!.width).toBeLessThanOrEqual(36 * 16 + 0.5);
      await ux.check(`signed out, readyz ${mode}`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
      // 3) Sign in (mock) and read the footer inside the Shell.
      await page.getByLabel(t('Email')).fill('ayla@example.az');
      await page.getByLabel(t('Password'), { exact: true }).fill('Some-long-password-1');
      await page.getByRole('button', { name: t('Sign in') }).click();
      await expect(avatarOf(page, t)).toBeVisible();
      const inShell = page.getByRole('contentinfo').getByRole('status');
      if (mode === '200') await expect(inShell).toHaveText('');
      else await expect(inShell).toHaveText(t('Service unavailable'));
      await expect(page.getByRole('contentinfo')).toContainText(
        t(
          'AI-assisted screening: scores and rankings are recommendations. Every decision about a candidate is made by a person and recorded under their name.',
        ),
      );
      expect(ready, `readyz ${mode}: requested once per load`).toHaveLength(1);
      expect(new URL(ready[0]!).origin).toBe(new URL(page.url()).origin);
      await ux.check(`signed in, readyz ${mode}`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    }
  },
);

uat(
  'SH-09',
  'API goes down after the page loaded: plain message and a health line that updates',
  { on: ['D', 'E', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    ux.allow(/\/(auth|admin|me|readyz|assistant|reports)\b/);
    let down = false;
    let html520 = false;
    // PLAN: 'fulfil it with status 520' — page.route sends the statusText 'Unknown' for 520, not an empty one.
    // A proxy's HTML error page with an empty reason phrase (as behind HTTP/2). page.route cannot send
    // an empty statusText (it sends 'Bad Gateway' for 502 and 'Unknown' for 520), so the one answer
    // comes from a raw socket that writes "HTTP/1.1 502 " with nothing after the code.
    const body502 = '<html><body><h1>Bad gateway</h1></body></html>';
    const proxy = createServer((sock) =>
      sock.once('data', () =>
        sock.end(
          `HTTP/1.1 502 \r\ncontent-type: text/html\r\ncontent-length: ${body502.length}\r\nconnection: close\r\n\r\n${body502}`,
        ),
      ),
    );
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
    const proxyPort = (proxy.address() as { port: number }).port;
    const cut = async (route: Route) => {
      if (down) {
        await route.abort('failed');
        return true;
      }
      if (html520) {
        html520 = false;
        await route.continue({
          url: `http://127.0.0.1:${proxyPort}${new URL(route.request().url()).pathname}`,
        });
        return true;
      }
      return false;
    };
    const raw = /Failed to fetch|Load failed|NetworkError when attempting to fetch resource/;
    // 1) and 2) Signed out, the API cut, then Sign in.
    await openWith(page, '#/', { signedIn: false, extra: cut });
    await expect(page.getByRole('button', { name: t('Sign in') })).toBeVisible();
    down = true;
    await page.getByLabel(t('Email')).fill('ayla@example.az');
    await page.getByLabel(t('Password'), { exact: true }).fill('Some-long-password-1');
    await page.getByRole('button', { name: t('Sign in') }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    const signInText = (await alert.innerText()).trim();
    expect.soft(signInText, 'the sign-in error is never empty').not.toBe('');
    expect
      .soft(
        signInText,
        'the sign-in error says the service cannot be reached, not a raw browser error',
      )
      .not.toMatch(raw);
    await ux.check('sign-in while down', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);

    // 3) Admin on #/admin, the API cut, 'Create user'. The clock lets 60 s pass in a moment.
    down = false;
    await page.clock.install();
    await openWith(page, '#/admin', { me: { roles: ['ADMIN'] }, table: ADMIN_ANSWERS, extra: cut });
    await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('new.person@example.az');
    await page.getByLabel('Name', { exact: true }).fill('New Person');
    down = true;
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(alert).toBeVisible();
    const adminText = (await alert.innerText()).trim();
    expect.soft(adminText, 'the Create user error is never empty').not.toBe('');
    expect.soft(adminText, 'the Create user error is not a raw browser error').not.toMatch(raw);
    await page.clock.fastForward(60_000);
    await page.waitForTimeout(300);
    await expect
      .soft(
        page.getByRole('contentinfo').getByRole('status'),
        'within 60 s of the outage the health line reads Service unavailable',
      )
      .toHaveText(t('Service unavailable'), { timeout: 2000 });
    await ux.check('admin while down', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);

    // 4) One answer is an HTML error page with an empty status text.
    down = false;
    html520 = true;
    await page.getByRole('button', { name: 'Create user' }).click();
    await page.waitForTimeout(500);
    expect(html520, 'the 502 answer was used').toBe(false);
    await expect
      .soft(page.getByRole('alert'), 'a visible error notice after the HTML error page')
      .toBeVisible({ timeout: 2000 });
    if (await page.getByRole('alert').count())
      expect.soft((await page.getByRole('alert').first().innerText()).trim()).not.toBe('');

    // 5) Recovery: within 60 s the line is empty again.
    await page.clock.fastForward(60_000);
    await page.waitForTimeout(300);
    await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText('');
    proxy.close();
  },
);

uat(
  'SH-10',
  'A part of the app that fails to load does not blank the page',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    ux.allow(/PdfPages|CoffeebayScene/);
    let block = true;
    await page.route('**/assets/PdfPages-*.js', (r) => (block ? r.abort('failed') : r.continue()));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockApi(page);
    await openReview(page);
    await page.waitForTimeout(1500);
    // 1) and 2) The frame and the analysis stay; the CV pane says what happened.
    const rootText = (await page.locator('#root').innerText()).trim();
    expect.soft(rootText.length, '#root keeps its content').toBeGreaterThan(20);
    await expect
      .soft(page.locator('header').first(), 'the header stays')
      .toBeVisible({ timeout: 1000 });
    if (meta.dev !== 'A')
      await expect
        .soft(page.getByRole('navigation', { name: t('Main') }), 'the rail stays')
        .toBeVisible({ timeout: 1000 });
    else
      await expect
        .soft(page.getByRole('navigation', { name: t('Main') }), 'the bottom bar stays')
        .toBeVisible({ timeout: 1000 });
    const reload = page
      .getByRole('button', { name: /reload|yenidən yükləyin/i })
      .or(page.getByRole('link', { name: /reload|yenidən yükləyin/i }));
    await expect
      .soft(reload.first(), 'the CV pane offers a reload control')
      .toBeVisible({ timeout: 1000 });
    await ux.check('PDF chunk blocked', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    await showAnalysis(page).catch(() => undefined);
    await expect
      .soft(
        page.getByRole('heading', { name: 'Aysel Məmmədova' }).first(),
        'the analysis pane stays',
      )
      .toBeVisible({ timeout: 1000 });
    // 3) Lift the block and reload.
    block = false;
    if (await reload.count()) await reload.first().click();
    else await page.reload();
    await expect(page.locator('[data-page="1"] canvas')).toBeVisible({ timeout: 15_000 });
    // 4) The coffeebay scene chunk blocked on a vacancy whose batch is running.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/assets/CoffeebayScene-*.js', (r) => r.abort('failed'));
    await mockApi(page, { extra: answers(RUNNING_VACANCY) });
    await reloadAt(page, `#/vacancies/${RUN_VID}`);
    await page.waitForTimeout(2000);
    expect
      .soft(
        (await page.locator('#root').innerText()).trim().length,
        'the vacancy page is not blank',
      )
      .toBeGreaterThan(20);
    await expect
      .soft(page.getByTestId('batch-panel'), 'the waiting screen stays')
      .toBeVisible({ timeout: 1000 });
    await expect
      .soft(page.getByTestId('batch-panel').getByText(/2|4|6/).first(), 'the progress text stays')
      .toBeVisible({ timeout: 1000 });
    await ux.check('coffeebay chunk blocked', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    expect(errors, 'no uncaught page error').toEqual([]);
  },
);

uat(
  'SH-11',
  'Route changes: still header and rail, reduced motion, keyboard order',
  { on: ['D', 'T'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await mockApi(page);
    await page.goto('/#/vacancies');
    const rail = page.getByRole('navigation', { name: 'Main' });
    await expect(rail).toBeVisible();
    expect(
      await page
        .locator('header')
        .first()
        .evaluate((h) => h.style.viewTransitionName),
    ).toBe('app-header');
    expect(await rail.evaluate((h) => (h as HTMLElement).style.viewTransitionName)).toBe(
      'app-rail',
    );
    // 1) Header and rail keep their boxes during the change.
    const before = [await box(page, 'header'), await box(page, 'nav[aria-label="Main"]')];
    await rail.getByRole('link', { name: 'Candidates' }).click();
    for (let i = 0; i < 6; i++) {
      expect([await box(page, 'header'), await box(page, 'nav[aria-label="Main"]')]).toEqual(
        before,
      );
      await page.waitForTimeout(60);
    }
    await expect(page).toHaveURL(/#\/candidates$/);
    // 2) Reduced motion: no animation, the page is there at once.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [name, h1] of [
      ['Vacancies', 'Vacancies'],
      ['Candidates', 'Candidates'],
      ['Vacancies', 'Vacancies'],
    ] as const) {
      await rail.getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible({ timeout: 500 });
      expect(
        await page.evaluate(
          () => document.getAnimations().filter((a) => a.playState === 'running').length,
        ),
      ).toBe(0);
    }
    await ux.check('reduced motion', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'RM']);
    // 3) Keyboard order with a visible ring.
    await page.reload(); // the top of a fresh page: Tab starts from the document
    await expect(page.getByRole('heading', { level: 1, name: 'Vacancies' })).toBeVisible();
    const want = ['skip', 'brand', 'avatar', 'Home', 'Vacancies', 'Candidates'];
    const got: string[] = [];
    for (let i = 0; i < want.length + 1; i++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        const st = getComputedStyle(e);
        const ring =
          (st.boxShadow && st.boxShadow !== 'none') ||
          (st.outlineStyle !== 'none' && st.outlineWidth !== '0px');
        const name = e.matches('a[href="#main"]')
          ? 'skip'
          : e.matches('header a[title]')
            ? 'brand'
            : e.matches('header details > summary')
              ? 'avatar'
              : e.closest('nav[aria-label="Main"]')
                ? (e.textContent ?? '').trim()
                : `content:${e.tagName}`;
        return { name, ring };
      });
      got.push(f.name);
      if (i < want.length) expect.soft(f.ring, `${f.name} shows a focus ring`).toBe(true);
    }
    expect(got.slice(0, want.length), `focus order: ${got.join(', ')}`).toEqual(want);
    expect(got[want.length]).toMatch(/^content:/);
    await page.keyboard.press('Shift+Tab');
    await expect(rail.getByRole('link', { name: 'Candidates' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/candidates$/);
    void t;
  },
);

uat(
  'SH-12',
  'Accessibility of the frame and the sign-in page on all four backgrounds',
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const landmarks = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll(
            'header, main, footer, nav, [role=banner], [role=main], [role=contentinfo], [role=navigation]',
          ),
        ]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
          })
          .filter((e) => !e.closest('details:not([open])'))
          .map(
            (e) =>
              `${e.tagName.toLowerCase()}${e.getAttribute('aria-label') ? `:${e.getAttribute('aria-label')}` : ''}`,
          ),
      );
    for (const bg of ['white', 'grey', 'cream', 'dark']) {
      // 1) Signed out, the background from this browser.
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.evaluate(() => sessionStorage.removeItem('cv.session')).catch(() => undefined);
      await mockApi(page, { signedIn: false });
      await reloadAt(page, '#/');
      await page.evaluate((b) => localStorage.setItem('cv-background', b), bg);
      await page.reload();
      await expect(page.getByRole('button', { name: t('Sign in') })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-bg'))).toBe(bg);
      const out = await landmarks();
      expect(out.filter((x) => x.startsWith('nav'))).toEqual([]);
      expect(out).toEqual(expect.arrayContaining(['header', 'main', 'footer']));
      await expect(page.getByRole('contentinfo').getByRole('status')).toHaveAttribute(
        'aria-live',
        'polite',
      );
      await ux.check(`signed out ${bg}`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
      // 2) Signed in, the background from the account, the menu open.
      await openWith(page, '#/vacancies', { me: { background: bg }, table: DIRECT });
      await openMenu(page, t);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-bg'))).toBe(bg);
      const inn = await landmarks();
      expect(inn.filter((x) => x.startsWith('nav'))).toEqual([`nav:${t('Main')}`]);
      expect(inn).toEqual(expect.arrayContaining(['header', 'main', 'footer']));
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
      const unnamed = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            'a[href], button, input:not([type=hidden]), select, summary',
          ),
        ]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .filter(
            (e) =>
              !(
                e.getAttribute('aria-label') ||
                e.innerText.trim() ||
                e.title ||
                (e as HTMLInputElement).labels?.length ||
                e.getAttribute('placeholder')
              ),
          )
          .map((e) => e.outerHTML.slice(0, 80)),
      );
      expect(unnamed, 'every control has an accessible name').toEqual([]);
      await expect(page.getByRole('contentinfo').getByRole('status')).toHaveAttribute(
        'aria-live',
        'polite',
      );
      await ux.check(`signed in ${bg} menu open`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], {
        overlay: MENU_OVERLAY,
      });
    }
  },
);

uat(
  'SH-13',
  'SenAI panel host: room for the panel and the account menu stays reachable',
  { on: ['DW', 'D', 'DS', 'T'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const widths: (number | null)[] = meta.dev === 'DS' ? [1280, 1024] : [null];
    await page.addInitScript(
      (uid) => localStorage.setItem(`cv-assistant-open:${uid}`, '1'),
      ME.userId,
    );
    for (const w of widths) {
      if (w) await page.setViewportSize({ width: w, height: w === 1024 ? 768 : 800 });
      const width = page.viewportSize()!.width;
      await openWith(page, '#/vacancies', {
        assistant: SENAI_ON,
        vacancies: [vacItem(1), vacItem(2)],
        table: DIRECT,
      });
      const panel = page.getByRole('complementary', { name: 'SenAI' });
      await expect(panel).toBeVisible();
      const pad = await page
        .locator('main')
        .evaluate((m) => getComputedStyle(m.parentElement!).paddingRight);
      if (width >= 1280)
        expect.soft(pad, `${width}px: the content keeps 384 px for the panel`).toBe('384px');
      await ux.check(`${width}px panel open`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE'], {
        overlay: 'aside',
      });
      expect
        .soft(await hitsItself(page, AVATAR), `${width}px: the avatar is not covered by the panel`)
        .toBe(true);
      let opened = true;
      try {
        await avatarOf(page, t).click({ timeout: 3000 });
      } catch {
        opened = false;
      }
      expect.soft(opened, `${width}px: the avatar can be clicked with the panel open`).toBe(true);
      if (!opened) continue;
      const signOut = menuPanel(page).getByRole('button', { name: 'Sign out' });
      await expect(signOut).toBeVisible();
      expect
        .soft(
          await hitsItself(page, 'header details[open] > div button.w-full'),
          `${width}px: the menu paints above the panel`,
        )
        .toBe(true);
      let out = true;
      try {
        await signOut.click({ timeout: 3000 });
      } catch {
        out = false;
      }
      expect.soft(out, `${width}px: 'Sign out' can be clicked`).toBe(true);
      if (out) await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    }
  },
);

uat(
  'SH-14',
  'Rail highlight on the landing page #/ (Home) and on a CV review',
  { on: ['D', 'T', 'A'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    ux.allow(/Transition was skipped/); // the test changes routes faster than a person; see SH-06
    const main = page.getByRole('navigation', { name: 'Main' });
    const current = () => main.locator('[aria-current="page"]');
    await mockApi(page);
    await page.goto('/#/');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
    // The phone's bottom bar keeps Vacancies and Candidates only (the brand is Home), so there nothing is current on #/.
    const phone = (page.viewportSize()?.width ?? 1200) < 640;
    if (phone) {
      await expect
        .soft(main.getByRole('link', { name: 'Home' }), 'no Home on the bar')
        .toHaveCount(0);
      await expect.soft(current(), "#/: nothing is current on the phone's bar").toHaveCount(0);
    } else {
      await expect
        .soft(main.getByRole('link', { name: 'Home' }), "#/: 'Home' is the current section")
        .toHaveAttribute('aria-current', 'page');
      expect
        .soft(
          await main.getByRole('link', { name: 'Home' }).getAttribute('class'),
          "#/: 'Home' has the selected style",
        )
        .toContain('bg-sel');
    }
    await expect
      .soft(main.getByRole('link', { name: 'Vacancies' }), "#/: 'Vacancies' is not current")
      .not.toHaveAttribute('aria-current', 'page');
    expect(await current().count()).toBeLessThanOrEqual(1);
    await ux.check('landing');
    await page.goto('/#/candidates');
    await expect(main.getByRole('link', { name: 'Candidates' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByRole('link', { name: 'Aysel Məmmədova' }).first().click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}\\?l=`));
    await expect.soft(current(), 'on a CV review exactly one item is current').toHaveCount(1);
    await expect
      .soft(
        main.getByRole('link', { name: 'Candidates' }),
        "on a CV review 'Candidates' is current",
      )
      .toHaveAttribute('aria-current', 'page');
    expect
      .soft(
        await main.getByRole('link', { name: 'Candidates' }).getAttribute('class'),
        "on a CV review 'Candidates' has the selected style",
      )
      .toContain('bg-sel');
    expect(await current().count()).toBeLessThanOrEqual(1);
    await ux.check('review');
    void meta;
  },
);

// ---------------------------------------------------------------- AC

uat(
  'AC-01',
  'Account menu: open, contents, close, keyboard',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    ux.allow(/Transition was skipped/); // the test changes routes faster than a person; see SH-06
    const t = words(meta);
    await openWith(page, '#/vacancies', { table: DIRECT });
    const avatar = avatarOf(page, t);
    await expect(avatar).toHaveText('AK');
    // 1) and 2) Open and read the panel.
    await avatar.click();
    const panel = menuPanel(page);
    await expect(panel).toBeVisible();
    const pb = (await panel.boundingBox())!;
    const ab = (await avatar.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(Math.round(pb.width)).toBe(256);
    expect(Math.abs(pb.x + pb.width - (ab.x + ab.width))).toBeLessThanOrEqual(1);
    expect(pb.x).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width);
    expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height);
    await expect(panel).toContainText('Ayla Karimova');
    await expect(panel).toContainText('ayla@example.az');
    for (const l of ['Shared with me', 'Change password', 'Security'])
      await expect(panel.getByRole('link', { name: t(l), exact: true })).toBeVisible();
    await expect(panel.getByRole('combobox', { name: t('Language') })).toBeVisible();
    await expect(panel.getByText(t('Background'), { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: t('Sign out') })).toBeVisible();
    await expect(panel.getByRole('link', { name: t('Fairness monitoring') })).toHaveCount(0);
    await expect(panel.getByRole('link', { name: t('Administration'), exact: true })).toHaveCount(
      0,
    );
    await ux.check('menu open', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], {
      overlay: MENU_OVERLAY,
    });
    // 3) Esc with focus on the avatar, then from inside the panel.
    await avatar.focus();
    await page.keyboard.press('Escape');
    expect.soft(await menuOpen(page), 'Esc on the avatar closes the menu').toBe(false);
    await openMenu(page, t);
    await panel.getByRole('link', { name: t('Shared with me') }).focus();
    await page.keyboard.press('Escape');
    expect(await menuOpen(page), 'Esc inside the panel closes the menu').toBe(false);
    expect
      .soft(
        await page.evaluate((s) => document.activeElement === document.querySelector(s), AVATAR),
        'focus returns to the avatar after Esc',
      )
      .toBe(true);
    // 4) An outside click closes it.
    await openMenu(page, t);
    await page.getByRole('heading', { level: 1 }).click();
    expect.soft(await menuOpen(page), 'a click outside closes the menu').toBe(false);
    // 5) 'Security' navigates and closes.
    await openMenu(page, t);
    await menuPanel(page)
      .getByRole('link', { name: t('Security') })
      .click();
    await expect(page).toHaveURL(/#\/security$/);
    expect(await menuOpen(page)).toBe(false);
    // 6) No name: initials from the email; neither: a dot.
    await openWith(page, '#/vacancies', { me: { displayName: null }, table: DIRECT });
    await expect(avatar).toHaveText('AE');
    await openMenu(page, t);
    expect(
      (await menuPanel(page).innerText()).split('ayla@example.az').length - 1,
      'the email shows once',
    ).toBe(1);
    await ux.check('no name', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], { overlay: MENU_OVERLAY });
    await openWith(page, '#/vacancies', { me: { displayName: null, email: null }, table: DIRECT });
    await expect(avatar).toHaveText('·');
    await openMenu(page, t);
    await ux.check('no name, no email', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], {
      overlay: MENU_OVERLAY,
    });
  },
);

uat('AC-02', 'Account menu items per role', { on: ['D', 'A'] }, async ({ page, ux, meta }) => {
  ux.allow(/Transition was skipped/); // the test changes routes faster than a person; see SH-06
  const t = words(meta);
  const LINK: Record<string, RegExp> = {
    'Shared with me': /#\/reports$/,
    Monitoring: /#\/admin\/monitoring$/,
    Admin: /#\/admin$/,
    Password: /#\/password$/,
    Security: /#\/security$/,
  };
  const cases: [string, string[], string[], boolean][] = [
    [
      'admin',
      ['ADMIN'],
      ['Shared with me', 'Fairness monitoring', 'Administration', 'Change password', 'Security'],
      false,
    ],
    [
      'admin+TA',
      ['ADMIN', 'TA_PARTNER'],
      ['Shared with me', 'Fairness monitoring', 'Administration', 'Change password', 'Security'],
      true,
    ],
    [
      'governance',
      ['GOVERNANCE'],
      ['Shared with me', 'Fairness monitoring', 'Change password', 'Security'],
      false,
    ],
    ['no role', [], ['Shared with me', 'Change password', 'Security'], false],
    ['lead', ['TA_LEAD'], ['Shared with me', 'Change password', 'Security'], true],
  ];
  for (const [who, roles, links, remembers] of cases) {
    await openWith(page, '#/', { me: { roles }, assistant: SENAI_ON, table: DIRECT });
    const panel = await openMenu(page, t);
    expect(await panel.getByRole('link').allInnerTexts(), `${who}: menu links`).toEqual(
      links.map((l) => t(l)),
    );
    if (remembers)
      await expect(panel.getByText(t('What {name} remembers', { name: 'SenAI' }))).toBeVisible();
    else
      await expect(panel.getByText(t('What {name} remembers', { name: 'SenAI' }))).toHaveCount(0);
    await expect(panel.getByRole('combobox', { name: t('Language') })).toBeVisible();
    await expect(panel.getByText(t('Background'), { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: t('Sign out') })).toBeVisible();
    await ux.check(`${who} menu`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], {
      overlay: MENU_OVERLAY,
    });
    for (const l of links) {
      const p = await openMenu(page, t);
      await p.getByRole('link', { name: t(l), exact: true }).click();
      await expect(page).toHaveURL(LINK[l]!);
      expect(await menuOpen(page), `${who}: '${l}' closes the menu`).toBe(false);
    }
  }
  if (meta.lang === 'az') {
    expect(t('Administration')).toBe('İdarəetmə');
    expect(t('Fairness monitoring')).toBe('Ədalətlilik monitorinqi');
  }
});

uat(
  'AC-03',
  'Language switch in the menu: instant change, saved to the account',
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    ux.allow(/me\/preferences/);
    for (const fail of [false, true]) {
      const errors: string[] = [];
      const onErr = (e: Error) => errors.push(e.message);
      page.on('pageerror', onErr);
      const seen = await openWith(page, '#/vacancies', {
        table: {
          ...DIRECT,
          'PUT /me/preferences': fail
            ? { $status: 500, $body: { message: 'Something went wrong' } }
            : {},
        },
      });
      const order = meta.lang === 'az' ? (['en', 'az'] as const) : (['az', 'en'] as const);
      for (const lang of order) {
        const t = words({ lang });
        const panel = await openMenu(page, words({ lang: lang === 'az' ? 'en' : 'az' }));
        const sel = panel.getByRole('combobox');
        await sel.selectOption(lang);
        await expect(
          page
            .getByRole('navigation', { name: t('Main') })
            .getByRole('link', { name: t('Vacancies') }),
        ).toBeVisible();
        await expect(menuPanel(page).getByRole('button', { name: t('Sign out') })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
        expect(await page.evaluate(() => localStorage.getItem('cv-lang'))).toBe(lang);
        await expect
          .poll(
            () =>
              PUTS(seen, '/me/preferences').filter(
                (r) => JSON.stringify(r.body) === JSON.stringify({ language: lang }),
              ).length,
          )
          .toBe(1);
        if (meta.touch)
          expect
            .soft(
              (await sel.boundingBox())!.height,
              'the language select is at least 44 px tall on touch',
            )
            .toBeGreaterThanOrEqual(44);
        await ux.check(
          `${fail ? 'PUT fails, ' : ''}${lang}`,
          [
            'OCC',
            'OVL',
            'OVF',
            'TGT',
            'AXE',
            ...(lang === 'az' && meta.lang === 'az' ? (['AZ'] as const) : []),
          ],
          { overlay: MENU_OVERLAY },
        );
      }
      expect(PUTS(seen, '/me/preferences')).toHaveLength(2);
      page.off('pageerror', onErr);
      expect(errors, 'no page error').toEqual([]);
    }
  },
);

uat(
  'AC-05',
  'Background picker: five choices, the default and instant apply',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    for (const saved of [null, 'cream'] as const) {
      const seen = await openWith(page, '#/vacancies', {
        me: { background: saved },
        table: DIRECT,
      });
      const panel = await openMenu(page, t);
      await panel.getByText(t('Background'), { exact: true }).click();
      const group = page.getByRole('group', { name: t('Page background') });
      await expect(group).toBeVisible();
      const labels = ['Match my device', 'White', 'White-grey', 'Cream-white', 'Dark'];
      await expect(group.getByRole('radio')).toHaveCount(5);
      for (const l of labels)
        await expect(group.getByRole('radio', { name: t(l), exact: true })).toBeVisible();
      expect(await group.locator('span[aria-hidden="true"]').count()).toBe(5);
      await expect(
        group.getByRole('radio', { name: t(saved ? 'Cream-white' : 'White-grey'), exact: true }),
      ).toBeChecked();
      if (saved) continue;
      for (const [label, value] of [
        ['White', 'white'],
        ['White-grey', 'grey'],
        ['Cream-white', 'cream'],
        ['Dark', 'dark'],
        ['Match my device', 'auto'],
      ] as const) {
        await group.getByRole('radio', { name: t(label), exact: true }).check();
        expect(await page.evaluate(() => document.documentElement.getAttribute('data-bg'))).toBe(
          value,
        );
        await expect
          .poll(() =>
            PUTS(seen, '/me/preferences').some(
              (r) => JSON.stringify(r.body) === JSON.stringify({ background: value }),
            ),
          )
          .toBe(true);
        expect(await page.evaluate(() => localStorage.getItem('cv-background'))).toBe(value);
        const fb = (await group.boundingBox())!;
        const vp = page.viewportSize()!;
        expect(
          fb.x >= 0 && fb.y >= 0 && fb.x + fb.width <= vp.width && fb.y + fb.height <= vp.height,
          'the picker lies inside the viewport',
        ).toBe(true);
        expect
          .soft(
            await hitsItself(page, 'header details[open] > div button.w-full'),
            `${label}: 'Sign out' stays reachable with the picker open`,
          )
          .toBe(true);
        if (value !== 'auto')
          await ux.check(`background ${value}`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], {
            overlay: PICKER_OVERLAY,
          });
      }
    }
  },
);

uat(
  'AC-06',
  'Background save fails: the choice applies here and a note says so',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    ux.allow(/me\/preferences/);
    let n = 0;
    await openWith(page, '#/vacancies', {
      table: {
        ...DIRECT,
        'PUT /me/preferences': (route: Route) =>
          n++ === 0
            ? route.fulfill({ status: 500, json: { message: 'Something went wrong' } })
            : route.fulfill({ json: {} }),
      },
    });
    const panel = await openMenu(page, t);
    await panel.getByText(t('Background'), { exact: true }).click();
    const group = page.getByRole('group', { name: t('Page background') });
    await group.getByRole('radio', { name: t('Dark'), exact: true }).check();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-bg'))).toBe(
      'dark',
    );
    const note = group.getByRole('alert');
    await expect(note).toHaveText(
      t('Could not save your choice. It applies on this device only for now.'),
    );
    await ux.check('save failed on dark', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], {
      overlay: PICKER_OVERLAY,
    });
    await group.getByRole('radio', { name: t('White'), exact: true }).check();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-bg'))).toBe(
      'white',
    );
    await expect(note).toHaveCount(0);
    await ux.check('saved on white', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], {
      overlay: PICKER_OVERLAY,
    });
  },
);

uat(
  'AC-07',
  "'Match my device' follows the OS setting; no flash on reload",
  { on: ['D', 'I'], langs: 'EN' },
  async ({ page, ux }) => {
    const themeInit: number[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('/theme-init.js')) themeInit.push(r.status());
    });
    // data-bg as it was when <body> was first created, before the bundle ran.
    await page.addInitScript(() => {
      const w = window as unknown as { __bgAtBody?: string | null };
      new MutationObserver((_, o) => {
        if (document.body) {
          w.__bgAtBody = document.documentElement.getAttribute('data-bg');
          o.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await openWith(page, '#/vacancies', { me: { background: 'auto' } });
    await expect(page.getByRole('heading', { level: 1, name: 'Vacancies' })).toBeVisible();
    const lum = () =>
      page.locator('main').evaluate((m) => {
        const c = getComputedStyle(m.parentElement!.parentElement!.parentElement!)
          .backgroundColor.match(/\d+/g)!
          .map(Number);
        return (0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!) / 255;
      });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-bg'))).toBe(
      'auto',
    );
    expect(await lum(), 'light tokens with a light OS').toBeGreaterThan(0.8);
    await ux.check('auto light', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(lum, { message: 'dark tokens with a dark OS, without reload' })
      .toBeLessThan(0.2);
    await ux.check('auto dark', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    await page.evaluate(() => localStorage.setItem('cv-background', 'dark'));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    expect(
      await page.evaluate(() => (window as unknown as { __bgAtBody?: string }).__bgAtBody),
    ).toBe('dark');
    expect(themeInit.at(-1)).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Vacancies' })).toBeVisible();
    await ux.check('after reload', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  },
);

uat(
  'AC-08',
  "'What SenAI remembers' entry in the menu (entry only)",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const echo = (route: Route) =>
      route.fulfill({
        json: { top: (route.request().postDataJSON() as { top: number | null }).top },
      });
    // Run 1: nothing saved.
    const seen = await openWith(page, '#/vacancies', {
      assistant: SENAI_ON,
      table: {
        ...DIRECT,
        'GET /assistant/preferences': { top: null },
        'PUT /assistant/preferences': echo,
      },
    });
    let panel = await openMenu(page, t);
    await expect(panel.getByText(t('What {name} remembers', { name: 'SenAI' }))).toBeVisible();
    await expect(
      panel.getByText(t('Nothing saved. Ask "always show top 5" or set it here.')),
    ).toBeVisible();
    const field = panel.getByRole('spinbutton', { name: t('How many to show') });
    await expect(field).toHaveValue('5');
    await expect(panel.getByRole('button', { name: t('Clear') })).toHaveCount(0);
    await ux.check('nothing saved', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], {
      overlay: MENU_OVERLAY,
    });
    const putBodies = () => PUTS(seen, '/assistant/preferences').map((r) => JSON.stringify(r.body));
    await field.fill('12');
    await panel.getByRole('button', { name: t('Save'), exact: true }).click();
    await expect(
      panel.getByText(t('Shows the top {n} unless you ask for more.', { n: 12 })),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: t('Clear') })).toBeVisible();
    expect(putBodies().at(-1)).toBe(JSON.stringify({ top: 12 }));
    await panel.getByRole('button', { name: t('Clear') }).click();
    await expect(
      panel.getByText(t('Nothing saved. Ask "always show top 5" or set it here.')),
    ).toBeVisible();
    expect(putBodies().at(-1)).toBe(JSON.stringify({ top: null }));
    await field.fill('99');
    await panel.getByRole('button', { name: t('Save'), exact: true }).click();
    await expect.poll(() => putBodies().at(-1)).toBe(JSON.stringify({ top: 50 }));
    // Run 2: 7 saved.
    await openWith(page, '#/vacancies', {
      assistant: SENAI_ON,
      table: {
        ...DIRECT,
        'GET /assistant/preferences': { top: 7 },
        'PUT /assistant/preferences': echo,
      },
    });
    panel = await openMenu(page, t);
    await expect(
      panel.getByText(t('Shows the top {n} unless you ask for more.', { n: 7 })),
    ).toBeVisible();
    await expect(panel.getByRole('spinbutton', { name: t('How many to show') })).toHaveValue('7');
    await ux.check('7 saved', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], { overlay: MENU_OVERLAY });
    // 5) Admin, and the recruiter with SenAI off: no section.
    for (const [who, opts] of [
      ['admin', { me: { roles: ['ADMIN'] }, assistant: SENAI_ON }],
      ['SenAI off', { assistant: { enabled: false } }],
    ] as const) {
      await openWith(page, '#/', {
        ...opts,
        table: { ...DIRECT, 'GET /assistant/preferences': { top: 7 } },
      });
      panel = await openMenu(page, t);
      await expect(panel.getByRole('button', { name: t('Sign out') })).toBeVisible();
      await expect(panel.getByText(t('What {name} remembers', { name: 'SenAI' })), who).toHaveCount(
        0,
      );
    }
  },
);

uat(
  'AC-09',
  "'Shared with me' opens the list of reports shared with me",
  { on: 'All' },
  async ({ page, ux, meta }) => {
    ux.allow(/Transition was skipped/); // the test changes routes faster than a person; see SH-06
    const t = words(meta);
    const h1 = page.getByRole('heading', { level: 1, name: t('Shared with me') });
    const go = async (roles: string[], answer: unknown, bg: string) => {
      await openWith(page, '#/', {
        me: { roles, background: bg },
        table: {
          ...DIRECT,
          'GET /reports/mine': answer,
          [`GET /reports/${SHARED_ROWS[0]!.id}`]: REPORT_OPENED,
        },
      });
      const panel = await openMenu(page, t);
      await panel.getByRole('link', { name: t('Shared with me') }).click();
      await expect(page).toHaveURL(/#\/reports$/);
      await expect(h1).toBeVisible();
    };
    // (a) nothing, after 1 s.
    await go(['TA_PARTNER'], { $status: 200, $body: { reports: [] }, $delay: 1000 }, 'white');
    await expect(page.getByText(t('Loading…'))).toBeVisible();
    await expect(
      page.getByRole('status').filter({
        hasText: t(
          'Nothing has been shared with you, or the links have expired. Ask the recruiter for a new link.',
        ),
      }),
    ).toBeVisible();
    await ux.check('empty, white', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    // (b) two rows, for the recruiter, the viewer and governance.
    for (const [roles, bg] of [
      [['TA_PARTNER'], 'grey'],
      [[], 'cream'],
      [['GOVERNANCE'], 'dark'],
    ] as const) {
      await go([...roles], { reports: SHARED_ROWS }, bg);
      const items = page.getByRole('main').getByRole('listitem');
      await expect(items).toHaveCount(2);
      for (let i = 0; i < 2; i++) {
        const r = SHARED_ROWS[i]!;
        await expect(items.nth(i).getByRole('link', { name: r.title })).toHaveAttribute(
          'href',
          `#/reports/${r.id}`,
        );
        const d1 = await appDayAndTime(page, r.sharedAt as string, meta.lang);
        const d2 = await appDayAndTime(page, r.expiresAt as string, meta.lang);
        await expect(items.nth(i)).toContainText(
          t('Shared by {by} on {date} · works until {until}', {
            by: 'Aysel Mammadova',
            date: d1,
            until: d2,
          }),
        );
      }
      await ux.check(`two rows, ${bg}`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    }
    // 3) A title opens the report.
    await page.getByRole('link', { name: SHARED_ROWS[0]!.title }).first().click();
    await expect(page).toHaveURL(new RegExp(`#/reports/${REPORT_ID}$`));
    // (c) the list fails.
    await go(['TA_PARTNER'], { $status: 500, $body: { message: 'Something went wrong' } }, 'grey');
    await expect(page.getByRole('alert')).toBeVisible();
    await ux.check('error', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
  },
);

uat('AC-10', 'Sign out from the menu', { on: 'All', langs: 'EN' }, async ({ page, ux, meta }) => {
  const t = words(meta);
  // The token is put in this tab once, as after a real sign-in (a reload must not bring it back).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('uat-token-set')) {
      sessionStorage.setItem('cv.session', 'e2e-token');
      sessionStorage.setItem('uat-token-set', '1');
    }
  });
  const seen = await mockApi(page, {
    signedIn: false,
    extra: async (route, url) => {
      if (url.pathname !== '/me') return false;
      if (route.request().headers().authorization === 'Bearer e2e-token')
        await route.fulfill({ json: ME });
      else await route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
      return true;
    },
  });
  await page.goto('/#/vacancies');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Candidates' })
    .click();
  await expect(page).toHaveURL(/#\/candidates$/);
  const panel = await openMenu(page, t);
  const n = seen.requests.length;
  await panel.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('header details')).toHaveCount(0);
  await expect(page.getByText('Your session ended. Please sign in again.')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('cv.session'))).toBeNull();
  await page.waitForTimeout(500);
  expect(
    seen.requests
      .slice(n)
      // The sign-out call itself must carry the token it ends; nothing after it may.
      .filter((r) => r.headers.authorization === 'Bearer e2e-token' && r.url !== '/auth/logout'),
    'no request with the old token after Sign out',
  ).toEqual([]);
  await expect(page.locator('header').getByRole('combobox', { name: 'Language' })).toBeVisible();
  await ux.check('signed out', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  await page.goBack();
  // Back returns to the address of the page the person left (#/candidates); the Sign in card shows.
  await expect(page).toHaveURL(/#\/candidates$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('header').getByRole('combobox', { name: 'Language' })).toBeVisible();
});

uat(
  'AC-11',
  'Account menu on touch screens and on all four backgrounds',
  { on: ['T', 'TL', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    ux.allow(/Transition was skipped/); // the test changes routes faster than a person; see SH-06
    const t = words(meta);
    const me = {
      displayName: 'Aysel Mammadova-Əliyeva Long Name',
      email: 'a.very.long.address@example.az',
      roles: ['ADMIN', 'TA_PARTNER'],
    };
    for (const bg of ['white', 'grey', 'cream', 'dark']) {
      await openWith(page, '#/vacancies', {
        me: { ...me, background: bg },
        assistant: SENAI_ON,
        table: DIRECT,
      });
      const avatar = avatarOf(page, t);
      expect
        .soft((await avatar.boundingBox())!.height, `${bg}: the avatar is at least 44 px tall`)
        .toBeGreaterThanOrEqual(44);
      const panel = await openMenu(page, t);
      const small: string[] = [];
      for (const c of await panel.locator('a, button, select, summary, input').all()) {
        const b = (await c.boundingBox())!;
        if (b.height < 44)
          small.push(
            `${(await c.getAttribute('aria-label')) ?? (await c.innerText()).trim()} ${Math.round(b.height)}px`,
          );
      }
      expect.soft(small, `${bg}: every menu item is at least 44 px tall on touch`).toEqual([]);
      await panel.getByText(t('Background'), { exact: true }).click();
      const vp = page.viewportSize()!;
      for (const b of [
        await panel.boundingBox(),
        await page.getByRole('group', { name: t('Page background') }).boundingBox(),
      ]) {
        expect(
          b!.x >= 0 && b!.y >= 0 && b!.x + b!.width <= vp.width && b!.y + b!.height <= vp.height,
          `${bg}: the panel and the picker stay inside the viewport`,
        ).toBe(true);
      }
      for (const full of [me.displayName, me.email]) {
        const el = panel.locator('p.truncate', { hasText: full });
        await expect(el).toHaveCount(1);
        const info = await el.evaluate((e) => ({
          oneLine: e.getBoundingClientRect().height < 30,
          cut: e.scrollWidth > e.clientWidth,
          title:
            e.getAttribute('title') ??
            e.closest('[title]')?.getAttribute('title') ??
            e.getAttribute('aria-label') ??
            '',
        }));
        expect(info.oneLine, `${bg}: "${full}" stays on one line`).toBe(true);
        if (info.cut)
          expect
            .soft(
              info.title,
              `${bg}: the cut-off "${full}" has its full text in a title or accessible name`,
            )
            .toContain(full);
      }
      await ux.check(`menu and picker on ${bg}`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ'], {
        overlay: MENU_OVERLAY,
      });
    }
    // 3) Tap each item.
    const dest: [string, RegExp][] = [
      ['Shared with me', /#\/reports$/],
      ['Fairness monitoring', /#\/admin\/monitoring$/],
      ['Administration', /#\/admin$/],
      ['Change password', /#\/password$/],
      ['Security', /#\/security$/],
    ];
    for (const [l, re] of dest) {
      const panel = await openMenu(page, t);
      await panel.getByRole('link', { name: t(l), exact: true }).tap();
      await expect(page).toHaveURL(re);
    }
  },
);

uat(
  'AC-12',
  "'What SenAI remembers': a failed Save or Clear is reported and not shown as saved",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    ux.allow(/assistant\/preferences/);
    let n = 0;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openWith(page, '#/vacancies', {
      assistant: SENAI_ON,
      table: {
        ...DIRECT,
        'GET /assistant/preferences': { top: 7 },
        'PUT /assistant/preferences': (route: Route) =>
          n++ % 2 === 0
            ? route.fulfill({ status: 500, json: { message: 'Something went wrong' } })
            : route.abort('failed'),
      },
    });
    const attempt = async (lang: 'en' | 'az', what: 'Save' | 'Clear') => {
      const t = words({ lang });
      const panel = await openMenu(page, t);
      if (what === 'Save') {
        await panel.getByRole('spinbutton', { name: t('How many to show') }).fill('12');
        await panel.getByRole('button', { name: t('Save'), exact: true }).click();
      } else await panel.getByRole('button', { name: t('Clear') }).click();
      await page.waitForTimeout(600);
      const msg = panel
        .getByRole('alert')
        .or(panel.locator('[role=status]').filter({ hasText: /\S/ }));
      await expect
        .soft(msg.first(), `${lang} ${what}: a visible message says the choice was not saved`)
        .toBeVisible({ timeout: 1000 });
      await expect(
        panel.getByText(t('Shows the top {n} unless you ask for more.', { n: 7 })),
      ).toBeVisible();
      await expect(
        panel.getByText(t('Shows the top {n} unless you ask for more.', { n: 12 })),
      ).toHaveCount(0);
      await ux.check(
        `${lang} ${what} failed`,
        ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', ...(lang === 'az' ? (['AZ'] as const) : [])],
        { overlay: MENU_OVERLAY },
      );
    };
    await attempt(meta.lang, 'Save'); // 500
    await attempt(meta.lang, 'Clear'); // network failure
    if (meta.lang === 'en') {
      await menuPanel(page).getByRole('combobox').selectOption('az');
      await attempt('az', 'Save');
    } else await attempt('az', 'Save');
    expect(errors, 'no unhandled promise rejection').toEqual([]);
  },
);

void ([] as Locator[]);
