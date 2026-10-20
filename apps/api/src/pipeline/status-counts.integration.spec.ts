import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';

/** S2-BE1: one status vocabulary, and the three counting bugs it fixes. */
describeDb('CV statuses and counts (Stage 2, S2-BE1)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('statuses');
  });
  afterAll(async () => h?.close());

  it('gives every CV one status, counts a failed CV once, and never shows a phantom "queued"', async () => {
    const r = await h.recruiter('status@azerconnect.test');
    const vid = await h.scenario(r.api, [
      { name: 'Alice Full', lines: ['BGP routing.', 'Kubernetes.'] },
      { name: 'Bob Routing', lines: ['BGP routing.'] },
    ]);

    let list = (await r.api.get(`/vacancies/${vid}/candidates`)).json();
    expect(list.candidates.map((c: { status: string }) => c.status)).toEqual([
      'analyzed',
      'analyzed',
    ]);
    let counts = (await r.api.get(`/vacancies/${vid}`)).json().counts;
    expect(counts).toMatchObject({
      documents: 2,
      analyzed: 2,
      running: 0,
      failed: 0,
      needsLook: 0,
    });

    // One analysis fails: it is counted as failed once, and is NOT also "needs a look".
    const failing = list.candidates[1].screeningId as string;
    await h.db.owner.query(
      `UPDATE screening SET state = 'failed', score = NULL, band = NULL, breakdown = NULL WHERE id = $1`,
      [failing],
    );
    list = (await r.api.get(`/vacancies/${vid}/candidates`)).json();
    expect(list.candidates.map((c: { status: string }) => c.status).sort()).toEqual([
      'analyzed',
      'failed',
    ]);
    counts = (await r.api.get(`/vacancies/${vid}`)).json().counts;
    expect(counts).toMatchObject({
      documents: 2,
      analyzed: 1,
      failed: 1,
      needsLook: 0,
      running: 0,
    });

    // The criteria change: nothing is analyzed on the new criteria yet. That is "not analyzed",
    // not "queued", so nothing keeps polling and nothing is counted as running or failed.
    expect((await r.api.post(`/vacancies/${vid}/criteria/new-version`)).statusCode).toBe(201);
    expect((await r.api.post(`/vacancies/${vid}/criteria/freeze`)).statusCode).toBe(200);
    list = (await r.api.get(`/vacancies/${vid}/candidates`)).json();
    for (const c of list.candidates) {
      expect(c.state).toBe('not_analyzed');
      expect(c.status).toBe('not_analyzed');
    }
    expect(list.counts.queued).toBe(0);
    counts = (await r.api.get(`/vacancies/${vid}`)).json().counts;
    expect(counts).toMatchObject({
      documents: 2,
      analyzed: 1, // the earlier result stays visible
      running: 0,
      failed: 0,
      needsLook: 0,
      notAnalyzed: 2,
    });
  });
});
