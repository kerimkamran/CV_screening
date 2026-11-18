import type { Page } from '@playwright/test';
import { freshAcc, loginR, openAsR, sleep, stepNow, totp, wrongCode } from '../fixtures/pkg-a';
import { expect, uat } from '../ux/test';
import { accounts, api, BASE, db, freshAccount, login, signInUi, tempPasswordFor } from './stack';

// 7.2 Sign-in and passwords (AU), full-stack journeys (L2).

uat(
  'AU-04',
  'Real sign-in: email case, unknown email, disabled account',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const acc = accounts();
    const gone = await freshAccount('TA_PARTNER'); // stands in for recruiter2, disabled for this test
    const admin = api(await login(acc.admin));
    expect(
      (await admin.post(`/admin/users/${gone.userId}/status`, { status: 'disabled' })).status,
    ).toBeLessThan(300);
    const before = await db(`SELECT failed_attempts FROM local_credential WHERE user_id = $1`, [
      gone.userId,
    ]);

    // 1) The recruiter with the email in upper case.
    await signInUi(page, {
      email: acc.recruiter.email.toUpperCase(),
      password: acc.recruiter.password,
    });
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page).toHaveURL(/#\/$|#\/vacancies$/);
    const logins = await db(
      `SELECT action FROM audit_event WHERE action = 'auth.login' AND actor_id = $1`,
      [acc.recruiter.userId],
    );
    expect(logins.length).toBeGreaterThan(0);
    await ux.check('signed in', ['OCC', 'OVL', 'OVF']);

    // 2) and 3) Unknown address and disabled account: the same 401 and the same words.
    const a = await api().post('/auth/login', {
      email: 'nobody@example.az',
      password: 'Whatever-123456',
    });
    const b = await api().post('/auth/login', { email: gone.email, password: gone.password });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/#/');
    await page.reload();
    await page.getByLabel('Email').fill('nobody@example.az');
    await page.getByLabel('Password', { exact: true }).fill('Whatever-123456');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await page.getByLabel('Email').fill(gone.email);
    await page.getByLabel('Password', { exact: true }).fill(gone.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    ux.allow(/401/);

    // 4) failed_attempts unchanged for the disabled account; no password in any audit row.
    const after = await db(`SELECT failed_attempts FROM local_credential WHERE user_id = $1`, [
      gone.userId,
    ]);
    expect(after[0].failed_attempts).toBe(before[0].failed_attempts);
    const leak = await db(
      `SELECT count(*)::int AS n FROM audit_event WHERE coalesce(before::text,'') || coalesce(after::text,'') LIKE $1 OR coalesce(before::text,'') || coalesce(after::text,'') LIKE $2`,
      [`%${acc.recruiter.password}%`, `%${gone.password}%`],
    );
    expect(leak[0].n).toBe(0);
    await ux.check('errors shown', ['OCC', 'OVL', 'OVF']);
  },
);

// ---------------------------------------------------------------- helpers

const menu = (page: Page) => page.locator('header details[open] > div');
async function openMenu(page: Page) {
  await page.getByLabel('Account menu', { exact: true }).click();
  await expect(menu(page)).toBeVisible();
}
async function signOut(page: Page) {
  await openMenu(page);
  await menu(page).getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
}
/** The real sign-in form; with `code`, the second step too. Waits for the answer. */
async function signIn(page: Page, email: string, password: string, code?: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (code !== undefined) {
    const field = page.getByLabel('Code from your authenticator app');
    await expect(field).toBeVisible();
    await field.fill(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
}
const signedIn = (page: Page) =>
  expect(page.getByLabel('Account menu', { exact: true })).toBeVisible();
const leaks = async (...values: string[]) =>
  (
    await db<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_event WHERE ${values.map((_, i) => `coalesce(before::text,'') || coalesce(after::text,'') LIKE $${i + 1}`).join(' OR ')}`,
      values.map((v) => `%${v}%`),
    )
  )[0]!.n;
/** 'New password' and not 'Repeat new password' (the label also holds the hint under the field). */
const NEW_PASSWORD = /^New password(?!\p{Ll})/u;
const ENDED = 'Your session ended. Please sign in again.';

// ---------------------------------------------------------------- AU

uat(
  'AU-06',
  'Two-step sign-in end to end: enrol, code, reuse, recovery code',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/401/);
    const acc = await freshAcc('TA_PARTNER');
    await openAsR(page, acc, '#/vacancies');
    await signedIn(page);
    // 1) Menu, Security, set up.
    await openMenu(page);
    await menu(page).getByRole('link', { name: 'Security' }).click();
    await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
    // 2) The secret, a wrong code, the right code.
    const secret = (await page.getByTestId('mfa-secret').innerText()).trim();
    const field = page.getByLabel('Code shown in the app');
    await field.fill(wrongCode(secret));
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'That code is not right. Check the time on your phone and try again.',
    );
    await field.fill(totp(secret, stepNow()));
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText('Two-step sign-in is on.', { exact: true })).toBeVisible();
    const codes = await page
      .getByRole('list', { name: 'Recovery codes' })
      .getByRole('listitem')
      .allInnerTexts();
    expect(codes).toHaveLength(8);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    await ux.check('recovery codes', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    const used = Number(
      (await db(`SELECT totp_last_step FROM local_credential WHERE user_id = $1`, [acc.userId]))[0]
        .totp_last_step,
    );
    // 3) Saved: a reload does not show them again.
    await page.getByRole('button', { name: 'I have saved them' }).click();
    await page.reload();
    await expect(page.getByText('Two-step sign-in is on. Recovery codes left: 8')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Recovery codes' })).toHaveCount(0);
    // 4) The next 30 s step: sign out, sign in with that step's code.
    while (stepNow() <= used) await sleep(500);
    const s4 = stepNow();
    const code4 = totp(secret, s4);
    await signOut(page);
    await signIn(page, acc.email, acc.password, code4);
    await signedIn(page);
    // 5) The same code again, in the same step: refused.
    await signOut(page);
    await signIn(page, acc.email, acc.password, code4);
    await expect(page.getByRole('alert')).toHaveText('Invalid email, password or code');
    // 6) A recovery code works once.
    const field2 = page.getByLabel('Code from your authenticator app');
    await field2.fill(codes[0]!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await signedIn(page);
    await signOut(page);
    await signIn(page, acc.email, acc.password, codes[0]!);
    await expect(page.getByRole('alert')).toHaveText('Invalid email, password or code');
    // 7) Security: 7 codes left; the recovery use is in the audit.
    await field2.fill(totp(secret, Math.max(stepNow(), s4 + 1)));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await signedIn(page);
    await page.goto(`${BASE}/#/security`);
    await expect(page.getByText('Two-step sign-in is on. Recovery codes left: 7')).toBeVisible();
    const rec = await db(
      `SELECT count(*)::int AS n FROM audit_event WHERE action = 'auth.mfa_recovery_used' AND actor_id = $1`,
      [acc.userId],
    );
    expect(rec[0].n).toBe(1);
    await ux.check('security, 7 left', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  },
);

uat(
  'AU-08',
  'Invitation link end to end: create, choose a password, land by role',
  { on: ['D'], langs: 'EN' },
  async ({ page, browser, ux }) => {
    const tag = Date.now().toString(36);
    const people = [
      {
        name: 'Lead Test',
        email: `uat.lead.${tag}@example.az`,
        role: 'Recruiting lead',
        roles: 'Recruiting lead',
        pw: 'Lead chooses a long sentence 1',
      },
      {
        name: 'Viewer Test',
        email: `uat.viewer.${tag}@example.az`,
        role: 'Report viewer only (no other access)',
        roles: 'Report viewer only',
        pw: 'Viewer chooses a long sentence 2',
      },
    ];
    await openAsR(page, accounts().admin, '#/admin');
    await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible();
    // 1) Create both users and read each link.
    const links: string[] = [];
    for (const p of people) {
      await page.getByLabel('Email', { exact: true }).fill(p.email);
      await page.getByLabel('Name', { exact: true }).fill(p.name);
      await page.getByLabel('Role').selectOption({ label: p.role });
      await page.getByRole('button', { name: 'Create user' }).click();
      const warn = page
        .getByRole('status')
        .filter({ hasText: /^(Email could not be sent|Copy this link and send it to)/ });
      await expect(warn).toBeVisible();
      await expect(warn).toContainText(p.email);
      const link = await page.getByLabel('Invitation link').inputValue();
      expect(link.startsWith(`${BASE}/#/set-password?token=`), 'the link is on this site').toBe(
        true,
      );
      links.push(link);
      await ux.check(`created ${p.name}`, ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    }
    // 2) and 3) A fresh browser each: choose a password, land by role.
    for (const [i, p] of people.entries()) {
      const ctx = await browser.newContext({ baseURL: BASE });
      const q = await ctx.newPage();
      const flush = ux.watch(q);
      await q.goto(links[i]!);
      await expect(
        q.getByText(`Welcome, ${p.name}. Choose a password for your account:`),
      ).toBeVisible();
      await q.getByLabel(NEW_PASSWORD).fill(p.pw);
      await q.getByLabel('Repeat new password').fill(p.pw);
      await q.getByRole('button', { name: 'Save password and sign in' }).click();
      await expect(q).toHaveURL(/#\/$/);
      await expect(q.getByLabel('Account menu', { exact: true })).toBeVisible();
      if (i === 0) {
        await expect(q.getByRole('navigation', { name: 'Main' })).toBeVisible();
        await expect(q.getByRole('heading', { level: 1, name: 'Vacancies' })).toBeVisible();
      } else
        await expect(q.getByRole('heading', { level: 1, name: 'Shared with me' })).toBeVisible();
      flush();
      await ctx.close();
    }
    // 4) Users: both active with their roles.
    await page.reload();
    for (const p of people) {
      const row = page.getByRole('row').filter({ hasText: p.email });
      await expect(row).toContainText('Active');
      await expect(row).toContainText(p.roles);
    }
    for (const p of people) {
      const id = (await db(`SELECT id FROM app_user WHERE email = $1`, [p.email]))[0].id;
      const n = await db(
        `SELECT count(*)::int AS n FROM audit_event WHERE action = 'auth.password_set_via_link' AND actor_id = $1`,
        [id],
      );
      expect(n[0].n, `${p.name}: auth.password_set_via_link`).toBe(1);
    }
    expect(await leaks(people[0]!.pw, people[1]!.pw), 'no password value in the audit').toBe(0);
    await ux.check('users', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  },
);

uat(
  'AU-11',
  'Forced change for real: wrong temporary password keeps the person on the page; the API is locked until the change',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/401|403|400/);
    const acc = await freshAcc('TA_PARTNER'); // the recruiter whose password the admin resets
    const admin = api(await loginR(accounts().admin));
    expect((await admin.post(`/admin/users/${acc.userId}/reset-password`)).status).toBe(200);
    const temp = await tempPasswordFor(acc.email);
    const forced = page.getByRole('heading', { name: 'Choose your own password' });
    // 1) Sign in with the temporary password.
    await page.goto(`${BASE}/#/`);
    await signIn(page, acc.email, temp);
    await expect(forced).toBeVisible();
    // 2) The API is locked.
    const token = (await page.evaluate(() => sessionStorage.getItem('cv.session')))!;
    for (const p of ['/vacancies', '/admin/users']) {
      const r = await api(token).get(p);
      expect(r.status, p).toBe(403);
      expect(r.body.code, p).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    const fill = async (cur: string, next: string) => {
      await page.getByLabel('Temporary password (from your email)').fill(cur);
      await page.getByLabel(NEW_PASSWORD).fill(next);
      await page.getByLabel('Repeat new password').fill(next);
      await page.getByRole('button', { name: 'Save password' }).click();
    };
    // 3) A wrong temporary password.
    await fill('Wrong-temporary-pw-1', 'A quiet river at dawn 42');
    await expect
      .soft(
        page.getByRole('alert').filter({ hasText: 'Current password is incorrect' }),
        'the error shows on the same page',
      )
      .toBeVisible({ timeout: 4000 });
    await expect
      .soft(forced, 'the person stays on the forced change page')
      .toBeVisible({ timeout: 1000 });
    expect
      .soft(await page.evaluate(() => sessionStorage.getItem('cv.session')), 'still signed in')
      .not.toBeNull();
    await expect.soft(page.getByText(ENDED), 'no session-ended note').toHaveCount(0);
    await ux.check('wrong temporary password', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    if (await page.getByRole('button', { name: 'Sign in', exact: true }).isVisible()) {
      await signIn(page, acc.email, temp); // signed out by the 401: back in to finish the journey
      await expect(forced).toBeVisible();
    }
    // 4) The temporary password as the new one.
    await fill(temp, temp);
    await expect(page.getByRole('alert')).toHaveText('New password must differ from the old one');
    // 5) A new password with the email name in it.
    await fill(temp, `${acc.email.split('@')[0]} is my long password`);
    await expect(page.getByRole('alert')).toHaveText(
      'New password must not contain your email name',
    );
    // 6) A valid one: the recruiter home; the API answers.
    await fill(temp, 'A quiet river at dawn 42');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Vacancies' })).toBeVisible();
    const t2 = (await page.evaluate(() => sessionStorage.getItem('cv.session')))!;
    expect((await api(t2).get('/vacancies')).status).toBe(200);
    await ux.check('recruiter home', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  },
);

uat(
  'AU-13',
  'Change password for real: wrong current password, same password, other tabs signed out',
  { on: ['D'], langs: 'EN' },
  async ({ page, context, ux }) => {
    ux.allow(/401|400/);
    const acc = await freshAcc('TA_PARTNER');
    const NEW = 'A brand new sentence 77';
    await openAsR(page, acc, '#/vacancies');
    const tabB = await context.newPage();
    const flush = ux.watch(tabB);
    await openAsR(tabB, acc, '#/vacancies');
    await signedIn(page);
    await signedIn(tabB);
    const toPassword = async () => {
      await openMenu(page);
      await menu(page).getByRole('link', { name: 'Change password', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
    };
    const fill = async (cur: string, next: string) => {
      await page.getByLabel('Current password').fill(cur);
      await page.getByLabel(NEW_PASSWORD).fill(next);
      await page.getByLabel('Repeat new password').fill(next);
      await page.getByRole('button', { name: 'Save password' }).click();
    };
    // 1) A wrong current password.
    await toPassword();
    await fill('Not-the-password-1', NEW);
    await expect
      .soft(
        page.getByRole('alert').filter({ hasText: 'Current password is incorrect' }),
        'the error shows on the page',
      )
      .toBeVisible({ timeout: 4000 });
    await expect
      .soft(page.getByLabel('Account menu', { exact: true }), 'tab A stays signed in')
      .toBeVisible({ timeout: 1000 });
    await expect.soft(page.getByText(ENDED), 'no session-ended note').toHaveCount(0);
    await ux.check('wrong current password', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    if (await page.getByRole('button', { name: 'Sign in', exact: true }).isVisible()) {
      await signIn(page, acc.email, acc.password); // signed out by the 401: back in to finish the journey
      await signedIn(page);
      await toPassword();
    }
    // 2) The current password as the new one.
    await fill(acc.password, acc.password);
    await expect(page.getByRole('alert')).toHaveText('New password must differ from the old one');
    // 3) A valid change: back to #/, still signed in.
    await fill(acc.password, NEW);
    await expect(page).toHaveURL(/#\/$/);
    await signedIn(page);
    // 4) Tab B is signed out.
    await tabB
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Candidates' })
      .click();
    await expect(tabB.getByText(ENDED)).toBeVisible();
    await expect(tabB.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    flush();
    // 5) The old password is refused, the new one works.
    await signOut(page);
    await signIn(page, acc.email, acc.password);
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
    await signIn(page, acc.email, NEW);
    await signedIn(page);
    const n = await db(
      `SELECT count(*)::int AS n FROM audit_event WHERE action = 'auth.password_changed' AND actor_id = $1`,
      [acc.userId],
    );
    expect(n[0].n).toBeGreaterThan(0);
    expect(await leaks(acc.password, NEW)).toBe(0);
  },
);

uat(
  'AU-15',
  'Turning two-step off with a wrong password shows the error and keeps the session',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/401/);
    const acc = await freshAcc('TA_PARTNER');
    const token = await loginR(acc);
    const a = api(token);
    const setup = await a.post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    const en = await a.post('/auth/mfa/enable', { code: totp(setup.body.secret, stepNow()) });
    expect(en.status).toBe(200);
    const recovery = en.body.recoveryCodes as string[];
    await openAsR(page, acc, '#/security', token);
    await expect(page.getByText('Two-step sign-in is on. Recovery codes left: 8')).toBeVisible();
    const turnOff = async (pw: string) => {
      await page.getByRole('button', { name: 'Turn off', exact: true }).click();
      await page.getByLabel('Your password').fill(pw);
      await page.getByRole('button', { name: 'Turn off two-step sign-in' }).click();
    };
    // 1) A wrong password.
    await turnOff('Not-the-password-1');
    await expect
      .soft(
        page.getByRole('alert').filter({ hasText: 'Password is incorrect' }),
        'the error shows on the Security page',
      )
      .toBeVisible({ timeout: 4000 });
    await expect
      .soft(page.getByLabel('Account menu', { exact: true }), 'still signed in')
      .toBeVisible({ timeout: 1000 });
    await expect.soft(page.getByText(ENDED), 'no session-ended note').toHaveCount(0);
    const on = await db(
      `SELECT totp_secret IS NOT NULL AS on FROM local_credential WHERE user_id = $1`,
      [acc.userId],
    );
    expect(on[0].on, 'two-step stays on').toBe(true);
    await ux.check('wrong password', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    if (await page.getByRole('button', { name: 'Sign in', exact: true }).isVisible()) {
      await signIn(page, acc.email, acc.password, recovery[0]!); // signed out by the 401: back in with a recovery code
      await signedIn(page);
      await page.goto(`${BASE}/#/security`);
      await expect(
        page.getByText(/Two-step sign-in is on\. Recovery codes left: \d/),
      ).toBeVisible();
    } else if (await page.getByLabel('Your password').isVisible()) {
      await page.getByLabel('Your password').fill(acc.password);
      await page.getByRole('button', { name: 'Turn off two-step sign-in' }).click();
    }
    // 2) The right password.
    if (await page.getByRole('button', { name: 'Turn off', exact: true }).isVisible())
      await turnOff(acc.password);
    await expect(page.getByRole('button', { name: 'Set up two-step sign-in' })).toBeVisible();
    // 3) Sign out and in: no code is asked.
    await signOut(page);
    await signIn(page, acc.email, acc.password);
    await signedIn(page);
    await expect(page.getByLabel('Code from your authenticator app')).toHaveCount(0);
    const n = await db(
      `SELECT count(*)::int AS n FROM audit_event WHERE action = 'auth.mfa_disabled' AND actor_id = $1`,
      [acc.userId],
    );
    expect(n[0].n).toBe(1);
  },
);

uat(
  'AU-17',
  'Invitation link opened in a signed-in tab: the tab ends up as the invited user only, with no admin rights left',
  { on: ['D'], langs: 'EN' },
  async ({ page, context, ux }) => {
    const admin = accounts().admin;
    const tok1 = await loginR(admin);
    const tok2 = await loginR(admin);
    const adminId = (await api(tok1).get('/me')).body.userId as string;
    await openAsR(page, admin, '#/admin', tok1);
    const tab2 = await context.newPage();
    const flush = ux.watch(tab2);
    await openAsR(tab2, admin, '#/admin', tok2);
    await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible();
    // PLAN: 'new.user@example.test' — the shared database keeps every run's users, so the address carries a unique tag.
    const tag = Date.now().toString(36);
    const email = `new.user.${tag}@example.test`;
    const created = await api(tok1).post('/admin/users', {
      email,
      displayName: 'Nadir Quliyev',
      role: 'TA_PARTNER',
    });
    expect(created.status).toBe(201);
    const userId = created.body.user.id as string;
    const link = `${BASE}/#/set-password?token=${created.body.setupToken}`;
    const since = (await db(`SELECT now() AS t`))[0].t;
    // 1) and 2) Open the link in tab 1.
    await page.goto(link);
    await expect(
      page.getByText('Welcome, Nadir Quliyev. Choose a password for your account:'),
    ).toBeVisible();
    await expect(page.locator('strong', { hasText: email })).toBeVisible();
    // 3) Choose a password.
    await page.getByLabel(NEW_PASSWORD).fill('Nadir picks a long sentence 3');
    await page.getByLabel('Repeat new password').fill('Nadir picks a long sentence 3');
    await page.getByRole('button', { name: 'Save password and sign in' }).click();
    await expect(page).toHaveURL(/#\/$/);
    // 4) Tab 1 is the new user only.
    await expect(page.getByLabel('Account menu', { exact: true })).toHaveText('NQ');
    await openMenu(page);
    await expect(menu(page)).toContainText(email);
    await expect(menu(page).getByRole('link', { name: 'Administration', exact: true })).toHaveCount(
      0,
    );
    const t1 = (await page.evaluate(() => sessionStorage.getItem('cv.session')))!;
    expect(t1).not.toBe(tok1);
    const me = await api(t1).get('/me');
    expect(me.body.email).toBe(email);
    expect(me.body.roles).toEqual(['TA_PARTNER']);
    expect(
      await page.evaluate(() => Object.values(sessionStorage)),
      "the admin's token is gone from tab 1",
    ).not.toContain(tok1);
    // The menu's rounded corners fool the OCC grid; its content blocks are checked instead.
    await ux.check('new user in tab 1', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE'], {
      overlay: 'header details[open] > div > div, header details[open] > div > p',
    });
    // 5) Tab 2 still works as the admin.
    await tab2.reload();
    await tab2.goto(`${BASE}/#/admin`);
    await expect(tab2.getByRole('heading', { name: 'Add a user' })).toBeVisible();
    await expect(tab2.getByRole('row').filter({ hasText: email })).toContainText('Active');
    flush();
    const set = await db(
      `SELECT count(*)::int AS n FROM audit_event WHERE action = 'auth.password_set_via_link' AND actor_id = $1`,
      [userId],
    );
    expect(set[0].n).toBe(1);
    const underAdmin = await db(
      `SELECT count(*)::int AS n FROM audit_event WHERE actor_id = $1 AND entity_id = $2 AND occurred_at >= $3`,
      [adminId, userId, since],
    );
    expect(underAdmin[0].n, 'no audit row under the admin for this step').toBe(0);
  },
);
