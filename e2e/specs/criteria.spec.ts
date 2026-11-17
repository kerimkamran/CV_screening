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
    const typeSel = panel.getByRole('combobox', { name: t('Type'), exact: true }).nth(1);
    await typeSel.selectOption({ index: 0 });
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

uat(
  'CR-03',
  'Criteria rows: type changes weight and rule, knockout words keep commas, add, remove, save draft',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const rows = REQS.slice(0, 3).map((r) => ({ ...r, rule: null, confidence: 'high' }));
    const puts: any[] = [];
    await resultsApi(page, {
      criteria: criteria({ frozen: false, versions: [{ version: 1, frozenAt: null }], rows }),
      answers: {
        [`PUT /vacancies/${DVID}/criteria`]: (_r, _u, _m, body) => {
          puts.push(body);
          return criteria({
            frozen: false,
            versions: [{ version: 1, frozenAt: null }],
            rows: (body.requirements as any[]).map((q, i) => ({
              id: `R${i}`.padEnd(26, '0'),
              ...q,
            })),
          });
        },
      },
    });
    await page.goto(`/#/vacancies/${DVID}/criteria`);
    const panel = page.getByRole('tabpanel');
    const crit = panel.getByLabel(t('Criterion'), { exact: true });
    const type = panel.getByRole('combobox', { name: t('Type'), exact: true });
    const weight = panel.getByLabel(t('Weight'), { exact: true });
    const save = panel.getByRole('button', { name: t('Save draft') });
    await expect(crit).toHaveCount(3);
    await expect(save, 'Save draft waits for a change').toBeDisabled();
    // The four types, in the plan's words.
    const labels = await type
      .first()
      .evaluate((el: HTMLSelectElement) => [...el.options].map((o) => o.textContent));
    expect(labels).toEqual(
      [
        'Mandatory',
        'Preferred',
        'Informational (not scored)',
        'Knockout rule (routes to review)',
      ].map((s) => t(s)),
    );
    // Mandatory 10, Preferred 5; Informational and Knockout take the weight away and disable it.
    await type.nth(1).selectOption('preferred');
    await expect(weight.nth(1)).toHaveValue('5');
    await expect(weight.nth(1)).toBeEnabled();
    await type.nth(1).selectOption('mandatory');
    await expect(weight.nth(1)).toHaveValue('10');
    await type.nth(1).selectOption('informational');
    await expect(weight.nth(1)).toHaveValue('');
    await expect(weight.nth(1)).toBeDisabled();
    await type.nth(1).selectOption('disqualifier');
    await expect(weight.nth(1)).toBeDisabled();
    // The rule fields appear with the hint.
    // The hint sits inside the label, so the name is matched as a start, not exactly.
    const words = panel.getByLabel(t('Words (comma-separated)'));
    await expect(panel.getByRole('combobox', { name: t('Rule'), exact: true })).toBeVisible();
    await expect(words).toBeVisible();
    await expect(
      panel.getByText(
        t(
          'Matched as whole words, ignoring case. Include likely synonyms and languages. A match only sends the CV to human review; nobody is rejected automatically.',
        ),
      ),
    ).toBeVisible();
    // Typing key by key keeps the commas and spaces; the saved words are trimmed.
    await words.pressSequentially('AWS, Azure , GCP');
    await expect(words).toHaveValue('AWS, Azure , GCP');
    await words.fill('AWS, Azure , GCP');
    await expect(words).toHaveValue('AWS, Azure , GCP');
    // Add and remove.
    await panel.getByRole('button', { name: t('Add criterion') }).click();
    await expect(crit).toHaveCount(4);
    await expect(crit.nth(3)).toHaveValue('');
    await expect(type.nth(3)).toHaveValue('mandatory');
    await panel.getByRole('button', { name: t('Remove criterion {n}', { n: 3 }) }).click();
    await expect(crit).toHaveCount(3);
    await expect(crit.nth(2), 'criterion 3 (CCIE) is gone, the new blank row is third').toHaveValue(
      '',
    );
    await crit.nth(2).fill('Docker');
    await expect(save).toBeEnabled();
    await ux.shot('edited rows');
    await save.click();
    await expect(panel.getByText(t('Draft saved.'))).toBeVisible();
    expect(puts.length, 'one PUT /criteria').toBe(1);
    const sent = puts[0].requirements as any[];
    expect(sent.map((r) => r.text)).toEqual(['BGP routing', 'OSPF', 'Docker']);
    expect(sent[1]).toMatchObject({
      classification: 'disqualifier',
      weight: null,
      rule: { type: 'must_contain_any', terms: ['AWS', 'Azure', 'GCP'] },
    });
    expect(sent[2]).toMatchObject({ classification: 'mandatory', weight: 10 });
    await ux.check('criteria edited', [...STD, 'AZ']);
  },
);
