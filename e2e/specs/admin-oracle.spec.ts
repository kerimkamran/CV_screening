import { ADMIN_ACTIVE, ADMIN_BASE, oracleAdminApi } from '../fixtures/oracle';
import { T } from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';

// 7.4 Administration (AD), continued for Stage 3: the Oracle card, layer L1 (plan 18.4).

uat(
  'AD-23',
  'Oracle card before activation: 3 fields, 1 tick-box, Activate; the five result lines; the password never shown (A3-A8)',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    let code = 'auth_failed';
    const answers: string[] = [];
    page.on('response', async (r) => {
      if (/\/api\//.test(r.url())) answers.push(await r.text().catch(() => ''));
    });
    await oracleAdminApi(page, {
      view: () => ADMIN_BASE,
      activate: () => ({ code, enabled: code === 'ok' }),
    });
    await page.goto('about:blank');
    await page.goto('/#/admin/oracle');
    await expect(page.getByRole('button', { name: t('Activate') })).toBeVisible();
    await page.getByRole('button', { name: t('Activate') }).click();
    await expect(page.getByText(t('Paste the Oracle API address.'))).toBeVisible();
    await page
      .getByLabel(new RegExp(`^${t('Oracle API address')}`))
      .fill('https://pod.fa.em2.example-ending/hcmRestApi/x');
    await page.getByLabel(new RegExp(`^${t('User name')}`)).fill('parallax.integration');
    await page.getByLabel(t('Password'), { exact: true }).fill('L1-SECRET-PASSWORD');
    await page.getByRole('checkbox').check();
    const lines: Record<string, string> = {
      auth_failed: 'Sign-in failed. Oracle did not accept this user name and password.',
      empty_scope:
        'Connected, but this account sees no vacancies. Ask the Oracle team to give it access to Recruiting, then try again.',
      unreachable: 'The address could not be reached. Check it and try again.',
    };
    for (const [c, line] of Object.entries(lines)) {
      code = c;
      await page.getByLabel(t('Password'), { exact: true }).fill('L1-SECRET-PASSWORD');
      await page.getByRole('button', { name: t('Activate') }).click();
      await expect(page.getByText(t(line))).toBeVisible();
    }
    await ux.check('the Oracle card with a result line', [...STD, 'AZ']);
    expect(await page.content()).not.toContain('L1-SECRET-PASSWORD');
    expect(answers.join('\n')).not.toContain('L1-SECRET-PASSWORD');
  },
);

uat(
  'AD-24',
  'Oracle card after activation: Active, three buttons, Advanced closed (A9, A14)',
  { on: ['D'] },
  async ({ page, meta }) => {
    const t = T(meta.lang);
    await oracleAdminApi(page, { view: () => ADMIN_ACTIVE });
    await page.goto('about:blank');
    await page.goto('/#/admin/oracle');
    await expect(page.getByRole('button', { name: t('Test again') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('Replace password') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('Turn off') })).toBeVisible();
    await expect(page.locator('input[type=password]')).toHaveCount(0);
    expect(
      await page.locator('details', { hasText: t('Advanced') }).getAttribute('open'),
    ).toBeNull();
    await expect(page.getByRole('link', { name: t('Oracle import') })).toBeVisible();
  },
);

uat(
  'AD-29',
  'Switch off: the Oracle tab shows one sentence and no control (A2)',
  { on: ['D'] },
  async ({ page, meta }) => {
    const t = T(meta.lang);
    await oracleAdminApi(page, { view: () => 404 });
    await page.goto('about:blank');
    await page.goto('/#/admin/oracle');
    await expect(
      page.getByText(t('Oracle import is not available in this environment.')),
    ).toBeVisible();
    await expect(page.locator('main input')).toHaveCount(0);
  },
);
