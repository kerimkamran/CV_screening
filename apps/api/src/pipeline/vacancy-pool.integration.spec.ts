import { describeDb } from '../testing/pg-harness';
import { boot, JD, type Harness } from '../testing/app-harness';
import { VacancyScope } from '../vacancy/vacancy-scope.service';

process.env['TEST_VISIBILITY'] = 'all';

describeDb('Vacancy pool (Development Plan WP 1.2 to 1.6; spec 6.7, 6.10)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('vpool');
  });
  afterAll(async () => {
    delete process.env['TEST_VISIBILITY'];
    await h?.close();
  });

  it('creates a vacancy from a title alone, as a Draft the creator owns', async () => {
    const a = await h.recruiter('v1@azerconnect.test');
    const c = await a.api.post('/vacancies', { title: 'Backend Engineer' });
    expect(c.statusCode).toBe(201);
    const v = (await a.api.get(`/vacancies/${c.json().id}`)).json();
    expect(v).toMatchObject({
      title: 'Backend Engineer',
      status: 'draft',
      version: 1,
      requirementsVersion: 1,
      canEdit: true,
      archived: false,
      description: '',
      requirements: [],
    });
    expect((await a.api.post('/vacancies', { title: '' })).statusCode).toBe(400);
  });

  it('every recruiter sees and changes every vacancy, and each change is under their own name', async () => {
    const a = await h.recruiter('own@azerconnect.test');
    const b = await h.recruiter('other@azerconnect.test');
    const id = (await a.api.post('/vacancies', { title: 'Shared role' })).json().id;
    const seen = (await b.api.get('/vacancies')).json();
    expect(seen.map((x: { id: string }) => x.id)).toContain(id);
    expect(seen.find((x: { id: string }) => x.id === id).canEdit).toBe(true);
    const theirs = (await b.api.get(`/vacancies/${id}`)).json();
    expect(theirs.canEdit).toBe(true);
    const edit = await b.api.patch(`/vacancies/${id}`, {
      expectedVersion: 1,
      title: 'Edited by B',
    });
    expect(edit.statusCode).toBe(200);
    expect((await b.api.post(`/vacancies/${id}/archive`)).statusCode).toBe(200);
    expect((await b.api.post(`/vacancies/${id}/restore`)).statusCode).toBe(200);
    // The owner stays the owner; the change is recorded under the person who made it.
    expect((await a.api.get(`/vacancies/${id}`)).json().owner.id).not.toBe(
      (await b.api.get('/me')).json().userId,
    );
    const audit = (
      await h.db.owner.query(
        `SELECT actor_id FROM audit_event WHERE entity_id = $1 AND action LIKE 'vacancy.%' ORDER BY seq`,
        [id],
      )
    ).rows.map((r: { actor_id: string }) => r.actor_id);
    expect(audit).toContain((await b.api.get('/me')).json().userId);
    // Governance and administrators still cannot change vacancies.
    expect(
      (await h.admin.patch(`/vacancies/${id}`, { expectedVersion: 2, title: 'x' })).statusCode,
    ).toBe(403);
  });

  it('with VACANCY_EDIT=owner, only the owner or a lead changes a vacancy (the earlier rule)', async () => {
    const env = (h.app.get(VacancyScope) as unknown as { env: { VACANCY_EDIT: string } }).env;
    env.VACANCY_EDIT = 'owner';
    try {
      const a = await h.recruiter('own2@azerconnect.test');
      const b = await h.recruiter('other2@azerconnect.test');
      const lead = await h.recruiter('lead2@azerconnect.test', 'TA_LEAD');
      const id = (await a.api.post('/vacancies', { title: 'Owned role' })).json().id;
      expect((await b.api.get(`/vacancies/${id}`)).json().canEdit).toBe(false);
      const denied = await b.api.patch(`/vacancies/${id}`, { expectedVersion: 1, title: 'Hijack' });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().message).toMatch(/owner or a recruiting lead/);
      expect((await b.api.post(`/vacancies/${id}/archive`)).statusCode).toBe(403);
      expect(
        (await lead.api.patch(`/vacancies/${id}`, { expectedVersion: 1, title: 'Lead edit' }))
          .statusCode,
      ).toBe(200);
    } finally {
      env.VACANCY_EDIT = 'everyone';
    }
  });

  it('saves the Role card with a version check, and refuses a stale save with who changed it', async () => {
    const a = await h.recruiter('ver@azerconnect.test');
    const lead = await h.recruiter('lead3@azerconnect.test', 'TA_LEAD');
    const id = (await a.api.post('/vacancies', { title: 'Versioned' })).json().id;
    const ok = await a.api.patch(`/vacancies/${id}`, {
      expectedVersion: 1,
      department: 'Core',
      openings: 2,
      closingDate: '2026-12-01',
      status: 'open',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      version: 2,
      department: 'Core',
      openings: 2,
      status: 'open',
    });
    expect(ok.json().closingDate).toBe('2026-12-01');
    // A lead saves in between; the first recruiter's next save is stale.
    await lead.api.patch(`/vacancies/${id}`, { expectedVersion: 2, notes: 'x' });
    const stale = await a.api.patch(`/vacancies/${id}`, { expectedVersion: 2, department: 'Edge' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'STALE_VERSION', version: 3 });
    expect(stale.json().message).toMatch(/Changed by lead3/);
  });

  it('raises the requirements version only once something was analyzed, and keeps history', async () => {
    const a = await h.recruiter('req@azerconnect.test');
    const vid = await h.scenario(
      a.api,
      [{ name: 'Alice One', lines: ['BGP routing.', 'Kubernetes.'] }],
      'History role',
    );
    let v = (await a.api.get(`/vacancies/${vid}`)).json();
    expect(v.requirementsVersion).toBe(1);
    expect(v.counts).toMatchObject({ analyzed: 1, outOfDate: 0 });
    const reqs = v.requirements.map(
      (r: { text: string; classification: string; weight: number }) => ({
        text: r.text,
        classification: r.classification,
        weight: r.weight,
      }),
    );
    // No change: no new version.
    const same = await a.api.patch(`/vacancies/${vid}`, {
      expectedVersion: v.version,
      requirements: reqs,
    });
    expect(same.json().requirementsVersion).toBe(1);
    // Turn a must-have into a nice-to-have: version 2, the match is out of date, nothing was re-scored.
    const changed = reqs.map((r: { text: string }) =>
      r.text === 'Kubernetes' ? { ...r, classification: 'preferred', weight: 5 } : r,
    );
    const put = await a.api.patch(`/vacancies/${vid}`, {
      expectedVersion: same.json().version,
      requirements: changed,
    });
    expect(put.statusCode).toBe(200);
    v = put.json();
    expect(v.requirementsVersion).toBe(2);
    expect(v.hasDraft).toBe(true);
    expect(v.counts).toMatchObject({ analyzed: 1, outOfDate: 1 });
    const list = (await a.api.get('/vacancies')).json().find((x: { id: string }) => x.id === vid);
    expect(list).toMatchObject({ analyzed: 1, outOfDate: 1 });
    const hist = (await a.api.get(`/vacancies/${vid}/history`)).json();
    expect(hist[0]).toMatchObject({ requirementsVersion: 2, cause: 'edit' });
    expect(hist[0].changes).toEqual([
      { field: 'requirement', requirement: 'Kubernetes', from: 'must-have', to: 'nice-to-have' },
    ]);
    // Re-analyze: the draft is frozen, the resume is scored again, and the match is current.
    const start = await a.api.post(`/vacancies/${vid}/start`, { confirmNotice: true });
    expect(start.json().queued).toBe(1);
    await h.app.get((await import('./processor.service')).ProcessorService).drain();
    v = (await a.api.get(`/vacancies/${vid}`)).json();
    expect(v.counts).toMatchObject({ analyzed: 1, outOfDate: 0 });
    const runs = (await a.api.get(`/vacancies/${vid}/runs`)).json();
    expect(runs.map((r: { version: number }) => r.version)).toEqual([2, 1]);
  });

  it('archives (with Undo via restore), refuses while a run is active, and duplicates without candidates', async () => {
    const a = await h.recruiter('arch@azerconnect.test');
    const vid = await h.scenario(
      a.api,
      [{ name: 'Bob Two', lines: ['BGP routing.'] }],
      'Archive role',
    );
    const arch = await a.api.post(`/vacancies/${vid}/archive`);
    expect(arch.json().archived).toBe(true);
    expect((await a.api.get('/vacancies')).json().some((x: { id: string }) => x.id === vid)).toBe(
      false,
    );
    const only = (await a.api.get('/vacancies?archived=true')).json();
    expect(only.map((x: { id: string }) => x.id)).toContain(vid);
    expect(
      (
        await a.api.patch(`/vacancies/${vid}`, {
          expectedVersion: arch.json().version,
          title: 'No',
        })
      ).statusCode,
    ).toBe(409);
    expect((await a.api.post(`/vacancies/${vid}/restore`)).json().archived).toBe(false);

    const dup = await a.api.post(`/vacancies/${vid}/duplicate`);
    expect(dup.statusCode).toBe(201);
    expect(dup.json()).toMatchObject({ title: 'Copy of Archive role', status: 'draft' });
    expect(dup.json().counts.documents).toBe(0);
    expect(dup.json().requirements.length).toBe(3);

    // A run in progress blocks archiving.
    const busy = await h.scenario(a.api, [], 'Busy role');
    await a.api.upload(`/vacancies/${busy}/documents`, [
      {
        name: 'C.txt',
        type: 'text/plain',
        data: Buffer.from(
          'Name: Cara Three\nBGP routing.\n' + 'Padding text for length. '.repeat(10),
        ),
      },
    ]);
    const refuse = await a.api.post(`/vacancies/${busy}/archive`);
    expect(refuse.statusCode).toBe(409);
    expect(refuse.json().message).toBe('Stop the running screening first');
  });

  it('filters by status and searches with Azerbaijani folding', async () => {
    const a = await h.recruiter('find@azerconnect.test');
    await a.api.post('/vacancies', { title: 'Şəbəkə Mühəndisi', jdText: JD });
    await a.api.post('/vacancies', { title: 'Data analyst' });
    const hit = (await a.api.get('/vacancies?q=sebeke%20muhendisi')).json();
    expect(hit.map((x: { title: string }) => x.title)).toEqual(['Şəbəkə Mühəndisi']);
    expect((await a.api.get('/vacancies?status=open&q=data')).json()).toEqual([]);
    const byTitle = (await a.api.get('/vacancies?sort=title&order=asc')).json();
    const titles = byTitle.map((x: { title: string }) => x.title);
    expect(titles.indexOf('Data analyst')).toBeLessThan(titles.indexOf('Şəbəkə Mühəndisi'));
  });

  it('keeps the link apart from the text, and Read again reports unchanged, changed or unreadable', async () => {
    const a = await h.recruiter('link@azerconnect.test');
    const id = (await a.api.post('/vacancies', { title: 'Linked' })).json().id;
    const { LinkReader } = await import('./link-reader');
    const { VacancyService } = await import('./vacancy.service');
    const http = await import('node:http');
    let html = `<html><body><h1>Backend Engineer</h1><p>${'You will build services and run Kubernetes clusters in production. '.repeat(8)}</p></body></html>`;
    const srv = http.createServer((_q, r) => {
      r.writeHead(200, { 'content-type': 'text/html' });
      r.end(html);
    });
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/job`;
    h.app.get(VacancyService).links = new LinkReader({ allowLoopback: true, timeoutMs: 2000 });
    try {
      const saved = await a.api.patch(`/vacancies/${id}`, { expectedVersion: 1, linkUrl: url });
      expect(saved.json().link).toMatchObject({ url, status: null });
      const first = (await a.api.post(`/vacancies/${id}/reread`, {})).json();
      expect(first.status).toBe('changed');
      const applied = (await a.api.post(`/vacancies/${id}/reread`, { apply: true })).json();
      expect(applied.status).toBe('applied');
      expect((await a.api.get(`/vacancies/${id}`)).json()).toMatchObject({
        sourceType: 'url',
        link: { status: 'read' },
      });
      expect((await a.api.post(`/vacancies/${id}/reread`, {})).json().status).toBe('unchanged');
      html = html.replace('Kubernetes', 'Terraform');
      expect((await a.api.post(`/vacancies/${id}/reread`, {})).json().status).toBe('changed');
    } finally {
      await new Promise((r) => srv.close(r));
    }
    // The page is gone: the old text stays, the link is marked unreadable.
    const gone = (await a.api.post(`/vacancies/${id}/reread`, {})).json();
    expect(gone.status).toBe('unreadable');
    expect((await a.api.get(`/vacancies/${id}`)).json().description).toContain('Kubernetes');
    expect(
      (await a.api.patch(`/vacancies/${id}`, { expectedVersion: 99, linkUrl: 'ftp://x' }))
        .statusCode,
    ).toBe(400);
  });
});
