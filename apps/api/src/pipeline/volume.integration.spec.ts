import { performance } from 'node:perf_hooks';
import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';

/**
 * Volume run (Development Plan WP 0.1 "one load command" and WP 5.3). Seeds a vacancy with N analyzed
 * resumes by cloning three real ones in SQL, then measures the pool at its p95 for the things a
 * recruiter waits on. `npm run load:pool` runs it with 300 and 5,000 rows; set VOLUME_ROWS=300 to
 * run a smaller set. Times are measured in-process against a local database, so they show the
 * work the application does; add network time on the deployed site.
 *
 * The limits are the working targets for this release. They are named here so a change is a visible
 * edit, and the report in docs/performance-run.md states what was measured against them.
 */
process.env['TEST_VISIBILITY'] = 'all';

export const LIMITS_MS = {
  list: 1000,
  search: 1000,
  sort: 1000,
  nextPage: 1000,
  mark: 400,
  bulk100: 1500,
  report: 800,
  summary: 1500,
  export: 10000,
};

const SIZES = (process.env['VOLUME_ROWS'] ?? '300,5000')
  .split(',')
  .map((x) => Number(x.trim()))
  .filter((n) => n > 0);

const p95 = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)]!;

describeDb('Pool volume run (WP 5.3)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('volume');
  });
  afterAll(async () => {
    delete process.env['TEST_VISIBILITY'];
    await h?.close();
  });

  const cvs = [
    {
      name: 'Alice One',
      lines: ['Worked on BGP routing for 6 years.', 'Kubernetes in production.'],
    },
    { name: 'Bob Two', lines: ['BGP routing at an ISP.', 'Docker only.'] },
    { name: 'Cem Three', lines: ['Sales assistant.'] },
  ];

  async function clone(vid: string, n: number) {
    const id = (kind: string) => `upper(substr(md5('${kind}' || g::text || $1), 1, 26))`;
    await h.db.owner.query(
      `INSERT INTO cv_document (id, vacancy_id, filename, mime, size_bytes, sha256, content, text, parse_status, uploaded_by, uploaded_at, page_starts)
       SELECT ${id('d')}, c.vacancy_id, 'Clone_' || g || '.txt', c.mime, c.size_bytes,
              encode(sha256(('c' || g::text || $1)::bytea), 'hex'), c.content, c.text, c.parse_status,
              c.uploaded_by, c.uploaded_at + (g || ' seconds')::interval, c.page_starts
         FROM generate_series(1, ${n}) g
         JOIN LATERAL (SELECT * FROM cv_document WHERE vacancy_id = $2 AND filename NOT LIKE 'Clone_%'
                        ORDER BY id OFFSET (g % 3) LIMIT 1) c ON true`,
      [vid, vid],
    );
    await h.db.owner.query(
      `INSERT INTO screening (id, document_id, requirement_set_id, state, candidate_name, candidate_email, summary,
                              knockout, knockout_triggered, injection_suspected, score, breakdown, band,
                              ai_provider, ai_model, created_at, started_at, completed_at)
       SELECT ${id('s')}, ${id('d')}, s.requirement_set_id, s.state, s.candidate_name || ' ' || g, NULL, s.summary,
              s.knockout, s.knockout_triggered, s.injection_suspected,
              LEAST(100, GREATEST(0, s.score + (g % 9) - 4)), s.breakdown, s.band,
              s.ai_provider, s.ai_model, s.created_at, s.started_at, s.completed_at
         FROM generate_series(1, ${n}) g
         JOIN LATERAL (SELECT sc.* FROM screening sc JOIN cv_document d ON d.id = sc.document_id
                        WHERE d.vacancy_id = $2 AND d.filename NOT LIKE 'Clone_%'
                        ORDER BY sc.id OFFSET (g % 3) LIMIT 1) s ON true`,
      [vid, vid],
    );
  }

  async function time(samples: number, f: () => Promise<{ statusCode: number }>) {
    const xs: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = performance.now();
      const r = await f();
      xs.push(performance.now() - t);
      if (r.statusCode >= 300) throw new Error(`request failed: ${r.statusCode}`);
    }
    return p95(xs);
  }

  it.each(SIZES)(
    'a vacancy with %i analyzed resumes stays within the limits at p95',
    async (rows) => {
      const a = await h.recruiter(`vol-${rows}@azerconnect.test`);
      const vid = await h.scenario(a.api, cvs, `Volume ${rows}`);
      await clone(vid, rows);
      const api = a.api;

      const first = (await api.get(`/candidates?vacancy=${vid}&limit=50`)).json();
      expect(first.total).toBe(rows + 3);
      expect(first.rows).toHaveLength(50);
      expect(first.nextCursor).toBeTruthy();

      const got: Record<string, number> = {};
      got['list'] = await time(15, () => api.get(`/candidates?vacancy=${vid}&limit=50`));
      got['search'] = await time(10, () => api.get(`/candidates?vacancy=${vid}&q=alice&limit=50`));
      got['sort'] = await time(10, () =>
        api.get(`/candidates?vacancy=${vid}&sort=candidate&order=desc&limit=50`),
      );
      got['nextPage'] = await time(10, () =>
        api.get(
          `/candidates?vacancy=${vid}&limit=50&cursor=${encodeURIComponent(first.nextCursor)}`,
        ),
      );

      const page = (await api.get(`/candidates?vacancy=${vid}&limit=100`)).json().rows as {
        matchId: string;
        decisionVersion: number;
      }[];
      let v = page[0]!.decisionVersion;
      let flip = true;
      got['mark'] = await time(15, async () => {
        const r = await api.put(`/candidates/${page[0]!.matchId}/decision`, {
          mark: flip ? 'maybe' : 'new',
          expectedVersion: v,
        });
        flip = !flip;
        v += 1;
        return r;
      });
      got['bulk100'] = await time(3, () =>
        api.post('/candidates/decisions', {
          matchIds: page.slice(1, 101).map((r) => r.matchId),
          mark: 'maybe',
        }),
      );
      got['report'] = await time(10, () => api.get(`/candidates/${page[0]!.matchId}/report`));
      got['summary'] = await time(5, () => api.get(`/candidates/shortlist-summary?vacancy=${vid}`));
      got['export'] = await time(2, () => api.get(`/candidates/export?vacancy=${vid}`));

      // Printed so the run can be pasted into docs/performance-run.md.
      process.stdout.write(
        `\nVOLUME ${rows}: ` +
          Object.entries(got)
            .map(
              ([k, ms]) =>
                `${k} p95 ${Math.round(ms)} ms (limit ${LIMITS_MS[k as keyof typeof LIMITS_MS]})`,
            )
            .join(' · ') +
          '\n',
      );
      for (const [k, ms] of Object.entries(got))
        expect({ step: k, ok: ms <= LIMITS_MS[k as keyof typeof LIMITS_MS] }).toEqual({
          step: k,
          ok: true,
        });
    },
    600_000,
  );
});
