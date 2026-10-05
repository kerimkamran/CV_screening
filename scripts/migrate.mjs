#!/usr/bin/env node
// PLAT-02: forward-only-by-default, reversible migrations.
//   node scripts/migrate.mjs up [--to NNNN]
//   node scripts/migrate.mjs down [N | --all]     (default: roll back the most recent migration)
//   node scripts/migrate.mjs status
// Files: db/migrations/NNNN_name.up.sql + NNNN_name.down.sql. Each runs in its own transaction
// and is recorded in schema_migrations with a checksum, so an edited, already-applied migration
// is detected instead of silently diverging between environments.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '..', 'db', 'migrations');

export function listMigrations(dir = MIGRATIONS_DIR) {
  const byId = new Map();
  for (const file of readdirSync(dir).sort()) {
    const m = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/.exec(file);
    if (!m) continue;
    const [, id, name, dir_] = m;
    const entry = byId.get(id) ?? { id, name };
    if (entry.name !== name)
      throw new Error(`Migration ${id} has inconsistent names: ${entry.name} vs ${name}`);
    entry[dir_] = join(dir, file);
    byId.set(id, entry);
  }
  const all = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const mig of all) {
    if (!mig.up || !mig.down)
      throw new Error(`Migration ${mig.id}_${mig.name} must have both .up.sql and .down.sql`);
  }
  return all;
}

const checksum = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function applied(client) {
  const { rows } = await client.query(
    'SELECT id, name, checksum FROM schema_migrations ORDER BY id',
  );
  return rows;
}

async function inTx(client, sql, after) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await after?.();
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function up(client, { to } = {}, log = console.log) {
  await ensureTable(client);
  const done = new Map((await applied(client)).map((r) => [r.id, r]));
  const migrations = listMigrations();
  for (const mig of migrations) {
    const prior = done.get(mig.id);
    if (prior) {
      if (prior.checksum !== checksum(mig.up)) {
        throw new Error(
          `Migration ${mig.id}_${mig.name} was modified after being applied (checksum mismatch)`,
        );
      }
      continue;
    }
    if (to && mig.id > to) break;
    log(`up   ${mig.id}_${mig.name}`);
    await inTx(client, readFileSync(mig.up, 'utf8'), () =>
      client.query('INSERT INTO schema_migrations (id, name, checksum) VALUES ($1, $2, $3)', [
        mig.id,
        mig.name,
        checksum(mig.up),
      ]),
    );
  }
}

export async function down(client, { steps = 1 } = {}, log = console.log) {
  await ensureTable(client);
  const done = await applied(client);
  const byId = new Map(listMigrations().map((m) => [m.id, m]));
  for (const row of done.reverse().slice(0, steps)) {
    const mig = byId.get(row.id);
    if (!mig) throw new Error(`Applied migration ${row.id}_${row.name} has no files on disk`);
    log(`down ${mig.id}_${mig.name}`);
    await inTx(client, readFileSync(mig.down, 'utf8'), () =>
      client.query('DELETE FROM schema_migrations WHERE id = $1', [mig.id]),
    );
  }
}

export async function status(client, log = console.log) {
  await ensureTable(client);
  const done = new Set((await applied(client)).map((r) => r.id));
  for (const mig of listMigrations())
    log(`${done.has(mig.id) ? 'applied' : 'pending'}  ${mig.id}_${mig.name}`);
}

async function main() {
  const [cmd = 'status', ...args] = process.argv.slice(2);
  // Migrations run as the schema owner; the API connects as a least-privilege member of cv_app.
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is required');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (cmd === 'up') {
      const i = args.indexOf('--to');
      await up(client, { to: i >= 0 ? args[i + 1] : undefined });
    } else if (cmd === 'down') {
      const steps = args.includes('--all') ? Infinity : Number(args[0] ?? 1);
      if (!Number.isFinite(steps) && !args.includes('--all'))
        throw new Error('down expects a number or --all');
      await down(client, { steps });
    } else if (cmd === 'status') {
      await status(client);
    } else {
      throw new Error(`Unknown command: ${cmd}`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
