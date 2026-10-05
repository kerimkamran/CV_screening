#!/usr/bin/env node
// Container entrypoint for the single-service deploy (Render): migrate, set up the least-privilege
// database login if the host allows it, then start the API as PID-child with signals forwarded.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// 1. Migrations run as the database owner.
const mig = spawnSync(process.execPath, [join(here, 'migrate.mjs'), 'up'], {
  stdio: 'inherit',
  env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
});
if (mig.status !== 0) {
  console.error('migrations failed; not starting');
  process.exit(mig.status ?? 1);
}

// 2. Least privilege: the API should not run as the schema owner. If the host lets us create a
//    role, create `cv_api` (member of cv_app: no UPDATE/DELETE on the audit trail). If not, say so.
let appUrl = ownerUrl;
const pw = process.env.APP_DB_PASSWORD;
if (pw && pw.length >= 16 && !pw.includes('\u0000')) {
  const client = new pg.Client({ connectionString: ownerUrl });
  try {
    await client.connect();
    const lit = `'${pw.replace(/'/g, "''")}'`;
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cv_api') THEN
        CREATE ROLE cv_api LOGIN PASSWORD ${lit} IN ROLE cv_app;
      ELSE
        ALTER ROLE cv_api PASSWORD ${lit};
      END IF; END $$;`);
    const u = new URL(ownerUrl);
    u.username = 'cv_api';
    u.password = pw;
    appUrl = u.toString();
    console.log('API will connect as least-privilege role cv_api');
  } catch (e) {
    console.warn(
      `WARNING: could not create the least-privilege role (${e.message}). The API will connect as the database owner: audit tables remain append-only by trigger, but the grant-based protection is not in force.`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
} else {
  console.warn('WARNING: APP_DB_PASSWORD not set; the API will connect as the database owner.');
}

// 3. Run the API.
const child = spawn(process.execPath, [join(here, '..', 'apps', 'api', 'dist', 'main.js')], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: appUrl },
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
