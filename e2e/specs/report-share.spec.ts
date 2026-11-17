import type { Page } from '@playwright/test';
import { mockApi } from '../fixtures/api';
import { ulidOf } from '../fixtures/files';
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
  scrOf,
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

uat(
  'RP-03',
  "Report candidate list: 'Show all n', 'Show only the top 15', 'Show details', 'Hide details'",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await resultsApi(page, { rows: bandRows({ strong: 9, good: 9, partial: 9 }) });
    await open(page);
    const art = page.getByRole('article', { name: t('Evaluation report') });
    const entries = art.locator('section[aria-labelledby="rep-cands"] ol > li');
    await expect(entries).toHaveCount(15);
    await expect(art.getByText(t('Showing {top} of {n} scored', { top: 15, n: 27 }))).toBeVisible();
    // 1) Show all 27.
    await art.getByRole('button', { name: t('Show all {n}', { n: 27 }), exact: true }).click();
    await expect(entries).toHaveCount(27);
    await expect(art.getByText(t('Showing all {n} scored', { n: 27 }))).toBeVisible();
    await expect(
      art.getByRole('button', { name: t('Show only the top {top}', { top: 15 }), exact: true }),
    ).toBeVisible();
    // The first 15 are open, the other 12 are collapsed.
    const showDetails = art.getByRole('button', { name: t('Show details'), exact: true });
    await expect(showDetails).toHaveCount(12);
    await expect(entries.nth(14).getByRole('button', { name: t('Show details') })).toHaveCount(0);
    await ux.check('all 27', [...STD, 'AZ']);
    // 2) Show details on entry 20: quotes with their page, the missing must-have, and Hide details.
    const e20 = entries.nth(19);
    await e20.getByRole('button', { name: t('Show details'), exact: true }).click();
    const forLine = t('For: {requirement}', { requirement: 'BGP routing' });
    await expect(e20.locator('blockquote footer').first()).toContainText(forLine);
    await expect(e20.locator('blockquote footer').first()).toContainText(
      t('page {n}', { n: 1 }).replace('1', ''),
    );
    await expect(
      e20.getByText(
        t('Not found in this CV. Searched for: {text}', { text: 'CCIE certification' }),
      ),
    ).toBeVisible();
    await expect(showDetails).toHaveCount(11);
    await ux.check('entry 20 open', [...STD, 'AZ']);
    // 3) Hide details.
    await e20.getByRole('button', { name: t('Hide details'), exact: true }).click();
    await expect(e20.getByRole('button', { name: t('Show details'), exact: true })).toBeVisible();
    await expect(e20.locator('blockquote')).toHaveCount(0);
    // 4) Back to the top 15.
    await art
      .getByRole('button', { name: t('Show only the top {top}', { top: 15 }), exact: true })
      .click();
    await expect(entries).toHaveCount(15);
    await expect(
      art.getByRole('button', { name: t('Show all {n}', { n: 27 }), exact: true }),
    ).toBeVisible();
  },
);

uat(
  'RP-16',
  'Report candidate reasons: loading line, then the reason, and a plain message when one fails',
  { on: ['D'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    ux.allow(/500|Database not reachable|Failed to load resource/);
    await resultsApi(page, {
      rows: bandRows({ strong: 7, good: 7, partial: 6 }),
      detail: (sid) =>
        sid === scrOf(1) ? { delay: 2000 } : sid === scrOf(2) ? { status: 500 } : undefined,
    });
    await open(page);
    const art = page.getByRole('article', { name: t('Evaluation report') });
    const entries = art.locator('section[aria-labelledby="rep-cands"] ol > li');
    await expect(entries).toHaveCount(15);
    // 2) Within the first second: entry 1 is still loading, with its chips already there.
    await expect(entries.nth(0).getByText(t('Loading the reason…'))).toBeVisible({ timeout: 1500 });
    await expect(entries.nth(0).getByRole('list', { name: t('Skills') })).toBeVisible();
    await ux.check('loading', [...STD, 'AZ']);
    // 3) Three seconds later: entry 1 has its summary and up to two quotes; entry 2 says it failed
    // and still shows its band, its must-have tally and its chips.
    await page.waitForTimeout(3000);
    await expect(entries.nth(0).getByText(t('Loading the reason…'))).toHaveCount(0);
    await expect(entries.nth(0).locator('blockquote')).not.toHaveCount(0);
    expect(await entries.nth(0).locator('blockquote').count()).toBeLessThanOrEqual(2);
    const second = entries.nth(1);
    await expect(second.getByText(t('The reason could not be loaded.'))).toBeVisible();
    const tally = new RegExp(
      esc(t('{found} of {total} must-haves found', { found: '§1', total: '§2' }))
        .replace('§1', '\\d+')
        .replace('§2', '\\d+'),
    );
    await expect(second).toContainText(tally);
    await expect(second.getByRole('list', { name: t('Skills') })).toBeVisible();
    // Every other entry and section rendered.
    await expect(entries.nth(14).getByRole('list', { name: t('Skills') })).toBeVisible();
    await expect(
      art.getByRole('heading', { level: 3, name: t('Data quality'), exact: true }),
    ).toBeVisible();
    await ux.check('one failed', [...STD, 'AZ']);
  },
);

uat(
  'RP-04',
  'Share panel: people search, chosen people, expiry, quotes, disabled states',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const people = [
      {
        id: '01K0000000000000000000VWR1',
        displayName: 'Leyla Hasanova',
        email: 'leyla@example.az',
      },
      { id: '01K0000000000000000000VWR2', displayName: 'Tural Guliyev', email: 'tural@example.az' },
      {
        id: '01K0000000000000000000VWR3',
        displayName: 'Nigar Safarova',
        email: 'nigar@example.az',
      },
    ];
    const { seen } = await resultsApi(page, {
      rows: bandRows({ strong: 3, good: 3 }),
      answers: {
        'GET /reports/people': (_r: unknown, u: URL) => ({
          people: u.searchParams.get('q') === 'zz' ? [] : people,
        }),
      },
    });
    await open(page);
    const lookups = () =>
      seen.requests.filter((r) => r.method === 'GET' && r.url.startsWith('/reports/people')).length;
    // 1) Open the panel: intro, hint, placeholder, aria-expanded, and the button reads Close.
    const share = page.getByRole('button', { name: t('Share as a link'), exact: true });
    await share.click();
    const panel = page.locator('section[aria-labelledby="share-h"]');
    await expect(panel.getByRole('heading', { name: t('Share this report') })).toBeVisible();
    await expect(
      panel.getByText(
        t('A login-only link to a snapshot taken now. Only the people you name can open it.'),
      ),
    ).toBeVisible();
    const close = panel.getByRole('button', { name: t('Close'), exact: true });
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByText(t('Who can open it'))).toBeVisible();
    await expect(panel.getByText(t('People with an account. They must sign in.'))).toBeVisible();
    const search = panel.getByPlaceholder(t('Search by name or e-mail'));
    await expect(search).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: /Leyla Hasanova/ })).toBeVisible();
    const create = panel.getByRole('button', { name: t('Create link'), exact: true });
    await expect(create, 'disabled until someone is chosen').toBeDisabled();
    // The defaults: 30 days, quotes on with their warning.
    const days = panel.getByRole('combobox', { name: t('Link works for') });
    expect(await days.locator('option').allTextContents()).toEqual(
      [7, 14, 30, 60, 90].map((n) => t('{n} days', { n })),
    );
    await expect(days).toHaveValue('30');
    const quotes = panel.getByRole('checkbox', {
      name: new RegExp(esc(t('Include quotes from the CVs.'))),
    });
    await expect(quotes).toBeChecked();
    await expect(
      panel.getByText(t('Quotes are text from CVs and count as personal data.')),
    ).toBeVisible();
    await ux.check('panel open', [...STD, 'AZ']);
    // 2) Type zz, then clear: one lookup per pause, 'No one found.' in between.
    const before = lookups();
    await search.pressSequentially('zz', { delay: 40 });
    await expect(panel.getByText(t('No one found.'))).toBeVisible();
    expect(lookups() - before, 'one lookup for the two letters').toBe(1);
    await search.fill('');
    await expect(panel.getByRole('checkbox', { name: /Leyla Hasanova/ })).toBeVisible();
    expect(lookups() - before, 'one more after clearing').toBe(2);
    // 3) Tick two people: they show under Chosen people with a ×.
    await panel.getByRole('checkbox', { name: /Leyla Hasanova/ }).check();
    await panel.getByRole('checkbox', { name: /Tural Guliyev/ }).check();
    const chosen = panel.getByRole('list', { name: t('Chosen people') });
    await expect(chosen.getByRole('listitem')).toHaveCount(2);
    await expect(create).toBeEnabled();
    // 4) Remove one with its ×.
    await chosen
      .getByRole('button', { name: t('Remove {name}', { name: 'Leyla Hasanova' }) })
      .click();
    await expect(chosen.getByRole('listitem')).toHaveCount(1);
    await expect(panel.getByRole('checkbox', { name: /Leyla Hasanova/ })).not.toBeChecked();
    await ux.check('one chosen', [...STD, 'AZ']);
    // 5) The expiry choice and the quotes switch go with the request.
    await days.selectOption('60');
    await quotes.uncheck();
    await create.click();
    await expect.poll(() => posts(seen, /^\/vacancies\/\w+\/shares$/).length).toBe(1);
    expect(posts(seen, /^\/vacancies\/\w+\/shares$/)[0]!.body).toMatchObject({
      viewerIds: ['01K0000000000000000000VWR2'],
      expiresInDays: 60,
      includeQuotes: false,
    });
    // 6) Scenario B: a scan is still running and there is no earlier link: sharing is off.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, {
      rows: [
        ...bandRows({ strong: 5, good: 5 }),
        ...Array.from({ length: 20 }, (_, i) => crow(11 + i, { score: null, state: 'queued' })),
      ],
      aiActive: true,
    });
    // The same address again would only be a hash change on the same page: start from a blank one.
    await page.goto('about:blank');
    await open(page);
    const blocked = page.getByRole('button', { name: t('Share as a link'), exact: true });
    await expect(blocked).toBeDisabled();
    await ux.check('sharing off', [...STD, 'AZ']);
  },
);

uat(
  'RP-11',
  "Report 'Changes and decisions': frozen versions, requirement changes, reset and recruiter decisions",
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const kind = (k: string) => t(k).toLocaleLowerCase(meta.lang === 'az' ? 'az-AZ' : undefined);
    /** Fixed text with a date in it, as a pattern: the date is whatever the app prints. */
    const line = (s: string) => new RegExp(`^${esc(s).replace(/§D/g, '.+?')}$`);
    const scored = bandRows({ strong: 4, good: 3, partial: 3 });
    const decided = (i: number, name: string, outcome: string, reason: string) => {
      scored[i]!.candidateName = name;
      scored[i]!.decision = {
        outcome,
        reason,
        decidedAt: daysAgo(1),
        decidedBy: 'Aysel Mammadova',
      };
    };
    decided(0, 'Rauf Əliyev', 'shortlist', 'Strong BGP work');
    decided(1, 'Leyla Həsənova', 'reject', '');
    const adj = adjustments({
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
          at: daysAgo(3),
        },
        {
          id: '01K0000000000000000000CHG2',
          requirementId: null,
          requirement: null,
          from: null,
          to: null,
          reset: true,
          by: 'Aysel Mammadova',
          at: daysAgo(2),
        },
        {
          id: '01K0000000000000000000CHG3',
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
    await resultsApi(page, {
      rows: scored,
      adj,
      criteria: criteria({
        versions: [
          { version: 1, frozenAt: daysAgo(6) },
          { version: 2, frozenAt: daysAgo(4) },
        ],
        current: 2,
      }),
    });
    await open(page);
    const art = page.getByRole('article', { name: t('Evaluation report') });
    await expect(art).toBeVisible();
    const sec = (h: string) =>
      art
        .locator('section')
        .filter({ has: page.getByRole('heading', { level: 3, name: t(h), exact: true }) });
    // 2) The role.
    const role = sec('The role');
    await expect(role.getByText(line(t('Not counted: {list}.', { list: 'OSPF' })))).toBeVisible();
    await expect(
      role.getByText(
        line(
          t('Requirements changed during this scan: version {version} was frozen on {date}.', {
            version: 2,
            date: '§D',
          }),
        ),
      ),
    ).toBeVisible();
    // 3) Changes and decisions, in order.
    const list = sec('Changes and decisions').getByRole('listitem');
    const by = (change: string) =>
      t('{change}, by {by} on {date}.', { change, by: 'Aysel Mammadova', date: '§D' });
    const decision = (name: string, outcome: string, reason?: string) =>
      `${t('Recruiter decision, separate from the AI match.')} ${
        reason
          ? t('{name}: {outcome} by {by} on {date} ({reason}).', {
              name,
              outcome: t(outcome),
              by: 'Aysel Mammadova',
              date: '§D',
              reason,
            })
          : t('{name}: {outcome} by {by} on {date}.', {
              name,
              outcome: t(outcome),
              by: 'Aysel Mammadova',
              date: '§D',
            })
      }`;
    const want = [
      t('Requirements version {version} frozen on {date}.', { version: 2, date: '§D' }),
      by(
        t('{requirement}: {from} to {to}', {
          requirement: 'CCIE certification',
          from: kind('Must-have'),
          to: kind('Nice-to-have'),
        }),
      ),
      by(t('Requirements set back to the original')),
      by(
        t('{requirement}: {from} to {to}', {
          requirement: 'OSPF',
          from: kind('Must-have'),
          to: kind('Ignore'),
        }),
      ),
      t('The original ranking is available in the app.'),
      decision('Rauf Əliyev', 'Shortlisted', 'Strong BGP work'),
      decision('Leyla Həsənova', 'Not now'),
    ];
    await expect(list).toHaveCount(want.length);
    for (const [i, w] of want.entries())
      await expect(list.nth(i), `line ${i + 1}`).toHaveText(line(w));
    const text = (await sec('Changes and decisions').innerText()) + (await role.innerText());
    expect(text.match(ISO_DAY)?.[0] ?? null, 'no ISO dates').toBeNull();
    // 4) The footer.
    await expect(art.locator('footer').last()).toContainText(
      t('prepared for {name}', { name: 'Aysel Mammadova' }),
    );
    await ux.check('changes and decisions', [...STD, 'AZ']);
    // 5) Scenario B: nothing changed and nobody decided.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { rows: bandRows({ strong: 4, good: 3, partial: 3 }) });
    await page.goto('about:blank'); // the same address again would only be a hash change
    await open(page);
    await expect(art).toBeVisible();
    await expect(
      art.getByRole('heading', { level: 3, name: t('Changes and decisions') }),
    ).toHaveCount(0);
    await expect(art.getByText(/^(Not counted|Requirements changed during this scan)/)).toHaveCount(
      0,
    );
    await expect(
      art.getByText(new RegExp(`^${esc(t('Not counted: {list}.', { list: '' }).split('.')[0]!)}`)),
    ).toHaveCount(0);
    await ux.check('nothing changed', [...STD, 'AZ']);
  },
);

const SHARED = ulidOf('SHR', 1);
/** A shared snapshot as GET /reports/<id> answers it. */
function snapshot(more: { variant?: 2 } = {}) {
  const base = more.variant !== 2;
  return {
    id: SHARED,
    sharedBy: 'Aysel Mammadova',
    sharedAt: daysAgo(1),
    expiresAt: new Date(Date.now() + 29 * 86_400_000).toISOString(),
    report: {
      version: 1,
      runId: 'AB12CD34',
      title: 'UAT Network role',
      takenAt: daysAgo(1),
      createdBy: 'Aysel Mammadova',
      includeNames: true,
      includeQuotes: false,
      counts: { read: 5, scored: 5, needLook: 0, stopped: 0, unread: 0, total: 5 },
      role: {
        must: ['BGP routing', 'CCIE certification'],
        nice: ['5G transport experience'],
        ignored: base ? ['OSPF'] : [],
        experience: null,
      },
      method: {
        criteriaVersion: 2,
        frozenAt: base ? daysAgo(3) : null,
        provider: base ? 'Fake AI' : null,
        model: base ? 'fake-1' : null,
      },
      bands: { strong: 2, good: 2, partial: 1, limited: 0, human: 0 },
      candidates: Array.from({ length: 5 }, (_, i) => ({
        rank: i + 1,
        label: `Candidate ${String(i + 1).padStart(2, '0')}`,
        name: `Person ${i + 1}`,
        band: i < 2 ? 'strong' : i < 4 ? 'good' : 'partial',
        score: 90 - i * 5,
        mustFound: 2,
        mustTotal: 2,
        chips: [{ text: 'BGP routing', kind: 'found', classification: 'mandatory' }],
        expanded: true,
        summary: `Person ${i + 1} ran a carrier backbone.`,
        quotes: [],
        missing: null,
      })),
      expandedCount: 15,
      unread: [],
      changes: base
        ? [
            {
              text: 'CCIE certification: must-have to nice-to-have',
              by: 'Aysel Mammadova',
              at: daysAgo(2),
            },
          ]
        : [],
      decisions: base
        ? [
            {
              label: 'Candidate 03',
              outcome: 'shortlist',
              by: 'Aysel Mammadova',
              at: daysAgo(1),
              reason: 'Strong BGP work',
            },
            { label: 'Candidate 05', outcome: 'reject', by: 'Aysel Mammadova', at: daysAgo(1) },
          ]
        : [],
    },
  };
}

uat(
  'RP-13',
  'Shared report sections: preparing, how it was scored, changes and decisions with reasons, footer',
  { on: ['D', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const kind = (k: string) => t(k).toLocaleLowerCase(meta.lang === 'az' ? 'az-AZ' : undefined);
    const line = (s: string) => new RegExp(`^${esc(s).replace(/§D/g, '.+?')}$`);
    let variant: 1 | 2 = 1;
    await mockApi(page, {
      me: { roles: [] },
      extra: async (route, url) => {
        if (url.pathname === `/reports/${SHARED}`) {
          await new Promise((r) => setTimeout(r, 1000));
          await route.fulfill({ json: snapshot({ variant: variant === 2 ? 2 : undefined }) });
          return true;
        }
        if (url.pathname === '/reports/mine') {
          await route.fulfill({ json: { reports: [] } });
          return true;
        }
        return false;
      },
    });
    const read = async (two: boolean) => {
      await page.goto('about:blank');
      await page.goto(`/#/reports/${SHARED}`);
      // 1) While the request is pending.
      await expect(page.getByText(t('Preparing your report…'))).toBeVisible();
      const art = page.getByRole('article', { name: t('Shared evaluation report') });
      await expect(art).toBeVisible();
      const sec = (id: string) => art.locator(`section[aria-labelledby="${id}"]`);
      // 2) The role, how it was scored, changes and decisions, the footer.
      if (!two)
        await expect(
          sec('sr-role').getByText(t('Not counted: {list}.', { list: 'OSPF' })),
        ).toBeVisible();
      const how = sec('sr-how').getByRole('listitem');
      await expect(how.nth(0)).toHaveText(
        line(
          two
            ? t('Scored against requirements version {version}.', { version: 2 })
            : `${t('Scored against requirements version {version}, frozen {date}.', {
                version: 2,
                date: '§D',
              })} ${t('Read by {provider} ({model}).', { provider: 'Fake AI', model: 'fake-1' })}`,
        ),
      );
      await expect(how.nth(1)).toHaveText(
        `${t('AI suggests, a human decides.')} ${t('A missing must-have lowers the match; it never hides anyone.')}`,
      );
      await expect(how.nth(2)).toContainText(
        t('Scores may differ slightly if the screening is run again.'),
      );
      const changes = sec('sr-changes');
      if (two) {
        await expect(
          art.getByRole('heading', { level: 2, name: t('Changes and decisions') }),
        ).toHaveCount(0);
      } else {
        const li = changes.getByRole('listitem');
        await expect(li).toHaveCount(4);
        await expect(li.nth(0)).toHaveText(
          line(
            t('{text}, by {by} on {date}.', {
              text: t('{requirement}: {from} to {to}', {
                requirement: 'CCIE certification',
                from: kind('Must-have'),
                to: kind('Nice-to-have'),
              }),
              by: 'Aysel Mammadova',
              date: '§D',
            }),
          ),
        );
        await expect(li.nth(1)).toHaveText(t('The original ranking is available in the app.'));
        await expect(li.nth(2)).toHaveText(
          line(
            `${t('Recruiter decision, separate from the AI match.')} ${t(
              '{label}: {outcome} by {by} on {date}.',
              {
                label: 'Candidate 03',
                outcome: t('Shortlisted'),
                by: 'Aysel Mammadova',
                date: '§D',
              },
            )} ${t('Reason: {reason}', { reason: 'Strong BGP work' })}`,
          ),
        );
        await expect(li.nth(3)).toHaveText(
          line(
            `${t('Recruiter decision, separate from the AI match.')} ${t(
              '{label}: {outcome} by {by} on {date}.',
              {
                label: 'Candidate 05',
                outcome: t('Not now'),
                by: 'Aysel Mammadova',
                date: '§D',
              },
            )}`,
          ),
        );
      }
      const foot = art.locator('footer').last();
      await expect(foot).toContainText(
        new RegExp(
          esc(
            t('Run {id} · report date {date} · created by {by}.', {
              id: 'AB12CD34',
              date: '§D',
              by: 'Aysel Mammadova',
            }),
          ).replace('§D', '.+?'),
        ),
      );
      await expect(foot).toContainText(t('Candidate data stays inside Azerconnect Group.'));
      await expect(foot).toContainText(t('Candidates are shown with their real names.'));
      await expect(foot).toContainText(t('Quotes from CVs were left out.'));
      expect((await art.innerText()).match(ISO_DAY)?.[0] ?? null, 'no ISO dates').toBeNull();
      await ux.check(two ? 'shared report, plain' : 'shared report', [...STD, 'AZ']);
    };
    await read(false);
    // 3) Variant 2: no frozen date, no model, no changes and no decisions.
    variant = 2;
    await read(true);
  },
);
