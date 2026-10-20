import { describeDb } from '../testing/pg-harness';
import { boot, cv, type Harness } from '../testing/app-harness';
import { ProcessorService } from './processor.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

describeDb('The review screen server side (Stage 2, S2-BE5, S2-BE6)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('review');
  });
  afterAll(async () => {
    await h?.close();
  });

  const fakePdf = (tag: string) => ({
    name: `${tag}.pdf`,
    type: 'application/pdf',
    data: Buffer.from(`%PDF-1.4 not a real file ${tag}`),
  });
  /** Two analyzed CVs, one unreadable PDF, one failed, one still queued. */
  async function mixed(email: string) {
    const r = await h.recruiter(email);
    const vid = await h.scenario(r.api, [
      { name: 'Alpha Person', lines: ['BGP routing and OSPF.', 'Ten years of network design.'] },
      { name: 'Beta Person', lines: ['Some Python scripting only.'] },
    ]);
    await r.api.upload(`/vacancies/${vid}/documents`, [fakePdf('scan')]);
    await r.api.upload(`/vacancies/${vid}/documents`, [
      { name: 'gamma.txt', type: 'text/plain', data: Buffer.from(cv('Gamma Person', ['BGP.'])) },
      { name: 'delta.txt', type: 'text/plain', data: Buffer.from(cv('Delta Person', ['OSPF.'])) },
    ]);
    // Gamma fails, Delta stays queued (run it back to queued so it is "being analyzed").
    const by = async (f: string) =>
      (
        await h.db.owner.query(
          `SELECT d.id AS doc, s.id AS sid FROM cv_document d JOIN screening s ON s.document_id = d.id
            WHERE d.vacancy_id = $1 AND d.filename = $2`,
          [vid, f],
        )
      ).rows[0] as { doc: string; sid: string };
    const proc = h.app.get(ProcessorService);
    await proc.drain();
    const gamma = await by('gamma.txt');
    const delta = await by('delta.txt');
    await h.db.owner.query(
      `UPDATE screening SET state = 'failed', score = NULL, band = NULL, breakdown = NULL, error = 'Model timed out' WHERE id = $1`,
      [gamma.sid],
    );
    await h.db.owner.query(
      `UPDATE screening SET state = 'queued', score = NULL, band = NULL, breakdown = NULL, run_after = now() + interval '1 day' WHERE id = $1`,
      [delta.sid],
    );
    return {
      r,
      vid,
      gamma,
      delta,
      scan: await by('scan.pdf'),
      alpha: await by('Alpha_Person.txt'),
    };
  }

  it('opens a CV in any state with identity, file facts, status and analysis in one answer', async () => {
    const { r, alpha, scan, gamma, delta } = await mixed('states@azerconnect.test');
    const a = (await r.api.get(`/documents/${alpha.doc}`)).json();
    expect(a).toMatchObject({
      documentId: alpha.doc,
      kind: 'txt',
      status: 'analyzed',
      original: { available: true, view: 'none' },
      text: { available: true },
    });
    expect(a.analysis.score).toBeGreaterThan(0);
    expect(a.analysis.requirements.length).toBeGreaterThan(0);
    expect(a.matchId).toBe(a.analysis.matchId);

    const s = (await r.api.get(`/documents/${scan.doc}`)).json();
    expect(s).toMatchObject({
      kind: 'pdf',
      status: 'unreadable',
      analysis: null,
      original: { available: true, view: 'pdf' },
    });
    expect(s.statusDetail.reason).toBeTruthy();
    expect(s.matchId).toBe(s.screeningId); // a human can mark it after reading the original

    const g = (await r.api.get(`/documents/${gamma.doc}`)).json();
    expect(g).toMatchObject({
      status: 'failed',
      statusDetail: { retryable: true, error: 'Model timed out' },
      analysis: null,
    });
    expect(g.matchId).toBeNull();

    const d = (await r.api.get(`/documents/${delta.doc}`)).json();
    expect(d.status).toBe('analyzing');
    expect(d.pseudonym).toMatch(/Candidate/);
  });

  it('lets a person mark an unreadable CV, but not one that is still being analyzed', async () => {
    const { r, scan, delta } = await mixed('marks@azerconnect.test');
    const s = (await r.api.get(`/documents/${scan.doc}`)).json();
    const ok = await r.api.put(`/candidates/${s.matchId}/decision`, {
      mark: 'maybe',
      expectedVersion: 0,
    });
    expect(ok.statusCode).toBe(200);
    expect((await r.api.get(`/documents/${scan.doc}`)).json().decision).toMatchObject({
      mark: 'maybe',
      version: 1,
    });
    const d = (await r.api.get(`/documents/${delta.doc}`)).json();
    expect(d.matchId).toBeNull();
    const refused = await r.api.put(`/candidates/${delta.sid}/decision`, {
      mark: 'maybe',
      expectedVersion: 0,
    });
    expect(refused.statusCode).toBe(409);
  });

  it('returns the text, and 409 when there is none', async () => {
    const { r, alpha, scan } = await mixed('text@azerconnect.test');
    const t = await r.api.get(`/documents/${alpha.doc}/text`);
    expect(t.statusCode).toBe(200);
    expect(t.json().text).toContain('BGP');
    expect(t.json().blocks.length).toBeGreaterThan(0);
    expect((await r.api.get(`/documents/${scan.doc}/text`)).statusCode).toBe(409);
  });

  it('is a 404 for another recruiter and a 403 for a role that may not see files', async () => {
    const { alpha } = await mixed('owner@azerconnect.test');
    const other = await h.recruiter('other@azerconnect.test');
    expect((await other.api.get(`/documents/${alpha.doc}`)).statusCode).toBe(404);
    expect((await other.api.get(`/documents/${alpha.doc}/view`)).statusCode).toBe(404);
    expect((await other.api.get(`/documents/${alpha.doc}/text`)).statusCode).toBe(404);
    const none = await h.recruiter('norole@azerconnect.test', 'NONE');
    expect((await none.api.get(`/documents/${alpha.doc}`)).statusCode).toBe(403);
    expect((await h.admin.get(`/documents/${alpha.doc}/view`)).statusCode).toBe(403);
  });

  it('writes every open and every download to the audit trail before sending', async () => {
    const { r, vid, scan, alpha } = await mixed('audit@azerconnect.test');
    const view = await r.api.get(`/documents/${scan.doc}/view`);
    expect(view.statusCode).toBe(200);
    expect(view.headers['content-type']).toBe('application/pdf');
    expect(String(view.headers['content-disposition'])).toContain('inline');
    expect(view.headers['x-content-type-options']).toBe('nosniff');
    expect(String(view.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(view.headers['x-frame-options']).toBe('DENY');
    expect(view.body.startsWith('%PDF-')).toBe(true);
    const file = await r.api.get(`/documents/${alpha.doc}/file`);
    expect(file.statusCode).toBe(200);
    expect(String(file.headers['content-disposition'])).toContain('attachment');
    const rows = (
      await h.db.owner.query(
        `SELECT action, entity_id, after FROM audit_event
          WHERE action IN ('document.opened', 'document.downloaded') ORDER BY seq`,
      )
    ).rows;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'document.opened',
          entity_id: scan.doc,
          after: expect.objectContaining({ as: 'pdf', vacancyId: vid }),
        }),
        expect.objectContaining({
          action: 'document.downloaded',
          entity_id: alpha.doc,
          after: { via: 'file' },
        }),
      ]),
    );
    // A text file has no pages, and a Word file without a rendition says so; neither is audited as opened.
    const before = rows.length;
    expect((await r.api.get(`/documents/${alpha.doc}/view`)).json().code).toBe('NO_PREVIEW');
    const after = (
      await h.db.owner.query(
        `SELECT count(*)::int AS n FROM audit_event WHERE action = 'document.opened'`,
      )
    ).rows[0].n;
    expect(after).toBe(1);
    expect(before).toBeGreaterThanOrEqual(2);
  });

  it('lists every CV with its status after the ranked ones, and the ids follow the same order', async () => {
    const { r, vid, scan, gamma, delta, alpha } = await mixed('list@azerconnect.test');
    const plain = (await r.api.get(`/candidates?vacancy=${vid}`)).json();
    expect(plain.rows.every((x: any) => x.matchId && !('status' in x))).toBe(true);
    const all = (await r.api.get(`/candidates?vacancy=${vid}&status=all`)).json();
    expect(all.total).toBe(5);
    const ranked = all.rows.filter((x: any) => x.matchId);
    const rest = all.rows.filter((x: any) => !x.matchId);
    expect(all.rows.slice(0, ranked.length)).toEqual(ranked); // status rows come last
    expect(rest.map((x: any) => x.status).sort()).toEqual(['analyzing', 'failed', 'unreadable']);
    expect(rest.every((x: any) => x.score === null && x.band === null)).toBe(true);
    expect(all.counts.byMark.new).toBe(ranked.length); // counts stay about ranked rows
    const ids = (await r.api.get(`/candidates/ids?vacancy=${vid}&status=all`)).json();
    expect(ids.items.map((i: [string, string | null]) => i[0])).toEqual(
      all.rows.map((x: any) => x.documentId),
    );
    expect(ids).toMatchObject({ total: 5, truncated: false });
    expect(ids.items.find((i: any) => i[0] === alpha.doc)[1]).toBeTruthy();
    expect(ids.items.find((i: any) => i[0] === gamma.doc)[1]).toBeNull();
    const onlyFailed = (await r.api.get(`/candidates?vacancy=${vid}&status=failed`)).json();
    expect(onlyFailed.rows.map((x: any) => x.documentId)).toEqual([gamma.doc]);
    const look = (
      await r.api.get(`/candidates?vacancy=${vid}&status=needs_look,unreadable`)
    ).json();
    expect(look.rows.map((x: any) => x.documentId)).toEqual([scan.doc]);
    const withRanked = (await r.api.get(`/candidates?vacancy=${vid}&status=analyzed,failed`)).json();
    expect(withRanked.rows.filter((x: any) => x.matchId).length).toBe(ranked.length);
    expect(withRanked.rows.some((x: any) => x.documentId === gamma.doc)).toBe(true);
    expect(rest.map((x: any) => x.documentId)).toEqual(
      expect.arrayContaining([scan.doc, gamma.doc, delta.doc]),
    );
    // Sorting never moves a status row ahead of a ranked one.
    const byName = (
      await r.api.get(`/candidates?vacancy=${vid}&status=all&sort=candidate&order=desc`)
    ).json();
    expect(byName.rows.slice(-3).every((x: any) => !x.matchId)).toBe(true);
  });

  it('pages a long list and keeps ids complete', async () => {
    const r = await h.recruiter('many@azerconnect.test');
    const vid = await h.scenario(
      r.api,
      Array.from({ length: 7 }, (_, i) => ({ name: `Many P${i}`, lines: [`BGP ${i}.`] })),
    );
    const page = (await r.api.get(`/candidates?vacancy=${vid}&status=all&limit=3`)).json();
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toBeTruthy();
    const ids = (await r.api.get(`/candidates/ids?vacancy=${vid}&status=all`)).json();
    expect(ids.items).toHaveLength(7);
  });
});
