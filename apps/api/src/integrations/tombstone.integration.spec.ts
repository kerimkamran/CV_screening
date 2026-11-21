import { describeDb } from '../testing/pg-harness';
import type { Harness } from '../testing/app-harness';
import {
  bootOracle,
  drainAll,
  makeApps,
  MemorySource,
  readyVacancy,
  runner,
  runRow,
  seedRun,
} from '../testing/oracle-harness';
import { RetentionService } from '../pipeline/retention.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 3, S3-INT-02 (4)-(9): tombstones on erase and purge, the retention clock; and S3-INT-11 (6).
describeDb('tombstones and the retention clock (S3-INT-02)', () => {
  let h: Harness;
  let rec: { userId: string; api: any };
  beforeAll(async () => {
    h = await bootOracle('tombstone');
    rec = await h.recruiter('tomb.rec@azerconnect.test');
  }, 120_000);
  afterAll(async () => h?.close());
  const q = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);

  async function imported(n: number, opts: { applied?: Date } = {}) {
    const vid = await readyVacancy(h, rec.api, `Tomb ${Math.random()}`);
    const apps = makeApps(n);
    if (opts.applied) apps.forEach((a) => (a.appliedAt = opts.applied!));
    const src = new MemorySource(apps);
    runner(h).source = src;
    const rid = await seedRun(h, vid, rec.userId, { estimate: n });
    await drainAll(h);
    const docs = (
      await q(`SELECT document_id FROM import_item WHERE run_id = $1 ORDER BY seq`, [rid])
    ).rows.map((r: any) => r.document_id as string);
    return { vid, rid, docs, src, apps };
  }

  it('erasing an imported CV writes 2 tombstones and clears the raw IDs; a browser CV writes none (4)', async () => {
    const { docs, vid } = await imported(2);
    // Raw IDs are already NULL after the run; put one back to see erase clear it.
    await q(`UPDATE import_item SET external_application_id = 'A-raw' WHERE document_id = $1`, [
      docs[0],
    ]);
    const r = await rec.api.post(`/documents/${docs[0]}/erase`);
    expect(r.json()).toEqual({ erased: true });
    const t = (
      await q(
        `SELECT key_kind, cause FROM import_tombstone WHERE vacancy_id = $1 ORDER BY key_kind`,
        [vid],
      )
    ).rows;
    expect(t).toEqual([
      { key_kind: 'application', cause: 'erase' },
      { key_kind: 'person_requisition', cause: 'erase' },
    ]);
    const it = (
      await q(`SELECT external_application_id FROM import_item WHERE document_id = $1`, [docs[0]])
    ).rows[0];
    expect(it.external_application_id).toBeNull();

    const up = await rec.api.upload(`/vacancies/${vid}/documents`, [
      {
        name: 'b.txt',
        type: 'text/plain',
        data: Buffer.from(`Name: Browser Only\n${'x '.repeat(200)}`),
      },
    ]);
    const before = Number((await q(`SELECT count(*) FROM import_tombstone`)).rows[0].count);
    await rec.api.post(`/documents/${up.json().results[0].documentId}/erase`);
    expect(Number((await q(`SELECT count(*) FROM import_tombstone`)).rows[0].count)).toBe(before);
  });

  it('a later refresh withholds the erased candidate, also for a new application by the same person (S3-INT-11 (6), S3-INT-13 (6))', async () => {
    const { vid, docs, src, apps } = await imported(3);
    await rec.api.post(`/documents/${docs[0]}/erase`);
    // The same person applies again on the same requisition with a new application.
    const again = {
      ...apps[0]!,
      applicationId: 'A-NEW-1',
      attachments: [{ ...apps[0]!.attachments[0]!, attachmentId: 'T-NEW-1' }],
    };
    src.apps = [...apps, again];
    const rid = await seedRun(h, vid, rec.userId, { estimate: 4, mode: 'refresh' });
    await drainAll(h);
    const r = await runRow(h, rid);
    expect(r.stats.withheld).toBe(2);
    expect(r.stats.already).toBe(2);
    expect(r.listed).toBe(0);
  });

  it('erase without a key still writes the 2 rows; a failed copy leaves the CV erased with tombstonePending (6), (7)', async () => {
    const { docs } = await imported(2);
    // The erase path copies stored hashes and computes none (eraseDocumentData takes no key at all).
    expect((await rec.api.post(`/documents/${docs[0]}/erase`)).json()).toEqual({ erased: true });
    const n = (
      await q(
        `SELECT count(*)::int AS n FROM import_tombstone t JOIN import_item i
           ON t.key_hash IN (i.app_key_hash, i.person_key_hash) WHERE i.document_id = $1`,
        [docs[0]],
      )
    ).rows[0].n;
    expect(n).toBe(2);
    await q(
      `CREATE FUNCTION tomb_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced'; END $$`,
    );
    await q(
      `CREATE TRIGGER tomb_fail BEFORE INSERT ON import_tombstone FOR EACH ROW EXECUTE FUNCTION tomb_fail()`,
    );
    try {
      const r = await rec.api.post(`/documents/${docs[1]}/erase`);
      expect(r.json()).toEqual({ erased: true });
      const d = (await q(`SELECT erased_at FROM cv_document WHERE id = $1`, [docs[1]])).rows[0];
      expect(d.erased_at).not.toBeNull();
      const a = (
        await q(
          `SELECT after FROM audit_event WHERE action = 'document.erase' AND entity_id = $1`,
          [docs[1]],
        )
      ).rows[0];
      expect(a.after).toEqual({ tombstonePending: 1 });
    } finally {
      await q(`DROP TRIGGER tomb_fail ON import_tombstone`);
      await q(`DROP FUNCTION tomb_fail()`);
    }
    // A second erase: 409, no new row.
    const before = Number((await q(`SELECT count(*) FROM import_tombstone`)).rows[0].count);
    expect((await rec.api.post(`/documents/${docs[0]}/erase`)).statusCode).toBe(409);
    expect(Number((await q(`SELECT count(*) FROM import_tombstone`)).rows[0].count)).toBe(before);
  });

  it('retention at 180 days: an import today for a 200-day-old application is due, a browser upload today is not (5), (9)', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    const { docs, vid } = await imported(1, { applied: old });
    await rec.api.upload(`/vacancies/${vid}/documents`, [
      {
        name: 'fresh.txt',
        type: 'text/plain',
        data: Buffer.from(`Name: Fresh Upload\n${'y '.repeat(200)}`),
      },
    ]);
    await q(`UPDATE retention_setting SET enabled = true, days = 180 WHERE id = 1`);
    const svc = h.app.get(RetentionService);
    const p = await svc.preview();
    const run = await svc.run('manual', false);
    expect(run.documents).toBe(p.documents);
    const d = (await q(`SELECT erased_at FROM cv_document WHERE id = $1`, [docs[0]])).rows[0];
    expect(d.erased_at).not.toBeNull();
    const fresh = (
      await q(
        `SELECT erased_at FROM cv_document WHERE vacancy_id = $1 AND filename = 'fresh.txt'`,
        [vid],
      )
    ).rows[0];
    expect(fresh.erased_at).toBeNull();
    const t = (
      await q(
        `SELECT cause FROM import_tombstone t JOIN import_item i ON i.app_key_hash = t.key_hash WHERE i.document_id = $1`,
        [docs[0]],
      )
    ).rows[0];
    expect(t.cause).toBe('purge');
  });
});
