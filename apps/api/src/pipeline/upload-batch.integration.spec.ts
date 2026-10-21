import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { describeDb } from '../testing/pg-harness';
import { boot, cv, JD, type Api, type Harness } from '../testing/app-harness';
import { multipart } from '../testing/app-harness';
import { readCapped } from './intake.service';
import { ProcessorService } from './processor.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('readCapped (S2-BE2)', () => {
  it('reads a 3 MB file whole, and an 11 MB file is counted but never buffered beyond the cap', async () => {
    const cap = 10 * 1024 * 1024;
    const stream = (mb: number) =>
      Readable.from(Array.from({ length: mb }, () => Buffer.alloc(1024 * 1024, 97)));
    const ok = await readCapped(stream(3), cap);
    expect(ok).toMatchObject({ tooLarge: false, bytes: 3 * 1024 * 1024 });
    expect(ok.buf.length).toBe(3 * 1024 * 1024);
    const big = await readCapped(stream(11), cap);
    expect(big.tooLarge).toBe(true);
    expect(big.bytes).toBe(11 * 1024 * 1024);
    expect(big.buf.length).toBe(0); // nothing held for a refused file
  });
});

describeDb('Upload batches and reliable intake (Stage 2, S2-BE2, S2-BE3)', () => {
  let h: Harness;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env['TEST_VISIBILITY'] = 'all';
    process.env['MAX_RESUMES_PER_RUN'] = '6';
    h = await boot('batches');
  });
  afterAll(async () => {
    await h?.close();
    process.env['TEST_VISIBILITY'] = env['TEST_VISIBILITY'];
    process.env['MAX_RESUMES_PER_RUN'] = env['MAX_RESUMES_PER_RUN'];
  });

  const ready = async (api: Api, title = 'Senior Network Engineer') => {
    const vid = (await api.post('/vacancies', { title, jdText: JD })).json().id as string;
    await api.post(`/vacancies/${vid}/criteria/extract`);
    await api.post(`/vacancies/${vid}/criteria/freeze`);
    await api.post(`/vacancies/${vid}/notice-confirm`);
    return vid;
  };
  const file = (
    name: string,
    lines: string[] = ['BGP routing.'],
  ): { name: string; type: string; data: Buffer } => ({
    name: `${name.replace(/\s/g, '_')}.txt`,
    type: 'text/plain',
    data: Buffer.from(cv(name, lines)),
  });
  const batch = async (
    api: Api,
    vid: string,
    files: { name: string; size: number; path?: string }[],
  ) => api.post(`/vacancies/${vid}/upload-batches`, { files });
  const send = (api: Api, vid: string, itemId: string, f: ReturnType<typeof file>) =>
    api.upload(`/vacancies/${vid}/documents?item=${itemId}`, [f]);
  const live = async (vid: string) =>
    Number(
      (
        await h.db.owner.query(
          `SELECT count(*) AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL`,
          [vid],
        )
      ).rows[0].n,
    );

  it('marks wrong, empty, oversized and old Word files before anything is sent, and files beyond the room', async () => {
    const r = await h.recruiter('pre@azerconnect.test');
    const vid = await ready(r.api);
    const b = await batch(r.api, vid, [
      { name: 'notes.png', size: 40_000 },
      { name: 'old_cv.doc', size: 88_000 },
      { name: 'empty.pdf', size: 0 },
      { name: 'huge.pdf', size: 11 * 1024 * 1024 },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `ok_${i}.pdf`, size: 1000 })),
    ]);
    expect(b.statusCode).toBe(201);
    const body = b.json();
    expect(body.capacity).toEqual({ used: 0, limit: 6, room: 6 });
    const pre = body.items.map((i: any) => i.pre?.code ?? null);
    expect(pre).toEqual([
      'wrong_type',
      'old_word_format',
      'empty',
      'too_large',
      null,
      null,
      null,
      null,
      null,
      null,
      'vacancy_full',
      'vacancy_full',
    ]);
    // Everything marked now is on the vacancy's skipped list too: nothing is dropped silently.
    const skipped = (await r.api.get(`/vacancies/${vid}/skipped`)).json().skipped;
    expect(skipped).toHaveLength(6);
  });

  it('sends one file per request: per-file result, a reload shows the same picture, and re-sending is idempotent', async () => {
    const r = await h.recruiter('item@azerconnect.test');
    const vid = await ready(r.api);
    const files = [file('Alice Full', ['BGP routing.', 'Kubernetes.']), file('Bob Routing')];
    const b = (
      await batch(
        r.api,
        vid,
        files.map((f) => ({ name: f.name, size: f.data.length })),
      )
    ).json();
    const [i0, i1] = b.items.map((i: any) => i.itemId) as string[];

    const first = await send(r.api, vid, i0!, files[0]!);
    expect(first.statusCode).toBe(200);
    expect(first.json().results).toEqual([
      expect.objectContaining({ itemId: i0, status: 'queued', filename: files[0]!.name }),
    ]);
    // Re-sending a received item returns what was stored, and takes nothing in twice.
    const again = await send(r.api, vid, i0!, files[0]!);
    expect(again.json().results[0]).toMatchObject({ itemId: i0, status: 'queued' });
    expect(await live(vid)).toBe(1);

    // "After a reload": the second file was never sent.
    const mid = (await r.api.get(`/upload-batches/${b.batchId}?items=0`)).json();
    expect(mid.counts.upload).toMatchObject({ total: 2, received: 1, notReceived: 1 });
    expect(mid.counts.byStatus).toMatchObject({ analyzing: 1, not_sent: 1 });

    await send(r.api, vid, i1!, files[1]!);
    await h.app.get(ProcessorService).drain();
    const done = (await r.api.get(`/upload-batches/${b.batchId}?items=1`)).json();
    expect(done.counts.byStatus).toMatchObject({ analyzed: 2, not_sent: 0, analyzing: 0 });
    expect(done.items.map((i: any) => i.status)).toEqual(['analyzed', 'analyzed']);
    expect(done.items.every((i: any) => !('score' in i))).toBe(true); // statuses only, never a score
    expect(done.lastReceivedAt).toBeTruthy();

    const info = (await r.api.get(`/vacancies/${vid}/intake`)).json();
    expect(info).toMatchObject({
      used: 2,
      limit: 6,
      maxFileMb: 10,
      latestBatch: { id: b.batchId, mine: true, fileCount: 2 },
    });
  });

  it('two requests with identical bytes give one queued and one duplicate, never a 500; an item of another vacancy is a 404', async () => {
    const r = await h.recruiter('dup@azerconnect.test');
    const vid = await ready(r.api);
    const f = file('Same Person');
    const b = (
      await batch(r.api, vid, [
        { name: 'a.txt', size: f.data.length },
        { name: 'b.txt', size: f.data.length },
      ])
    ).json();
    const res = await Promise.all(
      b.items.map((i: any) => send(r.api, vid, i.itemId, { ...f, name: `${i.position}.txt` })),
    );
    expect(res.map((x) => x.statusCode)).toEqual([200, 200]);
    const status = res.map((x) => x.json().results[0].status).sort();
    expect(status).toEqual(['duplicate', 'queued']);
    expect(await live(vid)).toBe(1);
    const other = await ready(r.api, 'Another');
    expect((await send(r.api, other, b.items[0].itemId, f)).statusCode).toBe(404);
  });

  it('parallel requests never pass the vacancy cap, and files that did not fit can be sent when there is room', async () => {
    const r = await h.recruiter('cap@azerconnect.test');
    const vid = await ready(r.api);
    // Announce only 4, then let 4 more arrive from another batch at the same time.
    const fa = Array.from({ length: 4 }, (_, i) => file(`Cap A${i} Person`, [`BGP routing ${i}.`]));
    const fb = Array.from({ length: 4 }, (_, i) =>
      file(`Cap B${i} Person`, [`BGP routing b${i}.`]),
    );
    const ba = (
      await batch(
        r.api,
        vid,
        fa.map((f) => ({ name: f.name, size: f.data.length })),
      )
    ).json();
    const bb = (
      await batch(
        r.api,
        vid,
        fb.map((f) => ({ name: f.name, size: f.data.length })),
      )
    ).json();
    const all = await Promise.all([
      ...ba.items.map((i: any, k: number) => send(r.api, vid, i.itemId, fa[k]!)),
      ...bb.items.map((i: any, k: number) => send(r.api, vid, i.itemId, fb[k]!)),
    ]);
    expect(all.every((x) => x.statusCode === 200)).toBe(true);
    const outcomes = all.map((x) => x.json().results[0]);
    expect(outcomes.filter((o: any) => o.status === 'queued')).toHaveLength(6);
    expect(outcomes.filter((o: any) => o.code === 'vacancy_full')).toHaveLength(2);
    expect(await live(vid)).toBe(6);

    // Room appears: erase one CV, and the "vacancy full" file may be sent again.
    const full = outcomes.find((o: any) => o.code === 'vacancy_full');
    const docs = (await r.api.get(`/vacancies/${vid}/candidates`)).json().candidates;
    expect(
      (await r.api.post(`/documents/${docs[0].documentId}/erase`, { reason: 'test' })).statusCode,
    ).toBe(200);
    expect(await live(vid)).toBe(5);
    const rf = await r.api.post(`/vacancies/${vid}/retry-failed`, { batchId: ba.batchId });
    expect(rf.statusCode).toBe(200);
    const retry = await r.api.post(`/vacancies/${vid}/retry-failed`, { batchId: bb.batchId });
    // Each batch is offered at most the room that exists (one slot), and the full file is among them.
    expect(rf.json().resend.length).toBeLessThanOrEqual(1);
    expect(retry.json().resend.length).toBeLessThanOrEqual(1);
    const offered = [...rf.json().resend, ...retry.json().resend].map((x: any) => x.itemId);
    expect(offered).toContain(full.itemId);
    const src = [...fa, ...fb].find((f) => f.name === full.filename)!;
    const redo = await send(r.api, vid, full.itemId, src);
    expect(redo.json().results[0].status).toBe('queued');
    expect(await live(vid)).toBe(6);
  });

  it('an erased CV can be uploaded again as a new document', async () => {
    const r = await h.recruiter('erased@azerconnect.test');
    const vid = await ready(r.api);
    const f = file('Erase Me Person');
    const up1 = (await r.api.upload(`/vacancies/${vid}/documents`, [f])).json().results[0];
    expect(up1.status).toBe('queued');
    expect(
      (await r.api.post(`/documents/${up1.documentId}/erase`, { reason: 'test' })).statusCode,
    ).toBe(200);
    const up2 = (await r.api.upload(`/vacancies/${vid}/documents`, [f])).json().results[0];
    expect(up2.status).toBe('queued');
    expect(up2.documentId).not.toBe(up1.documentId);
    // A live copy is still a duplicate.
    const up3 = (await r.api.upload(`/vacancies/${vid}/documents`, [f])).json().results[0];
    expect(up3).toMatchObject({ status: 'duplicate', documentId: up2.documentId });
  });

  it('refuses an archived vacancy (409) and, with VACANCY_EDIT=owner, a person who may see but not change it (403)', async () => {
    const owner = await h.recruiter('owner@azerconnect.test');
    const other = await h.recruiter('other@azerconnect.test');
    const vid = await ready(owner.api);
    // Since 21 Oct 2026 every recruiter may change every vacancy they see, uploads included.
    expect(
      (await other.api.upload(`/vacancies/${vid}/documents`, [file('X Y Person')])).statusCode,
    ).toBe(200);
    const env = (h.app.get(VacancyScope) as unknown as { env: { VACANCY_EDIT: string } }).env;
    env.VACANCY_EDIT = 'owner';
    try {
      expect(
        (await other.api.upload(`/vacancies/${vid}/documents`, [file('Z W Person')])).statusCode,
      ).toBe(403);
      expect((await batch(other.api, vid, [{ name: 'a.txt', size: 5 }])).statusCode).toBe(403);
    } finally {
      env.VACANCY_EDIT = 'everyone';
    }
    const lead = await h.recruiter('lead2@azerconnect.test', 'TA_LEAD');
    expect(
      (await lead.api.upload(`/vacancies/${vid}/documents`, [file('Lead Upload')])).statusCode,
    ).toBe(200);
    await h.app.get(ProcessorService).drain(); // a vacancy that is still reading cannot be archived
    expect((await owner.api.post(`/vacancies/${vid}/archive`)).statusCode).toBe(200);
    const r = await owner.api.upload(`/vacancies/${vid}/documents`, [file('Late One Person')]);
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toBe('Restore this vacancy first');
    expect((await batch(owner.api, vid, [{ name: 'a.txt', size: 5 }])).statusCode).toBe(409);
  });

  it('opens a ZIP into entries, each with its own status under the ZIP item', async () => {
    const r = await h.recruiter('zipitem@azerconnect.test');
    const vid = await ready(r.api);
    const z = new JSZip();
    z.file('batch/Zed_One.txt', cv('Zed One', ['BGP routing.']));
    z.file('batch/Zed_Two.txt', cv('Zed Two', ['Kubernetes.']));
    z.file('batch/photo.jpg', 'jpeg');
    const data = await z.generateAsync({ type: 'nodebuffer' });
    const b = (await batch(r.api, vid, [{ name: 'cvs.zip', size: data.length }])).json();
    const res = await send(r.api, vid, b.items[0].itemId, {
      name: 'cvs.zip',
      type: 'application/zip',
      data,
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results as any[];
    expect(results[0]).toMatchObject({ status: 'queued', code: 'zip', itemId: b.items[0].itemId });
    expect(results.filter((x) => x.status === 'queued' && x.code !== 'zip')).toHaveLength(2);
    expect(results.filter((x) => x.status === 'skipped')).toHaveLength(1);
    await h.app.get(ProcessorService).drain();
    const state = (await r.api.get(`/upload-batches/${b.batchId}?items=1`)).json();
    // The ZIP is a container: the counts are over its entries.
    expect(state.counts.byStatus).toMatchObject({ analyzed: 2, rejected: 1 });
    expect(state.counts.upload).toMatchObject({ total: 1, received: 1 });
    expect(state.items.filter((i: any) => i.container)).toHaveLength(1);
    // Sending the ZIP again changes nothing.
    const again = await send(r.api, vid, b.items[0].itemId, {
      name: 'cvs.zip',
      type: 'application/zip',
      data,
    });
    expect(again.json().results).toHaveLength(results.length);
    expect(await live(vid)).toBe(2);
  });

  it('an oversized file is rejected as too_large; the answer for 500 announced files stays small', async () => {
    const r = await h.recruiter('big@azerconnect.test');
    const vid = await ready(r.api);
    const big = Buffer.alloc(11 * 1024 * 1024, 97);
    const b = (await batch(r.api, vid, [{ name: 'big.txt', size: 100 }])).json();
    const res = await send(r.api, vid, b.items[0].itemId, {
      name: 'big.txt',
      type: 'text/plain',
      data: big,
    });
    expect(res.json().results[0]).toMatchObject({ status: 'rejected', code: 'too_large' });
    expect(await live(vid)).toBe(0);

    const many = (
      await batch(
        r.api,
        vid,
        Array.from({ length: 500 }, (_, i) => ({
          name: `f${i}.pdf`,
          size: 1000,
          path: `dir/f${i}.pdf`,
        })),
      )
    ).json();
    const t0 = Date.now();
    const counts = await r.api.get(`/upload-batches/${many.batchId}?items=0`);
    expect(counts.body.length).toBeLessThan(2048);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect((await r.api.get(`/upload-batches/${many.batchId}?items=1`)).json().items).toHaveLength(
      500,
    );
  });

  it('retry-failed re-queues only failed analyses on the current criteria: completed CVs cost no extra model call', async () => {
    const r = await h.recruiter('retry@azerconnect.test');
    const vid = await ready(r.api);
    const fs = [file('Ret One Person'), file('Ret Two Person'), file('Ret Three Person')];
    const b = (
      await batch(
        r.api,
        vid,
        fs.map((f) => ({ name: f.name, size: f.data.length })),
      )
    ).json();
    for (const [k, i] of b.items.entries()) await send(r.api, vid, (i as any).itemId, fs[k]!);
    await h.app.get(ProcessorService).drain();
    const calls = h.modelCalls.length;
    const list = (await r.api.get(`/vacancies/${vid}/candidates`)).json().candidates;
    await h.db.owner.query(
      `UPDATE screening SET state = 'failed', score = NULL, band = NULL, breakdown = NULL WHERE id = $1`,
      [list[0].screeningId],
    );
    const rf = await r.api.post(`/vacancies/${vid}/retry-failed`, { batchId: b.batchId });
    expect(rf.json()).toMatchObject({ requeued: 1, resend: [] });
    await h.app.get(ProcessorService).drain();
    expect(h.modelCalls.length - calls).toBe(1); // only the failed one
    const none = await r.api.post(`/vacancies/${vid}/retry-failed`, {});
    expect(none.json().requeued).toBe(0);
    const audit = await h.db.owner.query(
      `SELECT after FROM audit_event WHERE action = 'screening.retried' ORDER BY seq DESC LIMIT 2`,
    );
    expect(audit.rows[1].after).toMatchObject({ scope: 'batch', count: 1 });
    expect(audit.rows[0].after).toMatchObject({ scope: 'vacancy', count: 0 });
    expect((await r.api.get(`/upload-batches/${b.batchId}`)).json().counts.byStatus).toMatchObject({
      analyzed: 3,
    });
  });

  it('retries one failed CV on its own, and the candidate list can be limited to one upload', async () => {
    const r = await h.recruiter('one@azerconnect.test');
    const vid = await ready(r.api);
    const first = [file('One Alpha Person'), file('One Beta Person')];
    const second = [file('One Gamma Person')];
    const b1 = (
      await batch(
        r.api,
        vid,
        first.map((f) => ({ name: f.name, size: f.data.length })),
      )
    ).json();
    for (const [k, i] of b1.items.entries()) await send(r.api, vid, (i as any).itemId, first[k]!);
    const b2 = (
      await batch(
        r.api,
        vid,
        second.map((f) => ({ name: f.name, size: f.data.length })),
      )
    ).json();
    await send(r.api, vid, b2.items[0].itemId, second[0]!);
    await h.app.get(ProcessorService).drain();

    // The pool lists only the CVs of the chosen upload.
    const all = (await r.api.get(`/candidates?vacancy=${vid}`)).json();
    expect(all.total).toBe(3);
    const only1 = (await r.api.get(`/candidates?vacancy=${vid}&batch=${b1.batchId}`)).json();
    const only2 = (await r.api.get(`/candidates?vacancy=${vid}&batch=${b2.batchId}`)).json();
    expect([only1.total, only2.total]).toEqual([2, 1]);
    expect((await r.api.get(`/candidates?batch=${'0'.repeat(26)}`)).statusCode).toBe(404);

    // Two failed CVs; retrying one by its document leaves the other alone.
    const mine = (await r.api.get(`/upload-batches/${b1.batchId}?items=1`)).json().items;
    for (const i of mine) {
      await h.db.owner.query(
        `UPDATE screening SET state = 'failed', score = NULL, band = NULL, breakdown = NULL WHERE document_id = $1`,
        [i.documentId],
      );
    }
    const one = await r.api.post(`/vacancies/${vid}/retry-failed`, {
      batchId: b1.batchId,
      documentId: mine[0].documentId,
    });
    expect(one.json().requeued).toBe(1);
    const left = await h.db.owner.query(
      `SELECT count(*)::int AS n FROM screening s JOIN cv_document d ON d.id = s.document_id
        WHERE d.vacancy_id = $1 AND s.state = 'failed'`,
      [vid],
    );
    expect(left.rows[0].n).toBe(1);
    await h.app.get(ProcessorService).drain();
    const audit = await h.db.owner.query(
      `SELECT after FROM audit_event WHERE action = 'screening.retried' ORDER BY seq DESC LIMIT 1`,
    );
    expect(audit.rows[0].after).toMatchObject({ scope: 'one', count: 1 });
  });

  it('keeps the legacy 50-file route working and answers the same shape', async () => {
    const r = await h.recruiter('legacy@azerconnect.test');
    const vid = await ready(r.api);
    const m = multipart([file('Legacy One Person')]);
    expect(m.payload.length).toBeGreaterThan(0);
    const res = await r.api.upload(`/vacancies/${vid}/documents`, [
      file('Legacy One Person'),
      { name: 'x.png', type: 'image/png', data: Buffer.from('png') },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().results.map((x: any) => x.status)).toEqual(['queued', 'rejected']);
  });
});
