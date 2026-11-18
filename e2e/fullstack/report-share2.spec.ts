import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { esc, jd, onBackgrounds } from '../fixtures/pkg-c';
import { englishOnScreen } from '../fixtures/pkg-h';
import { rx, T } from '../fixtures/pkg-i';
import { expect, STD, uat } from '../ux/test';
import {
  type Account,
  accounts,
  api,
  BASE,
  db,
  freshAccount,
  login,
  resumeFiles,
  ROOT,
  screenedVacancy,
  uniq,
} from './stack';

// 7.15 Report and sharing (RP), full-stack journeys (L2), second part: the people who receive a
// shared report. The first part (creating a share) is in report-share.spec.ts.

const CV_PDF = readFileSync(join(ROOT, 'e2e/fixtures/cv.pdf'));

/** A finished vacancy with `n` scored text CVs and one PDF CV (so some quotes carry a page). */
async function finished(token: string, n = 8, title = 'UAT Shared report') {
  const p = uniq('Rep');
  const slug = p.toLowerCase().replace(/\W+/g, '-');
  const files: { name: string; type: string; data: Buffer | string }[] = Array.from(
    { length: n },
    (_, i) => ({
      name: `${slug}-${i}.txt`,
      type: 'text/plain',
      data: `Name: ${p} Person ${i}\nBGP routing on the core.\n${i % 2 ? 'Python scripting.' : ''}\n${'Worked on network operations. '.repeat(8)}`,
    }),
  );
  files.push({ name: `${slug}-pdf.pdf`, type: 'application/pdf', data: CV_PDF });
  const v = await screenedVacancy(token, {
    title: uniq(title),
    jd: jd(['BGP routing'], ['Python scripting']),
    files,
  });
  return { ...v, prefix: p };
}

const share = (
  token: string,
  vid: string,
  viewerIds: string[],
  o: { days?: number; names?: boolean; quotes?: boolean } = {},
) =>
  api(token).post(`/vacancies/${vid}/shares`, {
    viewerIds,
    expiresInDays: o.days ?? 14,
    ...(o.names === undefined ? {} : { includeNames: o.names }),
    includeQuotes: o.quotes ?? false,
  });

/**
 * Sign in as this person in the same tab (the tab keeps its device emulation and language), then
 * open the page. Replaces the token even when another person was signed in before.
 */
async function signAs(page: Page, a: Pick<Account, 'email' | 'password'>, hash = '#/') {
  const token = await login(a);
  await page.goto(`${BASE}/#/`);
  await page.evaluate((t) => {
    sessionStorage.setItem('cv.session', t);
    sessionStorage.setItem('uat-token-set', '1');
  }, token);
  await page.goto(`${BASE}/${hash}`);
  await page.reload();
}

/** What a clock 8 days ahead would make of a share: made 8 days ago, ended yesterday. */
const expire = (id: string) =>
  db(
    `UPDATE report_share SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1`,
    [id],
  );

/** Open every collapsed entry; the list of 'Show details' buttons shrinks with each click. */
async function openAll(page: Page, label: string) {
  const b = page.getByRole('button', { name: label, exact: true });
  for (let i = 0; i < 60 && (await b.count()) > 0; i++) await b.first().click();
}

const body = (page: Page) => page.locator('body').innerText();
/** The rows under 'Shared so far' (newest first). */
const shareRows = (page: Page) => page.locator('li').filter({ has: page.locator('summary') });

uat(
  'RP-07',
  'The named person opens the shared report; opens are logged; quotes follow the setting',
  { on: ['D', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const rec = await login(acc.recruiter);
    const viewer = await freshAccount('NONE', { name: `Viewer ${uniq('V')}` });
    const v = await finished(rec, 17); // 18 scored: the top 15 open, 3 behind 'Show all'
    const s1 = await share(rec, v.id, [viewer.userId!], { names: true, quotes: false });
    expect(s1.status).toBe(200);
    const s2 = await share(rec, v.id, [acc.lead.userId!], { names: true, quotes: true });
    expect(s2.status).toBe(200);
    // 1) Sign in as the viewer: the list of what was shared with them.
    await signAs(page, viewer, '#/');
    await expect(page.getByRole('heading', { level: 1, name: t('Shared with me') })).toBeVisible();
    // 2) Open the report.
    await page.goto(`${BASE}/#/reports/${s1.body.id}`);
    await expect(page.getByText(t('Evaluation report · shared with you'))).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: v.title })).toBeVisible();
    await expect(
      page.getByText(
        rx(
          meta.lang,
          'Snapshot of {date} · {read} read, {scored} scored, {need} need a human look',
          {
            date: /.+?/,
          },
        ),
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        rx(meta.lang, 'Shared by {by} · this link works until {date}', {
          by: acc.recruiter.displayName,
          date: /.+/,
        }),
      ),
    ).toBeVisible();
    // 3) Real names, no quotes, the privacy line; the buttons expand the list.
    expect(await body(page)).toContain(`${v.prefix} Person`);
    const foot = page.locator('article > footer');
    await expect(foot).toContainText(t('Candidate data stays inside Azerconnect Group.'));
    await expect(foot).toContainText(t('Candidates are shown with their real names.'));
    await expect(foot).toContainText(t('Quotes from CVs were left out.'));
    const items = page.getByRole('heading', { level: 3 });
    const before = await items.count();
    const showAll = page.getByRole('button', { name: rx(meta.lang, 'Show all {n}') });
    expect(await showAll.count(), "'Show all' is offered for 18 scored CVs").toBe(1);
    await showAll.click();
    expect(await items.count()).toBeGreaterThan(before);
    const details = page.getByRole('button', { name: t('Show details') });
    expect(await details.count()).toBeGreaterThan(0);
    await details.first().click();
    await expect(page.getByRole('button', { name: t('Hide details') })).toBeVisible();
    await expect(page.locator('blockquote')).toHaveCount(0);
    await ux.check('shared report', [...STD, 'AZ']);
    // The four backgrounds: no axe violation on any of them.
    await onBackgrounds(page, meta.lang, async (name) => {
      await ux.check(`background ${name}`, ['AXE', 'OCC']);
    });
    // 4) The recruiter sees one opening, with the viewer's name.
    await signAs(page, acc.recruiter, `#/vacancies/${v.id}/report`);
    const rowV = shareRows(page).filter({ hasText: viewer.displayName });
    await expect(rowV).toHaveCount(1);
    const sum = rowV.getByText(t('Opened {n} time', { n: 1 }), { exact: true });
    await expect(sum).toBeVisible();
    await sum.click();
    await expect(rowV).toContainText(`${viewer.displayName} ${t('opened')}, `);
    // 5) The lead opens the second share (quotes on): 'For: …' and, from the PDF, a page number.
    await signAs(page, acc.lead, `#/reports/${s2.body.id}`);
    await expect(page.getByText(t('Evaluation report · shared with you'))).toBeVisible();
    await page.getByRole('button', { name: rx(meta.lang, 'Show all {n}') }).click();
    await openAll(page, t('Show details'));
    await expect(page.locator('blockquote').first()).toBeVisible();
    const feet = await page.locator('blockquote footer').allInnerTexts();
    expect(feet.length).toBeGreaterThan(0);
    for (const f of feet) expect(f).toContain(t('For: {requirement}', { requirement: '' }));
    expect(
      feet.some((f) => f.includes(t('page {n}', { n: 1 }))),
      `a quote from the PDF names its page (${JSON.stringify(feet.slice(0, 3))})`,
    ).toBe(true);
    await expect(page.locator('article > footer')).not.toContainText(
      t('Quotes from CVs were left out.'),
    );
  },
);

uat(
  'RP-08',
  'Shared report not on the list, revoked, expired, and a load error',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    ux.allow(/40\d|410|500|Failed to load resource/);
    const t = T(meta.lang);
    const acc = accounts();
    const rec = await login(acc.recruiter);
    const viewer = await freshAccount('NONE', { name: `Viewer ${uniq('W')}` });
    const v = await finished(rec, 4);
    const A = await share(rec, v.id, [viewer.userId!], { days: 14, names: true });
    const B = await share(rec, v.id, [viewer.userId!], { days: 7, names: true });
    const C = await share(rec, v.id, [viewer.userId!], { days: 14, names: true });
    for (const r of [A, B, C]) expect(r.status).toBe(200);
    const gone = page.getByText(
      t('This report is no longer available. Ask the recruiter for a new link.'),
    );
    // 1) recruiter2 is not on the list.
    await signAs(page, acc.recruiter2, `#/reports/${A.body.id}`);
    await expect(
      page.getByText(t("You don't have access to this report. Ask the recruiter.")),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: t('Shared with me') })).toBeVisible();
    await ux.check('not on the list', STD);
    // 2) The recruiter's log names who tried; the recruiter revokes A (the box asks first).
    await signAs(page, acc.recruiter, `#/vacancies/${v.id}/report`);
    const rows = shareRows(page);
    await expect(rows).toHaveCount(3);
    const rowA = rows.nth(2); // newest first: C, B, A
    await rowA.getByText(t('Opened {n} times', { n: 0 })).click();
    await expect(rowA).toContainText(
      `${acc.recruiter2.displayName} ${t('tried to open, not on the list')}, `,
    );
    const asked: string[] = [];
    page.once('dialog', (d) => {
      asked.push(d.message());
      void d.accept();
    });
    await rowA.getByRole('button', { name: t('Revoke') }).click();
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toBe(t('Revoke this link? Everyone who has it loses access at once.'));
    await expect(rowA).toContainText(t('revoked'));
    await expect(rowA.getByRole('button', { name: t('Revoke') })).toHaveCount(0);
    // The 7-day link after 8 days (the API reads both dates from the database).
    await expire(B.body.id);
    // 3) The viewer opens the revoked link, the expired link, then C with one load error.
    await signAs(page, viewer, `#/reports/${A.body.id}`);
    await expect(gone).toBeVisible();
    await ux.check('revoked', STD);
    await page.goto(`${BASE}/#/reports/${B.body.id}`);
    await expect(gone).toBeVisible();
    let failed = 0;
    await page.route(`**/reports/${C.body.id}`, (route) => {
      if (failed++ === 0)
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Something went wrong' }),
        });
      return route.continue();
    });
    await page.goto(`${BASE}/#/reports/${C.body.id}`);
    await expect(
      page.getByText(rx(meta.lang, 'The report could not be opened. {message}', { message: /.+/ })),
    ).toBeVisible();
    await ux.check('load error', STD);
    await page.getByRole('button', { name: t('Try again') }).click();
    await expect(page.getByText(t('Evaluation report · shared with you'))).toBeVisible();
    // 4) The recruiter sees the expired row and what the viewer tried.
    await signAs(page, acc.recruiter, `#/vacancies/${v.id}/report`);
    const rowB = shareRows(page).nth(2); // C, A, B: B is now the oldest
    await expect(rowB).toContainText(`· ${t('expired')}`);
    await rowB.locator('summary').click();
    await expect(rowB).toContainText(
      `${viewer.displayName} ${t('tried to open after it expired')}, `,
    );
    const rowA2 = shareRows(page).nth(1);
    await rowA2.locator('summary').click();
    await expect(rowA2).toContainText(
      `${viewer.displayName} ${t('tried to open after it was revoked')}, `,
    );
    await expect(shareRows(page).nth(0)).toContainText(
      t('works until {date}', { date: '' }).trim(),
    );
  },
);

uat(
  'RP-09',
  "'Shared with me' list: rows, empty, loading",
  { on: ['D', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const rec = await login(acc.recruiter);
    const me = await freshAccount('TA_PARTNER', { name: `Reader ${uniq('L')}` });
    const other = await freshAccount('NONE', { name: `Viewer ${uniq('M')}` });
    const v1 = await finished(rec, 3, 'UAT List one');
    const v2 = await finished(rec, 3, 'UAT List two');
    const a = await share(rec, v1.id, [me.userId!]);
    const b = await share(rec, v2.id, [me.userId!]);
    const revoked = await share(rec, v1.id, [me.userId!]);
    const old = await share(rec, v2.id, [me.userId!]);
    await api(rec).post(`/shares/${revoked.body.id}/revoke`);
    await expire(old.body.id);
    // 1) The account menu leads to 'Shared with me'; 2) 'Loading…' first, then the two live rows.
    await signAs(page, me, '#/vacancies');
    await page.route('**/reports/mine', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.getByLabel(t('Account menu'), { exact: true }).click();
    await page.getByRole('link', { name: t('Shared with me') }).click();
    await expect(page.getByRole('heading', { level: 1, name: t('Shared with me') })).toBeVisible();
    await expect(page.getByText(t('Loading…'), { exact: true })).toBeVisible();
    const rows = page
      .locator('main li')
      .filter({ has: page.getByRole('link', { name: /UAT List/ }) });
    await expect(rows).toHaveCount(2);
    for (const [s, title] of [
      [a, v1.title],
      [b, v2.title],
    ] as const) {
      const row = rows.filter({ hasText: title });
      await expect(row.getByRole('link', { name: title })).toHaveAttribute(
        'href',
        `#/reports/${s.body.id}`,
      );
      expect(await row.innerText()).toMatch(
        rx(meta.lang, 'Shared by {by} on {date} · works until {until}', {
          by: acc.recruiter.displayName,
          date: /.+?/,
          until: /.+/,
        }),
      );
    }
    await ux.check('list', [...STD, 'AZ']);
    // 3) A title opens its report.
    await rows.filter({ hasText: v1.title }).getByRole('link').click();
    await expect(page.getByText(t('Evaluation report · shared with you'))).toBeVisible();
    // 4) A person with nothing shared sees the empty notice and no rows.
    await page.unroute('**/reports/mine');
    await signAs(page, other, '#/');
    await expect(
      page.getByText(
        t(
          'Nothing has been shared with you, or the links have expired. Ask the recruiter for a new link.',
        ),
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /UAT List/ })).toHaveCount(0);
    await ux.check('empty', STD);
  },
);

uat(
  'RP-10',
  'A share is a snapshot: later changes do not reach it; Azerbaijani viewer',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const rec = await login(acc.recruiter);
    const a = api(rec);
    const viewer = await freshAccount('NONE', { name: `Viewer ${uniq('S')}` });
    const v = await finished(rec, 6);
    // 1) Create the link.
    const s = await share(rec, v.id, [viewer.userId!], { names: true });
    expect(s.status).toBe(200);
    const view = async () => {
      const all = page.getByRole('button', { name: rx(meta.lang, 'Show all {n}') });
      if (await all.count()) await all.click();
      return {
        heads: (await page.getByRole('heading', { level: 3 }).allInnerTexts()).map((x) =>
          x.replace(/\s+/g, ' '),
        ),
        text: await body(page),
      };
    };
    await signAs(page, viewer, `#/reports/${s.body.id}`);
    await expect(page.getByText(t('Evaluation report · shared with you'))).toBeVisible();
    const before = await view();
    expect(before.heads.length).toBeGreaterThan(3);
    expect(before.text).not.toContain(t('Changes and decisions'));
    // 2) One mark, and one requirement moved to Nice-to-have.
    const pool = await a.get(`/candidates?vacancy=${v.id}&limit=50`);
    const first = pool.body.rows.find((r: { matchId: string | null }) => r.matchId);
    const mark = await a.put(`/candidates/${first.matchId}/decision`, {
      mark: 'shortlist',
      note: 'Added after the link was made',
      expectedVersion: first.decisionVersion ?? 0,
    });
    expect(mark.status).toBe(200);
    const adj = (await a.get(`/vacancies/${v.id}/adjustments`)).body;
    const must = adj.requirements.find((r: { current: string }) => r.current === 'mandatory');
    expect(must, 'a must-have to change').toBeTruthy();
    const ch = await a.post(`/vacancies/${v.id}/adjustments`, {
      requirementId: must.id,
      to: 'preferred',
    });
    expect(ch.status).toBe(200);
    // 3) The viewer opens the link again: the old picture, no new line.
    await page.reload();
    await expect(page.getByText(t('Evaluation report · shared with you'))).toBeVisible();
    const after = await view();
    expect(after.heads).toEqual(before.heads);
    expect(after.text).not.toContain('Added after the link was made');
    expect(after.text).not.toContain(t('Changes and decisions'));
    // The recruiter's own report shows the change.
    await signAs(page, acc.recruiter, `#/vacancies/${v.id}/report`);
    await expect(page.getByText(t('Changes and decisions')).first()).toBeVisible();
    // 4) In Azerbaijani every label of the shared report is Azerbaijani.
    const az = T('az');
    await signAs(page, viewer, `#/reports/${s.body.id}`);
    await page.evaluate(() => localStorage.setItem('cv-lang', 'az'));
    await page.reload();
    await expect(page.getByText(az('Evaluation report · shared with you'))).toBeVisible();
    const allAz = page.getByRole('button', { name: rx('az', 'Show all {n}') });
    if (await allAz.count()) await allAz.click();
    await openAll(page, az('Show details'));
    const english = await englishOnScreen(page, [
      new RegExp(esc(v.prefix), 'g'),
      new RegExp(esc(v.title), 'g'),
      /BGP routing/g,
      /Python scripting/g,
      /Worked on network operations\.?/g,
      /Candidate summary for[^.]*\.?/g, // written by the (fake) model, not by the page
    ]);
    expect(english, 'English left on the Azerbaijani shared report').toEqual([]);
    await ux.check('shared report az', ['OCC', 'OVL', 'OVF', 'AXE']);
    void meta;
  },
);

uat(
  'RP-12',
  "A share's names promise matches what the viewer sees, also for a share made through the API",
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    // A sharer of their own: the seeded recruiter and the first invented resume share a name.
    const owner = await freshAccount('TA_PARTNER', { name: `Sharer ${uniq('P')}` });
    const rec = await login(owner);
    const a = api(rec);
    const viewer = await freshAccount('NONE', { name: `Viewer ${uniq('N')}` });
    const v = await screenedVacancy(rec, {
      title: uniq('UAT Names promise'),
      files: resumeFiles(),
    });
    const cands = (await a.get(`/vacancies/${v.id}/candidates`)).body.candidates as {
      screeningId: string;
      candidateName: string | null;
    }[];
    // The product takes the name from the first line of the CV; keep the ones that are names.
    const names = cands
      .map((c) => c.candidateName)
      .filter((n): n is string => /^\p{Lu}\p{L}+( \p{Lu}\p{L}+)+$/u.test(n ?? ''));
    expect(names.length, 'candidate names the product read').toBeGreaterThanOrEqual(4);
    // A shortlist reason that repeats a name, so the decision line is covered as well.
    const named = cands.find((c) => c.candidateName === names[0])!;
    const first = named.candidateName!.split(/\s+/)[0]!;
    expect(
      (
        await a.post(`/screenings/${named.screeningId}/decision`, {
          outcome: 'shortlist',
          reason: `${first} is strong on BGP`,
        })
      ).status,
    ).toBeLessThan(300);
    // 1) Share 1 in the UI; share 2 through the API with includeNames left out; share 3 with it off.
    const sent: { includeNames?: boolean }[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/vacancies\/\w+\/shares$/.test(r.url()))
        sent.push(r.postDataJSON());
    });
    await signAs(page, owner, `#/vacancies/${v.id}/report`);
    await page.getByRole('button', { name: t('Share as a link') }).click();
    await page.getByPlaceholder(t('Search by name or e-mail')).fill(viewer.displayName);
    await page.getByRole('checkbox', { name: new RegExp(esc(viewer.displayName)) }).check();
    await page.getByRole('button', { name: t('Create link') }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ includeNames: true });
    await expect(
      page.getByText(
        t('The link is ready. Send it to the people you named; they sign in to open it.'),
      ),
    ).toBeVisible();
    const ids = (
      await db<{ id: string }>(
        `SELECT id FROM report_share WHERE vacancy_id = $1 ORDER BY created_at`,
        [v.id],
      )
    ).map((r) => r.id);
    expect(ids).toHaveLength(1);
    const s2 = await a.post(`/vacancies/${v.id}/shares`, {
      viewerIds: [viewer.userId],
      expiresInDays: 14,
    });
    const s3 = await a.post(`/vacancies/${v.id}/shares`, {
      viewerIds: [viewer.userId],
      expiresInDays: 14,
      includeNames: false,
    });
    expect(s2.status).toBe(200);
    expect(s3.status).toBe(200);
    // 2) The rows under 'Shared so far' (newest first: 3, 2, 1).
    await page.reload();
    const rows = shareRows(page);
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(t('Pseudonyms only.'));
    await expect(rows.nth(1)).toContainText(t('Real names included.'));
    await expect(rows.nth(2)).toContainText(t('Real names included.'));
    // 3) The viewer opens each; 4) heading, footer and DOM are read for every one.
    await signAs(page, viewer, `#/reports/${ids[0]}`);
    const real = t('Candidates are shown with their real names.');
    const hidden = t('Candidates appear as numbers; names stay out of the report.');
    const open = async (id: string) => {
      await page.goto(`${BASE}/#/reports/${id}`);
      await page.reload();
      await expect(page.getByText(t('Evaluation report · shared with you'))).toBeVisible();
      await openAll(page, t('Show details'));
      const foot = await page.locator('article > footer').innerText();
      const heads = await page.getByRole('heading', { level: 3 }).allInnerTexts();
      return {
        html: await page.content(),
        text: await body(page),
        claimsReal: foot.includes(real),
        claimsHidden: foot.includes(hidden),
        shown: names.filter((n) => heads.some((h) => h.includes(n))),
      };
    };
    const seeded = (html: string) =>
      names
        .filter((n) => html.includes(n))
        .concat(
          names
            .flatMap((n) => n.split(/\s+/).filter((w) => w.length >= 5))
            .filter((w) => html.includes(w)),
        );
    for (const [label, id, wantNames] of [
      ['share 1 (UI)', ids[0]!, true],
      ['share 2 (API, flag left out)', s2.body.id as string, true],
      ['share 3 (API, includeNames false)', s3.body.id as string, false],
    ] as const) {
      const r = await open(id);
      // The report never claims both, and never claims names stay out while one is shown.
      expect(r.claimsReal !== r.claimsHidden, `${label}: exactly one names line`).toBe(true);
      if (r.claimsReal) {
        expect(r.shown.length, `${label}: real names in the headings`).toBeGreaterThanOrEqual(4);
        expect(r.text).toContain(`${first} is strong on BGP`);
      } else {
        expect(r.shown, `${label}: names stay out, yet shown in headings`).toEqual([]);
        expect(seeded(r.html), `${label}: a seeded name is in the page`).toEqual([]);
        expect(r.text).toContain('[name] is strong on BGP');
      }
      expect(r.claimsReal, `${label}: names line`).toBe(wantNames);
    }
    await ux.check('pseudonymous report', STD);
  },
);
