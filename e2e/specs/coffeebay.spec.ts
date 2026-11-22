import type { Page } from '@playwright/test';
import { batchApi, BVID, coffeebay, esc, onBackgrounds, startBatch, T } from '../fixtures/pkg-d';
import { expect, STD, uat } from '../ux/test';

// 7.10 Batch panel and coffeebay (BP), layer L1. UAT plan v1.1; each case is the row of the same ID.

const scene = (page: Page) => coffeebay(page).locator('.cb-scene').first();

uat(
  'BP-01',
  'Waiting screen after start: greeting with focus, lines, progress, buttons, chime switch, scene, 4 backgrounds',
  { on: ['D', 'DW', 'E'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await batchApi(page, {
      files: 40,
      holdUploads: true,
      script: [{ received: 10, by: { analyzing: 10, not_sent: 30 } }],
    });
    await page.goto(`/#/vacancies/${BVID}`);
    await startBatch(page, meta.lang, 40);
    const cb = coffeebay(page);
    await expect(cb).toBeVisible();
    const head = cb.getByRole('heading', { level: 2 });
    await expect(head).toHaveText(t('Hey {name}, go grab a coffee and relax.', { name: 'Aysel' }));
    await expect
      .soft(
        page.getByRole('region', {
          name: t('Hey {name}, go grab a coffee and relax.', { name: 'Aysel' }),
        }),
        'section labelled by the heading',
      )
      .toBeVisible();
    await expect.soft(head, 'the greeting has focus').toBeFocused();
    await expect
      .soft(
        cb.getByText(
          t('{assistant} is reading your {n} CVs for you.', { assistant: 'parallax', n: 40 }),
        ),
      )
      .toBeVisible();
    await expect
      .soft(
        cb.getByText(
          t('Sending files: {sent} of {total}. Keep this page open until they are all sent.', {
            sent: 10,
            total: 40,
          }),
        ),
      )
      .toBeVisible();
    await expect
      .soft(
        cb.getByText(
          `${t('Sent {sent} of {total}', { sent: 10, total: 40 })} · ${t('Analyzed {done} of {total}', { done: 0, total: 40 })}`,
          { exact: true },
        ),
      )
      .toBeVisible();
    await expect.soft(cb.getByRole('progressbar', { name: t('Progress') })).toBeVisible();
    for (const b of ['See results so far', 'Details', 'Hide']) {
      const btn = cb.getByRole('button', { name: t(b), exact: true });
      await expect.soft(btn).toBeVisible();
      expect
        .soft(Math.round((await btn.boundingBox())?.height ?? 0), `${b} at least 44 px`)
        .toBeGreaterThanOrEqual(44);
    }
    await expect
      .soft(cb.getByRole('checkbox', { name: t('Soft sound when ready') }))
      .not.toBeChecked();
    const sc = scene(page);
    await expect.soft(sc).toHaveAttribute('aria-hidden', 'true');
    // The scene is a lazy chunk: wait for its board text rather than reading it once.
    for (const w of ['coffeebay', t('Now brewing'), '0/40', t('CVs')])
      await expect.soft(sc, `the board shows '${w}'`).toContainText(w, { timeout: 10_000 });
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      const s = (await sc.boundingBox())!;
      const h = (await head.boundingBox())!;
      expect.soft(s.x + s.width <= h.x + 1, 'scene left, text right').toBe(true);
    }
    await ux.check('waiting', [...STD, 'AZ']);
    await onBackgrounds(page, meta.lang, async (bg) => ux.check(`background ${bg}`, ['AXE']));
  },
);

uat(
  'BP-05',
  'Finish texts: all ready, partly ready with problem line, buttons change, scene settles',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const run = async (final: Record<string, number>, received: number, reading: number) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await batchApi(page, {
        files: 12,
        script: [
          ...Array.from({ length: reading }, () => ({
            received: 12,
            by: { analyzing: 5, analyzed: 7 },
          })),
          { received, by: final },
        ],
      });
      await page.goto('about:blank');
      await page.goto(`/#/vacancies/${BVID}`);
      await startBatch(page, meta.lang, 12);
      await expect(coffeebay(page)).toBeVisible();
    };
    // A: all 12 analyzed.
    await run({ analyzed: 12 }, 12, 4);
    const cb = coffeebay(page);
    await expect
      .soft(
        cb.getByText(
          t('All files are sent. You can close this page: {assistant} keeps reading.', {
            assistant: 'parallax',
          }),
        ),
      )
      .toBeVisible({ timeout: 15_000 });
    await ux.check('reading', [...STD, 'AZ']);
    await expect(cb.getByRole('heading', { level: 2 })).toHaveText(
      t('All {n} CVs are ready, {name}. Enjoy your coffee.', { n: 12, name: 'Aysel' }),
      { timeout: 15_000 },
    );
    // PLAN: "no problem line" — the app shows the plain count '12 analyzed' after the finish; it names no problem.
    await expect
      .soft(
        cb.getByText(new RegExp(`${esc(t('1 analysis failed'))}|${esc(t('1 file was not sent'))}`)),
      )
      .toHaveCount(0);
    expect.soft((await scene(page).textContent()) ?? '').toContain(t('All ready'));
    await expect
      .soft(cb.getByRole('button', { name: t('See results'), exact: true }))
      .toBeVisible();
    await expect.soft(cb.getByRole('button', { name: t('Close'), exact: true })).toBeVisible();
    await ux.check('A finished', [...STD, 'AZ']);
    // B: 8 analyzed, 1 needs a look, 1 unreadable, 1 failed, 1 not sent.
    await run({ analyzed: 8, needs_look: 1, unreadable: 1, failed: 1, not_sent: 1 }, 11, 0);
    await expect(cb.getByRole('heading', { level: 2 })).toHaveText(
      t('{ready} of {total} CVs are ready, {name}.', { ready: 10, total: 12, name: 'Aysel' }),
      { timeout: 15_000 },
    );
    const line = [
      t('{n} analyzed', { n: 8 }),
      t('{n} need a human look', { n: 2 }),
      t('1 analysis failed'),
      t('1 file was not sent'),
    ].join(' · ');
    await expect.soft(cb.getByText(line, { exact: true })).toBeVisible();
    await expect
      .soft(cb.getByRole('button', { name: t('Retry failed ({n})', { n: 1 }) }))
      .toBeVisible();
    await ux.check('B finished', [...STD, 'AZ']);
    // 12 s later the scene holds still.
    await expect.soft(scene(page)).toHaveAttribute('data-still', 'true', { timeout: 15_000 });
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              (a.effect as KeyframeEffect | null)?.target instanceof Element &&
              (a.effect as KeyframeEffect).target!.closest('.cb-scene'),
          ).length,
    );
    expect.soft(running, 'no animation runs in the scene').toBe(0);
  },
);
