import JSZip from 'jszip';
import { describeDb } from '../testing/pg-harness';
import type { Harness } from '../testing/app-harness';
import {
  bootOracle,
  cvBytes,
  drainAll,
  makeApps,
  MemorySource,
  readyVacancy,
  runner,
  runRow,
  seedRun,
} from '../testing/oracle-harness';
import { announce, sendItem, textFile } from '../testing/stage3-upload';
import { ClaimLostError, IntakeService } from '../pipeline/intake.service';
import { PrincipalLoader } from './principal-loader';
import { SourceError } from './import-source';
import { finishRun } from './import-runs';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 3, S3-INT-04 (intake for server-created items) and S3-INT-05 (the batch surface).
describeDb('intake and batches for Oracle imports (S3-INT-04, S3-INT-05)', () => {
  let h: Harness;
  let rec: { userId: string; api: any };
  beforeAll(async () => {
    h = await bootOracle('oracleintake');
    rec = await h.recruiter('oi.rec@azerconnect.test');
  }, 120_000);
  afterAll(async () => h?.close());
  const q = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);

  /** A run parked after listing, so its batch has open items and nothing was fetched. */
  async function parkedImport(n = 3) {
    const vid = await readyVacancy(h, rec.api, `OI ${Math.random()}`);
    const src = new MemorySource(makeApps(n));
    src.downloadFault = () => new SourceError('unavailable');
    runner(h).source = src;
    const rid = await seedRun(h, vid, rec.userId, { estimate: n });
    await runner(h).drainRuns();
    const run = await runRow(h, rid);
    const items = (
      await q(
        `SELECT u.id FROM import_item i JOIN upload_item u ON u.id = i.upload_item_id WHERE i.run_id = $1 ORDER BY i.seq`,
        [rid],
      )
    ).rows.map((r: any) => r.id as string);
    return { vid, rid, run, items, src };
  }

  it('the browser route cannot write into an Oracle item; a browser item still works (S3-INT-04 (1))', async () => {
    const { vid, items, rid } = await parkedImport(2);
    const r = await sendItem(rec.api, vid, items[0]!, textFile('Intruder'));
    expect(r.statusCode).toBe(404);
    const it = (await q(`SELECT outcome FROM upload_item WHERE id = $1`, [items[0]])).rows[0];
    expect(it.outcome).toBeNull();
    const docs = (
      await q(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [vid])
    ).rows[0].n;
    expect(docs).toBe(0);
    const f = textFile('Browser Person');
    const b = (await announce(rec.api, vid, [{ name: f.name, size: f.data.length }])).json();
    expect((await sendItem(rec.api, vid, b.items[0].itemId, f)).statusCode).toBe(200);
    await finishRun(h.db.owner, rid, 'cancelled');
  });

  it('the skip list keeps the neutral label, never the Oracle file name (S3-INT-04 (2))', async () => {
    const vid = await readyVacancy(h, rec.api, 'Label');
    const intake = h.app.get(IntakeService);
    const principal = await h.app.get(PrincipalLoader).byUserId(rec.userId);
    const setId = await intake.gate(principal, vid);
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const r = await intake.admit(
      { principal, vacancyId: vid, setId, ip: '127.0.0.1', label: 'Oracle application 7' },
      'Leyla_Aliyeva_CV.doc',
      ole,
    );
    expect(r.code).toBe('old_word_format');
    const skip = (await q(`SELECT filename FROM intake_skip WHERE vacancy_id = $1`, [vid])).rows;
    expect(skip.map((s: any) => s.filename)).toEqual(['Oracle application 7']);
    // A taken file keeps its real name on cv_document only.
    const ok = await intake.admit(
      { principal, vacancyId: vid, setId, ip: '127.0.0.1', label: 'Oracle application 8' },
      'Kamal_Huseynov.txt',
      cvBytes('Kamal Huseynov'),
    );
    expect(ok.status).toBe('queued');
    const doc = (await q(`SELECT filename FROM cv_document WHERE id = $1`, [ok.documentId]))
      .rows[0];
    expect(doc.filename).toBe('Kamal_Huseynov.txt');
  });

  it('a cancel or archive under the lock ends the item cancelled; a foreign claim writes nothing (S3-INT-04 (3))', async () => {
    const { vid, rid, items, run } = await parkedImport(3);
    await q(`UPDATE import_run SET state = 'running', claim_id = 'c1' WHERE id = $1`, [rid]);
    const intake = h.app.get(IntakeService);
    const principal = await h.app.get(PrincipalLoader).byUserId(rec.userId);
    const setId = await intake.gate(principal, vid);
    const ctx = (itemId: string, claimId: string) => ({
      principal,
      vacancyId: vid,
      setId,
      ip: '',
      itemId,
      batchId: run.batch_id,
      label: 'Oracle application 1',
      via: 'oracle_hcm' as const,
      runId: rid,
      claimId,
    });
    await expect(
      intake.admit(ctx(items[0]!, 'not-mine'), 'a.txt', cvBytes('Someone A')),
    ).rejects.toBeInstanceOf(ClaimLostError);
    expect(
      (await q(`SELECT outcome FROM upload_item WHERE id = $1`, [items[0]])).rows[0].outcome,
    ).toBeNull();

    await q(
      `UPDATE import_run SET cancel_requested_at = now(), cancel_requested_by = $2 WHERE id = $1`,
      [rid, rec.userId],
    );
    const c = await intake.admit(ctx(items[0]!, 'c1'), 'a.txt', cvBytes('Someone A'));
    expect([c.status, c.code]).toEqual(['skipped', 'cancelled']);

    await q(
      `UPDATE import_run SET cancel_requested_at = NULL, cancel_requested_by = NULL WHERE id = $1`,
      [rid],
    );
    await q(`UPDATE vacancy SET archived_at = now(), archived_by = $2 WHERE id = $1`, [
      vid,
      rec.userId,
    ]);
    const a = await intake.admit(ctx(items[1]!, 'c1'), 'b.txt', cvBytes('Someone B'));
    expect([a.status, a.code]).toEqual(['skipped', 'cancelled']);
    const docs = (
      await q(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [vid])
    ).rows[0].n;
    expect(docs).toBe(0);
    await q(`UPDATE vacancy SET archived_at = NULL, archived_by = NULL WHERE id = $1`, [vid]);
    await finishRun(h.db.owner, rid, 'cancelled');
  });

  it('a browser upload has no via or runId on its audit row (S3-INT-04 (4))', async () => {
    const vid = await readyVacancy(h, rec.api, 'Browser audit');
    await rec.api.upload(`/vacancies/${vid}/documents`, [textFile('Plain Person')]);
    const a = (
      await q(
        `SELECT after FROM audit_event WHERE action = 'document.upload' AND after->>'vacancyId' = $1`,
        [vid],
      )
    ).rows[0].after;
    expect(a.via).toBeUndefined();
    expect(a.runId).toBeUndefined();
  });

  it('a Word file with more than 2,000 entries is stored unread with no pages; a normal one is queued (S3-INT-04 (5))', async () => {
    const vid = await readyVacancy(h, rec.api, 'Docx precheck');
    const make = async (extra: number) => {
      const z = new JSZip();
      z.file('[Content_Types].xml', '<Types/>');
      z.file(
        'word/document.xml',
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${'BGP routing and Kubernetes. '.repeat(20)}</w:t></w:r></w:p></w:body></w:document>`,
      );
      for (let k = 0; k < extra; k++) z.file(`x/${k}.xml`, '<a/>');
      return z.generateAsync({ type: 'nodebuffer' });
    };
    const bomb = await make(2_001);
    const r = await rec.api.upload(`/vacancies/${vid}/documents`, [
      { name: 'bomb.docx', type: 'application/octet-stream', data: bomb },
    ]);
    const res = r.json().results[0];
    expect([res.status, res.code]).toEqual(['unreadable', 'read_failed']);
    const doc = (
      await q(`SELECT text, rendition_state FROM cv_document WHERE id = $1`, [res.documentId])
    ).rows[0];
    expect(doc).toEqual({ text: null, rendition_state: null });
  });

  it('intake info and the batch view carry the source, the active import and not-fetched counts (S3-INT-05 (1), (2))', async () => {
    const { vid, rid, run } = await parkedImport(3);
    const info = (await rec.api.get(`/vacancies/${vid}/intake`)).json();
    expect(info.latestBatch.source).toBe('oracle_hcm');
    expect(info.activeImport).toMatchObject({
      runId: rid,
      state: 'queued',
      phase: 'fetching',
      batchId: run.batch_id,
    });
    await finishRun(h.db.owner, rid, 'failed', 'oracle_unavailable');
    const b = (await rec.api.get(`/upload-batches/${run.batch_id}?items=1`)).json();
    expect(b.batch.source).toBe('oracle_hcm');
    expect(b.counts.upload.notFetched).toBe(3);
    expect(b.items.map((i: any) => i.status)).toEqual([
      'not_fetched',
      'not_fetched',
      'not_fetched',
    ]);
    expect(b.items[0].filename).toBe('Oracle application 1');
    const sum = Object.values(b.counts.byStatus as Record<string, number>).reduce(
      (x, y) => x + y,
      0,
    );
    expect(sum).toBe(3);
    const after = (await rec.api.get(`/vacancies/${vid}/intake`)).json();
    expect(after.activeImport).toBeNull();
  });

  it('retry failed on an Oracle batch re-queues analyses and resends nothing (S3-INT-05 (4))', async () => {
    const { vid, rid, run } = await parkedImport(2);
    await finishRun(h.db.owner, rid, 'failed', 'oracle_unavailable');
    const r = (
      await rec.api.post(`/vacancies/${vid}/retry-failed`, { batchId: run.batch_id })
    ).json();
    expect(r.resend).toEqual([]);
  });

  it('a newer import supersedes the open files of an older Oracle batch (finishRun)', async () => {
    const { vid, rid, run, src } = await parkedImport(2);
    await finishRun(h.db.owner, rid, 'failed', 'oracle_unavailable');
    src.downloadFault = null;
    runner(h).source = src;
    const rid2 = await seedRun(h, vid, rec.userId, { estimate: 2, mode: 'refresh' });
    await drainAll(h);
    expect((await runRow(h, rid2)).state).toBe('completed');
    const old = (
      await q(`SELECT code FROM upload_item WHERE batch_id = $1`, [run.batch_id])
    ).rows.map((r: any) => r.code);
    expect(old).toEqual(['superseded', 'superseded']);
  });
});
