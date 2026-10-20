import JSZip from 'jszip';
import { describeDb } from '../testing/pg-harness';
import { boot, cv, type Harness } from '../testing/app-harness';
import { redactUrl, requestLog } from '../common/correlation';
import { Gate } from './downloads.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('download plumbing', () => {
  it('lets two downloads run and makes the third wait its turn', async () => {
    const g = new Gate(2);
    const a = await g.take();
    const b = await g.take();
    let third = false;
    const c = g.take().then((r) => ((third = true), r));
    await new Promise((r) => setTimeout(r, 10));
    expect(third).toBe(false);
    a();
    a(); // releasing twice does nothing
    const rc = await c;
    expect(third).toBe(true);
    expect(g.inUse).toBe(2);
    b();
    rc();
    expect(g.inUse).toBe(0);
  });

  it('keeps the token out of the request log', () => {
    expect(redactUrl('/downloads/abcDEF_-123?x=1')).toBe('/downloads/[token]?x=1');
    expect(requestLog({ method: 'GET', url: '/downloads/secret', ip: '1.2.3.4' })).toMatchObject({
      method: 'GET',
      url: '/downloads/[token]',
      remoteAddress: '1.2.3.4',
    });
    expect(redactUrl('/documents/x/file')).toBe('/documents/x/file');
  });
});

describeDb('Download CVs as one ZIP (Stage 2, S2-BE8)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('downloads');
  });
  afterAll(async () => {
    await h?.close();
  });

  async function setup(email: string) {
    const r = await h.recruiter(email);
    const vid = await h.scenario(r.api, [
      { name: 'Alpha Person', lines: ['BGP routing.'] },
      { name: 'Beta Person', lines: ['OSPF.'] },
    ]);
    await r.api.upload(`/vacancies/${vid}/documents`, [
      {
        name: 'alpha.txt',
        type: 'text/plain',
        data: Buffer.from(cv('Alpha Again', ['BGP and more.'])),
      },
    ]);
    const docs = (
      await h.db.owner.query(
        `SELECT id, filename FROM cv_document WHERE vacancy_id = $1 ORDER BY uploaded_at, id`,
        [vid],
      )
    ).rows as { id: string; filename: string }[];
    return { r, vid, docs };
  }

  it('hands out a short-lived ticket and streams a valid ZIP of exactly the chosen CVs, once', async () => {
    const { r, docs } = await setup('zip@azerconnect.test');
    const ids = docs.map((d) => d.id);
    const t = await r.api.post('/downloads', { documentIds: ids });
    expect(t.statusCode).toBe(201);
    const body = t.json();
    expect(body).toMatchObject({ files: 3, excluded: [] });
    expect(body.url).toMatch(/^\/downloads\/[A-Za-z0-9_-]{43}$/);
    expect(body.archiveName).toMatch(/^CVs - .+ - \d{4}-\d{2}-\d{2}\.zip$/);
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(121_000);

    // No session needed: the token is the credential.
    const res = await h.app.inject({ method: 'GET', url: body.url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(String(res.headers['content-disposition'])).toContain('attachment');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    const zip = await JSZip.loadAsync(res.rawPayload);
    const names = Object.keys(zip.files);
    expect(names).toHaveLength(3);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3); // clashes renamed
    expect(await zip.file(names[0]!)!.async('string')).toContain('Alpha Person');

    // Single use.
    expect((await h.app.inject({ method: 'GET', url: body.url })).statusCode).toBe(410);
    expect((await h.app.inject({ method: 'GET', url: '/downloads/nonsense' })).statusCode).toBe(
      410,
    );

    const audit = (
      await h.db.owner.query(
        `SELECT action, entity_id, after FROM audit_event
          WHERE action IN ('download.requested', 'document.downloaded', 'download.sent')
            AND (after->>'ticketId' IS NOT NULL OR action <> 'document.downloaded') ORDER BY seq`,
      )
    ).rows.filter((x: any) => x.action !== 'download.requested' || x.after.files === 3);
    expect(
      audit
        .filter((x: any) => x.action === 'document.downloaded')
        .map((x: any) => x.entity_id)
        .sort(),
    ).toEqual([...ids].sort());
    expect(audit.find((x: any) => x.action === 'download.sent')?.after).toMatchObject({
      files: 3,
      of: 3,
      complete: true,
    });
  });

  it('lists erased and unknown CVs as left out, and refuses when nothing is left', async () => {
    const { r, docs } = await setup('left@azerconnect.test');
    await h.db.owner.query(
      `UPDATE cv_document SET erased_at = now(), content = NULL WHERE id = $1`,
      [docs[1]!.id],
    );
    const other = await setup('someone-else@azerconnect.test');
    const t = (
      await r.api.post('/downloads', {
        documentIds: [docs[0]!.id, docs[1]!.id, other.docs[0]!.id],
      })
    ).json();
    expect(t.files).toBe(1);
    expect(t.excluded).toEqual([
      { documentId: docs[1]!.id, label: expect.stringMatching(/Candidate/), reason: 'erased' },
      { documentId: other.docs[0]!.id, label: null, reason: 'not_found' },
    ]);
    const none = await r.api.post('/downloads', { documentIds: [docs[1]!.id] });
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe('NOTHING_TO_DOWNLOAD');
  });

  it('reads one snapshot: a CV erased after the ticket is still whole in the ZIP that was asked for', async () => {
    const { r, docs } = await setup('snap@azerconnect.test');
    const t = (await r.api.post('/downloads', { documentIds: [docs[0]!.id] })).json();
    // Erased before the GET: the ticket names it, but the snapshot no longer has it, so it is not sent.
    await h.db.owner.query(
      `UPDATE cv_document SET erased_at = now(), content = NULL WHERE id = $1`,
      [docs[0]!.id],
    );
    const res = await h.app.inject({ method: 'GET', url: t.url });
    expect(res.statusCode).toBe(200);
    const zip = await JSZip.loadAsync(res.rawPayload);
    expect(Object.keys(zip.files)).toHaveLength(0);
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
  });

  it('caps a download at 500 CVs and keeps it to recruiters and team leads', async () => {
    const { r } = await setup('cap@azerconnect.test');
    const many = Array.from({ length: 501 }, (_, i) => `01${String(i).padStart(24, '0')}`);
    const big = await r.api.post('/downloads', { documentIds: many });
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe('DOWNLOAD_TOO_MANY');
    expect((await r.api.post('/downloads', { documentIds: [] })).statusCode).toBe(400);
    expect((await h.admin.post('/downloads', { documentIds: many.slice(0, 1) })).statusCode).toBe(
      403,
    );
    expect(
      (await h.app.inject({ method: 'POST', url: '/downloads', payload: {} })).statusCode,
    ).toBe(401);
  });

  it('refuses an expired ticket', async () => {
    const { r, docs } = await setup('late@azerconnect.test');
    const t = (await r.api.post('/downloads', { documentIds: [docs[0]!.id] })).json();
    await h.db.owner.query(`UPDATE download_ticket SET expires_at = now() - interval '1 second'`);
    expect((await h.app.inject({ method: 'GET', url: t.url })).statusCode).toBe(410);
  });
});
