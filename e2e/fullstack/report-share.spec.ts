import { appDay } from '../fixtures/dates';
import { esc, jd, T } from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';
import { accounts, login, openAs, screenedVacancy, uniq } from './stack';

// 7.15 Report and sharing (RP), full-stack journeys (L2). UAT plan v1.1.

uat(
  'RP-05',
  "Create a share link and copy it; 'Shared so far' row",
  { on: ['D', 'A'] },
  async ({ page, ux, meta, context }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const p = uniq('Share');
    const files = Array.from({ length: 6 }, (_, i) => ({
      name: `${p.toLowerCase().replace(/\W+/g, '-')}-${i}.txt`,
      type: 'text/plain',
      data: `Name: ${p} Person ${i}\nBGP routing on the core.\n${i % 2 ? 'Python scripting.' : ''}\n${'Worked on network operations. '.repeat(8)}`,
    }));
    const v = await screenedVacancy(token, {
      title: uniq('UAT Share'),
      jd: jd(['BGP routing'], ['Python scripting']),
      files,
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sent: any[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/vacancies\/\w+\/shares$/.test(r.url()))
        sent.push(r.postDataJSON());
    });
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}/report`);
    // 1) Share as a link; search; tick the viewer; 14 days; no quotes.
    await page.getByRole('button', { name: t('Share as a link') }).click();
    // PLAN: 'UAT Viewer' — the seeded viewer account is called Leyla Ismayilova (accounts.json); searched by 'viewer' (her e-mail).
    const viewer = acc.viewer.displayName;
    await page.getByPlaceholder(t('Search by name or e-mail')).fill('viewer');
    await page.getByRole('checkbox', { name: new RegExp(esc(viewer)) }).check();
    await page.getByLabel(t('Link works for')).selectOption({ label: t('{n} days', { n: 14 }) });
    await page
      .getByRole('checkbox', { name: new RegExp(esc(t('Include quotes from the CVs.'))) })
      .uncheck();
    // 2) Create link.
    await page.getByRole('button', { name: t('Create link') }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect.soft(sent[0]).toMatchObject({
      viewerIds: [acc.viewer.userId ?? expect.any(String)],
      expiresInDays: 14,
      includeNames: true,
      includeQuotes: false,
    });
    await expect
      .soft(
        page.getByText(
          t('The link is ready. Send it to the people you named; they sign in to open it.'),
        ),
      )
      .toBeVisible();
    const link = page.getByLabel(t('Report link'));
    await expect
      .soft(link)
      .toHaveValue(
        new RegExp(`^${esc(new URL(page.url()).origin)}/#/reports/[0-9A-HJKMNP-TV-Z]{26}$`),
      );
    // 3) Focus selects; Copy link.
    await link.focus();
    const sel = await link.evaluate((i: HTMLInputElement) => i.selectionEnd! - i.selectionStart!);
    expect.soft(sel, 'the link is selected on focus').toBe((await link.inputValue()).length);
    await page
      .getByRole('button', { name: t('Copy link'), exact: true })
      .first()
      .click();
    await expect
      .soft(page.getByRole('button', { name: t('Copied'), exact: true }).first())
      .toBeVisible();
    expect
      .soft(await page.evaluate(() => navigator.clipboard.readText()))
      .toBe(await link.inputValue());
    const row = page.getByRole('listitem').filter({ hasText: viewer });
    const expIso = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const exp =
      meta.lang === 'az'
        ? await appDay(page, expIso, 'az', 'long')
        : new Date(expIso).toLocaleDateString('en-GB');
    await expect.soft(row).toContainText(t('Snapshot of {date}', { date: '' }).trim());
    await expect.soft(row).toContainText(exp);
    await expect
      .soft(row)
      .toContainText(
        `${t('For {names}.', { names: viewer })} ${t('Real names included.')} ${t('No quotes.')}`,
      );
    await expect.soft(row.getByText(t('Opened {n} times', { n: 0 }))).toBeVisible();
    await row.getByText(t('Opened {n} times', { n: 0 })).click();
    await expect.soft(row.getByText(t('Not opened yet.'))).toBeVisible();
    await ux.check('shared', [...STD, 'AZ']);
    // 4) Share with someone else.
    await page.getByRole('button', { name: t('Share with someone else') }).click();
    await expect.soft(page.getByPlaceholder(t('Search by name or e-mail'))).toBeVisible();
  },
);
