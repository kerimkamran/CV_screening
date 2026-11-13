import pg from 'pg';
import { T } from '../fixtures/pkg-f';
import { expect, STD, uat } from '../ux/test';
import { accounts, api, db, login, openAs, RESUME, screenedVacancy, uniq } from './stack';

// 7.17 CV review, full stack (CV-20): decisions and notes are append-only rows with the actor.

uat(
  'CV-20',
  'Decisions and notes are stored append-only with the actor',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux, meta, browser, info }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    // PLAN: "aysel.pdf" — the seeded invented CVs are text files; Aysel's is 01-aysel-en.txt.
    const v = await screenedVacancy(token, {
      title: uniq('UAT Review decisions'),
      files: [{ name: '01-aysel-en.txt', type: 'text/plain', data: RESUME('01-aysel-en.txt') }],
    });
    const doc = v.documents[0]!;
    const sid = (
      await db<{ id: string }>('SELECT id FROM screening WHERE document_id = $1', [doc.id])
    )[0]!.id;
    // 1) From the pool: Shortlist, a note, Save note.
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}/candidates`);
    await page.locator(`a[href^="#/cv/${doc.id}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${doc.id}`));
    const sel = page.getByRole('combobox', { name: /^Decision for / });
    /** Change the decision and wait for the server's answer (and the reload after it). */
    const decide = async (p: typeof page, s: typeof sel, mark: string) => {
      const put = p.waitForResponse(
        (r) => r.request().method() === 'PUT' && /\/decision$/.test(r.url()),
      );
      await s.selectOption(mark);
      const r = await put;
      await p
        .waitForResponse(
          (x) => x.request().method() === 'GET' && /\/documents\/\w{26}$/.test(x.url()),
        )
        .catch(() => undefined);
      return r.status();
    };
    await expect(sel).toBeEnabled();
    await decide(page, sel, 'shortlist');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.getByPlaceholder('Add a note (optional)').fill('Strong BGP; ask about 5G');
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/decision$/.test(r.url()),
    );
    await page.getByRole('button', { name: 'Save note' }).click();
    await saved;
    await expect(page.getByRole('button', { name: 'Save note' })).toBeDisabled();
    // 2) Maybe, then Undo.
    await decide(page, sel, 'maybe');
    const undone = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/decision$/.test(r.url()),
    );
    await page.getByRole('button', { name: 'Undo' }).click();
    await undone;
    await expect(sel).toHaveValue('shortlist');
    await ux.check('after decisions', STD);
    // 3) A second browser changes it; the first (stale) one then gets the version conflict.
    const ctx2 = await browser.newContext({ baseURL: page.url().replace(/#.*$/, '') });
    const p2 = await ctx2.newPage();
    await openAs(p2, acc.recruiter2, `#/cv/${doc.id}`);
    const sel2 = p2.getByRole('combobox', { name: /^Decision for / });
    await expect(sel2).toBeEnabled();
    expect(await decide(p2, sel2, 'not_now'), 'the second browser saves its change').toBe(200);
    await ctx2.close();
    ux.allow(/409/, /already changed|changed by someone/i);
    expect.soft(await decide(page, sel, 'maybe'), 'the stale PUT is refused with 409').toBe(409);
    await expect.soft(sel, 'the stale browser reloads to the latest').toHaveValue('not_now');
    await page.waitForTimeout(500);
    await expect
      .soft(
        page.getByRole('alert').filter({ hasText: /already changed|someone else/i }),
        'the stale browser gets the version-conflict error (still shown after the reload)',
      )
      .toBeVisible({ timeout: 1_000 });
    expect(await decide(page, sel, 'maybe'), 'after the reload the change is saved').toBe(200);
    // 4) The lead sees who marked it.
    const p3 = await (
      await browser.newContext({ baseURL: page.url().replace(/#.*$/, '') })
    ).newPage();
    await openAs(p3, acc.lead, `#/cv/${doc.id}`);
    await expect
      .soft(
        p3.getByText(
          t('Marked by {name} {when}', { name: acc.recruiter.displayName, when: t('just now') }),
        ),
        `the lead sees 'Marked by ${acc.recruiter.displayName} …'`,
      )
      .toBeVisible();
    const hist = p3
      .locator('section')
      .filter({ has: p3.getByRole('heading', { name: 'Decision history' }) })
      .locator('li');
    const lines = await hist.allTextContents();
    await info.attach('decision history', {
      body: JSON.stringify(lines, null, 1),
      contentType: 'application/json',
    });
    // Shortlist, Shortlist + note, Maybe, Undo (Shortlist + note), Not now (recruiter2), Maybe = 6.
    expect.soft(lines.length, "'Decision history' shows every change").toBe(6);
    expect
      .soft(lines[0], 'newest first: Maybe by the recruiter')
      .toMatch(new RegExp(`^Maybe · ${acc.recruiter.displayName}`));
    expect
      .soft(
        lines.some((l) => l.includes('Strong BGP; ask about 5G')),
        'the note is in the history',
      )
      .toBe(true);
    await p3.context().close();
    // 5) The tables, as the owner.
    const rows = await db<{ outcome: string; reason: string | null; decided_by: string }>(
      'SELECT outcome, reason, decided_by FROM decision WHERE screening_id = $1 ORDER BY decided_at, id',
      [sid],
    );
    await info.attach('decision rows', {
      body: JSON.stringify(rows, null, 1),
      contentType: 'application/json',
    });
    expect.soft(rows.length, 'each change added a row').toBe(6);
    expect
      .soft(
        rows.every((r) => !!r.decided_by),
        'every row has its actor',
      )
      .toBe(true);
    const audit = await db<{ action: string; actor_id: string }>(
      "SELECT action, actor_id FROM audit_event WHERE entity_id = $1 AND action LIKE 'decision.%' ORDER BY seq",
      [sid],
    );
    expect.soft(audit.length, 'one audit entry per change').toBe(6);
    // 6) The app role cannot UPDATE or DELETE.
    const app = new pg.Client({
      connectionString:
        process.env.UAT_APP_URL ?? 'postgresql://cv_api:cv_api@127.0.0.1:5432/cv_uat',
    });
    await app.connect();
    try {
      for (const sql of [
        `UPDATE decision SET reason = 'x' WHERE screening_id = $1`,
        `DELETE FROM decision WHERE screening_id = $1`,
        `UPDATE audit_event SET action = 'x' WHERE entity_id = $1`,
        `DELETE FROM audit_event WHERE entity_id = $1`,
      ]) {
        const err = await app.query(sql, [sid]).then(
          () => null,
          (e: { code?: string; message: string }) => e,
        );
        expect
          .soft(
            err?.code,
            `app role: ${sql.split(' ').slice(0, 2).join(' ')} is denied (${err?.message})`,
          )
          .toBe('42501');
      }
    } finally {
      await app.end();
    }
    void api;
  },
);
