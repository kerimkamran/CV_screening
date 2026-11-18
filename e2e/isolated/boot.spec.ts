import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Page } from '@playwright/test';
import { startApi, client, type Proc } from '../fixtures/stack-proc';
import { expect, test, uat } from '../ux/test';

// Cases that need an API process of their own: an empty database and restarts (AD-21), and a
// short token lifetime (SEC-06). Each starts, uses and stops its own process, port and database.

async function sql<T = any>(url: string, q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}

async function signInAt(page: Page, base: string, email: string, password: string) {
  await page.goto(`${base}/#/`);
  await page.getByLabel(/^(Email|E-poçt)$/).fill(email);
  await page
    .getByLabel(/^(Password|Parol)$/, { exact: false })
    .first()
    .fill(password);
  await page.getByRole('button', { name: /^(Sign in|Daxil olun)$/ }).click();
}

const NEW_PASSWORD = /^New password(?!\p{Ll})/u;
const pwd = () => `Boot-${randomBytes(9).toString('base64url')}-1a`;

uat(
  'AD-21',
  'First administrator from the environment: created once, must change the password, never reset by a restart',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    test.setTimeout(240_000);
    const boot = pwd();
    expect(boot).toHaveLength(boot.length);
    const env = { UAT_BOOTSTRAP_EMAIL: 'First.Admin@example.test', UAT_BOOTSTRAP_PASSWORD: boot };
    let proc: Proc | undefined;
    try {
      // 1) Start the API on an empty database.
      proc = await startApi({ port: 4350, db: 'cv_uat_boot', reset: true, env });
      const q = (text: string, p: unknown[] = []) => sql(proc!.ownerUrl, text, p);
      // 2) The database after the first start.
      const users = await q(
        `SELECT id, email, display_name FROM app_user WHERE issuer <> 'system'`,
      );
      expect(users).toHaveLength(1);
      expect(users[0].display_name).toBe('Administrator');
      expect(users[0].email).toBe('first.admin@example.test');
      const roles = await q(
        `SELECT role::text AS role FROM role_assignment WHERE revoked_at IS NULL`,
      );
      expect(roles).toEqual([{ role: 'ADMIN' }]);
      const cred = await q(`SELECT must_change, password_hash FROM local_credential`);
      expect(cred).toHaveLength(1);
      expect(cred[0].must_change).toBe(true);
      expect(String(cred[0].password_hash)).not.toContain(boot);
      expect(String(cred[0].password_hash)).toMatch(/^\$|^scrypt|argon|:/i);
      const boots = await q(`SELECT 1 FROM audit_event WHERE action = 'role.bootstrap'`);
      expect(boots).toHaveLength(1);
      // 3) Sign in with the bootstrap password: the forced change page.
      await signInAt(page, proc.base, 'first.admin@example.test', boot);
      await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
      await ux.check('forced change');
      // 4) The API is locked until the password is changed.
      const token = (await page.evaluate(() => sessionStorage.getItem('cv.session')))!;
      const locked = await client(proc.base, token).get('/vacancies');
      expect(locked.status).toBe(403);
      expect(locked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      // 5) Choose a new password.
      const fresh = pwd();
      await page.getByLabel('Temporary password (from your email)').fill(boot);
      await page.getByLabel(NEW_PASSWORD).fill(fresh);
      await page.getByLabel('Repeat new password').fill(fresh);
      await page.getByRole('button', { name: 'Save password' }).click();
      await expect(
        page.getByText(
          'Administrators manage users and AI models under Administration. Candidate data is available only to recruiters.',
        ),
      ).toBeVisible();
      await page.getByLabel('Account menu', { exact: true }).click();
      await expect(page.getByRole('link', { name: 'Administration', exact: true })).toBeVisible();
      await ux.check('administrator home');
      // 6) Restart with the same variables, then with another e-mail: nothing is created or reset.
      const counts = async () => ({
        users: (await q(`SELECT 1 FROM app_user WHERE issuer <> 'system'`)).length,
        admins: (await q(`SELECT 1 FROM role_assignment WHERE role = 'ADMIN'`)).length,
        boots: (await q(`SELECT 1 FROM audit_event WHERE action = 'role.bootstrap'`)).length,
      });
      const base0 = await counts();
      expect(base0).toEqual({ users: 1, admins: 1, boots: 1 });
      await proc.stop();
      proc = await startApi({ port: 4350, db: 'cv_uat_boot', env });
      expect(await counts()).toEqual(base0);
      await proc.stop();
      proc = await startApi({
        port: 4350,
        db: 'cv_uat_boot',
        env: { ...env, UAT_BOOTSTRAP_EMAIL: 'other.admin@example.test' },
      });
      expect(await counts()).toEqual(base0);
      const other = await q(`SELECT 1 FROM app_user WHERE email = 'other.admin@example.test'`);
      expect(other).toHaveLength(0);
      // 7) The new password still signs in: a restart never resets it.
      const login = await client(proc.base).post('/auth/login', {
        email: 'first.admin@example.test',
        password: fresh,
      });
      expect(login.status).toBeLessThan(300);
      expect(login.body.mustChangePassword).toBeFalsy();
      const old = await client(proc.base).post('/auth/login', {
        email: 'first.admin@example.test',
        password: boot,
      });
      expect(old.status).toBe(401);
    } finally {
      await proc?.stop();
    }
  },
);

uat(
  'SEC-06',
  'A token past its lifetime ends the session; refresh does not lengthen it',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    test.setTimeout(240_000);
    ux.allow(/401/);
    const boot = pwd();
    let proc: Proc | undefined;
    try {
      proc = await startApi({
        port: 4360,
        db: 'cv_uat_tok',
        reset: true,
        env: {
          UAT_BOOTSTRAP_EMAIL: 'tok.admin@example.test',
          UAT_BOOTSTRAP_PASSWORD: boot,
          LOCAL_SESSION_SECONDS: '300',
          MAX_TOKEN_LIFETIME_SECONDS: '60',
        },
      });
      // A recruiter to sign in as (the bootstrap admin sets up the account).
      const admin0 = client(proc.base);
      const first = await admin0.post('/auth/login', {
        email: 'tok.admin@example.test',
        password: boot,
      });
      const adminPw = pwd();
      const ch = await client(proc.base, first.body.token).post('/auth/change-password', {
        currentPassword: boot,
        newPassword: adminPw,
      });
      expect(ch.status).toBeLessThan(300);
      const admin = client(proc.base, ch.body.token);
      const email = 'tok.recruiter@example.test';
      const made = await admin.post('/admin/users', {
        email,
        displayName: 'Token Tester',
        role: 'TA_PARTNER',
      });
      expect(made.status).toBe(201);
      const out = await fetch(`${proc.control}/outbox`).then((r) => r.json());
      const temp = /Password:\s+(\S+)/.exec(
        (out as { to: string; text: string }[]).filter((m) => m.to === email).at(-1)!.text,
      )![1]!;
      const t1 = await client(proc.base).post('/auth/login', { email, password: temp });
      const rpw = pwd();
      const c2 = await client(proc.base, t1.body.token).post('/auth/change-password', {
        currentPassword: temp,
        newPassword: rpw,
      });
      expect(c2.status).toBeLessThan(300);
      // 1) Sign in through the page and decode the token.
      await signInAt(page, proc.base, email, rpw);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      const token = (await page.evaluate(() => sessionStorage.getItem('cv.session')))!;
      const decode = (t: string) =>
        JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString()) as {
          iat: number;
          exp: number;
        };
      const a = decode(token);
      expect(a.exp - a.iat).toBe(60);
      // 2) Refresh does not lengthen it.
      const rf = await client(proc.base, token).post('/auth/refresh');
      if (rf.status < 300 && rf.body?.token) {
        const b = decode(rf.body.token as string);
        expect(b.exp - b.iat).toBe(60);
      } else {
        expect([401, 403, 404]).toContain(rf.status);
      }
      // 3) Past exp plus the verifier's 30 s tolerance: the next click shows the Sign in card.
      const until = a.iat * 1000 + 95_000;
      await page.waitForTimeout(Math.max(0, until - Date.now()));
      await page
        .getByRole('link', { name: 'Candidates', exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await expect(page.getByText('Your session ended. Please sign in again.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      await ux.check('session ended');
      // 4) The first token no longer works.
      expect((await client(proc.base, token).get('/me')).status).toBe(401);
    } finally {
      await proc?.stop();
    }
  },
);

uat(
  'SEC-14',
  'UAT seed tooling loads accounts and data without errors',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    test.setTimeout(240_000);
    const boot = pwd();
    const adminPw = pwd();
    const recruiterPw = pwd();
    const root = new URL('../..', import.meta.url).pathname;
    let proc: Proc | undefined;
    try {
      // A site of its own: a fresh database, an administrator who chose a password, the fake AI.
      proc = await startApi({
        port: 4370,
        db: 'cv_uat_seed',
        reset: true,
        env: { UAT_BOOTSTRAP_EMAIL: 'seed.admin@example.test', UAT_BOOTSTRAP_PASSWORD: boot },
      });
      const q = (text: string, p: unknown[] = []) => sql(proc!.ownerUrl, text, p);
      const first = await client(proc.base).post('/auth/login', {
        email: 'seed.admin@example.test',
        password: boot,
      });
      const change = await client(proc.base, first.body.token).post('/auth/change-password', {
        currentPassword: boot,
        newPassword: adminPw,
      });
      expect(change.status).toBeLessThan(300);
      const again = await client(proc.base).post('/auth/login', {
        email: 'seed.admin@example.test',
        password: adminPw,
      });
      const admin = client(proc.base, again.body.token);
      const conn = await admin.post('/admin/ai/connections', {
        company: 'anthropic',
        apiKey: 'sk-ant-uat-fake-key-not-real',
        models: [{ modelId: 'claude-fake-1' }],
      });
      expect(conn.status).toBeLessThan(300);
      const model = (await admin.get('/admin/ai')).body.connections[0].models[0].id as string;
      expect((await admin.put('/admin/ai/active', { modelId: model })).status).toBeLessThan(300);

      const run = (cmd: 'accounts' | 'data') =>
        new Promise<{ code: number; out: string }>((resolve) =>
          execFile(
            process.execPath,
            ['scripts/uat-seed.mjs', cmd],
            {
              cwd: root,
              env: {
                ...process.env,
                UAT_BASE_URL: proc!.base,
                UAT_ADMIN_EMAIL: 'seed.admin@example.test',
                UAT_ADMIN_PASSWORD: adminPw,
                UAT_PASSWORD: recruiterPw,
              },
            },
            (e, out, err) =>
              resolve({ code: e ? Number((e as { code?: number }).code ?? 1) : 0, out: out + err }),
          ),
        );
      const users = async () =>
        (await q(`SELECT email FROM app_user WHERE issuer <> 'system' ORDER BY email`)).map(
          (r) => r.email as string,
        );

      // 1) 'accounts': four lines, each with a setup link.
      const a1 = await run('accounts');
      expect(a1.code, a1.out).toBe(0);
      const lines = a1.out.split('\n').filter((l) => /setup link: /.test(l));
      expect(lines).toHaveLength(4);
      for (const role of ['TA_PARTNER', 'TA_LEAD', 'GOVERNANCE', 'NONE'])
        expect(lines.filter((l) => l.startsWith(role)).length, role).toBe(1);
      expect(a1.out).not.toContain(adminPw);
      const usersAfter = await users();
      expect(usersAfter).toHaveLength(5);

      // 2) The recruiter opens the setup link and chooses UAT_PASSWORD.
      const link = /setup link: (\S+)/.exec(lines.find((l) => l.startsWith('TA_PARTNER'))!)![1]!;
      await page.goto(link);
      await page.getByLabel(NEW_PASSWORD).fill(recruiterPw);
      await page.getByLabel('Repeat new password').fill(recruiterPw);
      await page.getByRole('button', { name: 'Save password and sign in' }).click();
      await expect(page.getByLabel('Account menu', { exact: true })).toBeVisible();
      await ux.check('recruiter set a password');

      // 3) 'data': no 409, the vacancy id is printed, and that vacancy has 10 CVs being analyzed.
      const d = await run('data');
      expect(d.code, d.out).toBe(0);
      expect(d.out).not.toMatch(/409/);
      expect(d.out).not.toContain(recruiterPw);
      const id = /Vacancy: .+ \(([0-9A-Z]{26})\)/.exec(d.out)?.[1];
      expect(id, d.out).toBeTruthy();
      const cvs = await q(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [id]);
      expect(cvs[0].n).toBe(10);
      const started = await q(
        `SELECT count(*)::int AS n FROM screening s JOIN cv_document d ON d.id = s.document_id
          WHERE d.vacancy_id = $1`,
        [id],
      );
      expect(started[0].n, 'every CV has an analysis').toBe(10);

      // 4) 'accounts' again: each account is already there; nothing is added.
      const a2 = await run('accounts');
      expect(a2.code, a2.out).toBe(0);
      expect(a2.out.split('\n').filter((l) => /already exists/.test(l))).toHaveLength(4);
      expect(await users()).toEqual(usersAfter);
    } finally {
      await proc?.stop();
    }
  },
);
