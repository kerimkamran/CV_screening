import type { Page, Response } from '@playwright/test';
import { expect, uat } from '../ux/test';
import { api, BASE, freshAccount, login, openAs, signInUi } from './stack';

// I18-02: the language belongs to the person, not the browser. The server keeps it
// (PUT /me/preferences), the app reads it back from /me on sign-in, and a failed save is said out
// loud (SD-133).

const MENU = /^(Account menu|Hesab menyusu)$/;
const LANGUAGE = /^(Language|Dil)$/;
const SIGN_OUT = /^(Sign out|Çıxış)$/;
const lang = (page: Page) => page.locator('html').getAttribute('lang');

async function openMenu(page: Page) {
  const select = page.getByLabel(LANGUAGE);
  if (!(await select.isVisible())) await page.getByLabel(MENU).click();
  await expect(select).toBeVisible();
  return select;
}

/** Pick a language in the account menu; resolves with the save request the app sent, if any. */
async function pick(page: Page, next: 'en' | 'az') {
  const select = await openMenu(page);
  const saved = page
    .waitForResponse((r) => r.url().endsWith('/me/preferences') && r.request().method() === 'PUT', {
      timeout: 8_000,
    })
    .catch(() => null);
  await select.selectOption(next);
  return saved as Promise<Response | null>;
}

/** What the account has saved. A fresh sign-in each time: sign-out withdraws earlier tokens. */
const saved = async (a: Parameters<typeof login>[0]) =>
  (await api(await login(a)).get('/me')).body.language as string | null | undefined;

async function signOut(page: Page) {
  const out = page.getByRole('button', { name: SIGN_OUT });
  // The menu stays open after a language choice; a second click on its button would close it.
  if (!(await out.isVisible())) await page.getByLabel(MENU).click();
  await out.click();
  await expect(page.getByRole('button', { name: /^(Sign in|Daxil olun)$/ })).toBeVisible();
}

uat(
  'I18-02',
  'Language is saved per account and follows the person',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, browser, meta, ux }) => {
    ux.allow(/500|preferences|Failed to load resource/);
    // Throwaway accounts stand in for the recruiter (nothing saved) and recruiter2 (en saved).
    const r1 = await freshAccount('TA_PARTNER');
    const r2 = await freshAccount('TA_PARTNER');
    const t2 = await login(r2);
    expect((await api(t2).put('/me/preferences', { language: 'en' })).status).toBeLessThan(300);

    // 1) As the recruiter, choose Azerbaijani in the account menu (from English, or from the
    //    other language first so the choice is a real change in either run).
    await openAs(page, r1, '#/vacancies');
    await expect(page.getByLabel(MENU)).toBeVisible();
    if ((await lang(page)) === 'az') {
      const back = await pick(page, 'en');
      expect(back?.status()).toBeLessThan(300);
      await expect.poll(() => lang(page)).toBe('en');
    }
    const first = await pick(page, 'az');
    expect(first, 'the choice is sent to the account').not.toBeNull();
    expect(first!.status()).toBeLessThan(300);
    expect(first!.request().postDataJSON()).toEqual({ language: 'az' });
    await expect.poll(() => lang(page)).toBe('az');
    await expect(page.getByLabel(LANGUAGE)).toHaveValue('az');
    await ux.check('az chosen');
    expect(await saved(r1)).toBe('az');

    // 2) Sign out, then sign in in a new context (new browser profile: nothing stored) with the
    //    same device and browser language as this run: the app opens in AZ from /me.
    await signOut(page);
    const fresh = await browser.newContext({
      viewport: page.viewportSize() ?? undefined,
      locale: meta.lang === 'az' ? 'az-AZ' : 'en-GB',
      hasTouch: meta.dev === 'A',
      isMobile: meta.dev === 'A',
    });
    const other = await fresh.newPage();
    try {
      await other.goto(`${BASE}/#/`);
      expect(await other.evaluate(() => localStorage.getItem('cv-lang'))).toBeNull();
      await signInUi(other, r1);
      await expect(other.getByLabel(MENU)).toBeVisible();
      await expect.poll(() => lang(other)).toBe('az');
      expect(new URL(other.url()).hash).toMatch(/^#\/?/);
      await openMenu(other);
      await expect(other.getByLabel(LANGUAGE)).toHaveValue('az');

      // 3) Recruiter2 signs in on the same browser: their own saved language (EN), not the
      //    recruiter's and not the browser's.
      await signOut(other);
      await signInUi(other, r2);
      await expect(other.getByLabel(MENU)).toBeVisible();
      await expect.poll(() => lang(other)).toBe('en');
      await openMenu(other);
      await expect(other.getByLabel(LANGUAGE)).toHaveValue('en');
      // The first person's choice is still theirs.
      expect(await saved(r1)).toBe('az');
      expect(await saved(r2)).toBe('en');

      // 4) The save fails: the language still changes on screen, and a visible message says the
      //    account did not keep it. Once the account is reachable again the message goes away.
      await other.route('**/me/preferences', (route) =>
        route.request().method() === 'PUT'
          ? route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Internal server error' }),
            })
          : route.continue(),
      );
      const failed = await pick(other, 'az');
      expect(failed?.status()).toBe(500);
      await expect.poll(() => lang(other)).toBe('az');
      const alert = other.getByRole('alert').filter({ hasText: /^(Seçiminiz saxlanmadı)/ });
      await expect(alert).toBeVisible();
      await expect(alert).toContainText('Hələlik yalnız bu cihazda keçərlidir.');
      await ux.check('save failed');
      // Nothing was stored for recruiter2.
      expect(await saved(r2)).toBe('en');
      // No raw status or code reaches the person.
      await expect(alert).not.toContainText(/500|Internal|failed/i);

      await other.unroute('**/me/preferences');
      const ok = await pick(other, 'en');
      expect(ok?.status()).toBeLessThan(300);
      await expect.poll(() => lang(other)).toBe('en');
      await expect(
        other.getByRole('alert').filter({ hasText: /saxlanmadı|Could not save/ }),
      ).toHaveCount(0);
      expect(await saved(r2)).toBe('en');
    } finally {
      await fresh.close();
    }
  },
);
