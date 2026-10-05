#!/usr/bin/env node
// PLAT-02 / PLAT-03 acceptance: migrations apply, roll back to empty, re-apply, and the
// database-enforced invariants actually hold. Runs against a throwaway database it creates
// from DATABASE_URL (which must point at a server where the role may CREATE DATABASE).
import assert from 'node:assert/strict';
import pg from 'pg';
import { down, up } from './migrate.mjs';

const base = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!base) throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is required');
const dbName = `cv_roundtrip_${process.pid}`;
const admin = new pg.Client({ connectionString: base });
const withDb = (name) => {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
};

const ID = (n) => String(n).padStart(26, '0'); // valid ULID shape for fixtures
const quiet = () => {};

async function expectReject(client, sql, params, pattern, label) {
  await client.query('SAVEPOINT s');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT s');
    assert.match(err.message, pattern, `${label}: wrong error: ${err.message}`);
    console.log(`  ok  ${label}`);
    return;
  }
  throw new Error(`${label}: expected rejection but statement succeeded`);
}

async function tables(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`,
  );
  return rows.map((r) => r.table_name);
}

await admin.connect();
await admin.query(`CREATE DATABASE ${dbName}`);
const client = new pg.Client({ connectionString: withDb(dbName) });
try {
  await client.connect();

  console.log('apply all');
  await up(client, {}, quiet);
  const full = await tables(client);
  for (const t of [
    'organization',
    'vacancy',
    'job_description_version',
    'requirement_set',
    'requirement',
    'audit_event',
  ])
    assert.ok(full.includes(t), `missing table ${t}`);

  console.log('rollback to empty');
  await down(client, { steps: Infinity }, quiet);
  assert.deepEqual(
    await tables(client),
    ['schema_migrations'],
    'rollback must leave only schema_migrations',
  );

  console.log('re-apply');
  await up(client, {}, quiet);
  assert.deepEqual(await tables(client), full);

  console.log('invariants');
  await client.query('BEGIN');
  await client.query(`INSERT INTO organization (id, name) VALUES ($1, 'Azerconnect')`, [ID(1)]);
  await client.query(
    `INSERT INTO app_user (id, issuer, subject, actor_kind) VALUES ($1,'https://idp.test/','u9','human')`,
    [ID(9)],
  );
  await client.query(
    `INSERT INTO vacancy (id, org_id, title, created_by) VALUES ($1,$2,'BPO agent',$3)`,
    [ID(2), ID(1), ID(9)],
  );
  await client.query(
    `INSERT INTO job_description_version (id, vacancy_id, version, body, source_kind, created_by)
                      VALUES ($1,$2,1,'jd','pasted',$3)`,
    [ID(3), ID(2), ID(9)],
  );
  await client.query(
    `INSERT INTO requirement_set (id, vacancy_id, version, jd_version_id, created_by)
                      VALUES ($1,$2,1,$3,$4)`,
    [ID(4), ID(2), ID(3), ID(9)],
  );

  await expectReject(
    client,
    `INSERT INTO organization (id, name) VALUES ('not-a-ulid','x')`,
    [],
    /ulid|check/i,
    'malformed ID rejected by domain',
  );
  await expectReject(
    client,
    `INSERT INTO requirement (id, requirement_set_id, text, classification, weight) VALUES ($1,$2,'must hold licence','disqualifier',10)`,
    [ID(5), ID(4)],
    /disqualifier_has_no_weight/,
    'disqualifier cannot carry a weight',
  );

  await client.query(
    `INSERT INTO requirement (id, requirement_set_id, text, classification, weight)
                      VALUES ($1,$2,'5+ years HR technology','mandatory',NULL)`,
    [ID(6), ID(4)],
  );
  await client.query(`UPDATE requirement_set SET frozen_at = now() WHERE id = $1`, [ID(4)]);
  await expectReject(
    client,
    `UPDATE requirement SET text='edited' WHERE id=$1`,
    [ID(6)],
    /frozen/,
    'frozen requirement cannot be edited (JOB-07)',
  );
  await expectReject(
    client,
    `DELETE FROM requirement WHERE id=$1`,
    [ID(6)],
    /frozen/,
    'frozen requirement cannot be deleted',
  );
  await expectReject(
    client,
    `INSERT INTO requirement (id, requirement_set_id, text, classification) VALUES ($1,$2,'late addition','preferred')`,
    [ID(7), ID(4)],
    /frozen/,
    'frozen set cannot gain requirements',
  );
  await expectReject(
    client,
    `UPDATE requirement_set SET frozen_at = NULL WHERE id=$1`,
    [ID(4)],
    /frozen/,
    'frozen set cannot be un-frozen',
  );

  for (let i = 0; i < 3; i++) {
    await client.query(
      `INSERT INTO audit_event (id, actor_id, actor_type, action, entity_type, entity_id, after)
       VALUES ($1,$2,'human','vacancy.create','vacancy',$3,$4)`,
      [ID(100 + i), ID(9), ID(2), JSON.stringify({ n: i })],
    );
  }
  const chain = await client.query(`SELECT seq, prev_hash, hash FROM audit_event ORDER BY seq`);
  assert.equal(chain.rows[0].prev_hash, '0'.repeat(64), 'genesis prev_hash');
  assert.equal(chain.rows[1].prev_hash, chain.rows[0].hash, 'rows are hash-linked');
  assert.equal(chain.rows[2].prev_hash, chain.rows[1].hash, 'rows are hash-linked');
  assert.equal(
    (await client.query('SELECT audit_event_verify_chain() AS bad')).rows[0].bad,
    null,
    'chain verifies',
  );
  console.log('  ok  audit chain links and verifies');

  await expectReject(
    client,
    `UPDATE audit_event SET action='tampered'`,
    [],
    /append-only/,
    'audit UPDATE rejected',
  );
  await expectReject(client, `DELETE FROM audit_event`, [], /append-only/, 'audit DELETE rejected');
  await expectReject(client, `TRUNCATE audit_event`, [], /append-only/, 'audit TRUNCATE rejected');
  await expectReject(
    client,
    `INSERT INTO audit_event (id, actor_id, actor_type, action, entity_type, entity_id)
                              VALUES ($1, NULL, 'human','x','y',$2)`,
    [ID(200), ID(2)],
    /null value|not-null/i,
    'audit write rejected without a principal (IAM-05)',
  );

  // Least privilege: as cv_app the same tamper attempts fail at the privilege layer too.
  await client.query('SET LOCAL ROLE cv_app');
  await expectReject(
    client,
    `UPDATE audit_event SET action='x'`,
    [],
    /permission denied/,
    'cv_app has no UPDATE on audit_event',
  );
  await expectReject(
    client,
    `DELETE FROM audit_event`,
    [],
    /permission denied/,
    'cv_app has no DELETE on audit_event',
  );
  await client.query('RESET ROLE');
  await client.query('ROLLBACK');

  // Concurrency: many writers on separate connections must still yield one linear, verifiable chain.
  const writers = await Promise.all(
    Array.from({ length: 6 }, async () => {
      const c = new pg.Client({ connectionString: withDb(dbName) });
      await c.connect();
      return c;
    }),
  );
  await Promise.all(
    writers.map(async (c, w) => {
      for (let i = 0; i < 20; i++) {
        await c.query(
          `INSERT INTO audit_event (id, actor_id, actor_type, action, entity_type, entity_id)
         VALUES ($1,$2,'service','concurrent','organization',$3)`,
          [ID(1000 + w * 100 + i), ID(9), ID(2)],
        );
      }
    }),
  );
  await Promise.all(writers.map((c) => c.end()));
  assert.equal(
    (
      await client.query('SELECT count(*)::int AS n FROM audit_event WHERE action=$1', [
        'concurrent',
      ])
    ).rows[0].n,
    120,
  );
  assert.equal(
    (await client.query('SELECT audit_event_verify_chain() AS bad')).rows[0].bad,
    null,
    'chain verifies after concurrent writes',
  );
  console.log('  ok  120 concurrent audit writes produce one intact chain');

  // Tamper detection: with triggers disabled (superuser), a modified row is detected.
  await client.query(`INSERT INTO organization (id, name) VALUES ($1,'t')`, [ID(300)]);
  await client.query(
    `INSERT INTO audit_event (id, actor_id, actor_type, action, entity_type, entity_id) VALUES ($1,$2,'service','a','organization',$3)`,
    [ID(301), ID(9), ID(300)],
  );
  await client.query(`ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update_delete`);
  await client.query(`UPDATE audit_event SET action='forged' WHERE id=$1`, [ID(301)]);
  await client.query(`ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update_delete`);
  const bad = (await client.query('SELECT audit_event_verify_chain() AS bad')).rows[0].bad;
  assert.notEqual(bad, null, 'forged row must be detected by verify_chain');
  console.log('  ok  forged audit row is detected by verify_chain');

  console.log('\nmigration round-trip: PASS');
} finally {
  await client.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.end();
}
