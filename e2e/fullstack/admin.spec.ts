import { ENDED } from '../fixtures/pkg-b';
import { expect, test, uat } from '../ux/test';
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

const blocked: [string, string, string][] = [
  [
    'AD-06',
    'Reset two-step for someone who lost the phone',
    'Not built: P2, outside the time budget of package B',
  ],
  [
    'AD-12',
    'AI models for real: add the fake company, switch the active model, the key never reaches the browser',
    'Blocked: switching and removing the active screening model is a global change that stops screening for every package running on the shared L2 server (no model active → uploads wait); needs an exclusive L2 run',
  ],
  [
    'AD-19',
    'Data retention for real: preview, hold, erase and certificate',
    'Not built: needs the global retention period set to 30 days and a real erase run on the shared database; outside the time budget of package B (run it alone)',
  ],
  [
    'AD-21',
    'First administrator from the environment: created once, must change the password, never reset by a restart',
    'Blocked: needs an empty database and API restarts; the shared L2 server must not be restarted',
  ],
  [
    'AD-22',
    'The last active administrator can never be removed, also by two admins at the same moment',
    'Blocked: revoking ADMIN from the seeded admin/admin+TA accounts would break every other package; needs an exclusive database',
  ],
];
for (const [id, title, why] of blocked)
  uat(id, title, { on: ['D'], langs: 'EN' }, async () => {
    test.skip(true, why);
  });
