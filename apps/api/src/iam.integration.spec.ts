/**
 * IAM-03/04/05 against a real, freshly migrated Postgres. The API connects as a login role that
 * is a member of cv_app — the same least-privilege shape as production — so a missing GRANT in a
 * migration fails here rather than in staging.
 * Needs MIGRATION_DATABASE_URL (a superuser). Skipped locally if absent; mandatory in CI.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { newId } from '@cv/shared';
import { Client } from 'pg';
import { createAdapter } from './app.factory';
import { AppModule } from './app.module';
import { KEY_RESOLVER } from './auth/token-verifier';
import { createTestIdp } from './testing/idp';

const ISSUER = 'https://idp.test/';
const AUDIENCE = 'api://cv-screening';
const ADMIN_SUB = 'bootstrap-admin';
const adminUrl = process.env.MIGRATION_DATABASE_URL;
if (!adminUrl && process.env.CI) throw new Error('MIGRATION_DATABASE_URL is required in CI');
const d = adminUrl ? describe : describe.skip;

const withDb = (url: string, db: string, user?: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = 'it';
  }
  return u.toString();
};

d('IAM against Postgres', () => {
  const dbName = `cv_it_${process.pid}`;
  let app: NestFastifyApplication;
  let owner: Client;
  let idp: Awaited<ReturnType<typeof createTestIdp>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const exists = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname='cv_api_it'`);
    if (!exists.rowCount) await admin.query(`CREATE ROLE cv_api_it LOGIN PASSWORD 'it'`);
    await admin.end();

    const ownerUrl = withDb(adminUrl!, dbName);
    execFileSync('node', [join(__dirname, '../../../scripts/migrate.mjs'), 'up'], {
      env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
      stdio: 'pipe',
    });
    owner = new Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query(`GRANT cv_app TO cv_api_it`);

    Object.assign(process.env, {
      DATABASE_URL: withDb(adminUrl!, dbName, 'cv_api_it'),
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
      OIDC_JWKS_URI: 'https://idp.test/jwks',
      BOOTSTRAP_ADMIN_SUBJECT: ADMIN_SUB,
      LOG_LEVEL: 'silent',
    });
    idp = await createTestIdp(ISSUER, AUDIENCE);
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KEY_RESOLVER)
      .useValue(idp.resolver)
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(createAdapter('silent'));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  const call = async (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    sub: string,
    opts: { body?: unknown; app?: boolean; claims?: Record<string, unknown> } = {},
  ) => {
    const token = await idp.sign(sub, {
      claims: { ...(opts.app ? { idtyp: 'app' } : {}), ...opts.claims },
    });
    return app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
  };
  const idOf = async (sub: string, opts?: { app?: boolean }) =>
    (ids[sub] ??= (await call('GET', '/me', sub, opts)).json().userId);
  const grant = (target: string, role: string, by = ADMIN_SUB) =>
    call('POST', `/admin/users/${ids[target]}/roles`, by, { body: { role } });

  it('provisions a new user with no roles; nothing is visible until granted (IAM-03)', async () => {
    const me = await call('GET', '/me', 'nobody');
    expect(me.statusCode).toBe(200);
    expect(me.json().roles).toEqual([]);
    await idOf('nobody');
    for (const url of ['/vacancies', '/admin/users']) {
      expect((await call('GET', url, 'nobody')).statusCode).toBe(403);
    }
  });

  it('records denied attempts with principal and resource in the audit trail (IAM-03/05)', async () => {
    const { rows } = await owner.query(
      `SELECT actor_id, action, after FROM audit_event WHERE action='access.denied' AND actor_id=$1`,
      [ids['nobody']],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((r) => r.after.resource)).toEqual(
      expect.arrayContaining(['/vacancies', '/admin/users']),
    );
  });

  it('bootstraps the first ADMIN only for the configured subject, and audits it', async () => {
    expect((await call('GET', '/me', ADMIN_SUB)).json().roles).toEqual(['ADMIN']);
    await idOf(ADMIN_SUB);
    const { rows } = await owner.query(
      `SELECT actor_id FROM audit_event WHERE action='role.bootstrap'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(ids[ADMIN_SUB]);
  });

  it('ignores role claims in tokens', async () => {
    const res = await call('GET', '/admin/users', 'claims-only', { claims: { roles: ['ADMIN'] } });
    expect(res.statusCode).toBe(403);
  });

  it('lets an ADMIN grant roles, audited with the admin as actor', async () => {
    await idOf('partner');
    await idOf('lead');
    const res = await grant('partner', 'TA_PARTNER');
    expect(res.statusCode).toBe(201);
    expect(res.json().changed).toBe(true);
    expect((await grant('partner', 'TA_PARTNER')).json().changed).toBe(false); // idempotent
    expect((await grant('lead', 'TA_LEAD')).statusCode).toBe(201);
    const { rows } = await owner.query(
      `SELECT actor_id, actor_role FROM audit_event WHERE action='role.grant' AND after->>'userId'=$1`,
      [ids['partner']],
    );
    expect(rows).toHaveLength(1); // the idempotent repeat wrote nothing
    expect(rows[0]).toMatchObject({ actor_id: ids[ADMIN_SUB], actor_role: 'ADMIN' });
  });

  it('refuses admin endpoints to non-admins, and validates input without echoing it', async () => {
    expect((await call('GET', '/admin/users', 'partner')).statusCode).toBe(403);
    const bad = await call('POST', `/admin/users/${ids['partner']}/roles`, ADMIN_SUB, {
      body: { role: 'ROOT-secret' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain('ROOT-secret');
    expect(
      (await call('POST', '/admin/users/not-a-ulid/roles', ADMIN_SUB, { body: { role: 'ADMIN' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('POST', `/admin/users/${newId()}/roles`, ADMIN_SUB, { body: { role: 'ADMIN' } }))
        .statusCode,
    ).toBe(404);
  });

  describe('per-vacancy scope (IAM-04)', () => {
    let v1: string;
    let v2: string;
    beforeAll(async () => {
      await owner.query(`INSERT INTO organization (id, name) VALUES ($1,'Azerconnect')`, [
        (ids['org'] = newId()),
      ]);
      v1 = newId();
      v2 = newId();
      for (const [id, title] of [
        [v1, 'BPO agent'],
        [v2, 'Oracle HCM lead'],
      ]) {
        await owner.query(
          `INSERT INTO vacancy (id, org_id, title, created_by) VALUES ($1,$2,$3,$4)`,
          [id, ids['org'], title, ids[ADMIN_SUB]],
        );
      }
    });

    it('a recruiter with no vacancy grant sees none', async () => {
      expect((await call('GET', '/vacancies', 'partner')).json()).toEqual([]);
      expect((await call('GET', `/vacancies/${v1}`, 'partner')).statusCode).toBe(404);
    });

    it('only a TA_LEAD can grant vacancy access; the recruiter then sees exactly that vacancy', async () => {
      const body = { userId: ids['partner'] };
      expect((await call('POST', `/vacancies/${v1}/access`, 'partner', { body })).statusCode).toBe(
        403,
      );
      expect((await call('POST', `/vacancies/${v1}/access`, 'lead', { body })).statusCode).toBe(
        201,
      );
      const list = (await call('GET', '/vacancies', 'partner')).json();
      expect(list.map((v: { id: string }) => v.id)).toEqual([v1]);
      expect((await call('GET', `/vacancies/${v1}`, 'partner')).statusCode).toBe(200);
      // Out of scope → 404, never 403: existence is not disclosed.
      expect((await call('GET', `/vacancies/${v2}`, 'partner')).statusCode).toBe(404);
    });

    it('a lead sees every vacancy; revocation takes effect immediately and is audited', async () => {
      expect((await call('GET', '/vacancies', 'lead')).json()).toHaveLength(2);
      expect(
        (await call('DELETE', `/vacancies/${v1}/access/${ids['partner']}`, 'lead')).statusCode,
      ).toBe(200);
      expect((await call('GET', '/vacancies', 'partner')).json()).toEqual([]);
      const { rows } = await owner.query(
        `SELECT action FROM audit_event WHERE entity_id=$1 AND action LIKE 'vacancy_access.%' ORDER BY seq`,
        [v1],
      );
      expect(rows.map((r) => r.action)).toEqual(['vacancy_access.grant', 'vacancy_access.revoke']);
    });
  });

  it('keeps service principals and human roles apart (least privilege)', async () => {
    await idOf('worker', { app: true });
    expect((await grant('worker', 'TA_PARTNER')).statusCode).toBe(400);
    expect((await grant('worker', 'SERVICE')).statusCode).toBe(201);
    expect((await grant('partner', 'SERVICE')).statusCode).toBe(400);
    const me = (await call('GET', '/me', 'worker', { app: true })).json();
    expect(me).toMatchObject({ actorType: 'service', roles: ['SERVICE'] });
  });

  it('refuses an identity whose token kind changes (human ↔ app)', async () => {
    expect((await call('GET', '/me', 'partner', { app: true })).statusCode).toBe(401);
  });

  it('refuses disabled users', async () => {
    await idOf('leaver');
    await owner.query(`UPDATE app_user SET status='disabled' WHERE id=$1`, [ids['leaver']]);
    expect((await call('GET', '/me', 'leaver')).statusCode).toBe(401);
  });

  it('revokes roles with immediate effect, and never the last ADMIN', async () => {
    expect(
      (await call('DELETE', `/admin/users/${ids['partner']}/roles/TA_PARTNER`, ADMIN_SUB))
        .statusCode,
    ).toBe(200);
    expect((await call('GET', '/vacancies', 'partner')).statusCode).toBe(403);
    expect(
      (await call('DELETE', `/admin/users/${ids[ADMIN_SUB]}/roles/ADMIN`, ADMIN_SUB)).statusCode,
    ).toBe(409);
    expect(
      (await call('DELETE', `/admin/users/${ids['partner']}/roles/TA_PARTNER`, ADMIN_SUB))
        .statusCode,
    ).toBe(404);
  });

  it('lists users with their active roles', async () => {
    const users = (await call('GET', '/admin/users', ADMIN_SUB)).json();
    const lead = users.find((u: { id: string }) => u.id === ids['lead']);
    expect(lead.roles).toEqual(['TA_LEAD']);
  });

  it('leaves an intact audit chain after all of the above (including concurrent API writes)', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => call('GET', '/admin/users', `denied-${i}`)),
    );
    const { rows } = await owner.query(`SELECT audit_event_verify_chain() AS bad`);
    expect(rows[0].bad).toBeNull();
  });
});
