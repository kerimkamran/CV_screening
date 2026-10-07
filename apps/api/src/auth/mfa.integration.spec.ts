import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';
import { codeAt, stepNow } from './totp';

describeDb('Two-step sign-in (TOTP)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('mfa');
  });
  afterAll(async () => h?.close());

  const login = (email: string, password: string, code?: string) =>
    h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password, ...(code ? { code } : {}) },
    });

  it('enrols, then asks for a code at sign-in, accepts each code once, and honours recovery codes', async () => {
    const email = 'mfa-user@azerconnect.test';
    const u = await h.recruiter(email);
    const PW = 'A-much-longer-secret-1';
    expect((await login(email, PW)).statusCode).toBe(200); // no two-step yet

    const setup = (await u.api.post('/auth/mfa/setup')).json();
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.uri).toContain('otpauth://totp/');
    expect((await u.api.post('/auth/mfa/enable', { code: '000000' })).statusCode).toBe(400);
    const step = stepNow();
    const on = await u.api.post('/auth/mfa/enable', { code: codeAt(setup.secret, step) });
    expect(on.statusCode).toBe(200);
    const recovery: string[] = on.json().recoveryCodes;
    expect(recovery).toHaveLength(8);
    expect((await u.api.get('/auth/mfa')).json()).toMatchObject({
      enabled: true,
      recoveryCodesLeft: 8,
    });
    // Secret and recovery codes are never stored in the clear.
    const row = (
      await h.db.owner.query(
        `SELECT totp_secret, recovery_hashes FROM local_credential WHERE user_id = $1`,
        [u.userId],
      )
    ).rows[0];
    expect(row.totp_secret).not.toContain(setup.secret);
    expect(JSON.stringify(row.recovery_hashes)).not.toContain(recovery[0]);

    // Password alone is now a prompt, not a session.
    const bare = await login(email, PW);
    expect(bare.statusCode).toBe(401);
    expect(bare.json().code).toBe('mfa_required');
    // The code used to enrol cannot be replayed; the next step's code works once.
    expect((await login(email, PW, codeAt(setup.secret, step))).statusCode).toBe(401);
    const next = codeAt(setup.secret, step + 1);
    expect((await login(email, PW, next)).statusCode).toBe(200);
    expect((await login(email, PW, next)).statusCode).toBe(401);
    // A recovery code works once.
    expect((await login(email, PW, recovery[0])).statusCode).toBe(200);
    expect((await login(email, PW, recovery[0])).statusCode).toBe(401);
    expect((await u.api.get('/auth/mfa')).json().recoveryCodesLeft).toBe(7);

    // Turning it off needs the password; an administrator can reset it for someone who lost the phone.
    expect(
      (await u.api.post('/auth/mfa/disable', { password: 'wrong-password-123' })).statusCode,
    ).toBe(401);
    expect((await h.admin.post(`/admin/users/${u.userId}/mfa-reset`)).statusCode).toBe(200);
    expect((await login(email, PW)).statusCode).toBe(200);
    const users = (await h.admin.get('/admin/users')).json() as { email: string; mfa: boolean }[];
    expect(users.find((x) => x.email === email)!.mfa).toBe(false);
    const log = (
      await h.db.owner.query(
        `SELECT action FROM audit_event WHERE action LIKE 'auth.mfa%' ORDER BY seq`,
      )
    ).rows.map((r: { action: string }) => r.action);
    expect(log).toEqual(['auth.mfa_enabled', 'auth.mfa_recovery_used', 'auth.mfa_reset']);
  });

  it('wrong second-step codes count towards the lockout like wrong passwords', async () => {
    const email = 'mfa-lock@azerconnect.test';
    const u = await h.recruiter(email);
    const PW = 'A-much-longer-secret-1';
    const s = (await u.api.post('/auth/mfa/setup')).json();
    await u.api.post('/auth/mfa/enable', { code: codeAt(s.secret, stepNow()) });
    for (let i = 0; i < 5; i++) expect((await login(email, PW, '123456')).statusCode).toBe(401);
    const good = codeAt(s.secret, stepNow() + 1);
    expect((await login(email, PW, good)).statusCode).toBe(401); // locked
  });

  it('only the administrator can reset', async () => {
    const a = await h.recruiter('mfa-a@azerconnect.test');
    const b = await h.recruiter('mfa-b@azerconnect.test');
    expect((await a.api.post(`/admin/users/${b.userId}/mfa-reset`)).statusCode).toBe(403);
  });
});
