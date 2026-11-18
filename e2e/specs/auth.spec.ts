import type { Page, Route } from '@playwright/test';
import { ME, mockApi } from '../fixtures/api';
import { MFA_OFF, openWith, reloadAt, words } from '../fixtures/pkg-a';
import { expect, test, uat } from '../ux/test';

// 7.2 Sign-in and passwords (AU), screen layer (L1). UAT plan v1.1; each case is the row of the same ID.

const BRAND_FULL = 'parallax by Azerconnect Group';
const BACKGROUNDS = ['white', 'grey', 'cream', 'dark'];
const sessionToken = (page: Page) => page.evaluate(() => sessionStorage.getItem('cv.session'));
/** /me answers the person only for the given token (a real sign-in), 401 otherwise. */
const meFor = (tokens: Record<string, unknown>) => (route: Route) => {
  const auth = route.request().headers().authorization ?? '';
  const who = tokens[auth.replace(/^Bearer /, '')];
  return who
    ? route.fulfill({ json: who })
    : route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
};
/** A field whose label starts with this text (the label also holds the hint under the field). */
const startLabel = (page: Page, text: string) =>
  page.getByLabel(new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{Ll})`, 'u'));
const MENU_OVERLAY = 'header details[open] > div > div, header details[open] > div > p';
const posts = (
  seen: { requests: { method: string; url: string; body: unknown }[] },
  path: string,
) => seen.requests.filter((r) => r.method === 'POST' && r.url === path);

uat(
  'AU-01',
  'Sign-in page: controls, wording and layout',
  { on: ['D', 'E', 'T', 'TL', 'A', 'I', 'DS'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    await mockApi(page, { signedIn: false });
    await page.goto('/#/');
    // 2) Header, card and footer.
    const header = page.locator('header');
    const brand = header.getByRole('link').first();
    await expect(brand).toHaveAttribute('href', '#/');
    await expect(brand).toHaveAttribute('title', BRAND_FULL);
    const lang = header.getByRole('combobox', { name: t('Language') });
    await expect(lang).toBeVisible();
    expect(await lang.locator('option').allInnerTexts()).toEqual(['English', 'Azərbaycan dili']);
    await expect(page.getByRole('heading', { name: t('Sign in') })).toBeVisible();
    const email = page.getByLabel(t('Email'));
    const pw = page.getByLabel(t('Password'), { exact: true });
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'username');
    expect(await email.evaluate((e: HTMLInputElement) => e.required)).toBe(true);
    expect(await pw.evaluate((e: HTMLInputElement) => e.required)).toBe(true);
    await expect(pw).toHaveAttribute('autocomplete', 'current-password');
    const show = page.getByRole('button', { name: t('Show password') });
    await expect(show).toHaveAttribute('aria-pressed', 'false');
    await expect(show).toHaveText(t('Show'));
    const submit = page.getByRole('button', { name: t('Sign in'), exact: true });
    const form = page.locator('form');
    expect(
      Math.abs((await submit.boundingBox())!.width - (await form.boundingBox())!.width),
    ).toBeLessThanOrEqual(1);
    await expect(
      page.getByText(
        t('Accounts are created by your administrator, who sends you an invitation link.'),
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /forgot/i })).toHaveCount(0);
    // The toggle sits inside the field and the typed text stays clear of it.
    await pw.fill('a-long-password-typed-here-1234567890');
    const fb = (await pw.boundingBox())!;
    const sb = (await show.boundingBox())!;
    expect(
      sb.x >= fb.x - 0.5 &&
        sb.x + sb.width <= fb.x + fb.width + 0.5 &&
        sb.y >= fb.y - 0.5 &&
        sb.y + sb.height <= fb.y + fb.height + 0.5,
      `the Show toggle is inside the password field (field ${JSON.stringify(fb)}, toggle ${JSON.stringify(sb)})`,
    ).toBe(true);
    const padR = await pw.evaluate((e) => parseFloat(getComputedStyle(e).paddingRight));
    expect(padR, 'the field keeps room on its right for the toggle').toBeGreaterThanOrEqual(
      fb.x + fb.width - sb.x - 1,
    );
    // Endorsement line hidden below 640 px.
    const by = page.getByText('by Azerconnect Group');
    const width = page.viewportSize()!.width;
    for (const b of await by.all()) {
      if (width < 640) await expect(b).toBeHidden();
      else await expect(b).toBeVisible();
    }
    await ux.check('sign-in page', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    // 3) Show and Hide.
    await show.click();
    await expect(pw).toHaveAttribute('type', 'text');
    const hide = page.getByRole('button', { name: t('Hide password') });
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(hide).toHaveText(t('Hide'));
    await hide.click();
    await expect(pw).toHaveAttribute('type', 'password');
    // 4) Tab order.
    await reloadAt(page, '#/');
    await expect(page.getByRole('heading', { name: t('Sign in') })).toBeVisible();
    const order: string[] = [];
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const e = document.activeElement as HTMLElement;
          if (e.matches('a[href="#main"]')) return 'skip';
          if (e.matches('header a')) return 'brand';
          if (e.tagName === 'SELECT') return 'language';
          if (e.matches('input[type=email]')) return 'email';
          if (e.matches('input[autocomplete=current-password]')) return 'password';
          if (e.getAttribute('aria-pressed') !== null) return 'show';
          if (e.tagName === 'BUTTON') return 'sign in';
          return e.tagName;
        }),
      );
    }
    expect(order).toEqual(['skip', 'brand', 'language', 'email', 'password', 'show', 'sign in']);
    // 4 backgrounds (this browser's choice, read by theme-init.js before the first paint).
    for (const bg of BACKGROUNDS) {
      await page.evaluate((b) => localStorage.setItem('cv-background', b), bg);
      await reloadAt(page, '#/');
      await expect(page.getByRole('heading', { name: t('Sign in') })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-bg'))).toBe(bg);
      await ux.check(`background ${bg}`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    }
    // 5) The language select changes the page at once.
    const other = meta.lang === 'az' ? 'en' : 'az';
    for (const l of [other, meta.lang] as const) {
      const w = words({ lang: l });
      await page.locator('header select').selectOption(l);
      await expect(page.getByRole('heading', { name: w('Sign in') })).toBeVisible();
      await expect(page.getByLabel(w('Email'))).toBeVisible();
      await expect(page.getByLabel(w('Password'), { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => [localStorage.getItem('cv-lang'), document.documentElement.lang]),
      ).toEqual([l, l]);
    }
    if (meta.lang === 'az') {
      await expect(page.getByRole('heading', { name: 'Daxil olun' })).toBeVisible();
      await expect(page.getByLabel('E-poçt')).toBeVisible();
      await expect(page.getByLabel('Parol', { exact: true })).toBeVisible();
    }
    // RM: with reduced motion nothing moves on the sign-in page.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await reloadAt(page, '#/');
    await expect(page.getByRole('heading', { name: t('Sign in') })).toBeVisible();
    await ux.check('reduced motion', ['RM']);
  },
);

uat(
  'AU-02',
  'Sign in with the right password stores the token for this tab and opens the home page',
  { on: 'All', langs: 'EN' },
  async ({ page, ux }) => {
    const seen = await mockApi(page, {
      signedIn: false,
      extra: async (route, url) => {
        if (url.pathname === '/me') return void (await meFor({ t1: ME })(route)) ?? true;
        if (url.pathname === '/auth/login') {
          await new Promise((r) => setTimeout(r, 1000));
          await route.fulfill({
            json: { token: 't1', expiresIn: 3600, mustChangePassword: false },
          });
          return true;
        }
        return false;
      },
    });
    await page.goto('/#/');
    await page.getByLabel('Email').fill('ayla@example.az');
    const pw = page.getByLabel('Password', { exact: true });
    await pw.fill('Correct-horse-battery-1');
    await pw.press('Enter');
    const busy = page.getByRole('button', { name: 'Signing in…' });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();
    await pw.press('Enter');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    const logins = posts(seen, '/auth/login');
    expect(logins, 'Enter while signing in sends no second request').toHaveLength(1);
    expect(logins[0]!.body).toEqual({
      email: 'ayla@example.az',
      password: 'Correct-horse-battery-1',
    });
    expect(await sessionToken(page)).toBe('t1');
    const local = await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (k) => localStorage.getItem(k)?.includes('t1') && localStorage.getItem(k)!.length < 8,
      ),
    );
    expect(local, 'no localStorage key holds the token').toEqual([]);
    const me = seen.requests.filter((r) => r.url === '/me');
    expect(me.at(-1)!.headers.authorization).toBe('Bearer t1');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
    await expect(page.getByText('Your session ended. Please sign in again.')).toHaveCount(0);
    await ux.check('signed in');
  },
);

uat(
  'AU-03',
  'Sign-in errors: empty fields, wrong password, throttled, wrong code',
  { on: ['D', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const answersInOrder = [
      { status: 401, json: { message: 'Invalid email or password', statusCode: 401 } },
      {
        status: 429,
        json: { message: 'Too many attempts. Try again in a minute.', statusCode: 429 },
      },
      { status: 401, json: { message: 'Invalid email, password or code', statusCode: 401 } },
    ];
    let n = 0;
    const seen = await mockApi(page, {
      signedIn: false,
      extra: async (route, url) => {
        if (url.pathname !== '/auth/login') return false;
        await route.fulfill(answersInOrder[n++ % 3]!);
        return true;
      },
    });
    ux.allow(/401|429/);
    await page.goto('/#/');
    // 1) Empty fields: no request, Email marked required.
    await page.getByRole('button', { name: t('Sign in'), exact: true }).click();
    await page.waitForTimeout(300);
    expect(posts(seen, '/auth/login')).toHaveLength(0);
    expect(
      await page.getByLabel(t('Email')).evaluate((e: HTMLInputElement) => e.validity.valueMissing),
    ).toBe(true);
    // 2) to 4)
    await page.getByLabel(t('Email')).fill('ayla@example.az');
    await page.getByLabel(t('Password'), { exact: true }).fill('Wrong-password-123');
    const alert = page.getByRole('alert');
    const want = [
      'Invalid email or password',
      'Too many attempts. Try again in a minute.',
      'Invalid email, password or code',
    ];
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: t('Sign in'), exact: true }).click();
      await expect.poll(() => posts(seen, '/auth/login').length).toBe(i + 1);
      await expect(alert).toBeVisible();
      const text = (await alert.innerText()).trim();
      if (meta.lang === 'en') expect(text).toBe(want[i]);
      else {
        if (i === 0) expect(text).toBe('E-poçt və ya parol yanlışdır');
        expect
          .soft(text, `AZ: the message for "${want[i]}" is Azerbaijani, not English`)
          .not.toBe(want[i]);
      }
      await expect(page.getByLabel(t('Email'))).toHaveValue('ayla@example.az');
      expect(text).not.toMatch(/exist|locked|disabled|mövcud|kilid|deaktiv/i);
      await expect(page.getByText(t('Your session ended. Please sign in again.'))).toHaveCount(0);
      await ux.check(`error ${i + 1}`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    }
  },
);

uat(
  'AU-05',
  'Two-step sign-in: the code step on the sign-in card',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const seen = await mockApi(page, {
      signedIn: false,
      extra: async (route, url) => {
        if (url.pathname === '/me') return void (await meFor({ t5: ME })(route)) ?? true;
        if (url.pathname !== '/auth/login') return false;
        const b = route.request().postDataJSON() as { code?: string };
        if (b.code === '123456')
          await route.fulfill({
            json: { token: 't5', expiresIn: 3600, mustChangePassword: false },
          });
        else
          await route.fulfill({
            status: 401,
            json: {
              message: 'Enter the 6-digit code from your authenticator app',
              code: 'mfa_required',
              statusCode: 401,
            },
          });
        return true;
      },
    });
    ux.allow(/401/);
    await page.goto('/#/');
    await page.getByLabel(t('Email')).fill('ayla@example.az');
    await page.getByLabel(t('Password'), { exact: true }).fill('Correct-horse-battery-1');
    await page.getByRole('button', { name: t('Sign in'), exact: true }).click();
    const code = page.getByLabel(t('Code from your authenticator app'));
    await expect(code).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
      page.getByText(t('Six digits. Lost your phone? Use one of your recovery codes instead.')),
    ).toBeVisible();
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    if (meta.lang === 'az')
      await expect(page.getByText('Autentifikator tətbiqindən kod')).toBeVisible();
    await ux.check('code step', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    await code.fill('123456');
    await page.getByRole('button', { name: t('Sign in'), exact: true }).click();
    await expect(page.getByLabel(t('Account menu'), { exact: true })).toBeVisible();
    expect(posts(seen, '/auth/login').map((p) => p.body)).toEqual([
      { email: 'ayla@example.az', password: 'Correct-horse-battery-1' },
      { email: 'ayla@example.az', password: 'Correct-horse-battery-1', code: '123456' },
    ]);
    await ux.check('signed in', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
  },
);

uat(
  'AU-07',
  'Invitation link page: checking, valid, mismatch, rule error, used, disabled, malformed',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    ux.allow(/400/);
    const TOKEN = 'A'.repeat(20) + 'b'.repeat(23); // 43 characters
    let mode: 'valid' | 'used' | 'disabled' = 'valid';
    let setups = 0;
    const table = {
      '/me': meFor({ t2: ME }),
      'POST /auth/setup-link/check': async (route: Route) => {
        if (mode === 'valid') {
          await new Promise((r) => setTimeout(r, 1000));
          await route.fulfill({
            json: { email: 'new.user@example.az', displayName: 'Leyla Həsənova' },
          });
        } else
          await route.fulfill({
            status: 400,
            json: {
              message:
                mode === 'used'
                  ? 'This link has already been used or was replaced by a newer one. Ask your administrator for a new one.'
                  : 'This account is disabled. Ask your administrator.',
              statusCode: 400,
            },
          });
      },
      'POST /auth/setup-password': (route: Route) =>
        setups++ === 0
          ? route.fulfill({
              status: 400,
              json: { message: 'New password must not contain your email name', statusCode: 400 },
            })
          : route.fulfill({ json: { token: 't2', expiresIn: 3600, mustChangePassword: false } }),
    };
    const seen = await openWith(page, `#/set-password?token=${TOKEN}`, { signedIn: false, table });
    // 1) Checking, then the card.
    await expect(page.getByText(t('Checking your link…'))).toBeVisible();
    await expect(page.getByRole('heading', { name: t('Choose your password') })).toBeVisible();
    await expect(
      page.getByText(
        t('Welcome, {name}. Choose a password for your account:', { name: 'Leyla Həsənova' }),
      ),
    ).toBeVisible();
    await expect(page.locator('strong', { hasText: 'new.user@example.az' })).toBeVisible();
    const hidden = page.locator('input[type=hidden][autocomplete=username]');
    await expect(hidden).toHaveValue('new.user@example.az');
    const np = startLabel(page, t('New password'));
    await expect(np).toHaveAttribute('minlength', '12');
    await expect(
      page.getByText(t('At least 12 characters. A short sentence works well.')),
    ).toBeVisible();
    const again = page.getByLabel(t('Repeat new password'));
    await expect(again).toBeVisible();
    await ux.check('valid link', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    const save = page.getByRole('button', { name: t('Save password and sign in') });
    // 2) Mismatch.
    await np.fill('A long sentence one');
    await again.fill('A long sentence two');
    await save.click();
    await expect(page.getByRole('alert')).toHaveText(t('The passwords do not match'));
    expect(posts(seen, '/auth/setup-password')).toHaveLength(0);
    // 3) The server's rule message.
    await np.fill('new.user is my new.user password');
    await again.fill('new.user is my new.user password');
    await save.click();
    await expect(page.getByRole('alert')).toBeVisible();
    const ruleText = (await page.getByRole('alert').innerText()).trim();
    if (meta.lang === 'en') expect(ruleText).toBe('New password must not contain your email name');
    else
      expect
        .soft(ruleText, 'AZ: the server rule message is Azerbaijani')
        .not.toBe('New password must not contain your email name');
    await ux.check('rule error', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    // 4) A valid password: signed in, #/, GET /me.
    const meBefore = seen.requests.filter((r) => r.url === '/me').length;
    await np.fill('A quiet river at dawn 42');
    await again.fill('A quiet river at dawn 42');
    await save.click();
    await expect(page).toHaveURL(/#\/$/);
    expect(await sessionToken(page)).toBe('t2');
    await expect
      .poll(() => seen.requests.filter((r) => r.url === '/me').length)
      .toBeGreaterThan(meBefore);
    // 5) Used link, then a disabled account.
    for (const m of ['used', 'disabled'] as const) {
      mode = m;
      await page.evaluate(() => sessionStorage.removeItem('cv.session'));
      await reloadAt(page, `#/set-password?token=${TOKEN}`);
      const msg =
        m === 'used'
          ? 'This link has already been used or was replaced by a newer one. Ask your administrator for a new one.'
          : 'This account is disabled. Ask your administrator.';
      await expect(page.getByRole('alert')).toBeVisible();
      const text = (await page.getByRole('alert').innerText()).trim();
      if (meta.lang === 'en') expect(text).toBe(msg);
      else expect.soft(text, `AZ: "${msg}" is shown in Azerbaijani`).not.toBe(msg);
      await expect(page.getByRole('link', { name: t('Go to sign in') })).toHaveAttribute(
        'href',
        '#/',
      );
      await ux.check(`${m} link`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    }
    // 6) A malformed token: no check, the Sign in card.
    const checks = posts(seen, '/auth/setup-link/check').length;
    await reloadAt(page, '#/set-password?token=abc');
    await expect(page.getByRole('button', { name: t('Sign in'), exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    expect(posts(seen, '/auth/setup-link/check')).toHaveLength(checks);
  },
);

/** /me for the forced change: the temporary password until the change goes through. */
function mustChange() {
  let changed = false;
  const table = {
    '/me': (route: Route) =>
      route.fulfill({ json: changed ? ME : { ...ME, mustChangePassword: true } }),
    'POST /auth/change-password': (route: Route) => {
      changed = true;
      return route.fulfill({ json: { token: 't3', expiresIn: 3600, mustChangePassword: false } });
    },
    'GET /auth/mfa': MFA_OFF,
  };
  return table;
}

uat(
  'AU-09',
  'Temporary password: the forced change page on every route',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const seen = await openWith(page, '#/', {
      table: mustChange(),
      assistant: { enabled: true, name: 'SenAI', features: {}, unavailableMessage: '' },
    });
    for (const r of ['#/', '#/vacancies', '#/admin', '#/security']) {
      await page.goto(`/?r=1${r}`);
      await expect(
        page.getByRole('heading', { name: t('Choose your own password') }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: t('Your temporary password must be replaced before you continue.') }),
      ).toBeVisible();
      await expect(page.getByLabel(t('Temporary password (from your email)'))).toBeVisible();
      await expect(startLabel(page, t('New password'))).toHaveAttribute('minlength', '12');
      await expect(page.getByLabel(t('Repeat new password'))).toBeVisible();
      await expect(page.getByRole('button', { name: t('Save password') })).toBeVisible();
      await expect(page.locator(`nav[aria-label="${t('Main')}"]`)).toHaveCount(0);
      await expect(page.getByLabel(t('Account menu'), { exact: true })).toHaveCount(0);
      await expect(page.getByRole('search')).toHaveCount(0);
      expect(await page.locator('main').getByRole('heading').count(), `${r}: only the card`).toBe(
        1,
      );
    }
    if (meta.lang === 'az')
      await expect(page.getByRole('heading', { name: 'Özünüz üçün parol seçin' })).toBeVisible();
    await ux.check('forced change', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    // 2) Mismatch: no POST.
    await page.getByLabel(t('Temporary password (from your email)')).fill('Temp-Pass-0001');
    await startLabel(page, t('New password')).fill('A quiet river at dawn 1');
    await page.getByLabel(t('Repeat new password')).fill('A quiet river at dawn 2');
    await page.getByRole('button', { name: t('Save password') }).click();
    await expect(page.getByRole('alert')).toHaveText(t('The new passwords do not match'));
    expect(posts(seen, '/auth/change-password')).toHaveLength(0);
    // 3) The change goes through.
    await page.getByLabel(t('Repeat new password')).fill('A quiet river at dawn 1');
    await page.getByRole('button', { name: t('Save password') }).click();
    await expect(page.getByLabel(t('Account menu'), { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: t('Main') })).toBeVisible();
    expect(posts(seen, '/auth/change-password').map((p) => p.body)).toEqual([
      { currentPassword: 'Temp-Pass-0001', newPassword: 'A quiet river at dawn 1' },
    ]);
    expect(await sessionToken(page)).toBe('t3');
    await ux.check('recruiter frame', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
  },
);

uat(
  'AU-10',
  'Forced change and invitation pages offer Sign out and a language switch',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const TOKEN = 'C'.repeat(43);
    const check = async (where: string) => {
      const signOut = page
        .getByRole('button', { name: t('Sign out') })
        .or(page.getByRole('link', { name: t('Sign out') }));
      const lang = page.getByRole('combobox', { name: t('Language') });
      await expect
        .soft(signOut.first(), `${where}: a 'Sign out' control`)
        .toBeVisible({ timeout: 2000 });
      await expect
        .soft(lang.first(), `${where}: the 'Language' select`)
        .toBeVisible({ timeout: 2000 });
      await ux.check(where, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
      if (await lang.count()) {
        const other = meta.lang === 'az' ? 'en' : 'az';
        await lang.first().selectOption(other);
        const w = words({ lang: other });
        await expect(
          page.getByRole('heading', {
            name: w(
              where === 'forced change' ? 'Choose your own password' : 'Choose your password',
            ),
          }),
        ).toBeVisible();
        await page.getByRole('combobox').first().selectOption(meta.lang);
      }
      if (await signOut.count()) {
        await signOut.first().click();
        expect(await sessionToken(page)).toBeNull();
        await expect(page.getByRole('button', { name: t('Sign in'), exact: true })).toBeVisible();
      }
    };
    // 1) to 4) The forced change page.
    await openWith(page, '#/', { table: mustChange() });
    await expect(page.getByRole('heading', { name: t('Choose your own password') })).toBeVisible();
    await check('forced change');
    // 5) A signed-in recruiter opens a valid invitation link.
    await openWith(page, `#/set-password?token=${TOKEN}`, {
      table: {
        'POST /auth/setup-link/check': {
          email: 'new.user@example.az',
          displayName: 'Leyla Həsənova',
        },
      },
    });
    await expect(page.getByRole('heading', { name: t('Choose your password') })).toBeVisible();
    await expect(
      page.getByText(
        t('Welcome, {name}. Choose a password for your account:', { name: 'Leyla Həsənova' }),
      ),
    ).toBeVisible();
    await check('invitation');
  },
);

uat(
  'AU-12',
  'Change password page: fields, mismatch, busy and return home',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    const seen = await openWith(page, '#/vacancies', {
      table: {
        'GET /auth/mfa': MFA_OFF,
        'POST /auth/change-password': {
          $status: 200,
          $body: { token: 't4', expiresIn: 3600, mustChangePassword: false },
          $delay: 1000,
        },
      },
    });
    await page.getByLabel(t('Account menu'), { exact: true }).click();
    await page
      .locator('header details[open] > div')
      .getByRole('link', { name: t('Change password'), exact: true })
      .click();
    await expect(page).toHaveURL(/#\/password$/);
    await expect(page.getByRole('heading', { name: t('Change password') })).toBeVisible();
    await expect(page.getByLabel(t('Account menu'), { exact: true })).toBeVisible(); // inside the Shell
    const cur = page.getByLabel(t('Current password'));
    const np = startLabel(page, t('New password'));
    const again = page.getByLabel(t('Repeat new password'));
    await expect(np).toHaveAttribute('minlength', '12');
    await expect(
      page.getByText(t('At least 12 characters. A short sentence works well.')),
    ).toBeVisible();
    if (meta.lang === 'az') {
      await expect(page.getByRole('heading', { name: 'Parolu dəyişin' })).toBeVisible();
      await expect(page.getByLabel('Cari parol')).toBeVisible();
    }
    await ux.check('change password', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    // 2) Mismatch.
    await cur.fill('Old-password-1234');
    await np.fill('A quiet river at dawn 1');
    await again.fill('A quiet river at dawn 2');
    const save = page.getByRole('button', { name: t('Save password') });
    await save.click();
    await expect(page.getByRole('alert')).toHaveText(t('The new passwords do not match'));
    expect(posts(seen, '/auth/change-password')).toHaveLength(0);
    // 3) Busy until the answer.
    await again.fill('A quiet river at dawn 1');
    const meBefore = seen.requests.filter((r) => r.url === '/me').length;
    await save.click();
    await expect(save).toBeDisabled();
    await expect(page).toHaveURL(/#\/$/);
    expect(await sessionToken(page)).toBe('t4');
    await expect
      .poll(() => seen.requests.filter((r) => r.url === '/me').length)
      .toBeGreaterThan(meBefore);
    await ux.check('back home', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
  },
);

uat(
  'AU-14',
  'Security page: every state of two-step sign-in',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = words(meta);
    ux.allow(/500|400/);
    const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const CODES = Array.from({ length: 8 }, (_, i) => `abcd${i}-efgh${i}`);
    let state: 'a' | 'b' | 'c' | 'd' = 'a';
    let enables = 0;
    const table = {
      'GET /auth/mfa': async (route: Route) => {
        if (state === 'a') {
          await new Promise((r) => setTimeout(r, 1000));
          return route.fulfill({ json: MFA_OFF });
        }
        if (state === 'b') return route.fulfill({ json: { available: false } });
        if (state === 'c')
          return route.fulfill({ json: { enabled: true, available: true, recoveryCodesLeft: 5 } });
        return route.fulfill({ status: 500, json: { message: 'Something went wrong' } });
      },
      'POST /auth/mfa/setup': {
        secret: SECRET,
        uri: `otpauth://totp/parallax:ayla?secret=${SECRET}`,
      },
      'POST /auth/mfa/enable': (route: Route) =>
        enables++ === 0
          ? route.fulfill({
              status: 400,
              json: {
                message: 'That code is not right. Check the time on your phone and try again.',
              },
            })
          : route.fulfill({ json: { enabled: true, recoveryCodes: CODES } }),
      'POST /auth/mfa/disable': {},
    };
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: t('Two-step sign-in') }) });
    // (a) off, after 1 s; then the setup.
    const seen = await openWith(page, '#/security', { me: { background: 'white' }, table });
    await expect(card.getByText(t('Loading…'))).toBeVisible();
    await expect(
      card.getByText(
        t(
          'After your password, you enter a six-digit code from an authenticator app on your phone. It protects your account if your password is stolen.',
        ),
      ),
    ).toBeVisible();
    await card.getByRole('button', { name: t('Set up two-step sign-in') }).click();
    const secret = page.getByTestId('mfa-secret');
    await expect(secret).toHaveText(SECRET);
    expect(
      await secret.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      'the secret fits its box',
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    await expect(page.getByRole('link', { name: t('Open in authenticator app') })).toHaveAttribute(
      'href',
      /^otpauth:\/\//,
    );
    const code = page.getByLabel(t('Code shown in the app'));
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await ux.check('setup, white', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    await code.fill('000000');
    await page.getByRole('button', { name: t('Turn on') }).click();
    await expect(card.getByRole('alert')).toBeVisible();
    if (meta.lang === 'en')
      await expect(card.getByRole('alert')).toHaveText(
        'That code is not right. Check the time on your phone and try again.',
      );
    await expect(secret).toBeVisible();
    await code.fill('123456');
    await page.getByRole('button', { name: t('Turn on') }).click();
    await expect(card.getByText(t('Two-step sign-in is on.'), { exact: true })).toBeVisible();
    const list = page.getByRole('list', { name: t('Recovery codes') });
    await expect(list.getByRole('listitem')).toHaveCount(8);
    const tops = await list
      .getByRole('listitem')
      .evaluateAll((li) => li.map((l) => Math.round(l.getBoundingClientRect().top)));
    expect(new Set(tops).size, 'the codes are in two columns').toBe(4);
    await ux.check('codes', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    await page.getByRole('button', { name: t('I have saved them') }).click();
    await expect(list).toHaveCount(0);
    // (b) managed elsewhere.
    state = 'b';
    await openWith(page, '#/security', { me: { background: 'grey' }, table });
    await expect(
      card.getByText(
        t('Your organisation signs you in elsewhere, so two-step sign-in is managed there.'),
      ),
    ).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
    await ux.check('managed elsewhere, grey', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    // (c) on, 5 codes left; turn off.
    state = 'c';
    const seenC = await openWith(page, '#/security', { me: { background: 'cream' }, table });
    await expect(
      card.getByText(t('Two-step sign-in is on. Recovery codes left: {n}', { n: 5 })),
    ).toBeVisible();
    await ux.check('on, cream', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    await card.getByRole('button', { name: t('Turn off'), exact: true }).click();
    await page.getByLabel(t('Your password')).fill('Correct-horse-battery-1');
    const gets = seenC.requests.filter((r) => r.url === '/auth/mfa').length;
    await page.getByRole('button', { name: t('Turn off two-step sign-in') }).click();
    await expect
      .poll(() => seenC.requests.filter((r) => r.url === '/auth/mfa/disable').map((r) => r.body))
      .toEqual([{ password: 'Correct-horse-battery-1' }]);
    await expect
      .poll(() => seenC.requests.filter((r) => r.url === '/auth/mfa').length)
      .toBeGreaterThan(gets);
    // (d) the status cannot be read.
    state = 'd';
    await openWith(page, '#/security', { me: { background: 'dark' }, table });
    await expect(card.getByRole('alert')).toBeVisible();
    await ux.check('error, dark', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
  },
);

test.describe('AU-16 language before sign-in', () => {
  test.use({ presetLang: false });
  uat(
    'AU-16',
    'Language chosen before sign-in: html lang at start and the saved choice after sign-in',
    { on: ['D', 'I'] },
    async ({ page, browser, ux, info }) => {
      // Run 1: a browser in Azerbaijani with nothing stored.
      const base = (info.project.use.baseURL as string | undefined) ?? 'http://127.0.0.1:4310';
      const ctx = await browser.newContext({ locale: 'az-AZ', baseURL: base });
      const p1 = await ctx.newPage();
      const flush = ux.watch(p1);
      await mockApi(p1, { signedIn: false });
      // html lang whenever Azerbaijani text is on the page.
      const watchLang = (p: Page) =>
        p.addInitScript(() => {
          const w = window as unknown as { __langWhileAz: string[] };
          w.__langWhileAz = [];
          new MutationObserver(() => {
            if (document.body?.innerText.includes('Daxil olun'))
              w.__langWhileAz.push(document.documentElement.lang);
          }).observe(document, { childList: true, subtree: true, characterData: true });
        });
      await watchLang(p1);
      await p1.goto('/#/');
      await expect(p1.getByRole('heading', { name: 'Daxil olun' })).toBeVisible();
      expect
        .soft(await p1.evaluate(() => document.documentElement.lang), 'run 1: html lang is az')
        .toBe('az');
      expect
        .soft(
          await p1.evaluate(() => [
            ...new Set((window as unknown as { __langWhileAz: string[] }).__langWhileAz),
          ]),
          'run 1: never lang=en while Azerbaijani shows',
        )
        .toEqual(['az']);
      flush();
      await ctx.close();
      // Run 2: cv-lang=az stored, then reload.
      await watchLang(page);
      let phase = 2;
      await mockApi(page, {
        signedIn: false,
        extra: async (route, url) => {
          if (url.pathname === '/me')
            return void (await meFor({ t16: { ...ME, language: 'en' } })(route)) ?? true;
          if (url.pathname === '/auth/login')
            return (
              void (await route.fulfill({
                json: { token: 't16', expiresIn: 3600, mustChangePassword: false },
              })) ?? true
            );
          return false;
        },
      });
      await page.goto('/#/');
      await page.evaluate(() => localStorage.setItem('cv-lang', 'az'));
      await reloadAt(page, '#/');
      await expect(page.getByRole('heading', { name: 'Daxil olun' })).toBeVisible();
      expect
        .soft(await page.evaluate(() => document.documentElement.lang), 'run 2: html lang is az')
        .toBe('az');
      expect
        .soft(
          await page.evaluate(() => [
            ...new Set((window as unknown as { __langWhileAz: string[] }).__langWhileAz),
          ]),
          'run 2: never lang=en while Azerbaijani shows',
        )
        .toEqual(['az']);
      await ux.check('az from storage', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
      // Run 3: local 'az', the account says 'en'.
      phase = 3;
      await page.getByLabel('E-poçt').fill('ayla@example.az');
      await page.getByLabel('Parol', { exact: true }).fill('Correct-horse-battery-1');
      await page.getByRole('button', { name: 'Daxil olun', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
      expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
      await page.getByLabel('Account menu', { exact: true }).click();
      await expect(page.locator('header details[open] select')).toHaveValue('en');
      await expect(page.locator('header details[open] select option:checked')).toHaveText(
        'English',
      );
      await ux.check('en from the account', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE'], {
        overlay: MENU_OVERLAY,
      });
      void phase;
    },
  );
});
