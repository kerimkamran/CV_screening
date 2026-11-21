import { createHash } from 'node:crypto';
import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';
import { announce, itemRow, ready, sendItem, textFile } from '../testing/stage3-upload';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** S3-UP-04: erase and the retention purge scrub file names; only their SHA-256 stays. */
describeDb('File-name scrub on erase (S3-UP-04)', () => {
  let h: Harness;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env['TEST_VISIBILITY'] = 'all';
    h = await boot('scrub');
  });
  afterAll(async () => {
    await h?.close();
    process.env['TEST_VISIBILITY'] = env['TEST_VISIBILITY'];
  });
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
  const findName = async (name: string) =>
    Number(
      (
        await h.db.owner.query(
          `SELECT (SELECT count(*) FROM cv_document WHERE filename LIKE '%' || $1 || '%')
                + (SELECT count(*) FROM upload_item WHERE filename LIKE '%' || $1 || '%' OR client_path LIKE '%' || $1 || '%') AS n`,
          [name],
        )
      ).rows[0].n,
    );

  it('erase keeps only the hash: cv_document, every upload_item (a duplicate item too) and a copy are scrubbed', async () => {
    const r = await h.recruiter('erase1@azerconnect.test');
    const vid = await ready(r.api);
    const f = textFile('Gulnar Mammadova');
    const b = (
      await announce(r.api, vid, [
        { name: f.name, size: f.data.length },
        { name: f.name, size: f.data.length },
      ])
    ).json();
    // Put a path on the first item, as a folder upload does.
    await h.db.owner.query(`UPDATE upload_item SET client_path = $2 WHERE id = $1`, [
      b.items[0].itemId,
      `cvs/${f.name}`,
    ]);
    const first = (await sendItem(r.api, vid, b.items[0].itemId, f)).json().results[0];
    const second = (await sendItem(r.api, vid, b.items[1].itemId, f)).json().results[0];
    expect(first.status).toBe('queued');
    expect(second).toMatchObject({ status: 'duplicate', documentId: first.documentId });
    // A copy for another vacancy (as SenAI "Analyze for this vacancy" makes) goes with it.
    const vid2 = await ready(r.api, 'Copy Target');
    const copyId = '0'.repeat(25) + '9';
    await h.db.owner.query(
      `INSERT INTO cv_document (id, vacancy_id, filename, mime, size_bytes, sha256, content, text, parse_status, uploaded_by, copied_from)
       SELECT $1, $2, filename, mime, size_bytes, sha256, content, text, parse_status, uploaded_by, id FROM cv_document WHERE id = $3`,
      [copyId, vid2, first.documentId],
    );
    expect(await findName('Gulnar_Mammadova')).toBeGreaterThan(0);

    expect((await r.api.post(`/documents/${first.documentId}/erase`, {})).statusCode).toBe(200);
    const doc = (
      await h.db.owner.query(`SELECT filename, erased_name_sha FROM cv_document WHERE id = $1`, [
        first.documentId,
      ])
    ).rows[0];
    expect(doc).toEqual({ filename: 'erased', erased_name_sha: sha(f.name) });
    for (const it of b.items)
      expect(await itemRow(h, it.itemId)).toMatchObject({ filename: 'erased', client_path: null });
    const copy = (
      await h.db.owner.query(`SELECT filename, erased_at FROM cv_document WHERE id = $1`, [copyId])
    ).rows[0];
    expect(copy.filename).toBe('erased');
    expect(copy.erased_at).not.toBeNull();
    expect(await findName('Gulnar_Mammadova')).toBe(0);
    // The audit rows carry no file name.
    const audit = await h.db.owner.query(
      `SELECT after FROM audit_event WHERE action = 'document.erase' AND entity_id = $1`,
      [first.documentId],
    );
    expect(JSON.stringify(audit.rows)).not.toContain('Gulnar');
    // The batch shows the row as Erased, with no name.
    const state = (await r.api.get(`/upload-batches/${b.batchId}?items=1`)).json();
    expect(state.items[0]).toMatchObject({ status: 'erased', filename: 'erased' });
  });

  it('a retention purge leaves the same scrubbed state', async () => {
    const r = await h.recruiter('erase2@azerconnect.test');
    const vid = await ready(r.api);
    const f = textFile('Purged Person');
    const res = (await r.api.upload(`/vacancies/${vid}/documents`, [f])).json().results[0];
    await h.db.owner.query(
      `UPDATE cv_document SET uploaded_at = now() - interval '400 days' WHERE id = $1`,
      [res.documentId],
    );
    const policy = await h.admin.put('/admin/retention', { enabled: true, days: 180 });
    expect([200, 201]).toContain(policy.statusCode);
    const run = await h.admin.post('/admin/retention/run', { dryRun: false });
    expect([200, 201]).toContain(run.statusCode);
    const doc = (
      await h.db.owner.query(
        `SELECT filename, erased_name_sha, erased_at FROM cv_document WHERE id = $1`,
        [res.documentId],
      )
    ).rows[0];
    expect(doc.erased_at).not.toBeNull();
    expect(doc).toMatchObject({ filename: 'erased', erased_name_sha: sha(f.name) });
    expect(await findName('Purged_Person')).toBe(0);
  });

  it('a file skipped on the legacy route, then taken in, then erased, stays off the skipped list', async () => {
    const r = await h.recruiter('erase3@azerconnect.test');
    const vid = await ready(r.api);
    const name = 'Later_Taken.txt';
    // 1) skipped: an empty file with this name.
    const empty = await r.api.upload(`/vacancies/${vid}/documents`, [
      { name, type: 'text/plain', data: Buffer.alloc(0) },
    ]);
    expect(empty.json().results[0].code).toBe('empty');
    expect((await r.api.get(`/vacancies/${vid}/skipped`)).json().skipped).toHaveLength(1);
    // 2) taken in later under the same name.
    await new Promise((res) => setTimeout(res, 20));
    const ok = (
      await r.api.upload(`/vacancies/${vid}/documents`, [{ ...textFile('Later Taken') }])
    ).json().results[0];
    expect(ok.status).toBe('queued');
    expect((await r.api.get(`/vacancies/${vid}/skipped`)).json().skipped).toHaveLength(0);
    // 3) erased: the name is gone, but the hash still matches, so it stays off the list.
    await r.api.post(`/documents/${ok.documentId}/erase`, {});
    expect((await r.api.get(`/vacancies/${vid}/skipped`)).json().skipped).toHaveLength(0);
  });
});
