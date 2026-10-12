import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';

process.env['TEST_VISIBILITY'] = 'all';

describeDb('Candidate pool (Development Plan WP 3.1 to 3.6; spec 6.8, 6.9)', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env['TEST_NAMES'] = 'shown';
    h = await boot('cpool');
  });
  afterAll(async () => {
    delete process.env['TEST_VISIBILITY'];
    delete process.env['TEST_NAMES'];
    await h?.close();
  });

  const cvs = [
    {
      name: 'Alice One',
      lines: ['Worked on BGP routing for 6 years.', 'Kubernetes in production.', 'Python scripts.'],
    },
    { name: 'Bob Two', lines: ['BGP routing at an ISP.', 'Docker only.'] },
    { name: 'Cem Three', lines: ['Sales assistant.'] },
  ];

  it('lists every analyzed resume with the name, the match, and the decision, from one source', async () => {
    const a = await h.recruiter('p1@azerconnect.test');
    const vid = await h.scenario(a.api, cvs, 'Pool role A');
    const res = (await a.api.get(`/candidates?vacancy=${vid}`)).json();
    expect(res.total).toBe(3);
    expect(res.rows.map((r: { label: string }) => r.label)).toEqual([
      'Alice One',
      'Bob Two',
      'Cem Three',
    ]);
    expect(res.rows[0]).toMatchObject({
      pseudonym: 'Candidate 01',
      name: 'Alice One',
      decision: 'new',
      decisionVersion: 0,
      outOfDate: false,
      vacancyTitle: 'Pool role A',
    });
    expect(res.counts.byMark).toEqual({ new: 3, shortlist: 0, maybe: 0, not_now: 0 });
    // Search is folded and works on names.
    const q = (await a.api.get(`/candidates?vacancy=${vid}&q=ALICE`)).json();
    expect(q.rows.map((r: { label: string }) => r.label)).toEqual(['Alice One']);
    // Sort by candidate, descending.
    const s = (await a.api.get(`/candidates?vacancy=${vid}&sort=candidate&order=desc`)).json();
    expect(s.rows[0].label).toBe('Cem Three');
  });

  it('marks with a version check, Undo, note, and who changed it', async () => {
    const a = await h.recruiter('p2@azerconnect.test');
    const b = await h.recruiter('p3@azerconnect.test');
    const vid = await h.scenario(a.api, cvs, 'Pool role B');
    const row = (await a.api.get(`/candidates?vacancy=${vid}`)).json().rows[0];
    const set = await a.api.put(`/candidates/${row.matchId}/decision`, {
      mark: 'shortlist',
      expectedVersion: 0,
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({
      mark: 'shortlist',
      version: 1,
      previous: { mark: 'new', version: 0 },
    });
    // Someone else still holds version 0: refused, and told who changed it.
    const stale = await b.api.put(`/candidates/${row.matchId}/decision`, {
      mark: 'not_now',
      expectedVersion: 0,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'STALE_VERSION', mark: 'shortlist', version: 1 });
    expect(stale.json().message).toMatch(/p2 already changed this to Shortlist/);
    // A note is optional; Undo is a mark that restores the previous one.
    const maybe = await b.api.put(`/candidates/${row.matchId}/decision`, {
      mark: 'maybe',
      note: 'Call back in May',
      expectedVersion: 1,
    });
    expect(maybe.json()).toMatchObject({ mark: 'maybe', note: 'Call back in May', version: 2 });
    const undo = await b.api.put(`/candidates/${row.matchId}/decision`, {
      mark: maybe.json().previous.mark,
      note: maybe.json().previous.note,
      expectedVersion: 2,
    });
    expect(undo.json()).toMatchObject({ mark: 'shortlist', version: 3 });
    const list = (await a.api.get(`/candidates?vacancy=${vid}&decision=shortlist`)).json();
    expect(list.rows).toHaveLength(1);
    // 'New' clears the mark.
    await a.api.put(`/candidates/${row.matchId}/decision`, { mark: 'new', expectedVersion: 3 });
    expect((await a.api.get(`/candidates?vacancy=${vid}&decision=new`)).json().total).toBe(3);
    // The report's history lists every change.
    const rep = (await a.api.get(`/candidates/${row.matchId}/report`)).json();
    expect(rep.history.map((x: { mark: string }) => x.mark)).toEqual([
      'new',
      'shortlist',
      'maybe',
      'shortlist',
    ]);
  });

  it('changes up to 100 at once and reports the rows that failed', async () => {
    const a = await h.recruiter('p4@azerconnect.test');
    const vid = await h.scenario(a.api, cvs, 'Pool role C');
    const rows = (await a.api.get(`/candidates?vacancy=${vid}`)).json().rows;
    const ids = rows.map((r: { matchId: string }) => r.matchId);
    const bad = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const r = await a.api.post('/candidates/decisions', {
      matchIds: [...ids, bad],
      mark: 'not_now',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().changed).toBe(3);
    expect(r.json().results.find((x: { matchId: string }) => x.matchId === bad)).toMatchObject({
      ok: false,
    });
    expect(
      (await a.api.post('/candidates/decisions', { matchIds: [], mark: 'new' })).statusCode,
    ).toBe(400);
  });

  it('keeps marks working on a Closed vacancy and refuses them on an Archived one', async () => {
    const a = await h.recruiter('p5@azerconnect.test');
    const vid = await h.scenario(a.api, cvs.slice(0, 1), 'Pool role D');
    const v = (await a.api.get(`/vacancies/${vid}`)).json();
    await a.api.patch(`/vacancies/${vid}`, { expectedVersion: v.version, status: 'closed' });
    const row = (await a.api.get(`/candidates?vacancy=${vid}`)).json().rows[0];
    expect(row.vacancyStatus).toBe('closed');
    expect(
      (
        await a.api.put(`/candidates/${row.matchId}/decision`, {
          mark: 'maybe',
          expectedVersion: 0,
        })
      ).statusCode,
    ).toBe(200);
    await a.api.post(`/vacancies/${vid}/archive`);
    const refused = await a.api.put(`/candidates/${row.matchId}/decision`, {
      mark: 'shortlist',
      expectedVersion: 1,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/archived/);
    // An archived vacancy's candidates are out of the default pool.
    expect((await a.api.get(`/candidates?vacancy=${vid}`)).json().total).toBe(0);
    expect((await a.api.get(`/candidates?vacancy=${vid}&archived=true`)).json().total).toBe(1);
  });

  it('pages 50 at a time with a cursor, and a cursor expires after 15 minutes', async () => {
    const a = await h.recruiter('p6@azerconnect.test');
    const vid = await h.scenario(a.api, cvs, 'Pool role E');
    const first = (await a.api.get(`/candidates?vacancy=${vid}&limit=2`)).json();
    expect(first.rows).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toBeTruthy();
    const next = (
      await a.api.get(`/candidates?vacancy=${vid}&limit=2&cursor=${first.nextCursor}`)
    ).json();
    expect(next.rows).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    const c = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString());
    c.at -= 16 * 60_000;
    const old = Buffer.from(JSON.stringify(c)).toString('base64url');
    const gone = await a.api.get(`/candidates?vacancy=${vid}&limit=2&cursor=${old}`);
    expect(gone.statusCode).toBe(410);
    expect(gone.json().message).toMatch(/Reload/);
  });

  it('gives the report: evidence anchors in the resume, history, and the out-of-date banner', async () => {
    const a = await h.recruiter('p7@azerconnect.test');
    const vid = await h.scenario(a.api, cvs.slice(0, 1), 'Pool role F');
    const row = (await a.api.get(`/candidates?vacancy=${vid}`)).json().rows[0];
    const rep = (await a.api.get(`/candidates/${row.matchId}/report`)).json();
    expect(rep).toMatchObject({ namesShown: true, name: 'Alice One', outOfDate: null });
    const bgp = rep.requirements.find((r: { text: string }) => /BGP/.test(r.text));
    expect(bgp.state).toBe('matched');
    expect(bgp.anchors.length).toBeGreaterThan(0);
    const resume = (await a.api.get(`/candidates/${row.matchId}/resume`)).json();
    expect(resume.view).toBe('original');
    const a0 = bgp.anchors[0];
    expect(resume.text.slice(a0.start, a0.end)).toBe(a0.quote);
    expect(resume.text).toContain('Alice One');
    // Change the requirements: the match is out of date and the report says what changed.
    const v = (await a.api.get(`/vacancies/${vid}`)).json();
    const reqs = v.requirements.map(
      (r: { text: string; classification: string; weight: number }) => ({
        text: r.text,
        classification: /Kubernetes/.test(r.text) ? 'preferred' : r.classification,
        weight: /Kubernetes/.test(r.text) ? 5 : r.weight,
      }),
    );
    await a.api.patch(`/vacancies/${vid}`, { expectedVersion: v.version, requirements: reqs });
    const after = (await a.api.get(`/candidates/${row.matchId}/report`)).json();
    expect(after.outOfDate.changes).toHaveLength(1);
    expect((await a.api.get(`/candidates?vacancy=${vid}&outOfDate=true`)).json().total).toBe(1);
  });

  it('exports the filtered pool as a spreadsheet and writes the Shortlist summary', async () => {
    const a = await h.recruiter('p8@azerconnect.test');
    const vid = await h.scenario(a.api, cvs, 'Pool role G');
    const rows = (await a.api.get(`/candidates?vacancy=${vid}`)).json().rows;
    await a.api.put(`/candidates/${rows[0].matchId}/decision`, {
      mark: 'shortlist',
      note: '=cmd()',
      expectedVersion: 0,
    });
    const x = await a.api.get(`/candidates/export?vacancy=${vid}`);
    expect(x.statusCode).toBe(200);
    expect(String(x.headers['content-type'])).toContain('spreadsheetml');
    expect(x.body.slice(0, 2)).toBe('PK');
    const sum = (await a.api.get(`/candidates/shortlist-summary?vacancy=${vid}`)).json();
    expect(sum.count).toBe(1);
    expect(sum.body).toContain('Alice One');
    expect(sum.body).toContain('=cmd()');
    expect(sum.subject).toMatch(/^Shortlist for Pool role G/);
  });

  it('answers a plain 404 for a candidate that does not exist', async () => {
    const a = await h.recruiter('p9@azerconnect.test');
    const r = await a.api.get('/candidates/01ARZ3NDEKTSV4RRFFQ69G5FAV/report');
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toMatch(/could not find this candidate/);
  });

  it('suggests an existing vacancy when a new title looks the same, Closed ones included', async () => {
    const a = await h.recruiter('p10@azerconnect.test');
    const id = (await a.api.post('/vacancies', { title: 'Senior Network Engineer' })).json().id;
    const v = (await a.api.get(`/vacancies/${id}`)).json();
    await a.api.patch(`/vacancies/${id}`, { expectedVersion: v.version, status: 'closed' });
    const hit = (await a.api.get('/vacancies/similar?title=Senior%20network%20engineer%20')).json();
    expect(hit.map((x: { id: string }) => x.id)).toContain(id);
    expect(hit.find((x: { id: string }) => x.id === id).status).toBe('closed');
    const none = (await a.api.get('/vacancies/similar?title=Chief%20Gardener')).json();
    expect(none).toEqual([]);
  });
});
