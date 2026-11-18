import { esc, jd, textCvs } from '../fixtures/pkg-c';
import { rx, T } from '../fixtures/pkg-i';
import { expect, STD, uat } from '../ux/test';
import {
  accounts,
  api,
  BASE,
  clearModelCalls,
  db,
  drain,
  login,
  modelCalls,
  openAs,
  screenedVacancy,
  setAi,
  uniq,
} from './stack';

// 7.12 Results (RS-14) and 7.14 Runs (RN-02), full-stack journeys (L2): stop the scan, continue
// reading, and the Runs, Results and Report screens that must tell the same story.

const N = 30;

/** Calls the fake AI got for the CVs of this batch, by the person's name line. */
async function callsPerCv(prefix: string) {
  const out = new Map<string, number>();
  for (const c of await modelCalls()) {
    if (!c.user.includes('<<<CV_START>>>')) continue;
    const name = new RegExp(`Name: (${esc(prefix)} Person \\d+)`).exec(c.user)?.[1];
    if (name) out.set(name, (out.get(name) ?? 0) + 1);
  }
  return out;
}

uat(
  'RS-14',
  'Stop the scan and Continue reading; Report and Runs agree',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const prefix = uniq('Stop');
    const v = await screenedVacancy(token, {
      title: uniq('UAT Stop and continue'),
      jd: jd(['BGP routing', 'Kubernetes'], ['Python scripting']),
    });
    await clearModelCalls();
    await setAi('slow', 2000);
    try {
      const gets: number[] = [];
      page.on('request', (r) => {
        if (r.method() === 'GET' && r.url().endsWith(`/vacancies/${v.id}/candidates`))
          gets.push(Date.now());
      });
      const posts: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST') posts.push(new URL(r.url()).pathname);
      });
      // 1) Start: 30 CVs, each held for 2 s by the fake AI; open Results while reading.
      const up = await api(token).upload(`/vacancies/${v.id}/documents`, textCvs(prefix, N));
      expect(up.status).toBeLessThan(300);
      await openAs(page, acc.recruiter, `#/vacancies/${v.id}/results`);
      const reading = page.getByText(
        rx(
          meta.lang,
          '{read} of {total} read. You can leave this page: the scan continues and is kept under Runs.',
        ),
      );
      await expect(reading).toBeVisible();
      await expect(page.getByRole('progressbar', { name: t('CVs read') })).toBeVisible();
      await expect(
        page.getByText(rx(meta.lang, '{ready} ready, {pending} being read, {human} need a look')),
      ).toBeVisible();
      await ux.check('reading', STD);
      // Polling: a GET about every 4 s while something is pending.
      await expect.poll(() => gets.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
      const gaps = gets.slice(1).map((x, i) => x - gets[i]!);
      expect(Math.min(...gaps.slice(-2))).toBeGreaterThan(3000);
      expect(Math.max(...gaps.slice(-2))).toBeLessThan(6500);
      // 2) When about 10 are read, press 'Stop the scan'.
      await expect
        .poll(
          async () => {
            const n = await db<{ n: number }>(
              `SELECT count(*)::int AS n FROM screening s JOIN cv_document d ON d.id = s.document_id
              WHERE d.vacancy_id = $1 AND s.state IN ('completed','manual')`,
              [v.id],
            ).catch(() => [{ n: 0 }]);
            return n[0]!.n;
          },
          { timeout: 40_000, intervals: [500] },
        )
        .toBeGreaterThanOrEqual(10);
      await page.getByRole('button', { name: t('Stop the scan') }).click();
      await expect.poll(() => posts.filter((p) => p === `/vacancies/${v.id}/stop`).length).toBe(1);
      // 3) The CVs in progress finish; the waiting ones become Stopped.
      const stoppedLine = page.getByText(
        rx(meta.lang, 'Stopped at {read} of {total}. What was scored is kept.'),
      );
      await expect(stoppedLine).toBeVisible({ timeout: 30_000 });
      const m = rx(meta.lang, 'Stopped at {read} of {total}. What was scored is kept.').exec(
        await stoppedLine.innerText(),
      )!;
      const read = Number(m[1]);
      expect(Number(m[2])).toBe(N);
      expect(read).toBeGreaterThanOrEqual(10);
      expect(read).toBeLessThan(N);
      const cont = page.getByRole('button', {
        name: rx(meta.lang, 'Continue reading the other {n}'),
      });
      const n = Number(
        rx(meta.lang, 'Continue reading the other {n}').exec(await cont.innerText())![1],
      );
      expect(read + n).toBe(N);
      const states = await db<{ stopped: boolean; c: number }>(
        `SELECT (s.cancelled_at IS NOT NULL) AS stopped, count(*)::int AS c FROM screening s
           JOIN cv_document d ON d.id = s.document_id
          WHERE d.vacancy_id = $1 GROUP BY 1`,
        [v.id],
      );
      expect(states.find((s) => s.stopped)?.c ?? 0).toBe(n);
      await ux.check('stopped', STD);
      // 4) Report and Runs agree.
      await page.goto(`${BASE}/#/vacancies/${v.id}/report`);
      await expect(
        page.getByText(
          rx(
            meta.lang,
            'Stopped at {read} of {total}. Files not read are listed under Data quality.',
          ),
        ),
      ).toContainText(`${read} `);
      await page.goto(`${BASE}/#/vacancies/${v.id}/runs`);
      await expect(
        page
          .getByRole('list', { name: t('Runs') })
          .getByText(rx(meta.lang, '{a} of {b} read', { a: String(read), b: String(N) })),
      ).toBeVisible();
      // 5) Back on Results: Continue.
      await page.goto(`${BASE}/#/vacancies/${v.id}/results`);
      await page
        .getByRole('button', { name: rx(meta.lang, 'Continue reading the other {n}') })
        .click();
      await expect
        .poll(() => posts.filter((p) => p === `/vacancies/${v.id}/continue`).length)
        .toBe(1);
      // 6) The end: nothing pending.
      const done = page.getByText(
        rx(meta.lang, '{read} read, {scored} scored, {human} need a human look'),
      );
      await expect(done).toBeVisible({ timeout: 60_000 });
      const dm = rx(meta.lang, '{read} read, {scored} scored, {human} need a human look').exec(
        await done.innerText(),
      )!;
      expect(Number(dm[1])).toBe(N);
      expect(Number(dm[2]) + Number(dm[3])).toBe(N);
      await ux.check('finished', STD);
      // CVs scored before the stop got no new fake-AI call: one call per CV, 30 CVs.
      await drain();
      const per = await callsPerCv(prefix);
      expect(per.size).toBe(N);
      expect([...per.values()].filter((c) => c !== 1)).toEqual([]);
    } finally {
      await setAi('scripted');
    }
  },
);

// ---------------------------------------------------------------------------------------------
// RN-02: the Runs list, the Results line, the Report header and the 'Last run' line tell one story.

uat(
  'RN-02',
  'Runs agree with Results and Report after stop, continue and re-analyze',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const a = api(token);
    const prefix = uniq('Runs');
    const v = await screenedVacancy(token, {
      title: uniq('UAT Runs agree'),
      jd: jd(['BGP routing', 'Kubernetes'], ['Python scripting']),
    });
    await clearModelCalls();
    await setAi('slow', 1500);
    const go = async (tab: string) => {
      // The state was changed through the API, so the page is loaded afresh (a page with nothing
      // pending does not poll).
      await page.goto(`${BASE}/#/vacancies/${v.id}/${tab}`);
      await page.reload();
    };
    const runs = async () => {
      await go('runs');
      const list = page.getByRole('list', { name: t('Runs') });
      await expect(list).toBeVisible();
      const items = list.getByRole('listitem');
      await expect(items.first()).toBeVisible();
      const texts = await items.allInnerTexts();
      return texts.map((x) => {
        const n = Number(rx(meta.lang, 'Run {n}').exec(x)![1]);
        const rd = rx(meta.lang, '{a} of {b} read').exec(x)!;
        const sc = rx(meta.lang, '{n} scored').exec(x)!;
        return { n, read: Number(rd[1]), total: Number(rd[2]), scored: Number(sc[1]) };
      });
    };
    const report = async () => {
      await go('report');
      const head = page.getByText(
        rx(
          meta.lang,
          'Report date {date} · {read} read, {scored} scored, {need} need a human look',
          {
            date: /[^·]+?/,
          },
        ),
      );
      await expect(head).toBeVisible();
      const m = rx(
        meta.lang,
        'Report date {date} · {read} read, {scored} scored, {need} need a human look',
        { date: /[^·]+?/ },
      ).exec(await head.innerText())!;
      return { read: Number(m[2]), scored: Number(m[3]), need: Number(m[4]) };
    };
    const lastRun = async () => {
      await go('results');
      const line = page.getByTestId('last-run');
      await expect(line).toBeVisible();
      const m = rx(meta.lang, '{a} of {b} read').exec(await line.innerText())!;
      return { read: Number(m[1]), total: Number(m[2]) };
    };
    try {
      // Run 1: 30 CVs, stopped at about 10.
      expect(
        (await a.upload(`/vacancies/${v.id}/documents`, textCvs(prefix, N))).status,
      ).toBeLessThan(300);
      await expect
        .poll(
          async () =>
            (
              await db<{ n: number }>(
                `SELECT count(*)::int AS n FROM screening s JOIN cv_document d ON d.id = s.document_id
                  WHERE d.vacancy_id = $1 AND s.state IN ('completed','manual')`,
                [v.id],
              )
            )[0]!.n,
          { timeout: 40_000, intervals: [500] },
        )
        .toBeGreaterThanOrEqual(10);
      expect((await a.post(`/vacancies/${v.id}/stop`)).status).toBeLessThan(300);
      // Wait until what was in progress has finished.
      await expect
        .poll(
          async () =>
            (
              await db<{ n: number }>(
                `SELECT count(*)::int AS n FROM screening s JOIN cv_document d ON d.id = s.document_id
                  WHERE d.vacancy_id = $1 AND s.state = 'processing'`,
                [v.id],
              )
            )[0]!.n,
          { timeout: 30_000, intervals: [500] },
        )
        .toBe(0);
      // Phase 1: after the stop.
      await openAs(page, acc.recruiter, `#/vacancies/${v.id}/results`);
      const stopped = page.getByText(
        rx(meta.lang, 'Stopped at {read} of {total}. What was scored is kept.'),
      );
      await expect(stopped).toBeVisible();
      const sm = rx(meta.lang, 'Stopped at {read} of {total}. What was scored is kept.').exec(
        await stopped.innerText(),
      )!;
      const r1 = await runs();
      expect(r1.map((r) => r.n)).toEqual([1]);
      expect(r1[0]!.read).toBe(Number(sm[1]));
      expect(r1[0]!.total).toBe(N);
      const rep1 = await report();
      expect([rep1.read, rep1.scored]).toEqual([r1[0]!.read, r1[0]!.scored]);
      expect(await lastRun()).toEqual({ read: r1[0]!.read, total: N });
      await ux.check('after stop', STD);
      // Phase 2: continue to the end (still run 1).
      expect((await a.post(`/vacancies/${v.id}/continue`)).status).toBeLessThan(300);
      await expect
        .poll(async () => (await a.get(`/vacancies/${v.id}/candidates`)).body.counts.queued, {
          timeout: 60_000,
          intervals: [1000],
        })
        .toBe(0);
      await go('results');
      const done = page.getByText(
        rx(meta.lang, '{read} read, {scored} scored, {human} need a human look'),
      );
      await expect(done).toBeVisible();
      const dm = rx(meta.lang, '{read} read, {scored} scored, {human} need a human look').exec(
        await done.innerText(),
      )!;
      const r2 = await runs();
      expect(r2.map((r) => r.n)).toEqual([1]);
      expect([r2[0]!.read, r2[0]!.scored]).toEqual([Number(dm[1]), Number(dm[2])]);
      expect(r2[0]!.read).toBe(N);
      const rep2 = await report();
      expect([rep2.read, rep2.scored, rep2.need]).toEqual([N, Number(dm[2]), Number(dm[3])]);
      expect(await lastRun()).toEqual({ read: N, total: N });
      // Phase 3: change one requirement and re-analyze: run 2 above run 1, run 1 unchanged.
      const nv = await a.post(`/vacancies/${v.id}/criteria/new-version`);
      expect(nv.status).toBe(201);
      const cur = (await a.get(`/vacancies/${v.id}/criteria`)).body;
      const rows = (cur.current ?? cur.draft ?? cur).requirements.map((r: any) => ({
        text: r.text,
        classification: r.text.startsWith('Python') ? 'mandatory' : r.classification,
        weight: r.text.startsWith('Python') ? 10 : r.weight,
        rule: r.rule,
        confidence: r.confidence ?? null,
      }));
      expect(
        (await a.put(`/vacancies/${v.id}/criteria`, { requirements: rows })).status,
      ).toBeLessThan(300);
      expect((await a.post(`/vacancies/${v.id}/criteria/freeze`)).status).toBeLessThan(300);
      expect(
        (await a.post(`/vacancies/${v.id}/start`, { confirmNotice: true })).status,
      ).toBeLessThan(300);
      await expect
        .poll(async () => (await a.get(`/vacancies/${v.id}/candidates`)).body.counts.queued, {
          timeout: 90_000,
          intervals: [1000],
        })
        .toBe(0);
      await go('results');
      await expect(done).toBeVisible();
      const em = rx(meta.lang, '{read} read, {scored} scored, {human} need a human look').exec(
        await done.innerText(),
      )!;
      const r3 = await runs();
      expect(r3.map((r) => r.n)).toEqual([2, 1]);
      expect(r3[1]).toEqual(r2[0]);
      expect([r3[0]!.read, r3[0]!.scored]).toEqual([Number(em[1]), Number(em[2])]);
      const rep3 = await report();
      expect([rep3.read, rep3.scored, rep3.need]).toEqual([N, Number(em[2]), Number(em[3])]);
      expect(await lastRun()).toEqual({ read: r3[0]!.read, total: r3[0]!.total });
      await ux.check('after re-analyze', STD);
    } finally {
      await setAi('scripted');
    }
  },
);
