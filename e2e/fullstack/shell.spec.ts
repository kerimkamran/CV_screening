import type { Page } from '@playwright/test';
import { freshAcc, openAsR, words } from '../fixtures/pkg-a';
import { expect, uat } from '../ux/test';
import { BASE, db } from './stack';

// 7.3 Account menu (AC), full-stack journey (L2).

const bgOf = (p: Page) => p.evaluate(() => document.documentElement.getAttribute('data-bg'));
const lum = (p: Page) =>
  p
    .locator('main')
    .first()
    .evaluate((m) => {
      let e: HTMLElement | null = m;
      let c = 'rgba(0, 0, 0, 0)';
      while (e && /rgba\(0, 0, 0, 0\)|transparent/.test(c)) {
        c = getComputedStyle(e).backgroundColor;
        e = e.parentElement;
      }
      const v = c.match(/\d+/g)!.map(Number);
      return (0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!) / 255;
    });

uat(
  'AC-04',
  'Language and background follow the account to another browser',
  { on: ['D'] },
  async ({ page, browser, ux, meta }) => {
    const acc = await freshAcc('TA_PARTNER'); // a throwaway recruiter: the test changes the account's choices
    // 1) Browser A: Azerbaijani and Dark from the account menu.
    await openAsR(page, acc, '#/vacancies');
    const tA = words(meta);
    await page.getByLabel(tA('Account menu'), { exact: true }).click();
    const menuA = page.locator('header details[open] > div');
    const sel = menuA.getByRole('combobox');
    if (meta.lang === 'az') await sel.selectOption('en'); // the change event needs another value first
    await sel.selectOption('az');
    const az = words({ lang: 'az' });
    await expect(
      page
        .getByRole('navigation', { name: az('Main') })
        .getByRole('link', { name: az('Vacancies') }),
    ).toBeVisible();
    await menuA.getByText(az('Background'), { exact: true }).click();
    await page
      .getByRole('group', { name: az('Page background') })
      .getByRole('radio', { name: az('Dark'), exact: true })
      .check();
    expect(await bgOf(page)).toBe('dark');
    await expect
      .poll(
        async () =>
          (
            await db(`SELECT language, background FROM user_preference WHERE user_id = $1`, [
              acc.userId,
            ])
          )[0] ?? null,
      )
      .toEqual({ language: 'az', background: 'dark' });
    await page
      .locator('header > div > details')
      .first()
      .evaluate((d) => d.removeAttribute('open'));
    await ux.check('browser A', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);

    // 2) Browser B: English, nothing stored; sign in with the form.
    const ctx = await browser.newContext({ baseURL: BASE, locale: 'en-GB', colorScheme: 'light' });
    const b = await ctx.newPage();
    const flush = ux.watch(b);
    await b.addInitScript(() => {
      const w = window as unknown as { __bgAtBody?: string | null };
      new MutationObserver((_, o) => {
        if (document.body) {
          w.__bgAtBody = document.documentElement.getAttribute('data-bg');
          o.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await b.goto(`${BASE}/#/`);
    await b.getByLabel('Email').fill(acc.email);
    await b.getByLabel('Password', { exact: true }).fill(acc.password);
    await b.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(b.getByRole('navigation', { name: az('Main') })).toBeVisible();
    await expect(b.getByRole('heading', { level: 1, name: az('Home') })).toBeVisible();
    expect(await bgOf(b)).toBe('dark');
    expect(await b.evaluate(() => document.documentElement.lang)).toBe('az');

    // 3) Match my device, then the colour scheme light and dark, without reload.
    await b.getByLabel(az('Account menu'), { exact: true }).click();
    await b
      .locator('header details[open] > div')
      .getByText(az('Background'), { exact: true })
      .click();
    await b
      .getByRole('group', { name: az('Page background') })
      .getByRole('radio', { name: az('Match my device'), exact: true })
      .check();
    expect(await bgOf(b)).toBe('auto');
    await b
      .locator('header > div > details')
      .first()
      .evaluate((d) => d.removeAttribute('open'));
    await b.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => lum(b), { message: 'light page with a light OS' }).toBeGreaterThan(0.8);
    await b.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(() => lum(b), { message: 'dark page with a dark OS, without reload' })
      .toBeLessThan(0.2);

    // 4) Reload: the choice stays, and theme-init.js set it before the app ran.
    await b.reload();
    await expect(b.getByRole('heading', { level: 1, name: az('Home') })).toBeVisible();
    expect(await b.evaluate(() => (window as unknown as { __bgAtBody?: string }).__bgAtBody)).toBe(
      'auto',
    );
    expect(await bgOf(b)).toBe('auto');
    await expect
      .poll(
        async () =>
          (
            await db(`SELECT language, background FROM user_preference WHERE user_id = $1`, [
              acc.userId,
            ])
          )[0] ?? null,
      )
      .toEqual({ language: 'az', background: 'auto' });
    flush();
    await ctx.close();
  },
);
