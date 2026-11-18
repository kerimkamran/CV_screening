import type { Page } from '@playwright/test';
import { mockApi, ME } from '../fixtures/api';
import { ENDED, wordsB } from '../fixtures/pkg-b';
import { expect, uat } from '../ux/test';

// 7.x Security (SEC), screen layer (L1, mocked API).

const signInForm = async (
  page: Page,
  w: (s: string) => string,
  email = 'ayla@example.az',
  password = 'Invented-Pass-123',
) => {
  await page.getByLabel(w('Email')).fill(email);
  await page.getByLabel(w('Password'), { exact: true }).fill(password);
  await page.getByRole('button', { name: w('Sign in'), exact: true }).click();
};
const signInCard = (page: Page, w: (s: string) => string) =>
  page.getByRole('heading', { name: w('Sign in'), exact: true });
const nav = (page: Page, name: string) =>
  page.getByRole('link', { name, exact: true }).filter({ visible: true }).first();

uat(
  'SEC-03',
  "The session token lives only in this tab's sessionStorage and the Authorization header",
  { on: ['D', 'E', 'I'], langs: 'EN' },
  async ({ page, ux, meta, context }) => {
    const w = wordsB(meta);
    const seen = await mockApi(page, {
      signedIn: false,
      extra: async (route, url) => {
        const req = route.request();
        if (url.pathname === '/auth/login' && req.method() === 'POST') {
          await route.fulfill({ json: { token: 'tab-token-1' } });
          return true;
        }
        if (url.pathname === '/me') {
          const ok = req.headers()['authorization'] === 'Bearer tab-token-1';
          await route.fulfill(ok ? { json: ME } : { status: 401, json: { message: 'Sign in' } });
          return true;
        }
        return false;
      },
    });
    ux.allow(/401/);
    await page.goto('/#/');
    await signInForm(page, w);
    await expect(page.getByLabel(w('Account menu'), { exact: true })).toBeVisible();
    // 2) Storage, cookies, URL and every request.
    const store = await page.evaluate(() => ({
      session: sessionStorage.getItem('cv.session'),
      local: Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`),
      cookie: document.cookie,
      url: location.href,
    }));
    expect(store.session).toBe('tab-token-1');
    for (const l of store.local) expect(l).not.toContain('tab-token-1');
    expect(store.cookie).not.toContain('tab-token-1');
    expect((await context.cookies()).map((c) => c.value).join(' ')).not.toContain('tab-token-1');
    expect(store.url).not.toContain('tab-token-1');
    const after = seen.requests.filter((r) => !(r.url === '/auth/login'));
    expect(after.length).toBeGreaterThan(0);
    for (const r of seen.requests) {
      expect(r.url).not.toContain('tab-token-1');
      expect(JSON.stringify(r.body ?? '')).not.toContain('tab-token-1');
    }
    const loginAt = seen.requests.findIndex((r) => r.url === '/auth/login');
    for (const r of seen.requests
      .slice(loginAt + 1)
      .filter((x) => x.url !== '/readyz' || x.headers['authorization']))
      expect(r.headers['authorization'], r.url).toBe('Bearer tab-token-1');
    await ux.check('signed in', ['OCC', 'OVL', 'OVF']);

    // 3) A new page of the same context: no session there.
    const p2 = await context.newPage();
    const flush2 = ux.watch(p2);
    await mockApi(p2, { signedIn: false });
    await p2.goto('/#/vacancies');
    await expect(signInCard(p2, w)).toBeVisible();
    flush2();
    await p2.close();

    // 4) window.open with noopener.
    const popup = context.waitForEvent('page');
    await page.evaluate(() => window.open(location.href, '_blank', 'noopener'));
    const p3 = await popup;
    const flush3 = ux.watch(p3);
    await mockApi(p3, { signedIn: false });
    await p3.reload();
    await expect(signInCard(p3, w)).toBeVisible();
    expect(await p3.evaluate(() => sessionStorage.getItem('cv.session'))).toBeNull();
    flush3();
    await p3.close();

    // 5) Close the first page and open the URL again.
    const url = page.url();
    await page.close();
    const p4 = await context.newPage();
    const flush4 = ux.watch(p4);
    await mockApi(p4, { signedIn: false });
    await p4.goto(url);
    await expect(signInCard(p4, w)).toBeVisible();
    flush4();
  },
);

uat(
  'SEC-04',
  'Any 401 while signed in signs out with a note; 403 does not',
  { on: ['D', 'E', 'T', 'TL', 'A', 'I'], langs: 'EN+AZ' },
  async ({ page, ux, meta, browser }) => {
    const w = wordsB(meta);
    ux.allow(/401|403/);
    // Run 1: the first GET /candidates answers 401.
    let first = true;
    const seen = await mockApi(page, {
      extra: async (route, url) => {
        if (url.pathname === '/candidates' && first) {
          first = false;
          await route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
          return true;
        }
        if (url.pathname === '/auth/login') {
          await route.fulfill({ json: { token: 't2' } });
          return true;
        }
        return false;
      },
    });
    await page.goto('/#/vacancies');
    await expect(page.getByLabel(w('Account menu'), { exact: true })).toBeVisible();
    await nav(page, w('Candidates')).click();
    // 2) Sign in card with the note above it, no session.
    await expect(signInCard(page, w)).toBeVisible();
    const note = page.getByRole('status').filter({ hasText: w(ENDED) });
    await expect(note).toBeVisible();
    const noteBox = await note.boundingBox();
    const cardBox = await signInCard(page, w).boundingBox();
    expect(noteBox!.y).toBeLessThan(cardBox!.y);
    expect(await page.evaluate(() => sessionStorage.getItem('cv.session'))).toBeNull();
    await ux.check('session ended', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    // 3) Sign in again: the note goes.
    await signInForm(page, w);
    await expect(page.getByLabel(w('Account menu'), { exact: true })).toBeVisible();
    await expect(page.getByText(w(ENDED))).toHaveCount(0);
    expect(seen.posts.some((p) => p.url === '/auth/login')).toBe(true);

    // Run 2: 403 keeps the person signed in and shows an error.
    const ctx2 = await browser.newContext({
      ...pageOpts(page),
      locale: meta.lang === 'az' ? 'az-AZ' : 'en-US',
    });
    const p2 = await ctx2.newPage();
    const flush2 = ux.watch(p2);
    await p2.addInitScript((l) => localStorage.setItem('cv-lang', l), meta.lang);
    await mockApi(p2, {
      extra: async (route, url) => {
        if (url.pathname === '/candidates') {
          await route.fulfill({ status: 403, json: { message: 'Forbidden' } });
          return true;
        }
        return false;
      },
    });
    await p2.goto('/#/vacancies');
    await expect(p2.getByLabel(w('Account menu'), { exact: true })).toBeVisible();
    await nav(p2, w('Candidates')).click();
    await expect(p2.getByRole('alert').first()).toBeVisible();
    await expect(p2.getByLabel(w('Account menu'), { exact: true })).toBeVisible();
    await expect(p2.getByText(w(ENDED))).toHaveCount(0);
    expect(await p2.evaluate(() => sessionStorage.getItem('cv.session'))).toBe('e2e-token');
    flush2();
    await ctx2.close();

    // Run 3: a wrong password while signed out shows only the sign-in error.
    const ctx3 = await browser.newContext({ ...pageOpts(page) });
    const p3 = await ctx3.newPage();
    const flush3 = ux.watch(p3);
    await p3.addInitScript((l) => localStorage.setItem('cv-lang', l), meta.lang);
    await mockApi(p3, {
      signedIn: false,
      extra: async (route, url) => {
        if (url.pathname === '/auth/login') {
          await route.fulfill({ status: 401, json: { message: 'Invalid email or password' } });
          return true;
        }
        return false;
      },
    });
    await p3.goto('/#/');
    await signInForm(p3, w, 'ayla@example.az', 'Wrong-Pass-000');
    await expect(p3.getByRole('alert')).toContainText(w('Invalid email or password'));
    await expect(p3.getByText(w(ENDED))).toHaveCount(0);
    flush3();
    await ctx3.close();
  },
);

/** The base URL, viewport and touch settings of this project, for a second context. */
function pageOpts(page: Page) {
  const vp = page.viewportSize()!;
  return {
    baseURL: new URL(page.url()).origin,
    viewport: vp,
    hasTouch: vp.width < 1000,
    isMobile: vp.width < 500,
  };
}

uat(
  'SEC-05',
  'Token renewal every 20 minutes with no idle sign-out (S2-FE16)',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux, meta, browser }) => {
    const w = wordsB(meta);
    const MIN = 60_000;
    let n = 0;
    await page.clock.install();
    const seen = await mockApi(page, {
      extra: async (route, url) => {
        if (url.pathname === '/auth/refresh') {
          n++;
          await route.fulfill({ json: { token: `r${n}` } });
          return true;
        }
        return false;
      },
    });
    const refreshes = () => seen.requests.filter((r) => r.url === '/auth/refresh').length;
    await page.goto('/#/vacancies');
    await expect(page.getByLabel(w('Account menu'), { exact: true })).toBeVisible();
    // 1) 19 minutes: nothing yet.
    await page.clock.runFor(19 * MIN);
    expect(refreshes()).toBe(0);
    // 2) 20 minutes: exactly one.
    await page.clock.runFor(1 * MIN + 1000);
    await expect.poll(refreshes).toBe(1);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('cv.session'))).toBe('r1');
    // 3) 45 minutes without input: two refreshes, still signed in.
    await page.clock.runFor(24 * MIN);
    await expect.poll(refreshes).toBe(2);
    await expect(page.getByLabel(w('Account menu'), { exact: true })).toBeVisible();
    await ux.check('after 45 min', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    // 4) Hidden, the clock jumps 25 min without timers, visible again: one refresh.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const before = refreshes();
    const now = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(now + 25 * MIN);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(refreshes).toBe(before + 1);

    // 5) and 6) Variants: refresh answers 500, then 401.
    for (const status of [500, 401]) {
      const ctx = await browser.newContext({ ...pageOpts(page) });
      const p = await ctx.newPage();
      const flush = ux.watch(p);
      ux.allow(new RegExp(String(status)));
      await p.clock.install();
      await mockApi(p, {
        extra: async (route, url) => {
          if (url.pathname === '/auth/refresh') {
            await route.fulfill({
              status,
              json: { message: status === 401 ? 'Unauthorized' : 'Server error' },
            });
            return true;
          }
          return false;
        },
      });
      await p.goto('/#/vacancies');
      await expect(p.getByLabel(w('Account menu'), { exact: true })).toBeVisible();
      await p.clock.runFor(20 * MIN + 1000);
      if (status === 500) {
        await p.waitForTimeout(300);
        await expect(p.getByLabel(w('Account menu'), { exact: true })).toBeVisible();
        await expect(p.getByRole('alert')).toHaveCount(0);
        await expect(p.getByText(w(ENDED))).toHaveCount(0);
      } else {
        await expect(signInCard(p, w)).toBeVisible();
        await expect(p.getByText(w(ENDED))).toBeVisible();
      }
      flush();
      await ctx.close();
    }
  },
);
