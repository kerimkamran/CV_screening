import { isFinalItem, RETRYABLE_CODES, UPLOAD_CODES } from '@cv/shared';
import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';
import { announce, itemRow, liveCount, ready, sendItem, textFile } from '../testing/stage3-upload';
import { IntakeService } from './intake.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** S3-UP-02: a final item outcome is never written over; one shared list of retryable codes. */
describeDb('Guarded item writes (S3-UP-02)', () => {
  let h: Harness;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env['TEST_VISIBILITY'] = 'all';
    process.env['MAX_RESUMES_PER_RUN'] = '50';
    h = await boot('race');
  });
  afterAll(async () => {
    await h?.close();
    process.env['TEST_VISIBILITY'] = env['TEST_VISIBILITY'];
    process.env['MAX_RESUMES_PER_RUN'] = env['MAX_RESUMES_PER_RUN'];
  });

  it('finishItem never changes a final item, and writes on an empty or retryable one', async () => {
    const r = await h.recruiter('guard@azerconnect.test');
    const vid = await ready(r.api);
    const b = (
      await announce(
        r.api,
        vid,
        Array.from({ length: 8 }, (_, i) => ({ name: `g${i}.txt`, size: 100 })),
      )
    ).json();
    const ids = b.items.map((i: any) => i.itemId) as string[];
    const set = (id: string, outcome: string | null, code: string | null) =>
      h.db.owner.query(`UPDATE upload_item SET outcome = $2, code = $3 WHERE id = $1`, [
        id,
        outcome,
        code,
      ]);
    await set(ids[0]!, 'queued', null);
    await set(ids[1]!, 'duplicate', 'duplicate');
    await set(ids[2]!, 'unreadable', 'no_text');
    await set(ids[3]!, 'rejected', 'wrong_type');
    await set(ids[4]!, 'skipped', 'wrong_type');
    await set(ids[5]!, null, null);
    await set(ids[6]!, 'skipped', 'vacancy_full');
    await set(ids[7]!, 'skipped', 'server_error');
    const intake = h.app.get(IntakeService);
    const attempt = { filename: 'x.txt', status: 'rejected' as const, code: 'empty', message: 'm' };
    for (const id of ids.slice(0, 5)) {
      const before = await itemRow(h, id);
      const fin = await intake.finishItem(id, { ...attempt, itemId: id });
      expect(fin.wrote).toBe(false);
      expect(fin.result.status).toBe(before.outcome);
      expect(await itemRow(h, id)).toEqual(before); // no column changed
    }
    for (const id of ids.slice(5)) {
      const fin = await intake.finishItem(id, { ...attempt, itemId: id });
      expect(fin.wrote).toBe(true);
      expect(await itemRow(h, id)).toMatchObject({ outcome: 'rejected', code: 'empty' });
    }
  });

  it('20 parallel sends of one item: 1 CV, 1 upload audit row, the item ends queued, no skip row', async () => {
    const r = await h.recruiter('twenty@azerconnect.test');
    const vid = await ready(r.api);
    const f = textFile('Twenty Times Person');
    const b = (await announce(r.api, vid, [{ name: f.name, size: f.data.length }])).json();
    const item = b.items[0].itemId as string;
    const res = await Promise.all(Array.from({ length: 20 }, () => sendItem(r.api, vid, item, f)));
    expect(res.every((x) => x.statusCode === 200)).toBe(true);
    const results = res.map((x) => x.json().results[0]);
    expect(new Set(results.map((x: any) => `${x.status}/${x.documentId}`)).size).toBe(1);
    expect(results[0]).toMatchObject({ status: 'queued' });
    expect(await liveCount(h, vid)).toBe(1);
    const audit = await h.db.owner.query(
      `SELECT count(*)::int AS n FROM audit_event WHERE action = 'document.upload' AND after->>'vacancyId' = $1`,
      [vid],
    );
    expect(audit.rows[0].n).toBe(1);
    expect(await itemRow(h, item)).toMatchObject({ outcome: 'queued' });
    const skips = await h.db.owner.query(
      `SELECT count(*)::int AS n FROM intake_skip WHERE upload_item_id = $1`,
      [item],
    );
    expect(skips.rows[0].n).toBe(0);
  });

  it('an item set final while a send is on its way stays as set; the answer is the stored result', async () => {
    const r = await h.recruiter('held@azerconnect.test');
    const vid = await ready(r.api);
    const f = textFile('Held Back Person');
    const b = (await announce(r.api, vid, [{ name: f.name, size: f.data.length }])).json();
    const item = b.items[0].itemId as string;
    const intake = h.app.get(IntakeService);
    // Hold the send after its text is read and before it writes: mark the item final meanwhile.
    const orig = intake.batchCancelled.bind(intake);
    const spy = jest.spyOn(intake, 'batchCancelled').mockImplementationOnce(async (...a) => {
      await h.db.owner.query(
        `UPDATE upload_item SET outcome = 'rejected', code = 'wrong_type', message = 'set by SQL', received_at = now() WHERE id = $1`,
        [item],
      );
      return orig(...a);
    });
    try {
      const res = await sendItem(r.api, vid, item, f);
      expect(res.statusCode).toBe(200);
      expect(res.json().results[0]).toMatchObject({ status: 'rejected', code: 'wrong_type' });
    } finally {
      spy.mockRestore();
    }
    expect(await itemRow(h, item)).toMatchObject({ outcome: 'rejected', message: 'set by SQL' });
    expect(await liveCount(h, vid)).toBe(0);
    const skips = await h.db.owner.query(
      `SELECT count(*)::int AS n FROM intake_skip WHERE upload_item_id = $1`,
      [item],
    );
    expect(skips.rows[0].n).toBe(0);
  });

  it('isFinalItem, the notReceived count and the resend list agree for every retryable code', async () => {
    for (const code of UPLOAD_CODES)
      expect(isFinalItem('skipped', code)).toBe(
        !(RETRYABLE_CODES as readonly string[]).includes(code),
      );
    const r = await h.recruiter('agree@azerconnect.test');
    const vid = await ready(r.api);
    const b = (
      await announce(r.api, vid, [
        { name: 'a.txt', size: 10 },
        { name: 'b.txt', size: 10 },
        { name: 'c.txt', size: 10 },
      ])
    ).json();
    const [a, bb, c] = b.items.map((i: any) => i.itemId) as string[];
    await h.db.owner.query(
      `UPDATE upload_item SET outcome = 'skipped', code = 'server_error', received_at = now() WHERE id = $1`,
      [a],
    );
    await h.db.owner.query(
      `UPDATE upload_item SET outcome = 'skipped', code = 'vacancy_full', received_at = now() WHERE id = $1`,
      [bb],
    );
    await h.db.owner.query(
      `UPDATE upload_item SET outcome = 'rejected', code = 'wrong_type', received_at = now() WHERE id = $1`,
      [c],
    );
    const state = (await r.api.get(`/upload-batches/${b.batchId}?items=1`)).json();
    expect(state.counts.upload).toMatchObject({ received: 1, notReceived: 1, vacancyFull: 1 });
    expect(state.items.find((i: any) => i.itemId === a).status).toBe('not_sent');
    const rf = (await r.api.post(`/vacancies/${vid}/retry-failed`, { batchId: b.batchId })).json();
    expect(rf.resend.map((x: any) => x.itemId).sort()).toEqual([a, bb].sort());
  });
});
