import { stepNow, totp } from '../fixtures/pkg-a';
import { ENDED } from '../fixtures/pkg-b';
import { expect, STD, uat } from '../ux/test';
import {
  accounts,
  api,
  BASE,
  clearOutbox,
  db,
  freshAccount,
  login,
  openAs,
  outbox,
  signInUi,
} from './stack';

// 7.x Administration (AD), full-stack journeys (L2). Accounts that change are throwaway ones.

uat(
  'AD-05',
  'Reset password, disable and enable for real',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux, browser }) => {
    ux.allow(/401|400/);
    const rec = await freshAccount('TA_PARTNER', {
      name: `Reset Target ${Date.now().toString(36)}`,
    });
    const acc = accounts();
    const adminToken = await openAs(page, acc.admin, '#/admin');
    const adminId = (await api(adminToken).get('/me')).body.userId as string;
    // The recruiter signed in in a second context.
    const rctx = await browser.newContext({ baseURL: BASE, viewport: page.viewportSize()! });
    const rp = await rctx.newPage();
    const flush = ux.watch(rp);
    const rToken = await openAs(rp, rec, '#/vacancies');
    await expect(rp.getByLabel('Account menu', { exact: true })).toBeVisible();
    const recRow = page.getByRole('row').filter({ hasText: rec.email });
    await expect(recRow).toBeVisible();

    // 1) Reset password (confirm if asked).
    page.on('dialog', (d) => void d.accept());
    const sent0 = (await outbox()).filter((m) => m.to === rec.email).length;
    await recRow.getByRole('button', { name: 'Reset password' }).click();
    // The page asks first, in a box of its own (not a browser dialog).
    await page
      .getByRole('alertdialog', { name: 'Reset password' })
      .getByRole('button', { name: 'Reset password' })
      .click();
    await expect(recRow.getByRole('cell').nth(3)).toHaveText(/^Invited/);
    // 2) The recruiter clicks Candidates: signed out with the note.
    await rp
      .getByRole('link', { name: 'Candidates', exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(rp.getByText(ENDED)).toBeVisible();
    await expect(rp.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    // 3) One email with a temporary password and a one-time link.
    const mails = (await outbox()).filter((m) => m.to === rec.email).slice(sent0);
    expect(mails).toHaveLength(1);
    const temp = /Password:\s+(\S+)/.exec(mails[0]!.text)?.[1];
    const link = /(https?:\/\/\S+#\/set-password\?token=[\w-]+)/.exec(mails[0]!.text)?.[1];
    expect(temp).toBeTruthy();
    expect(link).toBeTruthy();
    // 4) The temporary password opens the forced change page.
    await signInUi(rp, { email: rec.email, password: temp! });
    await expect(rp.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
    const tempToken = await login({ email: rec.email, password: temp! });
    // 5) Disable.
    await recRow.getByRole('button', { name: 'Disable' }).click();
    await page
      .getByRole('alertdialog', { name: 'Disable' })
      .getByRole('button', { name: 'Disable' })
      .click();
    await expect(recRow.getByRole('cell').nth(3)).toHaveText(/^Disabled/);
    const call = await api(tempToken).get('/me');
    expect(call.status).toBe(401);
    void rToken;
    await fresh(rp);
    await signInUi(rp, { email: rec.email, password: temp! });
    await expect(rp.getByRole('alert')).toContainText('Invalid email or password');
    await rp.goto(link!.replace(/^https?:\/\/[^/]+/, BASE));
    await expect(rp.getByText('This account is disabled. Ask your administrator.')).toBeVisible();
    // 6) Enable; the recruiter signs in.
    await recRow.getByRole('button', { name: 'Enable' }).click();
    await expect(recRow.getByRole('cell').nth(3)).not.toHaveText(/^Disabled/);
    await fresh(rp);
    await signInUi(rp, { email: rec.email, password: temp! });
    await expect(rp.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
    flush();
    await rctx.close();
    // 7) The admin cannot disable their own account.
    const self = await api(adminToken).post(`/admin/users/${adminId}/status`, {
      status: 'disabled',
    });
    expect(self.status).toBe(400);
    expect(self.body.message).toBe('You cannot disable your own account');
    const audit = await db<{ action: string }>(
      `SELECT action FROM audit_event WHERE entity_id = $1 ORDER BY occurred_at`,
      [rec.userId],
    ).catch(() =>
      db<{ action: string }>(`SELECT action FROM audit_event WHERE entity_id = $1`, [rec.userId]),
    );
    const actions = audit.map((a) => a.action);
    for (const a of ['user.password_reset', 'user.disable', 'user.enable'])
      expect(actions).toContain(a);
    void clearOutbox;
  },
);

/** Signed out in this tab, on a freshly loaded sign-in page. */
async function fresh(p: import('@playwright/test').Page) {
  await p.evaluate(() => {
    sessionStorage.clear();
    sessionStorage.setItem('uat-token-set', '1');
  });
  await p.goto(`${BASE}/#/`);
  await p.reload();
}

uat(
  'AD-06',
  'Reset two-step for someone who lost the phone',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const acc = accounts();
    const rec = await freshAccount('TA_PARTNER', {
      name: `Lost Phone ${Date.now().toString(36)}`,
    });
    // The recruiter has two-step on (set up through the API, as the Security page does).
    const rToken = await login(rec);
    const setup = await api(rToken).post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    const en = await api(rToken).post('/auth/mfa/enable', {
      code: totp(setup.body.secret, stepNow()),
    });
    expect(en.status).toBe(200);

    await openAs(page, acc.admin, '#/admin');
    const row = page.getByRole('row').filter({ hasText: rec.email });
    // 1) The row shows the marker; the button explains itself.
    await expect(row).toContainText('· two-step on');
    const reset = row.getByRole('button', { name: 'Reset two-step', exact: true });
    await expect(reset).toHaveAttribute(
      'title',
      'For someone who lost their phone and recovery codes',
    );
    await ux.check('two-step on', [...STD, 'ERR']);
    // 2) Press it and confirm in the page's own box.
    await reset.click();
    const box = page.getByRole('alertdialog', { name: 'Reset two-step' });
    await expect(box).toContainText(rec.displayName);
    await box.getByRole('button', { name: 'Reset two-step', exact: true }).click();
    await expect(row).not.toContainText('· two-step on');
    await expect(row.getByRole('button', { name: 'Reset two-step' })).toHaveCount(0);
    await ux.check('reset done', [...STD, 'ERR']);
    // The reset is audited, and the account's old sessions stop working.
    const audited = await db<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_event WHERE action = 'auth.mfa_reset' AND entity_id = $1`,
      [rec.userId],
    );
    expect(audited[0]!.n).toBe(1);
    expect((await api(rToken).get('/me')).status).toBe(401);
    // 3) The recruiter signs in with the password alone: no code asked.
    const rToken2 = await login(rec);
    expect((await api(rToken2).get('/auth/mfa')).body.enabled).toBe(false);
    // 4) With the recruiter's own token the same call is refused and recorded.
    const since = new Date(Date.now() - 1000).toISOString();
    const denied = await api(rToken2).post(`/admin/users/${rec.userId}/mfa-reset`);
    expect(denied.status).toBe(403);
    const rows = await db<{ m: string; p: string }>(
      `SELECT after->>'method' AS m, after->>'resource' AS p FROM audit_event
        WHERE action = 'access.denied' AND actor_id = $1 AND occurred_at >= $2`,
      [rec.userId, since],
    );
    expect(rows.map((r) => `${r.m} ${r.p}`)).toEqual([`POST /admin/users/${rec.userId}/mfa-reset`]);
  },
);
