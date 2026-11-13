import { criteria, DVID, onBackgrounds, REQS, resultsApi, T } from '../fixtures/pkg-d';
import { expect, STD, uat } from '../ux/test';

// 7.14 Criteria tab (CR), layer L1. UAT plan v1.1; each case is the row of the same ID.

uat(
  'CR-01',
  'Criteria tab opens with an unfrozen draft and no browser dialog; layout and 4 backgrounds',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const rows = REQS.slice(0, 4).map((r) => ({ ...r, rule: null, confidence: 'high' }));
    await resultsApi(page, {
      criteria: criteria({
        versions: [
          { version: 1, frozenAt: new Date(Date.now() - 864e5).toISOString() },
          { version: 2, frozenAt: null },
        ],
        current: 2,
        frozen: false,
        rows,
      }),
    });
    // With a listener attached Playwright no longer dismisses dialogs itself: count and dismiss each.
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await page.goto(`/#/vacancies/${DVID}/criteria`);
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText(t('Criteria · version {n} · draft', { n: 2 }))).toBeVisible();
    await page.waitForTimeout(500);
    expect
      .soft(dialogs.length, `no dialog on opening (SD-25): ${dialogs.slice(0, 2).join(' / ')}`)
      .toBe(0);
    const crit = panel.getByLabel(t('Criterion'), { exact: true });
    await expect.soft(crit).toHaveCount(4);
    await crit.first().pressSequentially(' x');
    const typeSel = panel.getByLabel(t('Type'), { exact: true }).nth(1);
    if (await typeSel.count()) await typeSel.selectOption({ index: 0 });
    await page.waitForTimeout(300);
    expect.soft(dialogs.length, 'no dialog on opening, typing or changing a type').toBe(0);
    await expect.soft(panel.getByRole('button', { name: t('Extract with AI') })).toBeEnabled();
    await expect
      .soft(panel.getByText(t('The AI proposes criteria from the job description.')))
      .toBeVisible();
    await expect.soft(panel.getByText(t('Job description'), { exact: true })).toBeVisible();
    await expect.soft(panel.getByRole('button', { name: t('Edit text') })).toBeVisible();
    await ux.check('criteria', [...STD, 'AZ']);
    await onBackgrounds(page, meta.lang, async (bg) => ux.check(`background ${bg}`, ['AXE']));
  },
);
