import { ProcessorService } from './processor.service';
import { describeDb } from '../testing/pg-harness';
import { boot } from '../testing/app-harness';

describeDb('Stopping and continuing a scan (design spec 6.3)', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    h = await boot('stop');
  });
  afterAll(async () => h?.close());

  it('keeps what was scored, marks the rest as stopped (not deleted), and continues on request', async () => {
    const ayla = await h.recruiter('ayla@azerconnect.test');
    const vid = await h.scenario(ayla.api, []);
    const files = ['One', 'Two', 'Three', 'Four'].map((n) => ({
      name: `${n}.txt`,
      type: 'text/plain',
      data: Buffer.from(
        `Name: ${n} Person\nBGP routing for carriers.\n${'Padding text. '.repeat(20)}`,
      ),
    }));
    expect((await ayla.api.upload(`/vacancies/${vid}/documents`, files)).statusCode).toBe(200);
    // Two are read, then the recruiter stops.
    const worker = h.app.get(ProcessorService);
    await worker.tick();
    await worker.tick();
    const stop = await ayla.api.post(`/vacancies/${vid}/stop`);
    expect(stop.json()).toEqual({ stopped: 2 });

    // The worker leaves stopped files alone.
    expect(await worker.tick()).toBe(false);
    const list = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json();
    expect(list.counts).toMatchObject({ total: 4, queued: 0, stopped: 2 });
    expect(list.candidates.filter((c: { state: string }) => c.state === 'completed')).toHaveLength(
      2,
    );
    expect(list.candidates.filter((c: { state: string }) => c.state === 'stopped')).toHaveLength(2);

    // Stopping twice does nothing more; the stop is in the audit trail.
    expect((await ayla.api.post(`/vacancies/${vid}/stop`)).json()).toEqual({ stopped: 0 });
    const audit = await h.db.owner.query(
      `SELECT action FROM audit_event WHERE action IN ('screening.stopped','screening.continued') ORDER BY seq`,
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      'screening.stopped',
      'screening.stopped',
    ]);

    // Continue puts them back and they are read.
    expect((await ayla.api.post(`/vacancies/${vid}/continue`)).json()).toEqual({ continued: 2 });
    await worker.drain();
    const after = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json();
    expect(after.counts).toMatchObject({ queued: 0, stopped: 0 });
    expect(after.candidates.every((c: { state: string }) => c.state === 'completed')).toBe(true);
  });

  it("does not let another recruiter stop someone else's scan", async () => {
    const a = await h.recruiter('owner@azerconnect.test');
    const b = await h.recruiter('other@azerconnect.test');
    const vid = await h.scenario(a.api, []);
    expect((await b.api.post(`/vacancies/${vid}/stop`)).statusCode).toBe(404);
  });
});
