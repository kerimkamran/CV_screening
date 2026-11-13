import type { Page } from '@playwright/test';
import { DID, mockApi, openReview } from '../fixtures/api';
import { ADMIN_ANSWERS, MFA_OFF } from '../fixtures/pkg-a';
import { hasRing, pageScrollsSideways, smallTargets, vacApi, vrow, vview } from '../fixtures/pkg-c';
import { DVID, resultsApi } from '../fixtures/pkg-d';
import { focused, poolAnswer, ringContrast, SENAI_H, T } from '../fixtures/pkg-h';
import { axe } from '../ux/checks';
import { expect, STD, uat } from '../ux/test';

// 7.x Accessibility (A11), layer L1. UAT plan v1.1; each case is the row of the same ID.

const BGS = ['white', 'grey', 'cream', 'dark'] as const;
const ADMIN_ME = { roles: ['ADMIN', 'TA_PARTNER'] };

/** Answers every screen of the recruiter app needs (L1), SenAI on with the row's features. */
async function app(
  page: Page,
  o: { me?: Record<string, unknown>; ask?: unknown; signedIn?: boolean } = {},
) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const table: Record<string, unknown> = {
    ...ADMIN_ANSWERS,
    '/reports/mine': { reports: [] },
    '/auth/mfa': MFA_OFF,
    '/assistant/preferences': { top: null },
    '/me/preferences': {},
    '/assistant/conversations': [],
  };
  const { seen } = await vacApi(page, {
    me: o.me,
    assistant: SENAI_H,
    list: [
      vrow(),
      vrow({ id: '01K0000000000000000000000W', title: 'Network Engineer 2', status: 'draft' }),
    ],
    views: [vview()],
    extra: async (route, url, method) => {
      const p = url.pathname;
      if (o.signedIn === false && p === '/me')
        return route.fulfill({ status: 401, json: { message: 'Sign in' } }).then(() => true);
      if (p === '/assistant/ask' && method === 'POST')
        return route
          .fulfill({
            json: o.ask ?? {
              conversationId: '01K00000000000000000000CNV',
              messageId: '01K00000000000000000000MSG',
              answer: poolAnswer(3),
            },
          })
          .then(() => true);
      if (/^\/screenings\/\w+\/assistant$/.test(p))
        return route.fulfill({ json: { thread: null } }).then(() => true);
      const a = table[p];
      if (a !== undefined) return route.fulfill({ json: a }).then(() => true);
      return false;
    },
  });
  return seen;
}

/** Open the SenAI panel from the Ask bar (empty question opens it). */
async function openPool(page: Page) {
  const ask = page.getByRole('search').getByRole('textbox');
  await ask.click();
  await ask.press('Enter');
}

/** The axe violations (serious and critical, WCAG 2.2 A/AA) as one line each. */
const axeLines = async (page: Page, where: string) =>
  (await axe(page)).map((f) => `${where}: ${f.what}`);

// ---------------------------------------------------------------- A11-01

uat(
  'A11-01',
  'axe WCAG 2.2 AA on every main screen on all 4 backgrounds',
  { on: ['D', 'A'], timeout: 180_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const out: string[] = [];
    const onAll = async (where: string) => {
      for (const bg of BGS) {
        await page.evaluate((b) => document.documentElement.setAttribute('data-bg', b), bg);
        await page.waitForTimeout(150);
        out.push(...(await axeLines(page, `${where} [${bg}]`)));
      }
      await page.evaluate(() => document.documentElement.removeAttribute('data-bg'));
    };
    // Sign in (signed out).
    await app(page, { signedIn: false });
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: t('Sign in') })).toBeVisible();
    await onAll('Sign in');
    // Recruiter screens (admin + TA so Admin is reachable).
    await app(page, { me: ADMIN_ME });
    for (const [hash, name] of [
      ['#/vacancies', 'Vacancies'],
      ['#/vacancies/new', 'New vacancy'],
      ['#/candidates', 'Candidates'],
      ['#/reports', 'Reports'],
      ['#/password', 'Change password'],
      ['#/security', 'Security'],
      ['#/admin', 'Admin'],
    ] as const) {
      await page.goto(`/?s=${name.replace(/ /g, '')}${hash}`);
      await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
      await page.waitForTimeout(300);
      await onAll(name);
    }
    // The pool panel with an answer.
    await page.goto('/?s=pool#/vacancies');
    const ask = page.getByRole('search').getByRole('textbox');
    await ask.fill('Who has BGP routing?');
    await ask.press('Enter');
    await expect(
      page
        .getByRole('complementary', { name: 'SenAI' })
        .getByText('3 candidates match BGP routing'),
    ).toBeVisible();
    await onAll('Pool panel with an answer');
    // CV review: CV and the candidate panel.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockApi(page, {
      assistant: SENAI_H,
      extra: async (route, url) =>
        url.pathname.startsWith('/assistant/conversations')
          ? route.fulfill({ json: [] }).then(() => true)
          : /^\/screenings\/\w+\/assistant$/.test(url.pathname)
            ? route.fulfill({ json: { thread: null } }).then(() => true)
            : false,
    });
    await openReview(page, DID);
    await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' }).first()).toBeVisible();
    await onAll('CV review');
    await openPool(page);
    await onAll('Candidate panel');
    // Results with the star map, the drawer and the other vacancy tabs.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/#/vacancies/${DVID}/results`);
    const tabs = page.getByRole('tablist', { name: t('Vacancy views') }).getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(400);
      await onAll(`Vacancy tab ${(await tabs.nth(i).innerText()).trim()}`);
    }
    await ux.check('last screen', STD);
    expect
      .soft(
        out,
        'axe WCAG 2.2 A/AA violations (serious/critical) on the main screens and backgrounds',
      )
      .toEqual([]);
  },
);

// ---------------------------------------------------------------- A11-02

uat(
  'A11-02',
  'Landmarks, headings and page titles',
  { on: ['D', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const problems: string[] = [];
    const titles = new Map<string, string>();
    const read = async (where: string, o: { signedIn?: boolean } = {}) => {
      const r = await page.evaluate(() => {
        const vis = (e: Element) => {
          const b = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
          .filter(vis)
          .map((h) => Number(h.tagName[1]));
        let skip = '';
        for (let i = 1; i < hs.length; i++)
          if (hs[i]! > hs[i - 1]! + 1) skip ||= `h${hs[i - 1]} → h${hs[i]}`;
        return {
          mains: [...document.querySelectorAll('main, [role=main]')].length,
          h1: [...document.querySelectorAll('h1')].filter(vis).length,
          firstHeading: hs[0] ?? 0,
          skip,
          navMain: [...document.querySelectorAll('nav')].filter(vis).length,
          search: document.querySelectorAll('[role=search], search').length,
          title: document.title,
        };
      });
      if (r.mains !== 1) problems.push(`${where}: ${r.mains} main landmarks`);
      if (r.h1 !== 1) problems.push(`${where}: ${r.h1} visible h1`);
      if (r.skip) problems.push(`${where}: heading levels skip (${r.skip})`);
      if (o.signedIn !== false && r.navMain !== 1)
        problems.push(`${where}: ${r.navMain} visible navigation landmarks`);
      titles.set(where, r.title);
      return r;
    };
    await app(page, { signedIn: false });
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: t('Sign in') })).toBeVisible();
    await read('Sign in', { signedIn: false });
    await app(page, { me: ADMIN_ME });
    for (const [hash, name] of [
      ['#/vacancies', 'Vacancies'],
      ['#/vacancies/new', 'New vacancy'],
      ['#/candidates', 'Candidates'],
      ['#/reports', 'Reports'],
      ['#/password', 'Change password'],
      ['#/security', 'Security'],
      ['#/admin', 'Admin'],
    ] as const) {
      await page.goto(`/?s=${name.replace(/ /g, '')}${hash}`);
      await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
      await page.waitForTimeout(200);
      const r = await read(name);
      expect.soft(r.search, `${name}: a search landmark for the Ask bar`).toBe(1);
    }
    // document.title names the page: every page has its own title.
    const distinct = new Set(titles.values());
    expect
      .soft(
        distinct.size,
        `document.title names the page (got ${[...titles].map(([k, v]) => `${k}='${v}'`).join(', ')})`,
      )
      .toBe(titles.size);
    // Both SenAI panels: complementary landmarks named the same way, each with an h2.
    await page.goto('/?s=p#/vacancies');
    await openPool(page);
    const pool = page.getByRole('complementary').last();
    await expect(pool).toBeVisible();
    const poolName = await pool.getAttribute('aria-label');
    const poolH2 = await pool.locator('h2').count();
    await page.keyboard.press('Escape');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockApi(page, {
      assistant: SENAI_H,
      extra: async (route, url) =>
        url.pathname.startsWith('/assistant/conversations')
          ? route.fulfill({ json: [] }).then(() => true)
          : /^\/screenings\/\w+\/assistant$/.test(url.pathname)
            ? route.fulfill({ json: { thread: null } }).then(() => true)
            : false,
    });
    await openReview(page, DID);
    await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' }).first()).toBeVisible();
    await read('CV review');
    await openPool(page);
    const cand = page
      .getByRole('complementary')
      .filter({ has: page.getByRole('list', { name: t('Suggested questions') }) });
    await expect(cand).toBeVisible();
    const candName = await cand.getAttribute('aria-label');
    expect.soft(await cand.locator('h2').count(), 'candidate panel has an h2').toBeGreaterThan(0);
    expect.soft(poolH2, 'pool panel has an h2').toBeGreaterThan(0);
    expect
      .soft(
        candName,
        `both SenAI panels are named the same way (pool '${poolName}', candidate '${candName}')`,
      )
      .toBe(poolName);
    await ux.check('candidate panel', STD);
    expect
      .soft(problems, 'one main, one h1, one visible Main navigation, no skipped heading level')
      .toEqual([]);
  },
);

// ---------------------------------------------------------------- A11-03

uat('A11-03', 'Skip link', { on: ['D', 'E'] }, async ({ page, ux, meta }) => {
  await app(page);
  await page.goto('/#/vacancies');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page
    .locator('body')
    .click({ position: { x: 1, y: 1 } })
    .catch(() => undefined);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // 1) The first Tab reaches a visible 'Skip to main content' link (AZ text in AZ).
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    const r = a.getBoundingClientRect();
    return {
      tag: a.tagName,
      text: a.innerText.trim(),
      href: a.getAttribute('href'),
      visible: r.width > 1 && r.height > 1,
    };
  });
  const want = meta.lang === 'az' ? /əsas|məzmun|keç/i : /skip to main content/i;
  expect(
    first.text,
    `the first Tab stop is the skip link (it is ${first.tag} '${first.text}')`,
  ).toMatch(want);
  expect(first.visible).toBe(true);
  await ux.check('skip link focused', [...STD, 'AZ']);
  // 2) Enter moves focus to main; 3) the next Tab is inside main.
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);
});

// ---------------------------------------------------------------- A11-04

uat(
  'A11-04',
  'Focus order and visible focus rings',
  { on: ['D', 'E'], langs: 'EN', timeout: 90_000 },
  async ({ page, ux }) => {
    await app(page);
    await page.goto('/#/vacancies');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const order: string[] = [];
    const noRing: string[] = [];
    const weak: string[] = [];
    const zone = () =>
      page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body) return 'body';
        if (a.closest('header')) {
          if (a.closest('[role=search]')) return 'ask';
          if (a.closest('details')) return 'account';
          return 'brand';
        }
        if (a.closest('nav')) return 'rail';
        if (a.closest('main')) return 'main';
        if (a.closest('footer')) return 'footer';
        if (a.closest('aside')) return 'panel';
        return 'other';
      });
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab');
      const z = await zone();
      if (order[order.length - 1] !== z) order.push(z);
      const r = await ringContrast(page);
      if (z === 'footer' || (order.includes('main') && z === 'body')) break;
      if (z === 'body') continue; // focus is in the browser's own UI
      if (!r.ring) noRing.push(r.what);
      else if (r.contrast < 3) weak.push(`${r.what} ${r.contrast}:1`);
    }
    // Brand, Ask bar, account menu, rail, main, footer (footer only when it has a control).
    const want = ['brand', 'ask', 'account', 'rail', 'main'];
    expect
      .soft(order.slice(0, 5), `focus follows the visual order (got ${order.join(' → ')})`)
      .toEqual(want);
    expect.soft([...new Set(noRing)], 'every focused element shows a ring').toEqual([]);
    expect.soft([...new Set(weak)], 'every ring has ≥ 3:1 contrast against the page').toEqual([]);
    await ux.check('vacancies tabbed', STD);

    // The vacancy tabs: each tab button shows a ring.
    await resultsApi(page, { answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/?r=1#/vacancies/${DVID}/candidates`);
    const tab = page.getByRole('tablist', { name: 'Vacancy views' }).getByRole('tab').first();
    await expect(tab).toBeVisible();
    await tab.focus();
    await page.keyboard.press('ArrowRight');
    const tr = await ringContrast(page);
    expect
      .soft(tr.ring && tr.contrast >= 3, `vacancy tab button ring (${tr.what}, ${tr.contrast}:1)`)
      .toBe(true);

    // After Close: the account menu closed with Escape gives focus back to its button, not body.
    await page.getByLabel('Account menu', { exact: true }).click();
    await page.keyboard.press('Escape');
    expect
      .soft(await focused(page), 'after closing the account menu focus is not on body')
      .not.toBe('body');
    // The full-screen CV closed: focus returns to 'Full screen', not body.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockApi(page, {
      assistant: SENAI_H,
      extra: async (route, url) =>
        url.pathname.startsWith('/assistant/conversations')
          ? route.fulfill({ json: [] }).then(() => true)
          : /^\/screenings\/\w+\/assistant$/.test(url.pathname)
            ? route.fulfill({ json: { thread: null } }).then(() => true)
            : false,
    });
    await openReview(page, DID);
    const full = page.getByRole('button', { name: 'Full screen', exact: true });
    await full.click();
    await page.getByRole('button', { name: 'Close full screen' }).click();
    expect
      .soft(await focused(page), 'after closing the full-screen CV focus is not on body')
      .not.toBe('body');
    // The candidate panel does not cover a focusable element of the page.
    await openPool(page);
    const covered = await page.evaluate(() => {
      const aside = [...document.querySelectorAll('aside')].pop();
      if (!aside) return [];
      const ar = aside.getBoundingClientRect();
      return [
        ...document.querySelectorAll<HTMLElement>(
          'main a[href], main button, main input, main select, main [tabindex="0"]',
        ),
      ]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          return cx > ar.left && cx < ar.right && cy > ar.top && cy < ar.bottom && cy < innerHeight;
        })
        .map((e) => (e.getAttribute('aria-label') || e.innerText).trim().slice(0, 30));
    });
    expect.soft(covered, 'no focusable element of the page sits under the SenAI panel').toEqual([]);
    await ux.check('panel open', STD);
  },
);

// ---------------------------------------------------------------- A11-05

uat(
  'A11-05',
  'SenAI panels by keyboard and screen reader',
  { on: ['D', 'E', 'T'], timeout: 60_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await page.addInitScript(() => {
      const w = window as unknown as { __live: string[] };
      w.__live = [];
      new MutationObserver((ms) => {
        for (const m of ms) {
          const el = (
            m.target.nodeType === 1 ? m.target : m.target.parentElement
          ) as Element | null;
          const live = el?.closest('[aria-live], [role=status], [role=alert]');
          if (live && (live.textContent ?? '').trim())
            w.__live.push(
              `${live.getAttribute('role') ?? 'live'}: ${(live.textContent ?? '').trim().slice(0, 80)}`,
            );
        }
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await app(page);
    await page.goto('/#/vacancies');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // 1) '/' jumps to the Ask bar; type, Enter.
    await page.locator('main h1').click();
    await page.keyboard.press('/');
    const ask = page.getByRole('search').getByRole('textbox');
    await expect(ask).toBeFocused();
    await page.keyboard.type('Who has BGP routing?');
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: 'SenAI' });
    await expect(panel.getByText('3 candidates match BGP routing')).toBeVisible();
    const where = await page.evaluate(() => {
      const a = document.activeElement;
      return a?.closest('[role=search]')
        ? 'ask'
        : a?.closest('aside')
          ? a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'
            ? 'composer'
            : 'panel'
          : a === document.body
            ? 'body'
            : 'page';
    });
    expect
      .soft(['ask', 'composer'], `focus stays in the Ask bar or the composer (it is in ${where})`)
      .toContain(where);
    // 2) Tab through the panel: every control is named; the conversation region is focusable.
    const unnamed = await panel.evaluate((root) =>
      [
        ...root.querySelectorAll<HTMLElement>(
          'button, a[href], input, textarea, select, [tabindex="0"]',
        ),
      ]
        .filter((e) => {
          const name = (
            e.getAttribute('aria-label') ||
            e.getAttribute('aria-labelledby') ||
            e.innerText ||
            e.getAttribute('title') ||
            (e as HTMLInputElement).placeholder ||
            ''
          ).trim();
          const lab = e.id ? document.querySelector(`label[for="${e.id}"]`) : e.closest('label');
          return !name && !lab;
        })
        .map((e) => e.outerHTML.slice(0, 80)),
    );
    expect.soft(unnamed, 'every control in the pool panel has a name').toEqual([]);
    const conv = panel.getByLabel(t('Conversation'), { exact: true });
    expect
      .soft(await conv.getAttribute('tabindex'), 'the conversation region is focusable')
      .toBe('0');
    // 3) Escape closes the panel and focus returns to the Ask bar or the opener.
    await panel.getByRole('button').first().focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    const back = await focused(page);
    expect.soft(back, 'after Escape focus returns to the Ask bar').toMatch(/^input/);
    // 5) Live region: 'SenAI has answered.' once per answer.
    const live = await page.evaluate(() => (window as unknown as { __live: string[] }).__live);
    const answered = live.filter((l) => l.includes(t('{name} has answered.', { name: 'SenAI' })));
    expect
      .soft(
        answered.length,
        `'SenAI has answered.' announced once (log: ${live.slice(0, 6).join(' | ')})`,
      )
      .toBe(1);
    await ux.check('after the pool panel', [...STD, 'AZ']);
  },
);

// ---------------------------------------------------------------- A11-06

uat(
  'A11-06',
  'Dialogs, drawers and menus behave as modals or menus',
  { on: ['D', 'E', 'T'], langs: 'EN', timeout: 90_000 },
  async ({ page, ux, meta }) => {
    // The full-screen CV.
    await mockApi(page, { assistant: { enabled: false } });
    await openReview(page, DID);
    const opener = page.getByRole('button', { name: 'Full screen', exact: true });
    await opener.click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    expect.soft(await dlg.getAttribute('aria-modal'), 'full-screen CV: aria-modal').toBe('true');
    expect
      .soft(
        (await dlg.getAttribute('aria-label')) ?? (await dlg.getAttribute('aria-labelledby')),
        'full-screen CV has a name',
      )
      .toBeTruthy();
    let escaped = 0;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      if (
        await page.evaluate(
          () =>
            document.activeElement !== document.body &&
            !document.activeElement?.closest('dialog[open]'),
        )
      )
        escaped++;
    }
    expect.soft(escaped, 'full-screen CV: Tab stays inside (20 presses)').toBe(0);
    await ux.check('full screen', STD, { overlay: 'dialog[open]' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener, 'full-screen CV: Escape returns focus to the opener').toBeFocused();

    // The Requirements drawer on Results.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/#/vacancies/${DVID}/results`);
    const reqBtn = page.getByRole('button', { name: /^Requirements/ });
    if (await reqBtn.isVisible().catch(() => false)) {
      await reqBtn.click();
      const d = page.getByRole('dialog');
      await expect(d).toBeVisible();
      expect
        .soft(
          (await d.getAttribute('aria-modal')) ??
            (await d.evaluate((e) => ((e as HTMLDialogElement).matches(':modal') ? 'true' : null))),
          'drawer: modal',
        )
        .toBe('true');
      let out = 0;
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        if (
          await page.evaluate(
            () =>
              document.activeElement !== document.body &&
              !document.activeElement?.closest('dialog[open]'),
          )
        )
          out++;
      }
      expect.soft(out, 'drawer: Tab stays inside').toBe(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(reqBtn, 'drawer: Escape returns focus to the opener').toBeFocused();
    } else expect.soft(false, 'the Requirements button is on Results').toBe(true);

    // Account menu and row ⋯ menus: Escape, outside click, one open at a time.
    await app(page);
    await page.goto('/?m=1#/vacancies');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const openCount = () => page.evaluate(() => document.querySelectorAll('details[open]').length);
    const acct = page.getByLabel('Account menu', { exact: true });
    await acct.click();
    expect(await openCount()).toBe(1);
    await page.keyboard.press('Escape');
    expect.soft(await openCount(), 'account menu closes on Escape').toBe(0);
    await acct.click();
    await page.locator('main h1').click();
    expect.soft(await openCount(), 'account menu closes on an outside click').toBe(0);
    const dots1 = page.getByLabel('Actions for Network Engineer', { exact: true });
    const dots2 = page.getByLabel('Actions for Network Engineer 2', { exact: true });
    await dots1.click();
    await dots2.click();
    expect.soft(await openCount(), 'only one row menu is open at a time').toBe(1);
    await page.keyboard.press('Escape');
    expect.soft(await openCount(), 'row menu closes on Escape').toBe(0);
    await dots1.click();
    await acct.click();
    expect.soft(await openCount(), 'opening the account menu closes the row menu').toBe(1);
    await page.locator('main h1').click();
    // The phone SenAI sheet closes on Escape (on T the panel is the sheet).
    if (meta.touch) {
      await openPool(page);
      const sheet = page.getByRole('complementary', { name: 'SenAI' });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('textbox').first().focus();
      await page.keyboard.press('Escape');
      await expect(sheet, 'the SenAI sheet closes on Escape').toBeHidden();
    }
    await ux.check('menus', STD);
  },
);

// ---------------------------------------------------------------- A11-07

uat(
  'A11-07',
  'Tabs and segmented controls use arrow keys',
  { on: ['D', 'E'], timeout: 60_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await resultsApi(page, { answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/#/vacancies/${DVID}/results`);
    const list = page.getByRole('tablist', { name: t('Vacancy views') });
    const tabs = list.getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    const n = await tabs.count();
    const sel = await tabs.evaluateAll((ts) =>
      ts.findIndex((x) => x.getAttribute('aria-selected') === 'true'),
    );
    await tabs.nth(sel).focus();
    const at = () => tabs.evaluateAll((ts) => ts.indexOf(document.activeElement as Element));
    await page.keyboard.press('ArrowRight');
    expect(await at()).toBe((sel + 1) % n);
    await page.keyboard.press('ArrowLeft');
    expect(await at()).toBe(sel);
    await page.keyboard.press('End');
    expect(await at()).toBe(n - 1);
    await page.keyboard.press('ArrowRight');
    expect(await at(), 'ArrowRight wraps to the first tab').toBe(0);
    await page.keyboard.press('Home');
    expect(await at()).toBe(0);
    // aria-controls points at a role=tabpanel; only the active tab is in the Tab order.
    const info = await tabs.evaluateAll((ts) =>
      ts.map((x) => ({
        sel: x.getAttribute('aria-selected'),
        tabindex: x.getAttribute('tabindex'),
        controls: x.getAttribute('aria-controls'),
        panel: x.getAttribute('aria-controls')
          ? (document.getElementById(x.getAttribute('aria-controls')!)?.getAttribute('role') ??
            'missing')
          : null,
      })),
    );
    const active = info.find((i) => i.sel === 'true');
    expect
      .soft(
        active?.panel,
        `the selected tab's aria-controls points at a role=tabpanel (${JSON.stringify(active)})`,
      )
      .toBe('tabpanel');
    expect
      .soft(
        info.filter((i) => i.sel !== 'true' && i.tabindex !== '-1').length,
        'only the active tab is in the Tab order',
      )
      .toBe(0);
    await ux.check('vacancy tabs', [...STD, 'AZ']);

    // CV and Analysis, Original and Text on #/cv at tablet width.
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockApi(page);
    await openReview(page, DID);
    for (const label of [t('CV'), t('Analysis')]) void label;
    const segs = page.getByRole('tablist');
    await expect(segs.first()).toBeVisible();
    for (let i = 0; i < (await segs.count()); i++) {
      const s = segs.nth(i);
      if (!(await s.isVisible())) continue;
      const items = s.getByRole('tab');
      const k = await items.count();
      const before = await items.evaluateAll((ts) =>
        ts.findIndex((x) => x.getAttribute('aria-selected') === 'true'),
      );
      await items.nth(before).focus();
      await page.keyboard.press('ArrowRight');
      const after = await items.evaluateAll((ts) =>
        ts.findIndex((x) => x.getAttribute('aria-selected') === 'true'),
      );
      expect
        .soft(after, `segmented control ${i + 1}: ArrowRight moves and selects`)
        .toBe((before + 1) % k);
      const tabbable = await items.evaluateAll(
        (ts) => ts.filter((x) => x.getAttribute('tabindex') !== '-1').length,
      );
      expect.soft(tabbable, `segmented control ${i + 1}: one tab stop`).toBe(1);
      await page.keyboard.press('Home');
    }
    await ux.check('cv segmented', [...STD, 'AZ']);
  },
);

// ---------------------------------------------------------------- A11-09

uat(
  'A11-09',
  'Touch targets ≥ 44 px on touch devices',
  { on: ['T', 'TL', 'A', 'I'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const small: string[] = [];
    const measure = async (where: string, scope = page.locator('body')) => {
      for (const s of await smallTargets(scope, 44)) small.push(`${where}: ${s}`);
    };
    await app(page);
    await page.goto('/#/vacancies');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await measure('#/vacancies');
    await ux.check('vacancies', ['TGT', 'OCC']);
    await page.goto('/?c=1#/candidates');
    await expect(page.getByText('Aysel Məmmədova').first()).toBeVisible();
    await measure('#/candidates');
    // The pool panel with an answer (remove-filter ×, Show all, New chat, Send).
    await page.goto('/?p=1#/vacancies');
    const ask = page.getByRole('search').getByRole('textbox');
    if (await ask.isVisible()) {
      await ask.fill('Who has BGP routing?');
      await ask.press('Enter');
    } else {
      // Phones: the bottom bar's SenAI item opens the sheet.
      await page.getByRole('navigation').last().getByRole('button').last().tap();
      const comp = page.getByRole('complementary', { name: 'SenAI' }).getByRole('textbox').last();
      await comp.fill('Who has BGP routing?');
      await comp.press('Enter');
    }
    const panel = page.getByRole('complementary', { name: 'SenAI' });
    await expect(panel.getByText('3 candidates match BGP routing')).toBeVisible();
    await measure('pool panel', panel);
    await ux.check('pool panel', ['TGT', 'OCC'], { overlay: 'aside' });
    // CV review: zoom − and +, CV toolbar.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockApi(page, {
      assistant: SENAI_H,
      extra: async (route, url) =>
        url.pathname.startsWith('/assistant/conversations')
          ? route.fulfill({ json: [] }).then(() => true)
          : /^\/screenings\/\w+\/assistant$/.test(url.pathname)
            ? route.fulfill({ json: { thread: null } }).then(() => true)
            : false,
    });
    await openReview(page, DID);
    await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' }).first()).toBeVisible();
    await measure('#/cv');
    // Results: evidence dots / stars and decision pills.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/#/vacancies/${DVID}/results`);
    await page.waitForTimeout(800);
    await measure('Results');
    await ux.check('results', ['TGT', 'OCC']);
    void meta;
    expect.soft([...new Set(small)], 'every touch target is ≥ 44 × 44 px').toEqual([]);
  },
);

// ---------------------------------------------------------------- A11-10

uat(
  'A11-10',
  'Forced colours (Windows high contrast)',
  { on: ['D', 'E'], langs: 'EN', timeout: 60_000 },
  async ({ page, ux }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await app(page);
    await page.goto('/#/vacancies');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await ux.check('vacancies forced colours', STD);
    // Focus rings stay visible: a box-shadow ring is dropped in forced colours, an outline is not.
    const invisible: string[] = [];
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const s = getComputedStyle(el);
        const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
        return {
          outline,
          what: `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 30)}"`,
        };
      });
      if (!r.outline) invisible.push(r.what);
    }
    expect
      .soft(
        [...new Set(invisible)],
        'in forced colours every focused element has an outline (box-shadow rings are removed)',
      )
      .toEqual([]);
    await page.goto('/?f=1#/candidates');
    await expect(page.getByText('Aysel Məmmədova').first()).toBeVisible();
    await ux.check('candidates forced colours', STD);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockApi(page);
    await openReview(page, DID);
    await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' }).first()).toBeVisible();
    await ux.check('cv forced colours', STD);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/#/vacancies/${DVID}/results`);
    await page.waitForTimeout(800);
    await ux.check('results forced colours', STD);
  },
);

// ---------------------------------------------------------------- A11-11

uat(
  'A11-11',
  '200% zoom and reflow at 320 px',
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const sideways: string[] = [];
    const screens = async (label: string) => {
      await app(page, { me: ADMIN_ME });
      for (const hash of [
        '#/vacancies',
        '#/vacancies/new',
        '#/candidates',
        '#/reports',
        '#/admin',
        '#/security',
      ]) {
        await page.goto(`/?z=${label}${hash}`);
        await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
        await page.waitForTimeout(250);
        if (await pageScrollsSideways(page)) sideways.push(`${label} ${hash}`);
      }
      await page.goto(`/?z=${label}p#/vacancies`);
      const ask = page.getByRole('search').getByRole('textbox');
      if (await ask.isVisible()) {
        await ask.fill('Compare the top two');
        await ask.press('Enter');
      } else {
        await page.getByRole('navigation').last().getByRole('button').last().click();
        const c = page.getByRole('complementary', { name: 'SenAI' }).getByRole('textbox').last();
        await c.fill('Compare the top two');
        await c.press('Enter');
      }
      const panel = page.getByRole('complementary', { name: 'SenAI' });
      await expect(panel.getByText('3 candidates match BGP routing')).toBeVisible();
      if (await pageScrollsSideways(page)) sideways.push(`${label} pool panel with a table`);
      // The composer and Send stay reachable.
      const send = panel.locator('form button[type=submit]').last();
      const sb = await send.boundingBox();
      const vp = page.viewportSize()!;
      expect
        .soft(
          !!sb && sb.x >= 0 && sb.x + sb.width <= vp.width + 1 && sb.y + sb.height <= vp.height + 1,
          `${label}: Send is on screen`,
        )
        .toBe(true);
      await ux.check(`${label} panel`, STD, { overlay: 'aside' });
      // Header items do not overlap.
      const overlap = await page.evaluate(() => {
        const items = [
          ...document.querySelectorAll<HTMLElement>(
            'header a, header [role=search], header details > summary',
          ),
        ]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0);
        for (let i = 0; i < items.length; i++)
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i]!;
            const b = items[j]!;
            if (
              a.left < b.right - 1 &&
              b.left < a.right - 1 &&
              a.top < b.bottom - 1 &&
              b.top < a.bottom - 1
            )
              return true;
          }
        return false;
      });
      expect.soft(overlap, `${label}: header items do not overlap`).toBe(false);
    };
    await page.setViewportSize({ width: 320, height: 640 });
    await screens('320px');
    if (meta.dev === 'D') {
      // 200% zoom on a 1440 × 900 screen is a 720 × 450 CSS-px viewport.
      await page.setViewportSize({ width: 720, height: 450 });
      await screens('200pct');
    }
    await page.setViewportSize({ width: 320, height: 640 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/#/vacancies/${DVID}/results`);
    await page.waitForTimeout(800);
    if (await pageScrollsSideways(page)) sideways.push('320px Results');
    const tabs = page.getByRole('tab');
    for (let i = 0; i < (await tabs.count()); i++) {
      if (!(await tabs.nth(i).isVisible())) continue;
      await tabs.nth(i).click();
      await page.waitForTimeout(300);
      if (await pageScrollsSideways(page)) sideways.push(`320px vacancy tab ${i + 1}`);
    }
    await ux.check('320 results', STD);
    expect.soft(sideways, 'no horizontal page scroll (tables scroll in their own box)').toEqual([]);
  },
);

// ---------------------------------------------------------------- A11-12

uat(
  'A11-12',
  'Names match visible labels, tooltips work by keyboard and touch, reduced motion',
  { on: ['D', 'T', 'A'], timeout: 90_000 },
  async ({ page, ux }) => {
    // 1) Accessible names contain the visible text (WCAG 2.5.3), measured on every labelled control.
    await app(page);
    const mismatch: string[] = [];
    const check = async (where: string) => {
      const bad = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            'button[aria-label], a[aria-label], [role=button][aria-label], summary[aria-label]',
          ),
        ]
          .filter((e) => {
            const vis = e.innerText.replace(/\s+/g, ' ').trim();
            const name = (e.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
            const r = e.getBoundingClientRect();
            return (
              r.width > 0 &&
              vis.length > 2 &&
              !/^[×✕+−\-⋯…]$/.test(vis) &&
              !name.toLowerCase().includes(vis.toLowerCase())
            );
          })
          .map(
            (e) =>
              `'${e.innerText.trim().slice(0, 25)}' named '${e.getAttribute('aria-label')!.slice(0, 50)}'`,
          ),
      );
      for (const b of bad) mismatch.push(`${where}: ${b}`);
    };
    await page.goto('/#/vacancies');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await check('#/vacancies');
    await page.goto('/?a=1#/candidates');
    await expect(page.getByText('Aysel Məmmədova').first()).toBeVisible();
    await check('#/candidates');
    // The disabled 'Download CVs' and 'Shortlist summary' give their reason on focus (not only a title).
    const disabled = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          'button[disabled][title], button[aria-disabled=true][title]',
        ),
      ].map((b) => ({
        text: b.innerText.trim(),
        title: b.title,
        described: !!b.getAttribute('aria-describedby'),
        focusable: !b.disabled,
      })),
    );
    for (const d of disabled)
      expect
        .soft(
          d.focusable || d.described,
          `'${d.text}': the disabled reason '${d.title}' is reachable on focus or tap (not only a hover title)`,
        )
        .toBe(true);
    await page.goto('/?a=2#/vacancies');
    await openPool(page);
    await check('pool panel');
    expect.soft(mismatch, 'each accessible name contains its visible text').toEqual([]);

    // 3) Reduced motion: document.getAnimations() is empty on every screen and both panels.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const moving: string[] = [];
    const anims = async (where: string) => {
      await page.waitForTimeout(500);
      const a = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((x) => x.playState === 'running')
          .map((x) => {
            const tg = (x.effect as KeyframeEffect | null)?.target as Element | null;
            return `${(x as CSSAnimation).animationName ?? (x as CSSTransition).transitionProperty ?? 'anim'} on ${tg?.tagName.toLowerCase() ?? '?'}`;
          }),
      );
      if (a.length) moving.push(`${where}: ${a.slice(0, 3).join('; ')}`);
    };
    for (const hash of ['#/vacancies', '#/vacancies/new', '#/candidates', '#/reports']) {
      await page.goto(`/?rm=1${hash}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await anims(hash);
    }
    await page.goto('/?rm=2#/vacancies');
    await openPool(page);
    await anims('pool panel');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockApi(page, {
      assistant: SENAI_H,
      extra: async (route, url) =>
        url.pathname.startsWith('/assistant/conversations')
          ? route.fulfill({ json: [] }).then(() => true)
          : /^\/screenings\/\w+\/assistant$/.test(url.pathname)
            ? route.fulfill({ json: { thread: null } }).then(() => true)
            : false,
    });
    await openReview(page, DID);
    await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' }).first()).toBeVisible();
    await anims('#/cv');
    await openPool(page);
    await anims('candidate panel');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/#/vacancies/${DVID}/results`);
    await anims('Results');
    await ux.check('reduced motion', [...STD, 'RM']);
    expect.soft(moving, 'no animation runs with reduced motion').toEqual([]);
    void hasRing;
  },
);
