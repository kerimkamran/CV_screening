import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';

process.env['TEST_VISIBILITY'] = 'all';

describeDb('Candidate pool with names hidden (CANDIDATE_NAMES=hidden; spec 6.9)', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env['TEST_NAMES'] = 'hidden';
    h = await boot('chidden');
  });
  afterAll(async () => {
    delete process.env['TEST_VISIBILITY'];
    delete process.env['TEST_NAMES'];
    await h?.close();
  });

  it('shows pseudonyms, an anonymised resume, and records the two reveals separately', async () => {
    const a = await h.recruiter('hid1@azerconnect.test');
    const vid = await h.scenario(
      a.api,
      [
        {
          name: 'Alice One',
          lines: [
            'Worked on BGP routing.',
            'Kubernetes in production.',
            'Email: alice@example.com',
          ],
        },
      ],
      'Hidden role',
    );
    const row = (await a.api.get(`/candidates?vacancy=${vid}`)).json().rows[0];
    expect(row).toMatchObject({ label: 'Candidate 01', name: null });
    expect((await a.api.get(`/candidates?vacancy=${vid}&q=Alice`)).json().total).toBe(0);

    const rep = (await a.api.get(`/candidates/${row.matchId}/report`)).json();
    expect(rep).toMatchObject({ namesShown: false, name: null, email: null, filename: null });
    expect(JSON.stringify(rep)).not.toMatch(/Alice|alice@example/);

    const anon = (await a.api.get(`/candidates/${row.matchId}/resume`)).json();
    expect(anon.view).toBe('anonymised');
    expect(anon.text).not.toMatch(/Alice|alice@example/);
    const bgp = rep.requirements.find((r: { text: string }) => /BGP/.test(r.text));
    const an = bgp.anchors[0];
    expect(anon.text.slice(an.start, an.end)).toBe(an.quote);

    const orig = (await a.api.get(`/candidates/${row.matchId}/resume?view=original`)).json();
    expect(orig.text).toContain('Alice One');
    expect(orig.text.slice(an.os, an.oe)).toContain('BGP');

    const name = (await a.api.post(`/candidates/${row.matchId}/reveal`, { kind: 'name' })).json();
    expect(name).toMatchObject({ kind: 'name', name: 'Alice One' });
    await a.api.post(`/candidates/${row.matchId}/reveal`, { kind: 'name', hide: true });
    const { rows } = await h.db.owner.query(
      `SELECT action FROM audit_event WHERE entity_id = $1 AND action LIKE 'candidate.%' ORDER BY seq`,
      [row.matchId],
    );
    expect(rows.map((r: { action: string }) => r.action)).toEqual([
      'candidate.original_revealed',
      'candidate.name_revealed',
      'candidate.name_hidden',
    ]);
  });
});
