import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { senaiOn, senaiPut } from '../fixtures/pkg-g';
import { englishOnScreen } from '../fixtures/pkg-h';
import { rx, T } from '../fixtures/pkg-i';
import { expect, STD, uat } from '../ux/test';
import {
  accounts,
  api,
  BASE,
  adminApi,
  db,
  freshAccount,
  growVacancy,
  JD_EN,
  login,
  openAs,
  resumeFiles,
  screenedVacancy,
  signInUi,
  uniq,
} from '../fullstack/stack';

/**
 * UAT I18-05, layer L2 on the isolated stack: the sentences the service sends reach the screen in
 * the person's language, and never as a code. Each step makes the service refuse for real and reads
 * what the screen says. SenAI is switched on and off for the whole stack, so this runs here only.
 * Every person and file is invented.
 */

const FILES = join(process.cwd(), 'fixtures', 'files');
const NAMES = [/parallax/i, /SenAI/, /Azerconnect/i, /Sən istə/];
/** Raw codes and browser texts that must never be on screen. */
const RAW =
  /FEATURE_OFF|ASSISTANT_OFF|STALE_VERSION|REPORT_DENIED|NETWORK|Failed to fetch|Load failed|\[object/;

const cvsCard = (page: Page, t: ReturnType<typeof T>) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: t('CVs'), exact: true }) });

/** Every English sentence that is still on the screen (data and the brand are allowed). */
/** What the stand-in model writes: a real model writes these in the language of the question. */
const MODEL_TEXT = [
  /matches on what the record shows\./,
  'A stated experience is in the CV.',
  "The CV doesn't mention everything; that is not evidence of a gap.",
  'Tell me about a recent project.',
];

async function english(page: Page, data: (string | RegExp)[] = [], scope?: Locator) {
  // Data stays as entered: the job text, vacancy titles, file names.
  return englishOnScreen(
    page,
    [...NAMES, JD_EN().trim(), /UAT [\w ]+/, ...MODEL_TEXT, ...data],
    scope,
  );
}

uat(
  'I18-05',
  'Server and file messages in the person’s language',
  { on: ['D'], langs: 'EN+AZ', timeout: 360_000 },
  async ({ page, ux, meta }) => {
    page.setDefaultTimeout(25_000);
    ux.allow(/40\d|50\d|Failed to load resource/);
    const t = T(meta.lang);
    const az = meta.lang === 'az';
    const acc = accounts();
    const rec = await login(acc.recruiter);
    const done: string[] = [];
    // Another person in the same tab: their token replaces the session, then the page reloads.
    const switchTo = async (who: Parameters<typeof openAs>[1], hash: string) => {
      const token = await login(who);
      await page.evaluate((x) => sessionStorage.setItem('cv.session', x), token);
      await page.goto(`${BASE}/${hash}`);
      await page.reload();
    };
    const say = async (
      step: string,
      expected: string | RegExp,
      scope: Locator | Page = page,
      on: Page = page,
    ) => {
      await expect(
        (scope as Page).getByText(expected).first(),
        `step ${step}: the message`,
      ).toBeVisible({ timeout: 15_000 });
      await expect(on.locator('body'), `step ${step}: no raw code`).not.toContainText(RAW);
      if (az) expect(await english(on), `step ${step}: English left on screen`).toEqual([]);
      done.push(step);
    };

    // 2) Sign in with a wrong password (first: nobody is signed in yet).
    await signInUi(page, { email: acc.recruiter.email, password: 'Wrong-pass-0000' });
    await say('2', t('Invalid email or password'));
    await ux.check('wrong password', [...STD, ...(az ? (['AZ'] as const) : [])]);

    // 1) A CV before the candidate notice is confirmed. On a vacancy not yet started the screen
    //    itself says why the button is off; the service's own sentence is read from a refused upload.
    const chooseCv = async (name = resumeFiles()[0]!.name) => {
      const cv = resumeFiles().find((f) => f.name === name)!;
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        cvsCard(page, t)
          .getByRole('button', { name: t('Choose files'), exact: true })
          .click(),
      ]);
      await chooser.setFiles([{ name: cv.name, mimeType: cv.type, buffer: Buffer.from(cv.data) }]);
    };
    const analyze = () =>
      page
        .getByRole('button', {
          name: new RegExp(
            `^(${[t('Re-analyze'), t('Find the best fit →')].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
          ),
        })
        .click();
    const raw = await api(rec).post('/vacancies', {
      title: uniq('UAT No notice'),
      jdText: 'x'.repeat(30),
    });
    expect(raw.status).toBeLessThan(300);
    const noNotice = await api(rec).upload(`/vacancies/${raw.body.id}/documents`, [
      {
        name: 'a.txt',
        type: 'text/plain',
        data: 'Some text for a CV that is long enough to read.',
      },
    ]);
    expect(noNotice.status).toBe(409);
    expect(noNotice.body.message).toBe(
      'Confirm that candidates have been informed that AI assists screening before uploading CVs.',
    );
    const started = await screenedVacancy(rec, { title: uniq('UAT Messages') });
    await db(`UPDATE vacancy SET candidate_notice_confirmed_at = NULL WHERE id = $1`, [started.id]);
    await openAs(page, acc.recruiter, `#/vacancies/${started.id}`);
    await page.reload(); // the sign-in page is the same document: reload so the session is picked up
    await chooseCv();
    await say('1a', t('Confirm the candidate notice.'));
    await expect(
      page.getByRole('button', { name: /Re-analyze|Find the best fit|Yenidən təhlil|ən yaxşı/ }),
    ).toBeDisabled();
    await ux.check('notice needed', [...STD, ...(az ? (['AZ'] as const) : [])]);
    // The notice is confirmed, the page is loaded, then the vacancy is archived behind it: the
    // button is on, and the service refuses.
    await db(`UPDATE vacancy SET candidate_notice_confirmed_at = now() WHERE id = $1`, [
      started.id,
    ]);
    await openAs(page, acc.recruiter, `#/vacancies/${started.id}`);
    await page.reload();
    await chooseCv();
    await db(`UPDATE vacancy SET archived_at = now() WHERE id = $1`, [started.id]);
    await analyze();
    await say('1b', t('Restore this vacancy first'));
    await ux.check('service refusal', [...STD, ...(az ? (['AZ'] as const) : [])]);
    await db(`UPDATE vacancy SET archived_at = NULL WHERE id = $1`, [started.id]);
    const v = await screenedVacancy(rec, { title: uniq('UAT Messages PDF') });

    // 3) A password-protected PDF and a damaged one: both are kept as "no readable text", and the
    //    original is opened from the CV screen.
    const pdfs = await api(rec).upload(`/vacancies/${v.id}/documents`, [
      {
        name: 'locked.pdf',
        type: 'application/pdf',
        data: readFileSync(join(FILES, 'protected.pdf')),
      },
      {
        name: 'damaged.pdf',
        type: 'application/pdf',
        data: readFileSync(join(FILES, 'broken.pdf')),
      },
    ]);
    expect(pdfs.status).toBe(200);
    const docs = (pdfs.body.results as { filename: string; documentId: string }[]).map(
      (r) => r.documentId,
    );
    expect(docs).toHaveLength(2);
    for (const [i, id] of docs.entries()) {
      await page.goto(`${BASE}/#/cv/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(1500);
      if (az) expect(await english(page, [/\.pdf/i]), `step 3: PDF ${i + 1}`).toEqual([]);
      await expect(page.locator('body'), `step 3: PDF ${i + 1} no raw code`).not.toContainText(RAW);
      await ux.check(`pdf problem ${i + 1}`, [...STD, ...(az ? (['AZ'] as const) : [])]);
    }
    done.push('3');

    // 4) A ZIP over the limit (501 CVs) and an erased CV.
    const big = await screenedVacancy(rec, {
      title: uniq('UAT Pool 501'),
      files: resumeFiles().slice(0, 3),
    });
    await growVacancy(big.id, 501);
    await page.goto(`${BASE}/#/vacancies/${big.id}/candidates`);
    await page
      .getByRole('combobox', { name: t('Show'), exact: true })
      .selectOption({ label: t('All CVs') });
    await expect(page.locator('li[id^=cand-]').first()).toBeVisible();
    await page
      .getByRole('checkbox', {
        name: meta.touch ? t('Select all') : t('Select all shown'),
        exact: true,
      })
      .check();
    await page.getByRole('button', { name: t('Select all {n} in this list', { n: 501 }) }).click();
    const bar = page.getByRole('region', { name: t('Selected candidates') });
    await expect(bar).toContainText(t('{n} selected', { n: 501 }));
    await expect(bar.getByRole('button', { name: t('Download CVs') })).toBeDisabled();
    await say('4a', t('Up to 500 CVs per download. Narrow the list.'));
    await ux.check('over the limit', [...STD, ...(az ? (['AZ'] as const) : [])]);
    // The service says the same, in English, to anything that asks it directly.
    const ids = (
      await db<{ id: string }>(`SELECT id FROM cv_document WHERE vacancy_id = $1`, [big.id])
    ).map((r) => r.id);
    const over = await api(rec).post('/downloads', { documentIds: ids });
    expect(over.status).toBe(413);
    expect(over.body.message).toBe('Up to 500 CVs per download.');

    const small = await screenedVacancy(rec, {
      title: uniq('UAT Erased'),
      files: resumeFiles().slice(0, 3),
    });
    await page.goto(`${BASE}/#/vacancies/${small.id}/candidates`);
    await page
      .getByRole('combobox', { name: t('Show'), exact: true })
      .selectOption({ label: t('All CVs') });
    await expect(page.locator('li[id^=cand-]')).toHaveCount(3);
    await page
      .getByRole('checkbox', {
        name: meta.touch ? t('Select all') : t('Select all shown'),
        exact: true,
      })
      .check();
    expect((await api(rec).post(`/documents/${small.documents[0]!.id}/erase`)).status).toBe(200);
    const download = page.waitForEvent('download');
    await page
      .getByRole('region', { name: t('Selected candidates') })
      .getByRole('button', { name: t('Download CVs') })
      .click();
    await download;
    await expect(
      page
        .getByRole('status')
        .filter({
          hasText: rx(meta.lang, 'Downloading {n} CVs ({size}) as one ZIP.', {
            n: '2',
            size: /[^)]+/,
          }),
        })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body'), 'step 4b: no raw code').not.toContainText(RAW);
    if (az) expect(await english(page), 'step 4b: English left on screen').toEqual([]);
    done.push('4');

    // 7) A 403: a recruiter whose role is taken away while the page is open, then asks for the list.
    const gone = await freshAccount('TA_PARTNER');
    await switchTo(gone, '#/vacancies');
    await expect(
      page.getByRole('navigation').getByRole('link', { name: t('Candidates') }),
    ).toBeVisible();
    const removed = await (await adminApi()).del(`/admin/users/${gone.userId}/roles/TA_PARTNER`);
    expect(removed.status).toBeLessThan(300);
    await page
      .getByRole('navigation')
      .getByRole('link', { name: t('Candidates') })
      .click();
    await say('7', t('Forbidden'));
    await ux.check('forbidden', [...STD, ...(az ? (['AZ'] as const) : [])]);

    // 5) and 6) SenAI: switch off a feature, then the whole assistant, then a cap of 0.
    await senaiOn({ dailyCap: null });
    await switchTo(acc.recruiter, `#/cv/${small.documents[1]!.id}`);
    const askBar = page.getByRole('search').getByRole('textbox');
    await askBar.fill(
      az ? 'Bu namizədin güclü tərəfləri nələrdir?' : 'What are this candidate’s strengths?',
    );
    await askBar.press('Enter');
    const panel = page.getByRole('complementary', { name: 'SenAI' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('status').filter({ hasText: /looking|axtarır/i })).toHaveCount(0, {
      timeout: 30_000,
    });
    // 6) Challenge with its switch off (the page still has it on).
    await senaiPut({
      features: {
        challenge: false,
        compare: true,
        interview: true,
        challengeRecruiter: true,
        understand: true,
        rediscovery: false,
        linkReview: false,
      },
    });
    await panel.getByRole('button', { name: t('Challenge this match') }).click();
    await panel.getByRole('button', { name: t('Challenge this match') }).click();
    await say('6', t('Challenge is switched off'), panel);
    // 5a) The cap at 0: the answer says so, in the screen language.
    await senaiPut({ dailyCap: 0 });
    const composer = panel.getByRole('textbox').last();
    await composer.fill(
      az
        ? 'Bu namizəd haqqında daha nə demək olar?'
        : 'What else can you say about this candidate?',
    );
    await composer.press('Enter');
    await say(
      '5a',
      az
        ? 'SenAI bugünkü limitinə çatdı. Nəticələr və sübutlar burada qalır.'
        : "SenAI has reached today's limit. The results and the evidence are still here.",
      panel,
    );
    // 5b) Turned off after the page was opened.
    await senaiPut({ dailyCap: null, enabled: false });
    await composer.fill(az ? 'Başqa sual' : 'Another question');
    await composer.press('Enter');
    await say('5b', t('The assistant is off'), panel);
    await ux.check('assistant refusals', [...STD, ...(az ? (['AZ'] as const) : [])]);
    done.push('5');
    await senaiPut({ enabled: false, dailyCap: null });

    // Every step of the case ran and read its message.
    for (const step of ['1a', '1b', '2', '3', '4', '4a', '5a', '5b', '6', '7'])
      expect(done, `step ${step} was not reached`).toContain(step);
  },
);
