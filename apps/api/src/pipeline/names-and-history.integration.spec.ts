import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';

describeDb('Names, Focus on skills and Past scans (design spec 6.2.6, 6.4)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('names');
  });
  afterAll(async () => h?.close());

  it('remembers revealed names per recruiter from the audit trail, and hiding is recorded too', async () => {
    const ayla = await h.recruiter('ayla@azerconnect.test');
    const lead = await h.recruiter('lead@azerconnect.test', 'TA_LEAD');
    const vid = await h.scenario(ayla.api, [
      { name: 'Alice Full', lines: ['BGP routing.', 'Kubernetes.'] },
      { name: 'Bob Routing', lines: ['BGP routing.'] },
    ]);
    const list = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json();
    // Pseudonym numbers come from upload order and are stable.
    expect(list.candidates.map((c: { ordinal: number }) => c.ordinal).sort()).toEqual([1, 2]);
    const [a, b] = list.candidates.map((c: { screeningId: string }) => c.screeningId) as string[];

    expect((await ayla.api.get(`/vacancies/${vid}/revealed`)).json()).toEqual({ screeningIds: [] });
    await ayla.api.post('/screenings/reveal-names', { screeningIds: [a, b] });
    await ayla.api.post('/screenings/hide-names', { screeningIds: [b] });
    const mine = (await ayla.api.get(`/vacancies/${vid}/revealed`)).json();
    expect(mine.screeningIds).toEqual([a]);
    // Another recruiter (a lead sees every vacancy) has revealed nobody: the choice is personal.
    expect((await lead.api.get(`/vacancies/${vid}/revealed`)).json()).toEqual({ screeningIds: [] });

    const actions = await h.db.owner.query(
      `SELECT action FROM audit_event WHERE action LIKE 'candidate.name_%' ORDER BY seq`,
    );
    expect(actions.rows.map((r: { action: string }) => r.action)).toEqual([
      'candidate.name_revealed',
      'candidate.name_revealed',
      'candidate.name_hidden',
    ]);

    // The detail view carries the pseudonym number and the total.
    const d = (await ayla.api.get(`/screenings/${a}`)).json();
    expect(d.documentCount).toBe(2);
    expect([1, 2]).toContain(d.ordinal);
    const other = await h.recruiter('stranger@azerconnect.test');
    expect((await other.api.post('/screenings/hide-names', { screeningIds: [a] })).statusCode).toBe(
      404,
    );
  });

  it('stores Focus on skills per person, separately from the background', async () => {
    const r = await h.recruiter('focus@azerconnect.test');
    expect((await r.api.get('/me')).json()).toMatchObject({
      focusOnSkills: false,
      background: null,
    });
    expect((await r.api.put('/me/preferences', { focusOnSkills: true })).json()).toEqual({
      background: null,
      focusOnSkills: true,
    });
    expect((await r.api.put('/me/preferences', { background: 'sky' })).json()).toEqual({
      background: 'sky',
      focusOnSkills: true,
    });
    expect((await r.api.put('/me/preferences', { background: null })).json()).toEqual({
      background: null,
      focusOnSkills: true,
    });
    expect((await r.api.get('/me')).json().focusOnSkills).toBe(true);
    expect((await r.api.put('/me/preferences', { focusOnSkills: false })).json()).toEqual({
      background: null,
      focusOnSkills: false,
    });
    expect((await r.api.put('/me/preferences', {})).statusCode).toBe(400);
    const rows = await h.db.owner.query(`SELECT * FROM user_preference WHERE user_id = $1`, [
      r.userId,
    ]);
    expect(rows.rowCount).toBe(0); // nothing left to store
  });

  it('lists past scans with how far each one got', async () => {
    const a = await h.recruiter('history@azerconnect.test');
    const vid = await h.scenario(
      a.api,
      [{ name: 'Only One', lines: ['BGP routing.'] }],
      'History role',
    );
    const list = (await a.api.get('/vacancies')).json();
    const v = list.find((x: { id: string }) => x.id === vid);
    expect(v).toMatchObject({
      title: 'History role',
      documentCount: 1,
      scoredCount: 1,
      pendingCount: 0,
      stoppedCount: 0,
      criteriaVersion: 1,
    });
  });
});
