import { jd, makeVacancy, T } from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';
import {
  accounts,
  BASE,
  changeOracle,
  db,
  drainImports,
  login,
  openAs,
  oracleCalls,
  seedOracle,
  uniq,
} from './stack';

// 7.31 Oracle import on the vacancy page (OR), layer L2: the full app against the one fake Oracle
// (apps/api/src/testing/fake-oracle.ts, loaded by fullstack/fake-oracle.mjs). Each case makes its own
// requisition number, so cases never share Oracle data on the shared stack.

uat(
  'OR-03',
  'Import end to end: 12 applications, PDF, Word and text, one without a file; strip, batch panel and CVs agree (S3-INT-14)',
  { on: ['D'], timeout: 180_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const ref = uniq('REQ')
      .replace(/[^A-Za-z0-9-]/g, '-')
      .slice(0, 40);
    await seedOracle([
      {
        number: ref,
        applications: 12,
        files: [{ kind: 'pdf' }, { kind: 'docx' }, null, { kind: 'noExtension' }],
      },
    ]);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Oracle import'),
      jd: jd(['BGP routing']),
      start: true,
    });
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    const field = page.getByRole('textbox', { name: new RegExp(t('Oracle vacancy ID')) });
    await field.fill(ref);
    await page.getByRole('button', { name: t('Import CVs from Oracle') }).click();
    const dlg = page.getByRole('dialog', { name: t('Import CVs from Oracle?') });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(
      t('About {n} applications. Their CVs will be copied and analyzed by AI. Room for {r}.', {
        n: 12,
        r: 500,
      }),
    );
    await dlg.getByRole('button', { name: t('Start') }).click();
    await drainImports();
    const strip = page.getByTestId('oracle-strip');
    await expect(strip).toContainText(
      t('{copied} CVs copied of {total} applications', { copied: 11, total: 12 }),
      {
        timeout: 30_000,
      },
    );
    await expect(strip).toContainText(t('{n} without a CV file', { n: 1 }));
    await expect(page.getByRole('region', { name: t('Latest import from Oracle') })).toBeVisible();
    await ux.check('the strip after the import', [...STD, 'AZ']);
    const calls = await oracleCalls();
    expect(calls.filter((c) => c.overCollection)).toHaveLength(0);
    expect(calls.every((c) => /oraclecloud\.com$/.test(c.host))).toBe(true);
  },
);

uat(
  'OR-13',
  'Refresh after an applicant withdrew: the gone line shows; nothing new is copied (S3-INT-13, B18)',
  { on: ['D'], timeout: 180_000 },
  async ({ page, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const ref = uniq('REQ')
      .replace(/[^A-Za-z0-9-]/g, '-')
      .slice(0, 40);
    await seedOracle([{ number: ref, applications: 3 }]);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Oracle refresh'),
      jd: jd(['BGP routing']),
      start: true,
    });
    const start = await fetch(`${BASE}/vacancies/${v.id}/oracle/imports`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ref, estimate: 3 }),
    });
    expect(start.status).toBe(202);
    await drainImports();
    await changeOracle(ref, 0, 'withdraw');
    // The refresh wait (10 minutes) is moved back by the database, as a person would wait it out.
    await db(
      `UPDATE import_run SET created_at = created_at - interval '1 hour', finished_at = finished_at - interval '1 hour' WHERE vacancy_id = $1`,
      [v.id],
    );
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    const strip = page.getByTestId('oracle-strip');
    await strip.getByRole('button', { name: t('Refresh') }).click();
    const dlg = page.getByRole('dialog', { name: t('Refresh from Oracle?') });
    await dlg.getByRole('button', { name: t('Start') }).click();
    await drainImports();
    await expect(strip).toContainText(
      t('{n} imported applicants are no longer active in Oracle.', { n: 1 }),
      { timeout: 30_000 },
    );
    await expect(strip).toContainText(t('Nothing new in Oracle since the last refresh.'));
  },
);
