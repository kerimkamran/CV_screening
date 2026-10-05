import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';

/** Needs a Postgres superuser URL. Absent locally → integration suites skip; in CI it is mandatory. */
export const adminUrl = process.env.MIGRATION_DATABASE_URL;
if (!adminUrl && process.env.CI) throw new Error('MIGRATION_DATABASE_URL is required in CI');
export const describeDb = adminUrl ? describe : describe.skip;

const withDb = (url: string, db: string, user?: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = 'it';
  }
  return u.toString();
};

/**
 * A throwaway, fully migrated database plus an API login role that is a member of cv_app, the
 * same least-privilege shape as production. A missing GRANT in a migration fails here.
 */
export async function createDb(tag: string) {
  // Suites mutate process.env to configure the app; restore it so later suites start clean.
  const envBefore = { ...process.env };
  const dbName = `cv_${tag}_${process.pid}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  const exists = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname='cv_api_it'`);
  if (!exists.rowCount) await admin.query(`CREATE ROLE cv_api_it LOGIN PASSWORD 'it'`);
  await admin.end();

  const ownerUrl = withDb(adminUrl!, dbName);
  execFileSync('node', [join(__dirname, '../../../../scripts/migrate.mjs'), 'up'], {
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
    stdio: 'pipe',
  });
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query(`GRANT cv_app TO cv_api_it`);

  return {
    owner,
    apiUrl: withDb(adminUrl!, dbName, 'cv_api_it'),
    async drop() {
      for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k];
      Object.assign(process.env, envBefore);
      await owner.end();
      const a = new Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await a.end();
    },
  };
}
