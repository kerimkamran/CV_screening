/** Built-in accounts against a real Postgres: admin-created users, generated passwords, lockout. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createAdapter } from './app.factory';
import { AppModule } from './app.module';
import { EmailService } from './auth/email.service';
import { createDb, describeDb } from './testing/pg-harness';

const ADMIN_EMAIL = 'admin@azerconnect.test';
const ADMIN_PW = 'Bootstrap-Passw0rd!';

describeDb('Local accounts', () => {
  let db: Awaited<ReturnType<typeof createDb>>;
  let app: NestFastifyApplication;
  const sent: { to: string; text: string }[] = [];
  let mailWorks = true;

  beforeAll(async () => {
    db = await createDb('local');
    Object.assign(process.env, {
      DATABASE_URL: db.apiUrl,
      AUTH_MODE: 'local',
      SESSION_SECRET: 'x'.repeat(48),
      BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
      BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PW,
      APP_BASE_URL: 'https://cv.example.test',
      LOG_LEVEL: 'silent',
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({
        send: async (m: { to: string; text: string }) => {
          if (mailWorks) sent.push(m);
          return mailWorks;
        },
      })
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(createAdapter('silent'));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  const post = (url: string, body: unknown, token?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload: body as object,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const get = (url: string, token: string) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const login = async (email: string, password: string) => {
    const r = await post('/auth/login', { email, password });
    return { status: r.statusCode, ...(r.statusCode === 200 ? r.json() : {}) } as {
      status: number;
      token: string;
      mustChangePassword: boolean;
    };
  };

  let adminToken: string;
  let recruiterId: string;
  let recruiterPw: string;

  it('bootstraps the first admin, who must change the generated password before anything else', async () => {
    const a = await login(ADMIN_EMAIL, ADMIN_PW);
    expect(a.status).toBe(200);
    expect(a.mustChangePassword).toBe(true);
    // Confined: everything except /me and change-password is refused.
    const blocked = await get('/admin/users', a.token);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await get('/me', a.token)).statusCode).toBe(200);

    const weak = await post(
      '/auth/change-password',
      { currentPassword: ADMIN_PW, newPassword: 'short' },
      a.token,
    );
    expect(weak.statusCode).toBe(400);
    const ok = await post(
      '/auth/change-password',
      { currentPassword: ADMIN_PW, newPassword: 'A-much-longer-secret-1' },
      a.token,
    );
    expect(ok.statusCode).toBe(200);
    adminToken = ok.json().token;
    expect((await get('/admin/users', adminToken)).statusCode).toBe(200);
    // The pre-change session no longer works.
    expect((await get('/me', a.token)).statusCode).toBe(401);
    // And the bootstrap password no longer signs in.
    expect((await login(ADMIN_EMAIL, ADMIN_PW)).status).toBe(401);
  });

  it('admin creates a recruiter: generated password is emailed with the link, never returned', async () => {
    const r = await post(
      '/admin/users',
      { email: 'Ayla.Recruiter@azerconnect.test', displayName: 'Ayla', role: 'TA_PARTNER' },
      adminToken,
    );
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.emailSent).toBe(true);
    expect(body.temporaryPassword).toBeUndefined();
    // The same email also carries a one-time link to choose a password.
    expect(body.setupLink).toBe(`https://cv.example.test/#/set-password?token=${body.setupToken}`);
    expect(sent.at(-1)!.text).toContain(body.setupLink);
    recruiterId = body.user.id;
    const mail = sent.at(-1)!;
    expect(mail.to).toBe('ayla.recruiter@azerconnect.test');
    expect(mail.text).toContain('https://cv.example.test');
    recruiterPw = /Password:\s+(\S+)/.exec(mail.text)![1]!;
    expect(recruiterPw).toHaveLength(16);

    const dup = await post(
      '/admin/users',
      { email: 'ayla.recruiter@azerconnect.test', displayName: 'X' },
      adminToken,
    );
    expect(dup.statusCode).toBe(409);
  });

  it('recruiter signs in case-insensitively, is forced to set a password, and holds only TA_PARTNER', async () => {
    const s = await login('AYLA.RECRUITER@azerconnect.test', recruiterPw);
    expect(s.status).toBe(200);
    expect(s.mustChangePassword).toBe(true);
    const c = await post(
      '/auth/change-password',
      { currentPassword: recruiterPw, newPassword: 'Recruiter-own-pass-9' },
      s.token,
    );
    expect(c.statusCode).toBe(200);
    const me = (await get('/me', c.json().token)).json();
    expect(me.roles).toEqual(['TA_PARTNER']);
    expect(me.mustChangePassword).toBe(false);
    expect((await get('/admin/users', c.json().token)).statusCode).toBe(403);
  });

  it('locks the account after repeated failures, then a reset restores access and ends sessions', async () => {
    for (let i = 0; i < 5; i++)
      expect((await login('ayla.recruiter@azerconnect.test', 'wrong-password')).status).toBe(401);
    // Locked: even the right password is refused.
    expect((await login('ayla.recruiter@azerconnect.test', 'Recruiter-own-pass-9')).status).toBe(
      401,
    );

    mailWorks = false; // simulate an email outage: the admin copies a one-time link instead
    const reset = await post(`/admin/users/${recruiterId}/reset-password`, {}, adminToken);
    expect(reset.statusCode).toBe(200);
    expect(reset.json().emailSent).toBe(false);
    expect(reset.json().temporaryPassword).toBeUndefined(); // no password is ever handed out
    const token = reset.json().setupToken as string;
    const opened = await post('/auth/setup-password', {
      token,
      newPassword: 'Chosen-by-the-user-77',
    });
    expect(opened.statusCode).toBe(200);
    expect((await login('ayla.recruiter@azerconnect.test', 'Chosen-by-the-user-77')).status).toBe(
      200,
    );
    mailWorks = true;
  });

  describe('invitation links', () => {
    const issue = async (id = recruiterId) =>
      (await post(`/admin/users/${id}/setup-link`, {}, adminToken)).json() as {
        setupToken: string;
        setupLink: string;
        expiresAt: string;
        user: { email: string };
      };

    it('an admin copies a link; opening it lets the user choose a password and signs them in', async () => {
      const l = await issue();
      expect(l.setupLink).toContain('/#/set-password?token=');
      expect(l.user.email).toBe('ayla.recruiter@azerconnect.test');
      const ttl = new Date(l.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(71 * 3_600_000);
      expect(ttl).toBeLessThanOrEqual(72 * 3_600_000);

      const who = await post('/auth/setup-link/check', { token: l.setupToken });
      expect(who.json()).toEqual({
        email: 'ayla.recruiter@azerconnect.test',
        displayName: 'Ayla',
      });
      const weak = await post('/auth/setup-password', {
        token: l.setupToken,
        newPassword: 'short',
      });
      expect(weak.statusCode).toBe(400);
      const ok = await post('/auth/setup-password', {
        token: l.setupToken,
        newPassword: 'Link-chosen-pass-31',
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().mustChangePassword).toBe(false);
      const me = (await get('/me', ok.json().token)).json();
      expect(me.roles).toEqual(['TA_PARTNER']);
      expect((await login('ayla.recruiter@azerconnect.test', 'Link-chosen-pass-31')).status).toBe(
        200,
      );
    });

    it('works once, and only the hash is stored', async () => {
      const l = await issue();
      expect(
        (
          await post('/auth/setup-password', {
            token: l.setupToken,
            newPassword: 'Second-pass-4242',
          })
        ).statusCode,
      ).toBe(200);
      const again = await post('/auth/setup-password', {
        token: l.setupToken,
        newPassword: 'Third-pass-5353x',
      });
      expect(again.statusCode).toBe(400);
      expect((await post('/auth/setup-link/check', { token: l.setupToken })).statusCode).toBe(400);
      const stored = await db.owner.query(`SELECT token_hash FROM password_setup`);
      for (const r of stored.rows) expect(r.token_hash).not.toContain(l.setupToken);
    });

    it('a newer link withdraws the older one, and an expired link is refused', async () => {
      const first = await issue();
      const second = await issue();
      expect((await post('/auth/setup-link/check', { token: first.setupToken })).statusCode).toBe(
        400,
      );
      expect((await post('/auth/setup-link/check', { token: second.setupToken })).statusCode).toBe(
        200,
      );
      await db.owner.query(`UPDATE password_setup SET expires_at = now() - interval '1 minute'`);
      const late = await post('/auth/setup-password', {
        token: second.setupToken,
        newPassword: 'Too-late-pass-6464',
      });
      expect(late.statusCode).toBe(400);
      expect(late.json().message).toMatch(/invalid or has expired/);
    });

    it('a made-up token, a disabled user and a non-admin are all refused', async () => {
      expect((await post('/auth/setup-link/check', { token: 'x'.repeat(43) })).statusCode).toBe(
        400,
      );
      const l = await issue();
      await post(`/admin/users/${recruiterId}/status`, { status: 'disabled' }, adminToken);
      expect((await post('/auth/setup-link/check', { token: l.setupToken })).statusCode).toBe(400);
      expect(
        (await post(`/admin/users/${recruiterId}/setup-link`, {}, adminToken)).statusCode,
      ).toBe(409);
      await post(`/admin/users/${recruiterId}/status`, { status: 'active' }, adminToken);
      const asUser = await login('ayla.recruiter@azerconnect.test', 'Second-pass-4242');
      expect(
        (await post(`/admin/users/${recruiterId}/setup-link`, {}, asUser.token)).statusCode,
      ).toBe(403);
    });
  });

  it('unknown accounts and wrong passwords are indistinguishable', async () => {
    const a = await post('/auth/login', {
      email: 'nobody@azerconnect.test',
      password: 'whatever-123456',
    });
    const b = await post('/auth/login', { email: ADMIN_EMAIL, password: 'whatever-123456' });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().message).toBe(b.json().message);
  });

  it('a disabled user is refused; the last active admin cannot be disabled', async () => {
    expect(
      (await post(`/admin/users/${recruiterId}/status`, { status: 'disabled' }, adminToken))
        .statusCode,
    ).toBe(200);
    const adminId = (await get('/me', adminToken)).json().userId;
    expect(
      (await post(`/admin/users/${adminId}/status`, { status: 'disabled' }, adminToken)).statusCode,
    ).toBe(400);
    expect((await login('ayla.recruiter@azerconnect.test', 'anything-at-all-1')).status).toBe(401);
  });

  it('writes audit events for account changes and never records a password', async () => {
    const { rows } = await db.owner.query(
      `SELECT action, after::text AS after FROM audit_event ORDER BY seq`,
    );
    const actions = rows.map((r) => r.action);
    for (const a of [
      'role.bootstrap',
      'auth.password_changed',
      'user.create',
      'auth.locked',
      'user.password_reset',
      'user.disable',
    ])
      expect(actions).toContain(a);
    expect(JSON.stringify(rows)).not.toContain(recruiterPw);
    const verify = await db.owner.query(`SELECT * FROM audit_event_verify_chain()`);
    expect(JSON.stringify(verify.rows[0])).not.toMatch(/false/);
  });
});
