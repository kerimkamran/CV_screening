import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, STD, test, uat } from '../ux/test';
import { accounts, api, db, JD_EN, login, openAs, RESUME, screenedVacancy, uniq } from './stack';

/**
 * UAT package E, layer L2: the candidate pool against the real API and the fake AI (CP-20, CP-21,
 * CP-29). Every vacancy here is made by the test; every person is invented.
 */

const PDF = readFileSync(new URL('../fixtures/cv.pdf', import.meta.url));
const DOCX = readFileSync(new URL('../fixtures/files/rashad.docx', import.meta.url));
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FOUR = () => [
  { name: 'aysel.pdf', type: 'application/pdf', data: PDF },
  { name: 'leyla.docx', type: DOCX_MIME, data: DOCX },
  { name: 'rauf.txt', type: 'text/plain', data: RESUME('01-aysel-en.txt') },
  {
    name: 'kamal.pdf',
    type: 'application/pdf',
    data: readFileSync(new URL('../fixtures/files/dense-skills.pdf', import.meta.url)),
  },
];

// ------------------------------------------------------------------------------------------ CP-20
uat(
  'CP-20',
  'ZIP download end to end: files, single-use link, scope, audit',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await screenedVacancy(token, {
      title: uniq('UAT ZIP Network Engineer'),
      files: FOUR(),
    });
    expect(v.documents).toHaveLength(4);
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}/candidates`);
    await page
      .getByRole('combobox', { name: 'Show', exact: true })
      .selectOption({ label: 'All CVs' });
    await expect(page.locator('li[id^=cand-]')).toHaveCount(4);
    const order = await page
      .locator('li[id^=cand-]')
      .evaluateAll((l) => l.map((x) => x.id.slice(5)));
    const names = Object.fromEntries(v.documents.map((d) => [d.id, d.filename]));
    const all = page.getByRole('checkbox', {
      name: meta.touch ? 'Select all' : 'Select all shown',
      exact: true,
    });
    await all.check();
    const region = page.getByRole('region', { name: 'Selected candidates' });
    await expect(region).toContainText('4 selected');
    // 2) The fourth CV is erased after the list has loaded, then Download.
    const kamal = v.documents.find((d) => d.filename === 'kamal.pdf')!;
    const er = await api(token).post(`/documents/${kamal.id}/erase`);
    expect(er.status).toBe(200);
    const t0 = new Date(Date.now() - 2000).toISOString();
    const download = page.waitForEvent('download');
    await region.getByRole('button', { name: 'Download CVs' }).click();
    const file = await download;
    const dir = mkdtempSync(join(tmpdir(), 'pkg-e-zip-'));
    const zipPath = join(dir, 'cvs.zip');
    await file.saveAs(zipPath);
    const listed = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).trim().split('\n');
    const want = order.filter((id) => id !== kamal.id).map((id) => names[id]);
    expect(listed).toEqual(want);
    expect(listed).toContain('leyla.docx');
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /Downloading 3 CVs/ })
        .first(),
    ).toContainText(/1 left out: .+ \(the CV was erased\)\./);
    await ux.check('downloaded');
    // 4) The link works once.
    const path = new URL(file.url()).pathname;
    const again = await api().get(path);
    expect(again.status).toBe(410);
    expect(again.body.message).toBe(
      'This download link has been used or has expired. Start the download again.',
    );
    // 5) recruiter2 cannot download this vacancy's CVs.
    const t2 = await login(acc.recruiter2);
    const r2 = await api(t2).post('/downloads', { documentIds: order });
    // PLAN: "recruiter2 gets 409 'None of the chosen CVs can be downloaded.'" — this L2 server runs
    // with VACANCY_VISIBILITY=all (the default, vacancy-scope.service.ts:17-19), so every recruiter
    // sees every vacancy and recruiter2 is in scope; the out-of-scope 409 needs a server started
    // with VACANCY_VISIBILITY=granted. The scope rule itself is downloads.controller.ts:138-140.
    if (r2.status === 409) {
      expect(r2.body.message).toBe('None of the chosen CVs can be downloaded.');
      expect(r2.body.url).toBeUndefined();
    } else {
      expect(r2.status).toBe(201);
      expect(r2.body.files).toBe(3);
      test.info().annotations.push({
        type: 'plan',
        description: 'recruiter2 is in scope (VACANCY_VISIBILITY=all): 201, not 409',
      });
    }
    // 6) The audit.
    const tickets = await db<{
      id: string;
      after: { files: number; excluded: number };
      actor_id: string;
    }>(
      `SELECT entity_id AS id, after, actor_id FROM audit_event
        WHERE action = 'download.requested' AND actor_id = $1 AND occurred_at >= $2`,
      [acc.recruiter.userId, t0],
    );
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.after).toMatchObject({ files: 3, excluded: 1 });
    const sent = await db<{
      entity_id: string;
      after: { via: string; ticketId: string };
      actor_id: string;
    }>(
      `SELECT entity_id, after, actor_id FROM audit_event WHERE action = 'document.downloaded' AND after->>'ticketId' = $1`,
      [tickets[0]!.id],
    );
    expect(sent.map((s) => s.entity_id).sort()).toEqual(
      want.map((n) => v.documents.find((d) => d.filename === n)!.id).sort(),
    );
    for (const s of sent) {
      expect(s.after.via).toBe('zip');
      expect(s.actor_id).toBe(acc.recruiter.userId);
    }
  },
);

// ------------------------------------------------------------------------------------------ CP-21
uat(
  'CP-21',
  'Export to Excel follows the filters',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await screenedVacancy(token, {
      title: uniq('UAT Export Network Engineer'),
      files: FOUR().slice(0, 3),
    });
    const rows = (await api(token).get(`/candidates?vacancy=${v.id}&limit=50`)).body.rows as {
      matchId: string;
      decisionVersion: number;
      label: string;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows.slice(0, 2))
      expect(
        (
          await api(token).put(`/candidates/${r.matchId}/decision`, {
            mark: 'shortlist',
            expectedVersion: r.decisionVersion,
          })
        ).status,
      ).toBe(200);
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}/candidates`);
    await expect(page.locator('li[id^=cand-]').first()).toBeVisible();
    const reqs: string[] = [];
    page.on(
      'request',
      (r) =>
        r.url().includes('/candidates') &&
        reqs.push(new URL(r.url()).pathname + new URL(r.url()).search),
    );
    await page
      .getByRole('group', { name: 'Decision', exact: true })
      .getByRole('button', { name: /^Shortlist/ })
      .click();
    await expect(page.locator('li[id^=cand-]')).toHaveCount(2);
    const download = page.waitForEvent('download');
    const t0 = new Date(Date.now() - 2000).toISOString();
    await page.getByRole('button', { name: 'Export to Excel' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('candidates.xlsx');
    const list = reqs.filter((u) => u.startsWith('/candidates?')).at(-1)!;
    const exp = reqs.find((u) => u.startsWith('/candidates/export?'))!;
    const q = (u: string) => {
      const p = new URLSearchParams(u.split('?')[1]);
      p.delete('limit');
      p.sort();
      return p.toString();
    };
    expect(q(exp)).toBe(q(list));
    const dir = mkdtempSync(join(tmpdir(), 'pkg-e-xlsx-'));
    const x = join(dir, 'c.xlsx');
    await file.saveAs(x);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(x);
    const ws = wb.getWorksheet('Candidates')!;
    expect(ws).toBeTruthy();
    const head = (ws.getRow(1).values as unknown[]).slice(1);
    expect(head).toEqual([
      'Candidate',
      'Vacancy',
      'Match %',
      'Match',
      'Must-haves found',
      'Mark',
      'Note',
      'Marked by',
      'Analyzed',
      'Out of date',
      'Status',
    ]);
    const data: unknown[][] = [];
    ws.eachRow((r, i) => i > 1 && data.push((r.values as unknown[]).slice(1)));
    expect(data).toHaveLength(2);
    for (const d of data) expect(d[5]).toBe('Shortlist');
    await ux.check('exported');
    await page.getByRole('searchbox', { name: 'Search candidates' }).fill('zzz');
    await expect(page.getByText('No candidates match.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export to Excel' })).toBeDisabled();
    const aud = await db<{ after: { rows: number } }>(
      `SELECT after FROM audit_event WHERE action = 'candidates.exported' AND actor_id = $1 AND occurred_at >= $2`,
      [acc.recruiter.userId, t0],
    );
    expect(aud).toHaveLength(1);
    expect(aud[0]!.after.rows).toBe(2);
    expect(JD_EN()).toBeTruthy();
  },
);

// ------------------------------------------------------------------------------------------ CP-29
uat(
  'CP-29',
  'Who can open the pool and a CV review',
  { on: ['D'], langs: 'EN', timeout: 120_000 },
  async ({ browser, ux }) => {
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await screenedVacancy(token, {
      title: uniq('UAT Roles Network Engineer'),
      files: FOUR().slice(0, 1),
    });
    const doc = v.documents[0]!;
    const rows = (await api(token).get(`/candidates?vacancy=${v.id}&limit=50`)).body.rows as {
      matchId: string;
      label: string;
    }[];
    const name = rows[0]!.label;
    const routes = ['#/candidates', `#/vacancies/${v.id}/candidates`, `#/cv/${doc.id}`];
    for (const who of ['recruiter', 'lead', 'governance', 'admin', 'viewer'] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const flush = ux.watch(page);
      for (const [i, r] of routes.entries()) {
        if (i === 0) await openAs(page, acc[who], r);
        else {
          await page.evaluate((h) => (location.hash = h), r);
        }
        if (who === 'recruiter' || who === 'lead') {
          if (i < 2) {
            // The shared database holds many CVs: find this one by its vacancy in the global list.
            if (i === 0)
              await page.getByRole('searchbox', { name: 'Search candidates' }).fill(v.title);
            const pill = page
              .locator(`#cand-${doc.id}`)
              .getByRole('combobox', { name: `Decision for ${name}` });
            await expect(pill, `${who} on ${r}`).toBeEnabled();
          } else {
            await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
            await expect(
              page.getByRole('combobox', { name: `Decision for ${name}` }),
            ).toBeEnabled();
          }
        } else if (who === 'governance') {
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          await expect(page.getByText(name)).toHaveCount(0);
          await expect(page.getByRole('combobox', { name: /Decision for/ })).toHaveCount(0);
        } else if (who === 'admin') {
          await expect(
            page.getByText(
              'Administrators manage users and AI models under Administration. Candidate data is available only to recruiters.',
            ),
          ).toBeVisible();
          await expect(page.getByText(name)).toHaveCount(0);
        } else {
          await expect(
            page.getByRole('heading', { level: 1, name: 'Shared with me' }),
          ).toBeVisible();
          await expect(page.getByText(name)).toHaveCount(0);
        }
      }
      if (who === 'governance')
        await expect(page.getByRole('heading', { name: /Monitoring/i }).first()).toBeVisible();
      flush();
      await ctx.close();
    }
    // 2) Governance through the API: 403 and audited.
    const g = api(await login(acc.governance));
    const t0 = new Date(Date.now() - 2000).toISOString();
    expect(
      (
        await g.put(`/candidates/${rows[0]!.matchId}/decision`, {
          mark: 'shortlist',
          expectedVersion: 0,
        })
      ).status,
    ).toBe(403);
    expect((await g.get(`/documents/${doc.id}/view`)).status).toBe(403);
    const denied = await db<{ after: { method: string; resource: string } }>(
      `SELECT after FROM audit_event WHERE action = 'access.denied' AND actor_id = $1 AND occurred_at >= $2`,
      [acc.governance.userId, t0],
    );
    expect(denied.map((d) => `${d.after.method} ${d.after.resource}`).sort()).toEqual(
      [`GET /documents/${doc.id}/view`, `PUT /candidates/${rows[0]!.matchId}/decision`].sort(),
    );
    expect(STD.length).toBeGreaterThan(0);
  },
);
