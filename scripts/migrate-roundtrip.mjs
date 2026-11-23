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
  // 0042 down keeps external_ref; up again marks the vacancy as an Oracle link (S3-INT-06 (4)).
  await client.query(`INSERT INTO organization (id, name) VALUES ($1, 'Seed2')`, [ID(711)]);
  await client.query(
    `INSERT INTO vacancy (id, org_id, title, created_by, external_ref, external_system, external_link_state)
     VALUES ($1,$2,'Linked',$3,'REQ-42','oracle_hcm','approved')`,
    [ID(712), ID(711), ID(702)],
  );
  // 0043 first (the assertion key column), then 0042.
  await down(client, { steps: 1 }, quiet);
  assert.equal(
    (
      await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'integration_connection' AND column_name = 'assertion_key_ciphertext'`,
      )
    ).rowCount,
    0,
  );
  console.log('  ok  0043 down drops the assertion key column');
  await down(client, { steps: 1 }, quiet);
  assert.equal(
    (await client.query(`SELECT external_ref FROM vacancy WHERE id = $1`, [ID(712)])).rows[0]
      .external_ref,
    'REQ-42',
  );
  await up(client, {}, quiet);
  const linked = (
    await client.query(`SELECT external_system, external_link_state FROM vacancy WHERE id = $1`, [
      ID(712),
    ])
  ).rows[0];
  assert.deepEqual(linked, { external_system: 'oracle_hcm', external_link_state: 'approved' });
  const valid = (
    await client.query(
      `SELECT convalidated FROM pg_constraint WHERE conname = 'vacancy_external_complete'`,
    )
  ).rows[0];
  assert.equal(valid.convalidated, true);
  console.log('  ok  a linked vacancy survives one step down and up (0042)');
  // 0041 down refuses while a tombstone exists, unless the operator says so on purpose (S3-INT-01 (7)).
  await client.query(
    `INSERT INTO import_tombstone (id, system, key_kind, key_hash, key_version, cause) VALUES ($1,'oracle_hcm','application',$2,1,'erase')`,
    [ID(713), '7'.repeat(64)],
  );
  await assert.rejects(down(client, { steps: 3 }, quiet), /import_tombstone holds rows/);
  console.log('  ok  0041 down refuses while the tombstone list holds a row');
  await client.query(`SET parallax.allow_tombstone_drop = 'on'`);
  await down(client, { steps: 1 }, quiet); // 0043 and 0042 already stepped down before the refusal
  await client.query(`RESET parallax.allow_tombstone_drop`);
  await up(client, {}, quiet);
  await client.query(
    `UPDATE vacancy SET external_ref = NULL, external_system = NULL, external_link_state = NULL WHERE id = $1`,
    [ID(712)],
  );
  await client.query(`DELETE FROM vacancy WHERE id = $1`, [ID(712)]);
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

  // 0041 (S3-INT-01): batch source, one active run per vacancy, unique items, append-only tombstones.
  assert.equal(
    (await client.query(`SELECT source FROM upload_batch WHERE id = $1`, [ID(40)])).rows[0].source,
    'browser',
  );
  console.log('  ok  an existing batch reads source browser');
  await expectReject(
    client,
    `UPDATE upload_batch SET source = 'x' WHERE id = $1`,
    [ID(40)],
    /upload_batch_source_ck/,
    'batch source x rejected',
  );
  const run = (id, state = 'queued') =>
    client.query(
      `INSERT INTO import_run (id, vacancy_id, mode, state, started_by, finished_at)
       VALUES ($1,$2,'import',$3,$4, CASE WHEN $3 IN ('completed','failed','cancelled') THEN now() END)`,
      [ID(id), ID(2), state, ID(9)],
    );
  await run(41);
  await expectReject(
    client,
    `INSERT INTO import_run (id, vacancy_id, mode, state, started_by)
     VALUES ($1,$2,'refresh','running',$3)`,
    [ID(42), ID(2), ID(9)],
    /import_run_one_active_uq/,
    'a second active import run for one vacancy rejected',
  );
  await client.query(
    `UPDATE import_run SET state = 'completed', finished_at = now() WHERE id = $1`,
    [ID(41)],
  );
  await run(43);
  console.log('  ok  a new run is accepted once the first is completed');
  for (const [col, val] of [
    ['state', 'paused'],
    ['phase', 'x'],
    ['mode', 'x'],
  ])
    await expectReject(
      client,
      `UPDATE import_run SET ${col} = $2 WHERE id = $1`,
      [ID(43), val],
      /check constraint/,
      `import_run unknown ${col} rejected`,
    );
  await client.query(
    `UPDATE import_run SET wait_reason = 'anything', error_code = 'any_code' WHERE id = $1`,
    [ID(43)],
  );
  console.log('  ok  wait_reason and error_code take any text');
  const h = (c) => c.repeat(64);
  const item = (id) =>
    client.query(
      `INSERT INTO import_item (id, run_id, vacancy_id, seq, app_key_hash, att_key_hash, person_key_hash, key_version)
       VALUES ($1,$2,$3,1,$4,$5,$6,1)`,
      [ID(id), ID(43), ID(2), h('a'), h('b'), h('c')],
    );
  await item(44);
  await expectReject(
    client,
    `INSERT INTO import_item (id, run_id, vacancy_id, seq, app_key_hash, att_key_hash, person_key_hash, key_version)
       VALUES ($1,$2,$3,2,$4,$5,$6,1)`,
    [ID(45), ID(43), ID(2), h('a'), h('d'), h('e')],
    /import_item_run_id_app_key_hash_key/,
    'two import items with one application hash rejected',
  );
  const tomb = (id, hash) =>
    client.query(
      `INSERT INTO import_tombstone (id, system, key_kind, key_hash, key_version, vacancy_id, cause)
       VALUES ($1,'oracle_hcm','application',$2,1,$3,'erase')`,
      [ID(id), hash, ID(2)],
    );
  await tomb(46, h('f'));
  await expectReject(
    client,
    `UPDATE import_tombstone SET cause = 'purge'`,
    [],
    /append-only/,
    'tombstone UPDATE rejected',
  );
  await expectReject(
    client,
    `DELETE FROM import_tombstone`,
    [],
    /append-only/,
    'tombstone DELETE rejected',
  );
  await expectReject(
    client,
    `TRUNCATE import_tombstone`,
    [],
    /append-only/,
    'tombstone TRUNCATE rejected',
  );
  await expectReject(
    client,
    `INSERT INTO import_tombstone (id, system, key_kind, key_hash, key_version, cause)
       VALUES ($1,'oracle_hcm','person_requisition',$2,2,'purge')`,
    [ID(47), h('f')],
    /import_tombstone_system_key_hash_key/,
    'a second tombstone with the same hash rejected',
  );
  await expectReject(
    client,
    `INSERT INTO import_tombstone (id, system, key_kind, key_hash, key_version, cause)
       VALUES ($1,'oracle_hcm','application',$2,1,'forgotten')`,
    [ID(48), h('9')],
    /check constraint/,
    'tombstone unknown cause rejected',
  );

  // 0042 (S3-INT-06): one connection per system; a link always names its system.
  const conn = (id) =>
    client.query(
      `INSERT INTO integration_connection (id, system, base_url, principal_name) VALUES ($1,'oracle_hcm','https://x.fa.em2.oraclecloud.com','u')`,
      [ID(id)],
    );
  await conn(50);
  const c50 = (
    await client.query(
      `SELECT auth_mode, calls_used, budget_day, secret_expires_on FROM integration_connection WHERE id = $1`,
      [ID(50)],
    )
  ).rows[0];
  assert.deepEqual(c50, {
    auth_mode: 'basic',
    calls_used: 0,
    budget_day: null,
    secret_expires_on: null,
  });
  console.log('  ok  a connection defaults to basic sign-in and an empty budget');
  await expectReject(
    client,
    `INSERT INTO integration_connection (id, system, base_url, principal_name) VALUES ($1,'oracle_hcm','https://y.oraclecloud.com','v')`,
    [ID(51)],
    /integration_connection_system_key/,
    'a second Oracle connection rejected',
  );
  await expectReject(
    client,
    `UPDATE integration_connection SET auth_mode = 'saml' WHERE id = $1`,
    [ID(50)],
    /check constraint/,
    'unknown sign-in method rejected',
  );
  await expectReject(
    client,
    `UPDATE vacancy SET external_ref = 'R1' WHERE id = $1`,
    [ID(2)],
    /vacancy_external_complete/,
    'a vacancy key without its system rejected',
  );
  await client.query(
    `UPDATE vacancy SET external_ref = 'R1', external_system = 'oracle_hcm', external_link_state = 'approved' WHERE id = $1`,
    [ID(2)],
  );
  await expectReject(
    client,
    `UPDATE vacancy SET external_link_state = 'maybe' WHERE id = $1`,
    [ID(2)],
    /check constraint/,
    'unknown link state rejected',
  );
  console.log('  ok  a vacancy linked with its system is accepted');

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
  await expectReject(
    client,
    `UPDATE import_tombstone SET cause = 'purge'`,
    [],
    /permission denied/,
    'cv_app has no UPDATE on import_tombstone',
  );
  await expectReject(
    client,
    `DELETE FROM import_tombstone`,
    [],
    /permission denied/,
    'cv_app has no DELETE on import_tombstone',
  );
  await client.query(`UPDATE import_run SET listed = 1 WHERE id = $1`, [ID(43)]);
  await client.query(`UPDATE import_item SET attempts = 1 WHERE id = $1`, [ID(44)]);
  await client.query(`UPDATE integration_connection SET calls_used = 1 WHERE id = $1`, [ID(50)]);
  console.log('  ok  cv_app may read, add and update runs, items and the connection');
  await expectReject(
    client,
    `DELETE FROM import_item`,
    [],
    /permission denied/,
    'cv_app has no DELETE on import_item',
  );
  await expectReject(
    client,
    `DELETE FROM import_run`,
    [],
    /permission denied/,
    'cv_app has no DELETE on import_run',
  );
  await expectReject(
    client,
    `DELETE FROM integration_connection`,
    [],
    /permission denied/,
    'cv_app has no DELETE on integration_connection',
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
