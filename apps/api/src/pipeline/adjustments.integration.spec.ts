import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';

describeDb('Editing requirements on the results screen (design spec 6.2.5)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('adj');
  });
  afterAll(async () => h?.close());

  const order = (list: {
    candidates: { candidateName: string | null; score: { value: number } | null }[];
  }) => list.candidates.map((c) => `${c.candidateName}:${c.score?.value}`);

  it('re-ranks from stored assessments without calling the model, keeps who and when, and goes back to the original', async () => {
    const ayla = await h.recruiter('ayla@azerconnect.test');
    const vid = await h.scenario(ayla.api, [
      {
        name: 'Alice Full',
        lines: [
          'BGP routing at two carriers.',
          'Kubernetes in production.',
          'Python scripting daily.',
        ],
      },
      { name: 'Bob Routing', lines: ['BGP routing at three carriers.'] },
      {
        name: 'Cora Cloud',
        lines: ['Kubernetes platform owner.', 'Python scripting for tooling.'],
      },
    ]);
    const first = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json();
    expect(order(first)).toEqual(['Alice Full:100', 'Cora Cloud:60', 'Bob Routing:40']);
    expect(first.candidates.some((c: { adjusted?: boolean }) => c.adjusted)).toBe(false);

    const v0 = (await ayla.api.get(`/vacancies/${vid}/adjustments`)).json();
    expect(v0.changeCount).toBe(0);
    const kube = v0.requirements.find((r: { text: string }) => r.text === 'Kubernetes');
    expect(kube).toMatchObject({ original: 'mandatory', current: 'mandatory' });

    // Preview does not store anything.
    const calls = h.modelCalls.length;
    const prev = (
      await ayla.api.post(`/vacancies/${vid}/adjustments/preview`, {
        requirementId: kube.id,
        to: 'ignore',
      })
    ).json();
    expect(Object.values(prev.scores).sort()).toEqual([100, 33.33, 66.67].sort());
    expect((await ayla.api.get(`/vacancies/${vid}/adjustments`)).json().changeCount).toBe(0);

    // Ignore Kubernetes: Bob (BGP only) now outranks Cora.
    const set = await ayla.api.post(`/vacancies/${vid}/adjustments`, {
      requirementId: kube.id,
      to: 'ignore',
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ changeCount: 1 });
    expect(set.json().changes[0]).toMatchObject({
      requirement: 'Kubernetes',
      from: 'mandatory',
      to: 'ignore',
      by: 'ayla',
    });
    const after = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json();
    expect(order(after)).toEqual(['Alice Full:100', 'Bob Routing:66.67', 'Cora Cloud:33.33']);
    expect(
      after.candidates.find((c: { candidateName: string }) => c.candidateName === 'Bob Routing'),
    ).toMatchObject({
      adjusted: true,
      originalScore: 40,
    });
    // The breakdown matches the new score (SCORE-03) and the model was never called.
    const bob = after.candidates.find(
      (c: { candidateName: string }) => c.candidateName === 'Bob Routing',
    );
    expect(bob.score.breakdown.items.map((i: { text: string }) => i.text)).toEqual([
      'BGP routing',
      'Python scripting',
    ]);
    expect(h.modelCalls.length).toBe(calls);

    // The detail page shows the same adjusted score as the list.
    const detail = (await ayla.api.get(`/screenings/${bob.screeningId}`)).json();
    expect(detail).toMatchObject({ adjusted: true, score: { value: 66.67 } });

    // Moving to nice-to-have, then back to original.
    await ayla.api.post(`/vacancies/${vid}/adjustments`, {
      requirementId: kube.id,
      to: 'preferred',
    });
    const mid = (await ayla.api.get(`/vacancies/${vid}/adjustments`)).json();
    expect(mid.changeCount).toBe(2);
    expect(mid.requirements.find((r: { id: string }) => r.id === kube.id).current).toBe(
      'preferred',
    );
    const reset = (await ayla.api.post(`/vacancies/${vid}/adjustments/reset`)).json();
    expect(reset.changeCount).toBe(0);
    expect(order((await ayla.api.get(`/vacancies/${vid}/candidates`)).json())).toEqual(
      order(first),
    );
    // History keeps all of it, including the reset.
    expect(reset.changes.map((c: { reset: boolean }) => c.reset)).toEqual([false, false, true]);

    // Append-only, and audited.
    await expect(h.db.owner.query(`DELETE FROM criteria_adjustment`)).rejects.toThrow(
      /append-only/,
    );
    const audit = await h.db.owner.query(
      `SELECT action FROM audit_event WHERE action LIKE 'criteria.adjust%' ORDER BY seq`,
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      'criteria.adjusted',
      'criteria.adjusted',
      'criteria.adjustment_reset',
    ]);
  });

  it('refuses a requirement from another vacancy and hides the vacancy from other recruiters', async () => {
    const a = await h.recruiter('owner2@azerconnect.test');
    const b = await h.recruiter('other2@azerconnect.test');
    const v1 = await h.scenario(a.api, []);
    const v2 = await h.scenario(a.api, [], 'Another role');
    const other = (await a.api.get(`/vacancies/${v2}/adjustments`)).json().requirements[0];
    expect(
      (await a.api.post(`/vacancies/${v1}/adjustments`, { requirementId: other.id, to: 'ignore' }))
        .statusCode,
    ).toBe(400);
    expect((await b.api.get(`/vacancies/${v1}/adjustments`)).statusCode).toBe(404);
    expect((await b.api.post(`/vacancies/${v1}/adjustments/reset`)).statusCode).toBe(404);
  });
});
