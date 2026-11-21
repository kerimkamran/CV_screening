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

  // Stage 3 (0040): the newest migration steps down and up again on its own, and its columns go.
  const cols = async (table, names) =>
    (
      await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = ANY($2)`,
        [table, names],
      )
    ).rows.map((r) => r.column_name);
  const after0039 = Number(
    (await client.query(`SELECT count(*) AS n FROM schema_migrations WHERE id >= '0040'`)).rows[0]
      .n,
  );
  await down(client, { steps: after0039 }, quiet);
  assert.deepEqual(await cols('cv_document', ['erased_name_sha']), []);
  assert.deepEqual(await cols('upload_batch', ['cancelled_at', 'cancelled_by']), []);
  // A CV erased before 0040 keeps its name until the up file scrubs it (S3-UP-04, backfill).
  await client.query(`INSERT INTO organization (id, name) VALUES ($1, 'Seed')`, [ID(701)]);
  await client.query(
    `INSERT INTO app_user (id, issuer, subject, actor_kind) VALUES ($1,'https://idp.test/','seed','human')`,
    [ID(702)],
  );
  await client.query(
    `INSERT INTO vacancy (id, org_id, title, created_by) VALUES ($1,$2,'Seed',$3)`,
    [ID(703), ID(701), ID(702)],
  );
  await client.query(
    `INSERT INTO cv_document (id, vacancy_id, filename, mime, size_bytes, sha256, uploaded_by, erased_at, parse_status)
     VALUES ($1,$2,'Leyla_Aliyeva.pdf','application/pdf',1,$3,$4, now(), 'parsed')`,
    [ID(704), ID(703), 'a'.repeat(64), ID(702)],
  );
  await client.query(
    `INSERT INTO upload_batch (id, vacancy_id, created_by, file_count) VALUES ($1,$2,$3,1)`,
    [ID(705), ID(703), ID(702)],
  );
  await client.query(
    `INSERT INTO upload_item (id, batch_id, position, filename, client_path, size_bytes, outcome, document_id)
     VALUES ($1,$2,0,'Leyla_Aliyeva.pdf','cvs/Leyla_Aliyeva.pdf',1,'queued',$3)`,
    [ID(706), ID(705), ID(704)],
  );
  await up(client, {}, quiet);
  const seeded = (
    await client.query(`SELECT filename, erased_name_sha FROM cv_document WHERE id = $1`, [ID(704)])
  ).rows[0];
  assert.equal(seeded.filename, 'erased');
  assert.match(seeded.erased_name_sha, /^[0-9a-f]{64}$/);
  const seededItem = (
    await client.query(`SELECT filename, client_path FROM upload_item WHERE id = $1`, [ID(706)])
  ).rows[0];
  assert.deepEqual(seededItem, { filename: 'erased', client_path: null });
  await client.query(`DELETE FROM upload_item WHERE id = $1`, [ID(706)]);
  await client.query(`DELETE FROM upload_batch WHERE id = $1`, [ID(705)]);
  await client.query(`DELETE FROM cv_document WHERE id = $1`, [ID(704)]);
  await client.query(`DELETE FROM vacancy WHERE id = $1`, [ID(703)]);
  console.log('  ok  0040 backfill scrubs the name of a CV erased before it');
  console.log(`  ok  Stage 3 migrations step down (${after0039}) and up again; 0040 columns go`);
  assert.equal((await cols('upload_batch', ['cancelled_at', 'cancelled_by'])).length, 2);

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

  // 0040: a cancelled batch always says who cancelled it.
  await client.query(
    `INSERT INTO upload_batch (id, vacancy_id, created_by, file_count) VALUES ($1,$2,$3,1)`,
    [ID(40), ID(2), ID(9)],
  );
  await expectReject(
    client,
    `UPDATE upload_batch SET cancelled_at = now() WHERE id = $1`,
    [ID(40)],
    /upload_batch_cancel_complete/,
    'batch cancelled_at without cancelled_by rejected',
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
