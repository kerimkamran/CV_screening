#!/usr/bin/env node
// Container entrypoint for the single-service deploy (Render): migrate, set up the least-privilege
// database login if the host allows it, then start the API as PID-child with signals forwarded.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// 0. Word pages (S2-BE7) need LibreOffice. Without it Word CVs still work, shown as text only.
{
  const soffice = process.env.RENDITION_SOFFICE || 'soffice';
  const probe = spawnSync(soffice, ['--version'], { encoding: 'utf8', timeout: 20000 });
  if (process.env.RENDITION_ENABLED === 'false') console.log('Word pages: turned off');
  else if (probe.status === 0) console.log(`Word pages: ${String(probe.stdout).trim()}`);
  else
    console.warn(
      `WARNING: LibreOffice (${soffice}) was not found; Word CVs will be shown as text only.`,
    );
  // The memory limit the guard works against (cgroup v2, then v1).
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    if (!existsSync(f)) continue;
    const r = spawnSync('cat', [f], { encoding: 'utf8' });
    const v = String(r.stdout).trim();
    console.log(`Memory limit: ${/^\d+$/.test(v) ? `${Math.round(Number(v) / 2 ** 20)} MB` : v}`);
    break;
  }
  // Stage 3, S3-OPS-04 (a): the platform facts the gates need, on every boot.
  if (existsSync('/sys/fs/cgroup/cpu.max')) {
    const [quota, period] = String(
      spawnSync('cat', ['/sys/fs/cgroup/cpu.max'], { encoding: 'utf8' }).stdout,
    )
      .trim()
      .split(/\s+/);
    console.log(
      `CPU limit: ${quota === 'max' ? 'none' : (Number(quota) / Number(period)).toFixed(2)}`,
    );
  }
  try {
    const tmp = statfsSync(tmpdir());
    const mounts = existsSync('/proc/mounts') ? readFileSync('/proc/mounts', 'utf8') : '';
    const memBacked = mounts
      .split('\n')
      .some((l) => l.split(' ')[1] === tmpdir() && l.split(' ')[2] === 'tmpfs');
    console.log(
      `Temp folder: ${Math.round((tmp.bavail * tmp.bsize) / 2 ** 20)} MB free, ${memBacked ? 'memory-backed' : 'on disk'}`,
    );
  } catch {
    /* not every platform reports it */
  }
  console.log(`Boot ID: ${randomUUID()}`);
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

// 3. Run the API. Without Docker (a plain Node service) the web build is still served if present.
const webDist = join(here, '..', 'apps', 'web', 'dist');
if (!process.env.WEB_DIST_DIR && existsSync(webDist)) process.env.WEB_DIST_DIR = webDist;
const pdf = spawnSync('pdftotext', ['-v'], { stdio: 'ignore' });
if (pdf.error) {
  console.warn(
    'WARNING: pdftotext (poppler-utils) is not installed here, so PDF CVs cannot be read and will be sent to manual review. Deploy with docker/render.Dockerfile (Runtime: Docker) to fix this.',
  );
}
// Optional first argument: the file to start (the gate launcher, S3-OPS-04). Not a setting.
const entry = process.argv[2]
  ? join(here, '..', process.argv[2])
  : join(here, '..', 'apps', 'api', 'dist', 'main.js');
const child = spawn(process.execPath, [entry], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: appUrl },
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
