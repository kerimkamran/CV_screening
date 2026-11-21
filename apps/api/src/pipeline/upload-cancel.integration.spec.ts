import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { describeDb } from '../testing/pg-harness';
import { boot, cv, type Harness } from '../testing/app-harness';
import { announce, itemRow, liveCount, ready, sendItem, textFile } from '../testing/stage3-upload';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { IntakeService } from './intake.service';
import { ProcessorService } from './processor.service';
import { SPOOL_PREFIX } from './zip-spool';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** S3-UP-05: "Stop sending files" cancels a running upload; nothing changes afterwards. */
describeDb('Cancel a running upload (S3-UP-05)', () => {
  let h: Harness;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env['TEST_VISIBILITY'] = 'all';
    process.env['MAX_RESUMES_PER_RUN'] = '100';
    h = await boot('cancel');
  });
  afterAll(async () => {
    await h?.close();
    process.env['TEST_VISIBILITY'] = env['TEST_VISIBILITY'];
    process.env['MAX_RESUMES_PER_RUN'] = env['MAX_RESUMES_PER_RUN'];
  });

  it('closes every open or retryable item as cancelled, leaves final ones, audits once, and is idempotent', async () => {
    const r = await h.recruiter('cancel1@azerconnect.test');
    const vid = await ready(r.api);
    const files = [1, 2, 3, 4].map((i) => textFile(`Cancel ${'abcd'[i - 1]} Person`));
    const b = (
      await announce(
        r.api,
        vid,
        files.map((f) => ({ name: f.name, size: f.data.length })),
      )
    ).json();
    const [i0, i1, i2, i3] = b.items.map((i: any) => i.itemId) as string[];
    await sendItem(r.api, vid, i0!, files[0]!);
    await h.db.owner.query(
      `UPDATE upload_item SET outcome = 'skipped', code = 'server_error', received_at = now() WHERE id = $1`,
      [i1],
    );
    const res = await r.api.post(`/upload-batches/${b.batchId}/cancel`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelled: 3 });
    expect(await itemRow(h, i0!)).toMatchObject({ outcome: 'queued' });
    for (const id of [i1, i2, i3])
      expect(await itemRow(h, id!)).toMatchObject({ outcome: 'skipped', code: 'cancelled' });
    const batchRow = async () =>
      (
        await h.db.owner.query(
          `SELECT cancelled_at, cancelled_by FROM upload_batch WHERE id = $1`,
          [b.batchId],
        )
      ).rows[0];
    const first = await batchRow();
    expect(first.cancelled_by).toBe(r.userId);
    const audits = async () =>
      (
        await h.db.owner.query(
          `SELECT after FROM audit_event WHERE action = 'upload_batch.cancelled' AND entity_id = $1`,
          [b.batchId],
        )
      ).rows;
    expect(await audits()).toEqual([{ after: { vacancyId: vid, cancelled: 3 } }]);

    // A second call changes nothing and answers the same stable shape.
    const lead = await h.recruiter('cancel1lead@azerconnect.test', 'TA_LEAD');
    const again = await lead.api.post(`/upload-batches/${b.batchId}/cancel`);
    expect(again.json()).toEqual({ cancelled: 0 });
    expect(await batchRow()).toEqual(first);
    expect(await audits()).toHaveLength(1);

    // The batch view says so; cancelled items are not counted as received; nothing to resend.
    const state = (await r.api.get(`/upload-batches/${b.batchId}?items=1`)).json();
    expect(state.batch.cancelledAt).toBeTruthy();
    expect(state.counts.upload).toMatchObject({
      total: 4,
      received: 1,
      cancelled: 3,
      notReceived: 0,
    });
    expect(state.items.filter((i: any) => i.status === 'cancelled')).toHaveLength(3);
    expect(state.counts.byStatus.cancelled).toBe(3);
    const rf = (await r.api.post(`/vacancies/${vid}/retry-failed`, { batchId: b.batchId })).json();
    expect(rf.resend).toEqual([]);
    // A late file for a cancelled item gets the stored answer and stores nothing.
    const late = await sendItem(r.api, vid, i2!, files[2]!);
    expect(late.json().results[0]).toMatchObject({ status: 'skipped', code: 'cancelled' });
    expect(await liveCount(h, vid)).toBe(1);
  });

  it('needs the edit right (403), is a 404 for an unknown batch, and works on an archived vacancy', async () => {
    const owner = await h.recruiter('cancel2@azerconnect.test');
    const other = await h.recruiter('cancel2other@azerconnect.test');
    const vid = await ready(owner.api);
    const b = (await announce(owner.api, vid, [{ name: 'a.txt', size: 10 }])).json();
    expect((await owner.api.post(`/upload-batches/${'0'.repeat(26)}/cancel`)).statusCode).toBe(404);
    const env2 = (h.app.get(VacancyScope) as unknown as { env: { VACANCY_EDIT: string } }).env;
    env2.VACANCY_EDIT = 'owner';
    try {
      expect((await other.api.post(`/upload-batches/${b.batchId}/cancel`)).statusCode).toBe(403);
    } finally {
      env2.VACANCY_EDIT = 'everyone';
    }
    const gov = await h.recruiter('cancel2gov@azerconnect.test', 'GOVERNANCE');
    expect((await gov.api.post(`/upload-batches/${b.batchId}/cancel`)).statusCode).toBe(403);
    expect((await owner.api.post(`/vacancies/${vid}/archive`)).statusCode).toBe(200);
    expect((await owner.api.post(`/upload-batches/${b.batchId}/cancel`)).json()).toEqual({
      cancelled: 1,
    });
  });

  it('sends in flight when cancel returns end either cancelled with no CV or queued with one; nothing changes later', async () => {
    const r = await h.recruiter('cancel3@azerconnect.test');
    const vid = await ready(r.api);
    const files = [1, 2, 3].map((i) => textFile(`Flight ${'xyz'[i - 1]} Person`));
    const b = (
      await announce(
        r.api,
        vid,
        files.map((f) => ({ name: f.name, size: f.data.length })),
      )
    ).json();
    const ids = b.items.map((i: any) => i.itemId) as string[];
    const sends = ids.map((id, k) => sendItem(r.api, vid, id, files[k]!));
    const cancel = r.api.post(`/upload-batches/${b.batchId}/cancel`);
    await Promise.all([...sends, cancel]);
    const docsNow = await liveCount(h, vid);
    for (const id of ids) {
      const row = await itemRow(h, id);
      const ok =
        (row.outcome === 'skipped' && row.code === 'cancelled' && row.document_id === null) ||
        (row.outcome === 'queued' && row.document_id !== null);
      expect(ok).toBe(true);
    }
    await new Promise((res) => setTimeout(res, 300));
    expect(await liveCount(h, vid)).toBe(docsNow);
  });

  it('a ZIP cancelled after entry 10 of 50: at most 11 entries stored, the ZIP item cancelled, its temp folder gone', async () => {
    const r = await h.recruiter('cancel4@azerconnect.test');
    const vid = await ready(r.api);
    const z = new JSZip();
    for (let i = 0; i < 50; i++)
      z.file(`e${i}.txt`, cv(`Entry Person ${i}x`, [`BGP routing ${i}.`]));
    const data = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const b = (await announce(r.api, vid, [{ name: 'fifty.zip', size: data.length }])).json();
    const zipItem = b.items[0].itemId as string;
    const intake = h.app.get(IntakeService) as any;
    const orig = intake.admitFile.bind(intake);
    let n = 0;
    const spy = jest.spyOn(intake, 'admitFile').mockImplementation(async (...a: any[]) => {
      const out = await orig(...a);
      if (++n === 10) await r.api.post(`/upload-batches/${b.batchId}/cancel`);
      return out;
    });
    const res = await sendItem(r.api, vid, zipItem, {
      name: 'fifty.zip',
      type: 'application/zip',
      data,
    });
    spy.mockRestore();
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({ status: 'skipped', code: 'cancelled' });
    const stored = await liveCount(h, vid);
    expect(stored).toBeGreaterThanOrEqual(10);
    expect(stored).toBeLessThanOrEqual(11);
    const kids = await h.db.owner.query(
      `SELECT count(*)::int AS n FROM upload_item WHERE parent_item_id = $1`,
      [zipItem],
    );
    expect(kids.rows[0].n).toBeLessThanOrEqual(11);
    expect(await itemRow(h, zipItem)).toMatchObject({ outcome: 'skipped', code: 'cancelled' });
    const mine = (await readdir(tmpdir())).filter((d) =>
      d.startsWith(`${SPOOL_PREFIX}${process.pid}-`),
    );
    expect(mine).toEqual([]);
    // No screening is touched by a cancel: the stored CVs are still analyzed.
    await h.app.get(ProcessorService).drain();
    const states = await h.db.owner.query(
      `SELECT DISTINCT s.state::text FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1`,
      [vid],
    );
    expect(states.rows.map((x: any) => x.state)).toEqual(['completed']);
  });
});
