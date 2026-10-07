import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessorService } from './processor.service';
import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';

interface Cand {
  screeningId: string;
  documentId: string;
}

describeDb('Shared reports (design spec 6.5)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('reports');
  });
  afterAll(async () => h?.close());

  const cvs = [
    { name: 'Alice Full', lines: ['BGP routing.', 'Kubernetes.', 'Python scripting.'] },
    { name: 'Bob Routing', lines: ['BGP routing.'] },
    { name: 'Carol Nothing', lines: ['Cooking.'] },
  ];

  async function setup(tag: string) {
    const ayla = await h.recruiter(`ayla-${tag}@azerconnect.test`);
    const manager = await h.recruiter(`manager-${tag}@azerconnect.test`, 'NONE');
    const outsider = await h.recruiter(`outsider-${tag}@azerconnect.test`, 'NONE');
    const vid = await h.scenario(ayla.api, cvs);
    return { ayla, manager, outsider, vid };
  }

  it('shares a snapshot with named people only; pseudonyms and no names by default', async () => {
    const { ayla, manager, outsider, vid } = await setup('a');
    const r = await ayla.api.post(`/vacancies/${vid}/shares`, { viewerIds: [manager.userId] });
    expect(r.statusCode).toBe(200);
    const { id } = r.json();

    const open = await manager.api.get(`/reports/${id}`);
    expect(open.statusCode).toBe(200);
    const { report, sharedBy } = open.json();
    expect(sharedBy).toContain('ayla');
    expect(report.counts).toMatchObject({ total: 3, read: 3 });
    expect(report.role.must).toEqual(['BGP routing', 'Kubernetes']);
    expect(report.candidates.length).toBeGreaterThanOrEqual(2);
    const body = JSON.stringify(open.json());
    // No real name, e-mail or internal key leaves the system by default.
    for (const n of ['Alice', 'Bob', 'Carol', 'documentId']) expect(body).not.toContain(n);
    expect(report.candidates[0].label).toMatch(/^Candidate \d\d$/);
    expect(report.candidates[0].name).toBeNull();
    // Candidates are ranked, best first.
    const scores = report.candidates.map((c: { score: number }) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // The link alone is never enough: someone not named is refused, and that is recorded.
    expect((await outsider.api.get(`/reports/${id}`)).statusCode).toBe(403);
    expect((await outsider.api.get(`/reports/${id}`)).json().code).toBe('REPORT_DENIED');
    const opens = (await ayla.api.get(`/vacancies/${vid}/shares`)).json().shares[0];
    expect(opens.openCount).toBe(1);
    expect(opens.opens.map((o: { outcome: string }) => o.outcome).sort()).toEqual([
      'denied',
      'denied',
      'ok',
    ]);
  });

  it('a person with no role can open shared reports and nothing else', async () => {
    const { ayla, manager, vid } = await setup('b');
    const { id } = (
      await ayla.api.post(`/vacancies/${vid}/shares`, { viewerIds: [manager.userId] })
    ).json();
    expect((await manager.api.get('/me')).json().roles).toEqual([]);
    const mine = (await manager.api.get('/reports/mine')).json().reports;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id, title: 'Senior Network Engineer' });
    for (const url of [
      '/vacancies',
      `/vacancies/${vid}`,
      `/vacancies/${vid}/candidates`,
      `/vacancies/${vid}/shares`,
      '/reports/people',
      '/admin/users',
    ]) {
      expect((await manager.api.get(url)).statusCode).toBe(403);
    }
    expect(
      (await manager.api.post(`/vacancies/${vid}/shares`, { viewerIds: [manager.userId] }))
        .statusCode,
    ).toBe(403);
    expect((await manager.api.post(`/shares/${id}/revoke`)).statusCode).toBe(403);
  });

  it('includes real names only for revealed or shortlisted candidates, and only when asked', async () => {
    const { ayla, manager, vid } = await setup('c');
    const list = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json().candidates as (Cand & {
      candidateName: string | null;
    })[];
    const alice = list.find((c) => c.candidateName?.includes('Alice'))!;
    const bob = list.find((c) => c.candidateName?.includes('Bob'))!;
    await ayla.api.post('/screenings/reveal-names', { screeningIds: [alice.screeningId] });
    await ayla.api.post(`/screenings/${bob.screeningId}/decision`, {
      outcome: 'shortlist',
      reason: 'Strong routing background',
    });

    // Not asked for: no names even though one was revealed.
    const plain = (
      await ayla.api.post(`/vacancies/${vid}/shares`, { viewerIds: [manager.userId] })
    ).json();
    expect(JSON.stringify((await manager.api.get(`/reports/${plain.id}`)).json())).not.toContain(
      'Alice',
    );

    const named = (
      await ayla.api.post(`/vacancies/${vid}/shares`, {
        viewerIds: [manager.userId],
        includeNames: true,
      })
    ).json();
    const rep = (await manager.api.get(`/reports/${named.id}`)).json().report;
    const names = rep.candidates.map((c: { name: string | null }) => c.name).filter(Boolean);
    expect(names.sort()).toEqual(['Alice Full', 'Bob Routing']);
    expect(JSON.stringify(rep)).not.toContain('Carol');
    expect(rep.decisions[0]).toMatchObject({
      outcome: 'shortlist',
      reason: 'Strong routing background',
    });
    expect(rep.decisions[0].documentId).toBeUndefined();
  });

  it('can leave the quotes out, and hides a candidate name found inside the text', async () => {
    const { ayla, manager, vid } = await setup('d');
    const withQ = (
      await ayla.api.post(`/vacancies/${vid}/shares`, { viewerIds: [manager.userId] })
    ).json();
    const a = (await manager.api.get(`/reports/${withQ.id}`)).json().report;
    expect(a.candidates.some((c: { quotes: unknown[] }) => c.quotes.length > 0)).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/Alice|Bob|Carol/);

    const noQ = (
      await ayla.api.post(`/vacancies/${vid}/shares`, {
        viewerIds: [manager.userId],
        includeQuotes: false,
      })
    ).json();
    const b = (await manager.api.get(`/reports/${noQ.id}`)).json().report;
    expect(b.candidates.every((c: { quotes: unknown[] }) => c.quotes.length === 0)).toBe(true);
    expect(b.includeQuotes).toBe(false);
  });

  it('refuses expired and revoked links plainly, and records the attempt', async () => {
    const { ayla, manager, vid } = await setup('e');
    const s = (
      await ayla.api.post(`/vacancies/${vid}/shares`, { viewerIds: [manager.userId] })
    ).json();
    await h.db.owner.query(
      `UPDATE report_share SET expires_at = now() + interval '1 second', created_at = now() - interval '1 hour' WHERE id = $1`,
      [s.id],
    );
    await new Promise((r) => setTimeout(r, 1200));
    const gone = await manager.api.get(`/reports/${s.id}`);
    expect(gone.statusCode).toBe(410);
    expect(gone.json().code).toBe('REPORT_GONE');
    expect((await manager.api.get('/reports/mine')).json().reports).toHaveLength(0);

    const s2 = (
      await ayla.api.post(`/vacancies/${vid}/shares`, { viewerIds: [manager.userId] })
    ).json();
    expect((await manager.api.get(`/reports/${s2.id}`)).statusCode).toBe(200);
    expect((await ayla.api.post(`/shares/${s2.id}/revoke`)).json()).toEqual({ revoked: true });
    expect((await manager.api.get(`/reports/${s2.id}`)).statusCode).toBe(410);
    const shares = (await ayla.api.get(`/vacancies/${vid}/shares`)).json().shares;
    expect(shares.map((x: { state: string }) => x.state).sort()).toEqual(['expired', 'revoked']);
    const revoked = shares.find((x: { id: string }) => x.id === s2.id);
    expect(revoked.opens.map((o: { outcome: string }) => o.outcome)).toEqual(['revoked', 'ok']);
    const audit = await h.db.owner.query(
      `SELECT action FROM audit_event WHERE action LIKE 'report.%' ORDER BY seq`,
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toContain('report.revoked');
    expect((await manager.api.get('/reports/01ARZ3NDEKTSV4RRFFQ69G5FAV')).statusCode).toBe(404);
  });

  it('is only offered when the scan is done and something was scored; validates the people', async () => {
    const ayla = await h.recruiter('ayla-f@azerconnect.test');
    const viewer = await h.recruiter('viewer-f@azerconnect.test', 'NONE');
    const empty = await h.scenario(ayla.api, []);
    const r = await ayla.api.post(`/vacancies/${empty}/shares`, { viewerIds: [viewer.userId] });
    expect(r.statusCode).toBe(409);
    expect((await ayla.api.post(`/vacancies/${empty}/shares`, { viewerIds: [] })).statusCode).toBe(
      400,
    );
    expect(
      (
        await ayla.api.post(`/vacancies/${empty}/shares`, {
          viewerIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await ayla.api.post(`/vacancies/${empty}/shares`, {
          viewerIds: [viewer.userId],
          expiresInDays: 400,
        })
      ).statusCode,
    ).toBe(400);
    // Another recruiter cannot share a vacancy they cannot see.
    const other = await h.recruiter('other-f@azerconnect.test');
    expect(
      (await other.api.post(`/vacancies/${empty}/shares`, { viewerIds: [viewer.userId] }))
        .statusCode,
    ).toBe(404);
    const people = (await ayla.api.get('/reports/people?q=viewer-f')).json().people;
    expect(people.map((p: { id: string }) => p.id)).toEqual([viewer.userId]);
  });

  it('scrubs names, reasons and quotes from snapshots when a resume is erased', async () => {
    const { ayla, manager, vid } = await setup('g');
    const list = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json().candidates as (Cand & {
      candidateName: string | null;
    })[];
    const alice = list.find((c) => c.candidateName?.includes('Alice'))!;
    await ayla.api.post('/screenings/reveal-names', { screeningIds: [alice.screeningId] });
    const s = (
      await ayla.api.post(`/vacancies/${vid}/shares`, {
        viewerIds: [manager.userId],
        includeNames: true,
      })
    ).json();
    expect(JSON.stringify((await manager.api.get(`/reports/${s.id}`)).json())).toContain(
      'Alice Full',
    );
    expect((await ayla.api.post(`/documents/${alice.documentId}/erase`)).statusCode).toBe(200);
    const after = (await manager.api.get(`/reports/${s.id}`)).json().report;
    expect(JSON.stringify(after)).not.toContain('Alice');
    expect(after.candidates.every((c: { name: string | null }) => c.name === null)).toBe(true);
  });

  it('carries the reviewer reason, without a hidden name, and scrubs it on erase', async () => {
    const { ayla, manager, vid } = await setup('h');
    const list = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json().candidates as (Cand & {
      candidateName: string | null;
    })[];
    const carol = list.find((c) => c.candidateName?.includes('Carol'))!;
    await ayla.api.post(`/screenings/${carol.screeningId}/decision`, {
      outcome: 'hold',
      reason: 'Carol Nothing to call back on Monday',
    });
    const s = (
      await ayla.api.post(`/vacancies/${vid}/shares`, { viewerIds: [manager.userId] })
    ).json();
    const rep = (await manager.api.get(`/reports/${s.id}`)).json().report;
    expect(rep.decisions).toHaveLength(1);
    expect(rep.decisions[0].reason).toContain('[name]');
    expect(JSON.stringify(rep)).not.toContain('Carol');
    expect(JSON.stringify(rep)).not.toContain('Nothing');

    expect((await ayla.api.post(`/documents/${carol.documentId}/erase`)).statusCode).toBe(200);
    const after = (await manager.api.get(`/reports/${s.id}`)).json().report;
    expect(after.decisions[0].reason).toBe('');
  });

  it('gives a PDF quotation its page number', async () => {
    const ayla = await h.recruiter('ayla-p@azerconnect.test');
    const manager = await h.recruiter('manager-p@azerconnect.test', 'NONE');
    const vid = await h.scenario(ayla.api, []);
    const up = await ayla.api.upload(`/vacancies/${vid}/documents`, [
      {
        name: 'nigar.pdf',
        type: 'application/pdf',
        data: readFileSync(join(__dirname, '..', 'testing', 'fixtures', 'cv-two-pages.pdf')),
      },
    ]);
    expect(up.statusCode).toBe(200);
    await h.app.get(ProcessorService).drain();
    const list = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json().candidates as Cand[];
    const detail = (await ayla.api.get(`/screenings/${list[0]!.screeningId}`)).json();
    const pages = detail.assessments
      .filter((a: { evidence: unknown[] | null }) => a.evidence?.length)
      .map((a: { text: string; evidence: { page: number }[] }) => [a.text, a.evidence[0]!.page]);
    expect(pages).toEqual(
      expect.arrayContaining([
        ['BGP routing', 1],
        ['Kubernetes', 2],
      ]),
    );
    const { id } = (
      await ayla.api.post(`/vacancies/${vid}/shares`, { viewerIds: [manager.userId] })
    ).json();
    const rep = (await manager.api.get(`/reports/${id}`)).json().report;
    const q = rep.candidates[0].quotes as { requirement: string; page: number }[];
    expect(q.find((x) => x.requirement === 'Kubernetes')?.page).toBe(2);
    expect(q.find((x) => x.requirement === 'BGP routing')?.page).toBe(1);
  });
});
