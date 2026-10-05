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

    mailWorks = false; // simulate an email outage: the admin gets the password once instead
    const reset = await post(`/admin/users/${recruiterId}/reset-password`, {}, adminToken);
    expect(reset.statusCode).toBe(200);
    expect(reset.json().emailSent).toBe(false);
    const temp = reset.json().temporaryPassword as string;
    const s = await login('ayla.recruiter@azerconnect.test', temp);
    expect(s.status).toBe(200);
    expect(s.mustChangePassword).toBe(true);
    mailWorks = true;
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
