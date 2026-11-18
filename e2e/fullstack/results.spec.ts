import type { Page, Request } from '@playwright/test';
import { esc, jd, T } from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';
import {
  accounts,
  clearModelCalls,
  db,
  login,
  modelCalls,
  openAs,
  screenedVacancy,
  uniq,
} from './stack';

// 7.12 Results (RS) and 7.13 Requirements drawer (RQ), full-stack journeys (L2). UAT plan v1.1.

const cv = (prefix: string, i: number, lines: string[]) => ({
  name: `${prefix.toLowerCase().replace(/\W+/g, '-')}-${String(i).padStart(2, '0')}.txt`,
  type: 'text/plain',
  data: `Name: ${prefix} Person ${i}\n${lines.join('\n')}\n${'Worked on network operations and automation. '.repeat(6)}`,
});
const cards = (page: Page, lang: 'en' | 'az') =>
  page.locator(`section[aria-label="${T(lang)('Candidates')}"] > article`);
const bodies = (page: Page, re: RegExp) => {
  const out: { url: string; body: any }[] = [];
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && re.test(r.url()))
      out.push({ url: r.url(), body: r.postDataJSON() });
  });
  return out;
};

uat(
  'RS-08',
  'My mark on a Results card: note of 10 characters, evidence tick for Not now, saved and appended',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const p = uniq('Mark');
    const files = [
      cv(p, 1, ['BGP routing on the core.', 'OSPF areas redesign.', 'Python scripting daily.']),
      cv(p, 2, ['BGP routing on the core.', 'OSPF areas redesign.']),
      cv(p, 3, ['BGP routing on the core.']),
      cv(p, 4, ['OSPF areas redesign.']),
      cv(p, 5, ['Python scripting daily.']),
    ];
    const v = await screenedVacancy(token, {
      title: uniq('UAT Marks'),
      jd: jd(['BGP routing', 'OSPF areas'], ['Python scripting']),
      files,
    });
    const sent = bodies(page, /\/screenings\/\w+\/decision$/);
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}/results`);
    const c = cards(page, meta.lang);
    await expect(c.first()).toBeVisible();
    const before = await c.evaluateAll((as) =>
      as.map((a) => (a.querySelector('button span span') as HTMLElement | null)?.textContent ?? ''),
    );
    const bandsBefore = await c.evaluateAll((as) =>
      as.map(
        (a) =>
          (a.querySelector('button span span + span') as HTMLElement | null)?.textContent ?? '',
      ),
    );
    // 1) Card 1 (expanded at load): Shortlist with an 8-character note.
    const fs1 = c.nth(0).getByRole('group', { name: t('My mark (separate from the AI match)') });
    await expect.soft(fs1).toBeVisible();
    await expect
      .soft(fs1.getByRole('button', { pressed: true }), 'nothing pre-selected')
      .toHaveCount(0);
    await fs1.getByRole('button', { name: t('Shortlist') }).click();
    const note1 = fs1.getByRole('textbox');
    await note1.fill('Good BGP');
    const save1 = fs1.getByRole('button', { name: t('Save my mark') });
    await expect.soft(save1).toBeDisabled();
    await note1.pressSequentially(' work');
    await save1.click();
    await expect.poll(() => sent.length).toBe(1);
    expect.soft(sent[0]!.body).toMatchObject({ outcome: 'shortlist', reason: 'Good BGP work' });
    // PLAN: 'My mark: Shortlist' / 'Now: Shortlist.' — the app names the recorded state 'Shortlisted' (shortlist.ts MARKS.done), which reads right for a decision already taken.
    await expect.soft(c.nth(0)).toContainText(t('My mark: {mark}', { mark: t('Shortlisted') }));
    await expect.soft(c.nth(0)).toContainText(`${t('Now:')} ${t('Shortlisted')}. Good BGP work`);
    await ux.check('marked', [...STD, 'AZ']);
    // 3) Card 2 (the next card, in the Limited group when the fake AI scored it low): Not now needs the evidence tick.
    const all = page.locator(`section[aria-label="${t('Candidates')}"] article`);
    const lim = page.locator('summary').filter({
      hasText: t('Limited ({n}): fewer of the requirements found. Nobody is rejected.', {
        n: 9,
      }).split('9')[0]!,
    });
    if ((await c.count()) < 2 && (await lim.count())) await lim.click();
    const second = all.nth(1);
    await second.getByRole('button').first().click();
    const fs2 = second.getByRole('group', { name: t('My mark (separate from the AI match)') });
    await fs2.getByRole('button', { name: t('Not now') }).click();
    await fs2.getByRole('textbox').fill('No carrier experience');
    const save2 = fs2.getByRole('button', { name: t('Save my mark') });
    await expect.soft(save2, 'disabled until the tick').toBeDisabled();
    await fs2.getByRole('checkbox').check();
    await save2.click();
    await expect.poll(() => sent.length).toBe(2);
    expect.soft(sent[1]!.body).toMatchObject({
      outcome: 'reject',
      reason: 'No carrier experience',
      evidenceReviewed: true,
    });
    // Band and order unchanged.
    const after = await c.evaluateAll((as) =>
      as.map((a) => (a.querySelector('button span span') as HTMLElement | null)?.textContent ?? ''),
    );
    expect.soft(after, 'order unchanged').toEqual(before);
    // 5) Reload: both marks remain; the decision table has 2 new rows.
    await page.reload();
    await expect(c.first()).toBeVisible();
    await expect.soft(c.nth(0)).toContainText(t('My mark: {mark}', { mark: t('Shortlisted') }));
    if ((await c.count()) < 2 && (await lim.count())) await lim.click();
    await expect.soft(all.nth(1)).toContainText(t('My mark: {mark}', { mark: t('Not now') }));
    const bandsAfter = await c.evaluateAll((as) =>
      as.map(
        (a) =>
          (a.querySelector('button span span + span') as HTMLElement | null)?.firstChild
            ?.textContent ?? '',
      ),
    );
    expect
      .soft(
        bandsAfter.map((b) => b.trim()),
        'bands unchanged',
      )
      .toEqual(bandsBefore.map((b) => b.replace(/My mark.*$|Mənim qeydim.*$/, '').trim()));
    const rows = await db<{ outcome: string; reason: string }>(
      `SELECT d.outcome::text AS outcome, d.reason FROM decision d JOIN screening s ON s.id = d.screening_id JOIN cv_document doc ON doc.id = s.document_id WHERE doc.vacancy_id = $1 ORDER BY d.decided_at`,
      [v.id],
    );
    expect
      .soft(
        rows.map((r) => r.outcome),
        'two new decision rows, appended',
      )
      .toEqual(['shortlist', 'reject']);
    await ux.check('reloaded', [...STD, 'AZ']);
  },
);

uat(
  'RQ-02',
  'Change a requirement to Nice-to-have and to Ignore: band-move note, history, no CV read again',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const p = uniq('Adj');
    // 20 CVs; 'CCIE certification' is missing in 6.
    const files = Array.from({ length: 20 }, (_, i) =>
      cv(p, i + 1, [
        'BGP routing on the core.',
        ...(i < 14 ? ['CCIE certification held since 2019.'] : []),
        ...(i % 3 === 0 ? [] : ['OSPF areas redesign.']),
        ...(i % 2 ? ['Python scripting daily.'] : []),
      ]),
    );
    const v = await screenedVacancy(token, {
      title: uniq('UAT Adjust'),
      jd: jd(['BGP routing', 'CCIE certification', 'OSPF areas'], ['Python scripting']),
      files,
    });
    await clearModelCalls();
    const sent = bodies(page, /\/adjustments(\/reset)?$/);
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}/results`);
    const btn = page.getByRole('button', { name: new RegExp(`^${esc(t('Requirements'))}`) });
    await btn.click();
    const dlg = page.getByRole('dialog', { name: t('Requirements') });
    await expect(dlg).toBeVisible();
    const row = (text: RegExp) => dlg.getByRole('group').filter({ hasText: text });
    await row(/CCIE/)
      .getByRole('radio', { name: t('Nice-to-have') })
      .click();
    await expect(row(/CCIE/).getByRole('radio', { name: t('Nice-to-have') })).toBeChecked();
    await expect.poll(() => sent.length).toBe(1);
    expect.soft(sent[0]!.body).toMatchObject({ to: 'preferred' });
    expect.soft(typeof sent[0]!.body.requirementId).toBe('string');
    const note = dlg.locator('p.bg-sel');
    await expect.soft(note).toHaveText(
      new RegExp(
        `${esc(t('No candidate changed band. The order may have changed.'))}|${esc(
          t('{n} candidates changed band: {moves}.', { n: 9, moves: 'X' }),
        )
          .replace('9', '\\d+')
          .replace(
            'X',
            '.+',
          )}|${esc(t('{n} candidate changed band: {moves}.', { n: 1, moves: 'X' })).replace('X', '.+')}`,
      ),
    );
    await expect.soft(row(/CCIE/)).toContainText(
      t('changed (was {kind})', {
        kind: t('Must-have').toLocaleLowerCase(meta.lang === 'az' ? 'az' : 'en'),
      }),
    );
    await expect.soft(dlg.getByText(t('{n} change since the first scan.', { n: 1 }))).toBeVisible();
    const hist = dlg.getByRole('region', { name: t('History of changes') });
    await expect
      .soft(hist)
      .toContainText(
        new RegExp(
          `CCIE certification: ${esc(t('Must-have').toLocaleLowerCase(meta.lang === 'az' ? 'az' : 'en'))} .+ ${esc(t('Nice-to-have').toLocaleLowerCase(meta.lang === 'az' ? 'az' : 'en'))} · Aysel Mammadova · `,
        ),
      );
    await expect.soft(btn).toHaveText(`${t('Requirements')} ${t('({n} changed)', { n: 1 })}`);
    await expect
      .soft(page.getByText(t('The ranking uses your requirement changes ({n}).', { n: 1 })))
      .toBeVisible();
    await ux.check('one change', [...STD, 'AZ'], { overlay: 'aside[role=dialog]' });
    await row(/OSPF/)
      .getByRole('radio', { name: t('Ignore') })
      .click();
    await expect.soft(row(/OSPF/).getByRole('radio', { name: t('Ignore') })).toBeChecked();
    await expect
      .soft(dlg.getByText(t('{n} changes since the first scan.', { n: 2 })))
      .toBeVisible();
    await page.keyboard.press('Escape');
    await expect.soft(dlg).toHaveCount(0);
    expect
      .soft((await modelCalls()).filter((m) => m.user.includes(p)).length, 'no CV read again')
      .toBe(0);
    const ko = await db(
      `SELECT count(*)::int AS n FROM requirement r JOIN requirement_set s ON s.id = r.set_id WHERE s.vacancy_id = $1 AND r.classification = 'disqualifier'`,
      [v.id],
    ).catch(() => [{ n: 0 }]);
    expect.soft(ko[0]?.n ?? 0, 'knockout rules unchanged').toBe(0);
  },
);

uat(
  'RQ-03',
  "'Back to original' from the drawer and from the page notice",
  { on: ['D'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const p = uniq('Reset');
    const files = Array.from({ length: 8 }, (_, i) =>
      cv(p, i + 1, [
        'BGP routing on the core.',
        ...(i < 5 ? ['CCIE certification held since 2019.'] : []),
        ...(i % 3 === 0 ? [] : ['OSPF areas redesign.']),
      ]),
    );
    const v = await screenedVacancy(token, {
      title: uniq('UAT Reset'),
      jd: jd(['BGP routing', 'CCIE certification', 'OSPF areas'], ['Python scripting']),
      files,
    });
    const resets: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/adjustments\/reset$/.test(r.url())) resets.push(r.url());
    });
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}/results`);
    const btn = page.getByRole('button', { name: new RegExp(`^${esc(t('Requirements'))}`) });
    const dlg = page.getByRole('dialog', { name: t('Requirements') });
    const row = (text: RegExp) => dlg.getByRole('group').filter({ hasText: text });
    const change = async (req: RegExp, to: string) => {
      await btn.click();
      await expect(dlg).toBeVisible();
      await row(req)
        .getByRole('radio', { name: t(to) })
        .click();
      await expect(row(req).getByRole('radio', { name: t(to) })).toBeChecked();
    };
    const closeDrawer = async () => {
      await page.keyboard.press('Escape');
      await expect(dlg).toHaveCount(0);
    };
    // Two changes to start from.
    await change(/CCIE/, 'Nice-to-have');
    await row(/OSPF/)
      .getByRole('radio', { name: t('Ignore') })
      .click();
    await expect(dlg.getByText(t('{n} changes since the first scan.', { n: 2 }))).toBeVisible();
    await closeDrawer();
    await expect(
      page.getByText(t('The ranking uses your requirement changes ({n}).', { n: 2 })),
    ).toBeVisible();
    await expect(btn).toHaveText(`${t('Requirements')} ${t('({n} changed)', { n: 2 })}`);

    // 1) From the page notice: one reset, the answer on the page, the notice gone (SD-93).
    await page.getByRole('button', { name: t('Back to original'), exact: true }).click();
    await expect.poll(() => resets.length).toBe(1);
    expect(resets[0]).toContain(`/vacancies/${v.id}/adjustments/reset`);
    await expect(
      page.getByRole('status').filter({ hasText: t('Back to the original ranking.') }),
    ).toBeVisible();
    await expect(
      page.getByText(t('The ranking uses your requirement changes ({n}).', { n: 2 })),
    ).toHaveCount(0);
    await expect(btn).toHaveText(t('Requirements'));
    await ux.check('reset from the notice', [...STD, 'AZ']);

    // 2) One change again, then 3) the drawer's own button.
    await change(/CCIE/, 'Ignore');
    await expect(dlg.getByText(t('{n} change since the first scan.', { n: 1 }))).toBeVisible();
    // The page's earlier answer is not repeated inside the drawer.
    await expect(dlg.getByText(t('Back to the original ranking.'))).toHaveCount(0);
    const back = dlg.getByRole('button', { name: t('Back to original'), exact: true });
    await expect(back).toBeEnabled();
    await back.click();
    await expect.poll(() => resets.length).toBe(2);
    await expect(dlg.getByText(t('Back to the original ranking.'))).toBeVisible();
    await expect(dlg.getByText(t('No changes since the first scan.'))).toBeVisible();
    // History keeps both resets as lines of their own; with 0 changes the button is disabled.
    const hist = dlg.getByRole('region', { name: t('History of changes') });
    await expect(hist.getByRole('listitem').filter({ hasText: t('Back to original') })).toHaveCount(
      2,
    );
    await expect(back).toBeDisabled();
    await ux.check('reset from the drawer', [...STD, 'AZ'], { overlay: 'aside[role=dialog]' });
    await closeDrawer();
    await expect(btn).toHaveText(t('Requirements'));
    // Nothing was erased: three changes and two resets are kept, the last row is a reset.
    const kept = await db<{ is_reset: boolean }>(
      `SELECT is_reset FROM criteria_adjustment WHERE vacancy_id = $1 ORDER BY changed_at, id`,
      [v.id],
    );
    expect(kept.map((r) => r.is_reset)).toEqual([false, false, true, false, true]);
  },
);
