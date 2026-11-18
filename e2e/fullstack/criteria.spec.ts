import { jd, T } from '../fixtures/pkg-c';
import { rx } from '../fixtures/pkg-i';
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
  resumeFiles,
  screenedVacancy,
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

// ---------------------------------------------------------------- CR-02, CR-04, CR-05

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const criteriaHash = (id: string) => `#/vacancies/${id}/criteria`;
/** A vacancy with job text and no criteria yet (nothing extracted). */
async function bareVacancy(token: string, jdText: string, title = uniq('UAT Criteria')) {
  const v = await api(token).post('/vacancies', { title, jdText });
  expect(v.status, JSON.stringify(v.body).slice(0, 200)).toBeLessThan(300);
  return v.body.id as string;
}
/** The requests the page sends to the service, as "METHOD /path". */
function sent(page: import('@playwright/test').Page) {
  const log: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (
      r.method() !== 'GET' &&
      !u.pathname.startsWith('/@') &&
      !/\.(js|css|png|svg)$/.test(u.pathname)
    )
      log.push(`${r.method()} ${u.pathname}`);
  });
  return log;
}

uat(
  'CR-02',
  'Extract with AI: empty state, AI confidence hints, replace confirm only after a press',
  { on: ['D'], langs: 'EN+AZ', timeout: 150_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    // Six rows; the reader is unsure about one and moderately sure about another.
    const id = await bareVacancy(
      token,
      'UAT role.\n\nRequired: BGP routing, MPLS design [low], Kubernetes [medium], Linux administration, Ansible.\nNice to have: Python scripting.\nLocation: Baku.',
    );
    const dialogs: string[] = [];
    let accept = false;
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void (accept ? d.accept() : d.dismiss());
    });
    const requests = sent(page);
    const extracts = () => requests.filter((r) => /\/criteria\/extract$/.test(r)).length;
    const unsure = page.getByText(t('The AI was unsure about this one. Please check it.'));
    const moderate = page.getByText(
      t('The AI was moderately sure about this one. Please check it.'),
    );
    const rows = page.getByLabel(t('Criterion'), { exact: true });

    // 1) Open Criteria: the empty state.
    await openAs(page, acc.recruiter, criteriaHash(id));
    await expect(
      page.getByText(t('No criteria yet. Extract them with AI or add your own.')),
    ).toBeVisible();
    expect(dialogs, 'nothing is asked while the page draws').toHaveLength(0);
    await ux.check('empty', [...STD, 'AZ']);
    // 2) Extract: no confirm; 'Extracting…' while it runs; six rows and the two hints.
    const extract = page.getByRole('button', { name: t('Extract with AI'), exact: true });
    await extract.click();
    await expect(rows).toHaveCount(6, { timeout: 30_000 });
    expect(dialogs, 'no confirm with no rows to replace').toHaveLength(0);
    expect(extracts()).toBe(1);
    await expect(unsure).toHaveCount(1);
    await expect(moderate).toHaveCount(1);
    await ux.check('extracted', [...STD, 'AZ']);
    // 3) Edit a row: the hints hide.
    await rows.first().fill('BGP routing at carrier scale');
    await expect(unsure).toHaveCount(0);
    await expect(moderate).toHaveCount(0);
    // 4) Extract again and dismiss the confirm: it appears only after the press; no request.
    expect(dialogs).toHaveLength(0);
    accept = false;
    await page.getByRole('button', { name: t('Extract with AI'), exact: true }).click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toBe(t('Replace the current draft with new AI suggestions?'));
    expect(extracts(), 'dismissing sends nothing').toBe(1);
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toHaveValue('BGP routing at carrier scale');
    // 5) Accept: the rows are replaced.
    accept = true;
    await page.getByRole('button', { name: t('Extract with AI'), exact: true }).click();
    await expect.poll(() => dialogs.length).toBe(2);
    await expect.poll(extracts).toBe(2);
    await expect(rows.first()).toHaveValue('BGP routing', { timeout: 30_000 });
    await expect(unsure).toHaveCount(1);
    await ux.check('replaced', [...STD, 'AZ']);
  },
);

uat(
  'CR-04',
  'Freeze criteria: confirm, saved first, frozen state, error without scored criteria',
  { on: ['D'], langs: 'EN+AZ', timeout: 150_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const a = api(token);
    const id = await bareVacancy(token, jd(['BGP routing', 'Kubernetes'], ['Python scripting']));
    expect((await a.post(`/vacancies/${id}/criteria/extract`)).status).toBeLessThan(300);
    // The second vacancy: a draft with only Informational rows.
    const other = await bareVacancy(token, jd(['Linux']), uniq('UAT Informational'));
    const ex = await a.post(`/vacancies/${other}/criteria/extract`);
    expect(ex.status).toBeLessThan(300);
    const infoRows = (ex.body.current.requirements as any[]).map((r) => ({
      text: r.text,
      classification: 'informational',
      weight: null,
      rule: null,
      confidence: null,
    }));
    expect((await a.put(`/vacancies/${other}/criteria`, { requirements: infoRows })).status).toBe(
      200,
    );

    const requests = sent(page);
    const dialogs: string[] = [];
    let accept = false;
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void (accept ? d.accept() : d.dismiss());
    });
    await openAs(page, acc.recruiter, criteriaHash(id));
    const rows = page.getByLabel(t('Criterion'), { exact: true });
    await expect(rows).toHaveCount(3);
    // One unsaved edit.
    await rows.nth(1).fill('Kubernetes in production');
    const freeze = page.getByRole('button', { name: t('Freeze criteria'), exact: true });
    // 1) Press and dismiss.
    await freeze.click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toBe(
      t('Freeze these criteria? They cannot be edited afterwards (you can create a new version).'),
    );
    expect(
      requests.filter((r) => /criteria/.test(r)),
      'dismissing sends nothing',
    ).toEqual([]);
    // 2) Press again and accept: the edit is saved first, then frozen.
    accept = true;
    await freeze.click();
    await expect(page.getByText(t('Criteria frozen. You can now upload CVs.'))).toBeVisible();
    const calls = requests.filter((r) => /criteria/.test(r));
    expect(calls).toEqual([
      `PUT /vacancies/${id}/criteria`,
      `POST /vacancies/${id}/criteria/freeze`,
    ]);
    await expect(
      page.getByRole('heading', { name: t('Criteria · version {n} · frozen', { n: 1 }) }),
    ).toBeVisible();
    for (const i of [0, 1, 2]) await expect(rows.nth(i)).toBeDisabled();
    await expect(rows.nth(1)).toHaveValue('Kubernetes in production');
    await expect(
      page.getByRole('button', { name: t('Create new version to edit'), exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: t('Freeze criteria'), exact: true })).toHaveCount(
      0,
    );
    await ux.check('frozen', [...STD, 'AZ']);
    // 3) The other vacancy: nothing to score against.
    await page.goto(`${new URL(page.url()).origin}/${criteriaHash(other)}`);
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: t('Freeze criteria'), exact: true }).click();
    await expect(
      page.getByText(t('Add at least one mandatory or preferred criterion to score against')),
    ).toBeVisible();
    await expect(page.getByText(t('Criteria frozen. You can now upload CVs.'))).toHaveCount(0);
    await ux.check('refused', [...STD, 'AZ']);
    expect(dialogs, 'dismissed, accepted, accepted').toHaveLength(3);
  },
);

uat(
  'CR-05',
  'Edit the job text, create a new version, double new version refused, re-analyze hint',
  { on: ['D'], langs: 'EN+AZ', timeout: 240_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const a = api(token);
    const v = await screenedVacancy(token, {
      title: uniq('UAT New version'),
      files: resumeFiles(),
    });
    expect(v.documents.length).toBe(10);
    const requests = sent(page);
    await openAs(page, acc.recruiter, criteriaHash(v.id));
    await expect(
      page.getByRole('heading', { name: t('Criteria · version {n} · frozen', { n: 1 }) }),
    ).toBeVisible();
    // 1) Edit the text and save it as a new version.
    await page.getByRole('button', { name: t('Edit text'), exact: true }).click();
    const box = page.locator('textarea:visible').first();
    await box.fill(`${await box.inputValue()}\nAlso: incident response on call.`);
    await page.getByRole('button', { name: t('Save new version'), exact: true }).click();
    await expect(
      page.getByText(t('Saved as a new version. Extract criteria again to refresh the draft.')),
    ).toBeVisible();
    expect(requests).toContain(`PUT /vacancies/${v.id}/jd`);
    await expect(page.getByRole('button', { name: t('Edit text'), exact: true })).toBeVisible();
    await expect(page.locator('textarea:visible')).toHaveCount(0);
    // 2) Create a new version to edit: a draft, rows copied.
    const frozenRows = await page.getByLabel(t('Criterion'), { exact: true }).count();
    await page.getByRole('button', { name: t('Create new version to edit'), exact: true }).click();
    await expect(
      page.getByRole('heading', { name: t('Criteria · version {n} · draft', { n: 2 }) }),
    ).toBeVisible();
    const rows = page.getByLabel(t('Criterion'), { exact: true });
    await expect(rows).toHaveCount(frozenRows);
    await expect(rows.first()).toBeEnabled();
    await ux.check('draft', [...STD, 'AZ']);
    // 3) A second new version is refused.
    const again = await a.post(`/vacancies/${v.id}/criteria/new-version`);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('A draft already exists');
    // 4) Change one criterion (copied rows alone change nothing, so nothing would go out of date),
    //    then freeze version 2: the hint about re-analyzing.
    await rows.first().fill(`${await rows.first().inputValue()} (24/7 rota)`);
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: t('Freeze criteria'), exact: true }).click();
    await expect(
      page.getByRole('heading', { name: t('Criteria · version {n} · frozen', { n: 2 }) }),
    ).toBeVisible();
    await expect(
      page.getByText(
        t('After creating and freezing a new version, choose “Re-analyze” on the CVs card.'),
      ),
    ).toBeVisible();
    // 5) Reload the vacancy page: the results are out of date.
    await page.goto(`${new URL(page.url()).origin}/#/vacancies/${v.id}`);
    await page.reload();
    await expect(
      page.getByText(rx(meta.lang, '{n} results were scored against earlier requirements.')),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(esc(t('Review and re-analyze'))) }),
    ).toBeVisible();
    await ux.check('out of date', [...STD, 'AZ']);
  },
);
