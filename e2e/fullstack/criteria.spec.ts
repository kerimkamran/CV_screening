import { jd, T } from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';
import {
  accounts,
  api,
  clearModelCalls,
  db,
  drain,
  login,
  modelCalls,
  openAs,
  uniq,
} from './stack';

// 7.14 Criteria tab (CR), full-stack journeys (L2). UAT plan v1.1.

uat(
  'CR-06',
  'Knockout rule never rejects and makes no model call',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const a = api(token);
    const p = uniq('Knock');
    const v = await a.post('/vacancies', {
      title: uniq('UAT Knockout'),
      jdText: jd(['BGP routing'], ['Python scripting']),
    });
    const id = v.body.id as string;
    const ex = await a.post(`/vacancies/${id}/criteria/extract`);
    const rows = (ex.body.current.requirements as any[]).map((r) => ({
      text: r.text,
      classification: r.classification,
      weight: r.weight,
      rule: r.rule,
      confidence: r.confidence ?? null,
    }));
    rows.push({
      text: 'Language',
      classification: 'disqualifier',
      weight: null,
      rule: { type: 'must_contain_any', terms: ['Azerbaijani', 'Azərbaycan dili'] },
      confidence: null,
    });
    const put = await a.put(`/vacancies/${id}/criteria`, { requirements: rows });
    expect(put.status, JSON.stringify(put.body).slice(0, 200)).toBeLessThan(300);
    // 1) Freeze and start.
    const st = await a.post(`/vacancies/${id}/start`, { confirmNotice: true });
    expect(st.status).toBeLessThan(300);
    await clearModelCalls();
    const cv = (i: number, lines: string[]) => ({
      name: `${p.toLowerCase().replace(/\W+/g, '-')}-${i}.txt`,
      type: 'text/plain',
      data: `Name: ${p} Person ${i}\n${lines.join('\n')}\n${'Worked on network operations. '.repeat(8)}`,
    });
    const up = await a.upload(`/vacancies/${id}/documents`, [
      cv(1, ['BGP routing on the core.', 'Languages: Azerbaijani, English.']),
      cv(2, ['BGP routing on the core.', 'Dillər: Azərbaycan dili, rus dili.']),
      cv(3, ['BGP routing on the core.', 'Languages: English, Russian.']),
    ]);
    expect(up.status).toBeLessThan(300);
    await drain();
    // 2) Results: the CV without the words needs a human look, 'a knockout rule matched'.
    await openAs(page, acc.recruiter, `#/vacancies/${id}/results`);
    await expect(
      page.getByRole('heading', { level: 3, name: t('Needs a human look ({n})', { n: 1 }) }),
    ).toBeVisible();
    await expect
      .soft(page.getByText(new RegExp(`· ${t('a knockout rule matched')}$`)))
      .toHaveCount(1);
    await expect
      .soft(
        page.getByText(
          t('{read} read, {scored} scored, {human} need a human look', {
            read: 3,
            scored: 2,
            human: 1,
          }),
        ),
      )
      .toBeVisible();
    await ux.check('results', [...STD, 'AZ']);
    // 3) No decision row; one model call per CV.
    const dec = await db<{ n: number }>(
      `SELECT count(*)::int AS n FROM decision d JOIN screening s ON s.id = d.screening_id JOIN cv_document doc ON doc.id = s.document_id WHERE doc.vacancy_id = $1`,
      [id],
    );
    expect.soft(dec[0]!.n, "no 'Not now' decision row is written").toBe(0);
    const calls = (await modelCalls()).filter((m) => m.user.includes(p));
    expect.soft(calls.length, 'exactly one assessment call per CV (3 in total)').toBe(3);
    const knocked = await db<{ state: string; knockout: boolean | null }>(
      `SELECT s.state::text AS state, s.knockout_triggered AS knockout FROM screening s JOIN cv_document doc ON doc.id = s.document_id WHERE doc.vacancy_id = $1 AND doc.filename LIKE '%-3.txt'`,
      [id],
    ).catch(() => []);
    if (knocked.length)
      expect
        .soft(knocked[0]!.state, 'not rejected: completed, routed to a human')
        .not.toMatch(/reject/);
  },
);
