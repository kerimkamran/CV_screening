import { readFileSync } from 'node:fs';
import { FULL, ink, poll, T, toAnalysis } from '../fixtures/pkg-f';
import { expect, STD, uat } from '../ux/test';
import { db, drain, login, openAs, RESUME, screenedVacancy, uniq, accounts } from './stack';

// 7.18 CV pane and full screen, full stack (FS-15): Word pages made by LibreOffice, and a TXT CV.

const LEYLA = readFileSync(new URL('../fixtures/pkg-f/leyla.docx', import.meta.url));

uat(
  'FS-15',
  'Word and TXT CVs in full screen: pages or sheet drawn, marks on the right lines',
  { on: ['D', 'A'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await screenedVacancy(token, {
      title: uniq('UAT Word pages'),
      files: [
        {
          name: 'leyla.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          data: LEYLA,
        },
        { name: '02-rashad-az.txt', type: 'text/plain', data: RESUME('02-rashad-az.txt') },
      ],
    });
    const word = v.documents.find((d) => d.filename === 'leyla.docx')!;
    const txt = v.documents.find((d) => d.filename.endsWith('.txt'))!;
    // The rendition (LibreOffice) is made in the background: wait until it is ready.
    await poll(
      async () =>
        (
          await db<{ s: string }>('SELECT rendition_state AS s FROM cv_document WHERE id = $1', [
            word.id,
          ])
        )[0]?.s ?? '',
      (s) => s === 'ready' || s === 'failed' || s === 'none',
      60_000,
      'the Word rendition',
    ).catch(() => undefined);
    await drain();
    await openAs(page, acc.recruiter, `#/cv/${word.id}`);
    await page.locator('h1').waitFor();
    const note = t('These pages were made from the Word file, so the layout can differ a little.');
    await expect.soft(page.getByText(note), 'the rendition note').toBeVisible({ timeout: 20_000 });
    const pages = page.locator('[data-page]');
    await expect(pages.first()).toBeAttached({ timeout: 20_000 });
    await poll(
      () => ink(page.locator('[data-page="1"] canvas')),
      (n) => n > 20,
      15_000,
      'page 1 drawn',
    );
    const count = await pages.count();
    info.annotations.push({ type: 'pages', description: String(count) });
    expect.soft(count, 'leyla.docx has two pages').toBe(2);
    // The requirement quoted on page 2 ("Python scripting …" after the page break).
    await toAnalysis(page, t);
    const cards = page
      .locator('[data-testid=analysis-pane] li')
      .filter({ has: page.getByRole('button', { name: t('Show in CV') }) });
    const texts = await cards.allTextContents();
    await info.attach('cards', {
      body: JSON.stringify(texts, null, 1),
      contentType: 'application/json',
    });
    const py = cards.filter({ hasText: /Python/ }).first();
    await expect(py, 'the Python requirement has a quote').toBeVisible();
    await py.getByRole('button', { name: t('Show in CV') }).click();
    const mark = page.locator('[data-page="2"] [data-testid=pdf-mark]').first();
    await expect
      .soft(mark, 'the jump lands on page 2 with a mark')
      .toBeAttached({ timeout: 10_000 });
    // A mark lies on a text line: inside its page, and where the page has ink.
    const onInk = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-page="2"] [data-testid=pdf-mark]')].map((m) => {
          const p = m.closest('[data-page]')!;
          const c = p.querySelector('canvas')!;
          const pr = p.getBoundingClientRect();
          const r = m.getBoundingClientRect();
          const sx = c.width / pr.width;
          const sy = c.height / pr.height;
          const d = c
            .getContext('2d')!
            .getImageData(
              Math.max(0, (r.left - pr.left) * sx),
              Math.max(0, (r.top - pr.top) * sy),
              Math.max(1, r.width * sx),
              Math.max(1, r.height * sy),
            ).data;
          let dark = 0;
          for (let i = 0; i < d.length; i += 16) if (d[i + 3]! > 200 && d[i]! < 160) dark++;
          return {
            inside:
              r.left >= pr.left - 1 &&
              r.right <= pr.right + 1 &&
              r.top >= pr.top - 1 &&
              r.bottom <= pr.bottom + 1,
            dark,
          };
        }),
      );
    await poll(
      () => ink(page.locator('[data-page="2"] canvas')),
      (n) => n > 20,
      10_000,
      'page 2 drawn',
    ).catch(() => undefined);
    const inPane = await onInk();
    expect.soft(inPane.length, 'marks on page 2').toBeGreaterThan(0);
    for (const m of inPane)
      expect
        .soft(
          m.inside && m.dark > 3,
          `in the pane a mark sits over the quoted line (${JSON.stringify(m)})`,
        )
        .toBe(true);
    await ux.check('Word CV in the pane', [...STD, 'AZ']);
    await page.getByRole('button', { name: t('Full screen'), exact: true }).click();
    await expect(page.locator(FULL)).toBeAttached();
    await page.waitForTimeout(800);
    await poll(
      () => ink(page.locator('[data-page="2"] canvas')),
      (n) => n > 20,
      10_000,
      'page 2 re-drawn',
    ).catch(() => undefined);
    const inFull = await onInk();
    for (const m of inFull)
      expect
        .soft(
          m.inside && m.dark > 3,
          `in full screen a mark sits over the quoted line (${JSON.stringify(m)})`,
        )
        .toBe(true);
    await ux.check('Word CV in full screen', [...STD, 'AZ']);
    await page.keyboard.press('Escape');
    // The TXT CV.
    await page.goto(`/#/cv/${txt.id}`);
    await page.locator('h1').waitFor();
    await expect
      .soft(page.getByRole('tab', { name: t('Original') }), "no 'Original' tab")
      .toHaveCount(0);
    await expect
      .soft(page.getByText(t('This is a plain text file, so it has no pages.')))
      .toBeVisible();
    await toAnalysis(page, t);
    const first = page
      .locator('[data-testid=analysis-pane] li')
      .filter({ has: page.getByRole('button', { name: t('Show in CV') }) })
      .first();
    await first.getByRole('button', { name: t('Show in CV') }).click();
    const box = page.getByLabel(t('CV text'));
    await expect.soft(box.locator('article')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect.soft(box.locator('mark').first(), 'a <mark> with the quote').toBeVisible();
    await page.getByRole('button', { name: t('Full screen'), exact: true }).click();
    await expect(page.locator(FULL)).toBeAttached();
    await page.waitForTimeout(400);
    const fill = await page.evaluate((full) => {
      const d = document.querySelector(full)!.getBoundingClientRect();
      const b = document.querySelector('[data-cv-text]')!.getBoundingClientRect();
      return { dialogBottom: d.bottom, boxBottom: b.bottom, boxH: b.height, dialogH: d.height };
    }, FULL);
    expect
      .soft(
        fill.boxH / fill.dialogH,
        `in full screen the sheet fills the dialog height (${JSON.stringify(fill)})`,
      )
      .toBeGreaterThan(0.75);
    await ux.check('TXT CV in full screen', [...STD, 'AZ']);
  },
);
