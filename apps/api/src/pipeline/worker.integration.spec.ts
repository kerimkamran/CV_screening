import { AiGateway } from '../ai/ai-gateway.service';
import { describeDb } from '../testing/pg-harness';
import { boot, cv, JD, type Api, type Harness } from '../testing/app-harness';
import { ProcessorService } from './processor.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The worker (Stage 2, S2-BE4): fills free slots, shares fairly, leases its claims, guards its writes. */
describeDb('Worker speed and safety (Stage 2, S2-BE4)', () => {
  let h: Harness;
  let proc: ProcessorService;
  let gw: AiGateway;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env['WORKER_CONCURRENCY'] = '4';
    h = await boot('worker');
    proc = h.app.get(ProcessorService);
    gw = h.app.get(AiGateway);
  });
  afterAll(async () => {
    await h?.close();
    process.env['WORKER_CONCURRENCY'] = env['WORKER_CONCURRENCY'];
  });

  /** Hold every model call until `open()` is called, so claims stay in flight. */
  const gate = () => {
    const original = gw.fetcher;
    let release!: () => void;
    const closed = new Promise<void>((r) => (release = r));
    let held = true;
    gw.fetcher = (async (url: any, init: any) => {
      if (held) await closed;
      return original(url, init);
    }) as typeof fetch;
    return {
      open() {
        held = false;
        release();
        gw.fetcher = original;
      },
    };
  };

  const ready = async (api: Api, title: string) => {
    const vid = (await api.post('/vacancies', { title, jdText: JD })).json().id as string;
    await api.post(`/vacancies/${vid}/criteria/extract`);
    await api.post(`/vacancies/${vid}/criteria/freeze`);
    await api.post(`/vacancies/${vid}/notice-confirm`);
    return vid;
  };
  const upload = async (api: Api, vid: string, n: number, tag: string) => {
    const files = Array.from({ length: n }, (_, i) => ({
      name: `${tag}_${i}.txt`,
      type: 'text/plain',
      data: Buffer.from(cv(`${tag} Person${i}`, [`BGP routing ${tag} ${i}.`])),
    }));
    for (let i = 0; i < files.length; i += 50) {
      const r = await api.upload(`/vacancies/${vid}/documents`, files.slice(i, i + 50));
      expect(r.statusCode).toBe(200);
    }
  };
  const inFlight = async (vid: string) =>
    Number(
      (
        await h.db.owner.query(
          `SELECT count(*) AS n FROM screening s JOIN cv_document d ON d.id = s.document_id
            WHERE d.vacancy_id = $1 AND s.state = 'processing'`,
          [vid],
        )
      ).rows[0].n,
    );
  const settle = async () => {
    for (let i = 0; i < 400; i++) {
      const n = Number(
        (await h.db.owner.query(`SELECT count(*) AS n FROM screening WHERE state = 'processing'`))
          .rows[0].n,
      );
      if (n === 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('worker did not settle');
  };

  it('claims C rows in one fill, and two vacancies take turns instead of one starving the other', async () => {
    const r = await h.recruiter('fair@azerconnect.test');
    const big = await ready(r.api, 'Big Vacancy');
    const small = await ready(r.api, 'Small Vacancy');
    await upload(r.api, big, 6, 'big');
    await upload(r.api, small, 2, 'small');
    const g = gate();
    await proc.fill();
    expect(await inFlight(big)).toBe(2);
    expect(await inFlight(small)).toBe(2); // 4 in flight, shared fairly
    g.open();
    await settle();
    await proc.drain();
    const left = await h.db.owner.query(
      `SELECT count(*) AS n FROM screening WHERE state IN ('queued','processing')`,
    );
    expect(Number(left.rows[0].n)).toBe(0);
  });

  it('puts an expired lease back in the queue, and fails it after its third attempt', async () => {
    const r = await h.recruiter('lease@azerconnect.test');
    const vid = await ready(r.api, 'Lease Vacancy');
    await upload(r.api, vid, 2, 'lease');
    const ids = (
      await h.db.owner.query(
        `SELECT s.id FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1 ORDER BY d.filename`,
        [vid],
      )
    ).rows.map((x: any) => x.id as string);
    await h.db.owner.query(
      `UPDATE screening SET state = 'processing', claim_id = $2, lease_until = now() - interval '1 minute', attempts = 1 WHERE id = $1`,
      [ids[0], 'C'.repeat(26)],
    );
    await h.db.owner.query(
      `UPDATE screening SET state = 'processing', claim_id = $2, lease_until = now() - interval '1 minute', attempts = 3 WHERE id = $1`,
      [ids[1], 'D'.repeat(26)],
    );
    // A live lease is left alone.
    expect(await proc.recover()).toBe(2);
    const rows = (
      await h.db.owner.query(
        `SELECT id, state, claim_id, error FROM screening WHERE id = ANY($1)`,
        [ids],
      )
    ).rows;
    const by = Object.fromEntries(rows.map((x: any) => [x.id, x]));
    expect(by[ids[0]!]).toMatchObject({ state: 'queued', claim_id: null });
    expect(by[ids[1]!]).toMatchObject({ state: 'failed' });
    expect(by[ids[1]!].error).toBeTruthy();
    await h.db.owner.query(
      `UPDATE screening SET state = 'processing', claim_id = $2, lease_until = now() + interval '2 minutes' WHERE id = $1`,
      [ids[0], 'E'.repeat(26)],
    );
    expect(await proc.recover()).toBe(0);
    await h.db.owner.query(
      `UPDATE screening SET state = 'queued', claim_id = NULL, lease_until = NULL WHERE id = $1`,
      [ids[0]],
    );
    await proc.drain();
  });

  it('a CV erased during its analysis stays erased and no result is written', async () => {
    const r = await h.recruiter('erase@azerconnect.test');
    const vid = await ready(r.api, 'Erase Vacancy');
    await upload(r.api, vid, 1, 'erase');
    const g = gate();
    await proc.fill();
    expect(await inFlight(vid)).toBe(1);
    const doc = (await h.db.owner.query(`SELECT id FROM cv_document WHERE vacancy_id = $1`, [vid]))
      .rows[0].id;
    expect((await r.api.post(`/documents/${doc}/erase`, { reason: 'test' })).statusCode).toBe(200);
    g.open();
    await settle();
    const s = (
      await h.db.owner.query(
        `SELECT state, score, candidate_name, summary, completed_at FROM screening WHERE document_id = $1`,
        [doc],
      )
    ).rows[0];
    expect(s).toMatchObject({
      state: 'manual',
      score: null,
      candidate_name: null,
      summary: null,
      completed_at: null,
    });
    const assessments = await h.db.owner.query(
      `SELECT count(*) AS n FROM requirement_assessment WHERE screening_id IN (SELECT id FROM screening WHERE document_id = $1)`,
      [doc],
    );
    expect(Number(assessments.rows[0].n)).toBe(0);
  });

  it('claims nothing and burns no attempt while the active model is paused', async () => {
    const r = await h.recruiter('breaker@azerconnect.test');
    const vid = await ready(r.api, 'Breaker Vacancy');
    await upload(r.api, vid, 3, 'brk');
    (gw as any).breaker.set('anthropic:claude-test', {
      n: 5,
      first: Date.now(),
      openUntil: Date.now() + 60_000,
    });
    await proc.fill();
    expect(await proc.tick()).toBe(false);
    const rows = (
      await h.db.owner.query(
        `SELECT state, attempts FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1`,
        [vid],
      )
    ).rows;
    expect(rows.every((x: any) => x.state === 'queued' && x.attempts === 0)).toBe(true);
    gw.resetBreaker();
    await proc.drain();
    const after = (
      await h.db.owner.query(
        `SELECT state FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1`,
        [vid],
      )
    ).rows;
    expect(after.every((x: any) => x.state === 'completed')).toBe(true);
  });

  it('a call refused by the breaker mid-run puts the row back without using an attempt', async () => {
    const r = await h.recruiter('midbreak@azerconnect.test');
    const vid = await ready(r.api, 'Midbreak Vacancy');
    await upload(r.api, vid, 1, 'mid');
    const original = gw.fetcher;
    // Claimed first, then the provider is refused by the breaker.
    const { ProviderError } = await import('../ai/providers');
    const { PAUSED_TEXT } = await import('../ai/ai-gateway.service');
    const complete = gw.complete.bind(gw);
    (gw as any).complete = async () => {
      throw new ProviderError(`Test: ${PAUSED_TEXT}`, false, 503);
    };
    await proc.tick();
    (gw as any).complete = complete;
    gw.fetcher = original;
    const s = (
      await h.db.owner.query(
        `SELECT state, attempts FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1`,
        [vid],
      )
    ).rows[0];
    expect(s).toMatchObject({ state: 'queued', attempts: 0 });
    await h.db.owner.query(`UPDATE screening SET run_after = now()`);
    await proc.drain();
  });

  it('100 CVs with a slow model finish in about ceil(100/C) x the model time', async () => {
    const r = await h.recruiter('hundred@azerconnect.test');
    const vid = await ready(r.api, 'Hundred Vacancy');
    await upload(r.api, vid, 100, 'hun');
    const original = gw.fetcher;
    gw.fetcher = (async (url: any, init: any) => {
      await new Promise((res) => setTimeout(res, 300));
      return original(url, init);
    }) as typeof fetch;
    const t0 = Date.now();
    await proc.fill();
    for (let i = 0; i < 600; i++) {
      const n = Number(
        (
          await h.db.owner.query(
            `SELECT count(*) AS n FROM screening s JOIN cv_document d ON d.id = s.document_id
              WHERE d.vacancy_id = $1 AND s.state IN ('queued','processing')`,
            [vid],
          )
        ).rows[0].n,
      );
      if (n === 0) break;
      await proc.fill();
      await new Promise((res) => setTimeout(res, 50));
    }
    const took = Date.now() - t0;
    gw.fetcher = original;
    const done = await h.db.owner.query(
      `SELECT count(*) AS n FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1 AND s.state = 'completed'`,
      [vid],
    );
    expect(Number(done.rows[0].n)).toBe(100);
    // C = 4 here: 25 rounds of 0.3 s = 7.5 s, plus database and scheduling slack.
    expect(took).toBeLessThan(25_000);
    expect(took).toBeGreaterThan(7_000); // it really ran four at a time, not instantly
  }, 90_000);
});
