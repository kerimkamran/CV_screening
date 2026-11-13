import type { Page } from '@playwright/test';
import {
  adjustments,
  AYSEL,
  bandRows,
  criteria,
  crow,
  DVID,
  esc,
  onBackgrounds,
  posts,
  resultsApi,
  T,
  type CRow,
} from '../fixtures/pkg-d';
import { expect, STD, uat } from '../ux/test';

// 7.15 Report and sharing (RP), layer L1. UAT plan v1.1; each case is the row of the same ID.

const open = (page: Page) => page.goto(`/#/vacancies/${DVID}/report`);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const ISO_DAY = /\b\d{4}-\d{2}-\d{2}\b/;
/** 30 CVs, all read: 27 scored (6/8/8/5), 3 sent to a human look by a knockout rule. */
function thirty(): CRow[] {
  const rows = bandRows({ strong: 6, good: 8, partial: 8, limited: 5 });
  for (let i = 28; i <= 30; i++)
    rows.push(crow(i, { score: null, state: 'completed', knockout: true, band: 'needs_review' }));
  rows[0]!.decision = {
    outcome: 'shortlist',
    reason: 'Strong BGP work',
    decidedAt: daysAgo(1),
    decidedBy: 'Aysel Mammadova',
  };
  rows[3]!.decision = {
    outcome: 'reject',
    reason: '',
    decidedAt: daysAgo(1),
    decidedBy: 'Aysel Mammadova',
  };
  return rows;
}
const twoChanges = () => {
  const a = adjustments({
    current: { OSPF: 'ignore' },
    changes: [
      {
        id: '01K0000000000000000000CHG1',
        requirementId: null,
        requirement: 'CCIE certification',
        from: 'mandatory',
        to: 'preferred',
        reset: false,
        by: 'Aysel Mammadova',
        at: daysAgo(2),
      },
      {
        id: '01K0000000000000000000CHG2',
        requirementId: null,
        requirement: 'OSPF',
        from: 'mandatory',
        to: 'ignore',
        reset: false,
        by: 'Aysel Mammadova',
        at: daysAgo(1),
      },
    ],
  });
  a.requirements[0]!.text = 'BGP routing, 5+ years';
  return a;
};

uat(
  'RP-01',
  'Report tab layout: header, sections, top 15, footer, 4 backgrounds',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await resultsApi(page, {
      rows: thirty(),
      adj: twoChanges(),
      criteria: criteria({
        versions: [
          { version: 1, frozenAt: daysAgo(5) },
          { version: 2, frozenAt: daysAgo(3) },
        ],
        current: 2,
      }),
    });
    await open(page);
    const art = page.getByRole('article', { name: t('Evaluation report') });
    await expect(art).toBeVisible();
    const header = art.locator('header').first();
    await expect.soft(header.getByLabel(/parallax/)).toBeVisible();
    await expect.soft(header.getByText(t('Evaluation report'), { exact: true })).toBeVisible();
    await expect.soft(header.getByRole('heading', { name: 'UAT Results role' })).toBeVisible();
    const line = header.locator('p').last();
    const counts = t(
      'Report date {date} · {read} read, {scored} scored, {need} need a human look',
      { date: 'DATE', read: 30, scored: 27, need: 3 },
    ).split('DATE')[1]!;
    await expect.soft(line).toContainText(counts);
    // SD-79: the date is in the app's date format, not ISO.
    expect
      .soft(
        (await line.innerText()).match(ISO_DAY)?.[0] ?? null,
        'report date is not ISO (YYYY-MM-DD)',
      )
      .toBeNull();
    const sec = (h: string) =>
      art
        .locator('section')
        .filter({ has: page.getByRole('heading', { level: 3, name: t(h), exact: true }) });
    await expect.soft(sec('The role')).toContainText(t('Must-have ({n})', { n: 2 }));
    await expect.soft(sec('The role')).toContainText(t('Nice-to-have ({n})', { n: 2 }));
    await expect
      .soft(sec('The role'))
      .toContainText(t('Experience asked for: {years}.', { years: t('{n} years', { n: '5+' }) }));
    await expect.soft(sec('How it was scored')).toContainText(
      t('Scored against requirements version {version}, frozen {date}.', {
        version: 2,
        date: 'X',
      }).split('X')[0]!,
    );
    await expect.soft(sec('How it was scored')).toContainText(t('AI suggests, a human decides.'));
    const bands = sec('The match').getByRole('listitem');
    for (const [i, [b, n]] of (
      [
        ['Strong', 6],
        ['Good', 8],
        ['Partial', 8],
        ['Limited', 5],
        ['Needs a human look', 3],
      ] as const
    ).entries())
      await expect.soft(bands.nth(i)).toHaveText(`${t(b)} ${n}`);
    await expect
      .soft(sec('Candidates, best match first'))
      .toContainText(t('Showing {top} of {n} scored', { top: 15, n: 27 }));
    await expect.soft(sec('Candidates, best match first').locator('ol > li')).toHaveCount(15);
    await expect.soft(sec('Data quality')).toContainText(t('Every file was read.'));
    await expect.soft(sec('Changes and decisions')).toBeVisible();
    const foot = art.locator('footer').last();
    await expect.soft(foot).toContainText(
      t('Run {id} · scan started {date} · report date {today}', {
        id: DVID.slice(-8),
        date: 'X',
        today: 'Y',
      }).split('X')[0]!,
    );
    expect
      .soft((await foot.innerText()).match(ISO_DAY)?.[0] ?? null, 'footer report date is not ISO')
      .toBeNull();
    await ux.check('report', [...STD, 'AZ']);
    await onBackgrounds(page, meta.lang, async (bg) => ux.check(`background ${bg}`, ['AXE']));
  },
);

uat(
  'RP-02',
  'Report states: preparing, error with Try again, no CVs, still reading, stopped, no AI, not read',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    ux.allow(/500/);
    const scen = async (o: Parameters<typeof resultsApi>[1]) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await resultsApi(page, o);
      await page.goto('about:blank');
      await open(page);
    };
    // A: 500 then 200, with 'Preparing the report…' while it loads.
    let n = 0;
    await scen({
      rows: bandRows({ strong: 3 }),
      answers: {
        [`GET /vacancies/${DVID}/candidates`]: async (route) => {
          await new Promise((r) => setTimeout(r, 700));
          if (n++ === 0) {
            await route.fulfill({
              status: 500,
              json: { statusCode: 500, message: 'Database not reachable' },
            });
            return true;
          }
          return undefined;
        },
      },
    });
    await expect.soft(page.getByText(t('Preparing the report…'))).toBeVisible();
    await expect
      .soft(
        page.getByText(
          t('The report could not be prepared. {error}', { error: 'Database not reachable' }),
        ),
      )
      .toBeVisible();
    await ux.check('A error', [...STD, 'AZ']);
    await page.getByRole('button', { name: t('Try again') }).click();
    await expect.soft(page.getByRole('article', { name: t('Evaluation report') })).toBeVisible();
    // B: no CVs.
    await scen({ rows: [] });
    await expect
      .soft(page.getByText(t('No CVs yet, so there is nothing to report.')))
      .toBeVisible();
    // C: 10 of 30 read.
    const reading = [
      ...bandRows({ strong: 5, good: 5 }),
      ...Array.from({ length: 20 }, (_, i) => crow(11 + i, { score: null, state: 'queued' })),
    ];
    await scen({ rows: reading });
    await expect
      .soft(
        page.getByText(
          t('{read} of {total} read, this report will update.', { read: 10, total: 30 }),
        ),
      )
      .toBeVisible();
    await expect
      .soft(
        page.getByText(
          t('A shared link is offered when the scan is done. {read} of {total} read so far.', {
            read: 10,
            total: 30,
          }),
        ),
      )
      .toBeVisible();
    await ux.check('C reading', [...STD, 'AZ']);
    // D: 25 read, 5 stopped.
    await scen({
      rows: [
        ...bandRows({ strong: 10, good: 15 }),
        ...Array.from({ length: 5 }, (_, i) => crow(26 + i, { score: null, state: 'stopped' })),
      ],
    });
    await expect
      .soft(
        page.getByText(
          t('Stopped at {read} of {total}. Files not read are listed under Data quality.', {
            read: 25,
            total: 30,
          }),
        ),
      )
      .toBeVisible();
    // E: no AI with unread CVs.
    await scen({
      rows: [...bandRows({ strong: 2 }), crow(3, { score: null, state: 'queued' })],
      aiActive: false,
    });
    await expect
      .soft(
        page.getByText(
          t(
            'No AI provider is active, so CVs wait in the queue. An administrator can set one up under Admin → AI models.',
          ),
        ),
      )
      .toBeVisible();
    // F: 2 not read.
    await scen({
      rows: [
        ...bandRows({ strong: 3 }),
        crow(4, { score: null, state: 'failed', name: 'Rauf Əliyev' }),
        crow(5, { score: null, state: 'manual', parseStatus: 'empty', name: 'Leyla Həsənova' }),
      ],
    });
    await expect.soft(page.getByText(t('Not read ({n})', { n: 2 }))).toBeVisible();
    await expect
      .soft(
        page.getByText(
          new RegExp(`^Leyla Həsənova: ${esc(t('Scan only: no readable text in the file'))}$`),
        ),
      )
      .toBeVisible();
    await ux.check('F', [...STD, 'AZ']);
  },
);

/** People search, one active share that turns 'revoked' after POST revoke, clipboard refused. */
async function shareApi(page: Page, o: { reading?: boolean } = {}) {
  let state: 'active' | 'revoked' = 'active';
  const share = () => ({
    id: '01K0000000000000000000SHR1',
    createdAt: daysAgo(2),
    expiresAt: new Date(Date.now() + 28 * 86_400_000).toISOString(),
    state,
    includeNames: true,
    includeQuotes: false,
    viewers: [{ id: '01K0000000000000000000VWR1', name: 'UAT Viewer', email: 'viewer@example.az' }],
    openCount: 0,
    opens: [],
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
      configurable: true,
    });
  });
  const rows = o.reading
    ? [
        ...bandRows({ strong: 5, good: 5 }),
        ...Array.from({ length: 20 }, (_, i) => crow(11 + i, { score: null, state: 'queued' })),
      ]
    : bandRows({ strong: 3, good: 3 });
  return resultsApi(page, {
    rows,
    people: {
      people: [
        { id: '01K0000000000000000000VWR1', displayName: 'UAT Viewer', email: 'viewer@example.az' },
      ],
    },
    answers: {
      [`GET /vacancies/${DVID}/shares`]: () => ({ shares: [share()] }),
      [`POST /vacancies/${DVID}/shares`]: () => ({ id: '01K0000000000000000000SHR2' }),
      'POST /shares/01K0000000000000000000SHR1/revoke': () => {
        state = 'revoked';
        return { ok: true };
      },
    },
  });
}

uat(
  'RP-06',
  'Copy failure after creating a link is shown; Revoke asks for confirmation',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const { seen } = await shareApi(page);
    const dialogs: string[] = [];
    let accept = false;
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void (accept ? d.accept() : d.dismiss());
    });
    await open(page);
    await page.getByRole('button', { name: t('Share as a link') }).click();
    await page.getByRole('checkbox', { name: /UAT Viewer/ }).check();
    await page.getByRole('button', { name: t('Create link') }).click();
    await expect(page.getByLabel(t('Report link'))).toBeVisible();
    await page
      .getByRole('button', { name: t('Copy link'), exact: true })
      .first()
      .click();
    await expect
      .soft(
        page.getByText(t('Could not copy. Select the link and copy it by hand.')),
        'the copy failure is visible next to the link',
      )
      .toBeVisible({ timeout: 3000 });
    await ux.check('copy failed', [...STD, 'AZ']);
    // Revoke: a confirmation first; dismissed → nothing sent.
    const row = page.getByRole('listitem').filter({ hasText: 'UAT Viewer' });
    await row.getByRole('button', { name: t('Revoke') }).click();
    await page.waitForTimeout(500);
    expect
      .soft(dialogs.length, 'a confirmation appears before anything is sent')
      .toBeGreaterThan(0);
    expect.soft(posts(seen, /\/shares\/\w+\/revoke$/).length, 'dismissed: no POST revoke').toBe(0);
    // Accept: one POST and the row reads 'revoked'.
    accept = true;
    if (await row.getByRole('button', { name: t('Revoke') }).count())
      await row.getByRole('button', { name: t('Revoke') }).click();
    await expect.soft(row).toContainText(t('revoked'));
    expect.soft(posts(seen, /\/shares\/\w+\/revoke$/).length, 'one POST revoke').toBe(1);
    await expect.soft(row.getByRole('button', { name: t('Copy link') })).toHaveCount(0);
    await expect.soft(row.getByRole('button', { name: t('Revoke') })).toHaveCount(0);
    await ux.check('revoked', [...STD, 'AZ']);
  },
);

uat(
  'RP-14',
  'Report when no CV could be scored: clear message, no share, every file listed under data quality',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const a = [
      crow(1, { score: null, state: 'failed', name: 'Person 01' }),
      crow(2, { score: null, state: 'failed', name: 'Person 02' }),
      crow(3, { score: null, state: 'failed', name: 'Person 03' }),
      crow(4, { score: null, state: 'manual', parseStatus: 'empty', name: 'Person 04' }),
      crow(5, { score: null, state: 'manual', parseStatus: 'empty', name: 'Person 05' }),
    ];
    const { seen } = await resultsApi(page, { rows: a });
    await open(page);
    await expect
      .soft(page.getByText(t('No candidate has been scored yet, so there is nothing to share.')))
      .toBeVisible();
    const share = page.getByRole('button', { name: t('Share as a link') });
    await expect.soft(share).toBeDisabled();
    const before = seen.requests.length;
    await share.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect
      .soft(
        seen.requests.slice(before).filter((r) => /share|people/.test(r.url)),
        'no request',
      )
      .toEqual([]);
    const bands = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 3, name: t('The match') }) })
      .getByRole('listitem');
    for (const [i, b] of ['Strong', 'Good', 'Partial', 'Limited'].entries())
      await expect.soft(bands.nth(i)).toHaveText(`${t(b)} 0`);
    await expect.soft(page.getByText(t('No strong match in this batch.'))).toHaveCount(0);
    await expect
      .soft(page.getByText(t('No candidate could be scored. See “Not read” below.')))
      .toBeVisible();
    const dq = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 3, name: t('Data quality') }) });
    for (let i = 1; i <= 5; i++)
      await expect.soft(dq.getByText(new RegExp(`^Person 0${i}: `))).toBeVisible();
    await ux.check('A', [...STD, 'AZ']);
    // B: 2 read, 3 still queued, none scored.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, {
      rows: [
        a[0]!,
        a[3]!,
        crow(6, { score: null, state: 'queued' }),
        crow(7, { score: null, state: 'queued' }),
        crow(8, { score: null, state: 'queued' }),
      ],
    });
    await page.reload();
    await expect
      .soft(page.getByText(t('No candidate has been scored yet.'), { exact: true }))
      .toBeVisible();
    await expect
      .soft(
        page.getByText(
          t('A shared link is offered when the scan is done. {read} of {total} read so far.', {
            read: 2,
            total: 5,
          }),
        ),
      )
      .toBeVisible();
    await ux.check('B', [...STD, 'AZ']);
  },
);

uat(
  'RP-15',
  'Sharing blocked during a new scan while earlier links exist: no empty panel, earlier links still usable',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const { seen } = await shareApi(page, { reading: true });
    page.on('dialog', (d) => void d.accept());
    await open(page);
    await expect
      .soft(
        page.getByText(
          t('A shared link is offered when the scan is done. {read} of {total} read so far.', {
            read: 10,
            total: 30,
          }),
        ),
      )
      .toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: 'UAT Viewer' });
    await expect.soft(row.getByRole('button', { name: t('Copy link') })).toBeVisible();
    await expect.soft(row.getByRole('button', { name: t('Revoke') })).toBeVisible();
    const btn = page.getByRole('button', { name: t('Share as a link') });
    if (await btn.isEnabled()) {
      await btn.click();
      const expanded = await page
        .getByRole('button', { name: t('Close'), exact: true })
        .first()
        .getAttribute('aria-expanded')
        .catch(() => null);
      const shown = await page.getByPlaceholder(t('Search by name or e-mail')).count();
      expect
        .soft(
          expanded === 'true' && shown === 0,
          "the button reads 'Close' with aria-expanded=true while nothing new is shown",
        )
        .toBe(false);
    }
    await ux.check('blocked', [...STD, 'AZ']);
    await row.getByRole('button', { name: t('Revoke') }).click();
    await expect.soft(row).toContainText(t('revoked'));
    expect.soft(posts(seen, /\/shares\/\w+\/revoke$/).length).toBe(1);
  },
);

void AYSEL;
