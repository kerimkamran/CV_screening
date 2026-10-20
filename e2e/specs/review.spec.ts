import { expect, test } from '@playwright/test';
import { DID, DID2, mockApi, openReview, showAnalysis, watchProblems } from '../fixtures/api';

// Stage 2, R1 and R2: the CV as it looks on the left, the analysis on the right, Previous and Next.
test.describe('the CV review screen', () => {
  test('draws the original PDF pages under the production CSP and marks the found lines', async ({
    page,
  }) => {
    const problems = watchProblems(page);
    await mockApi(page);
    await openReview(page);
    await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Match 88%' })).toBeVisible();

    // pdf.js runs from our own worker file: two pages, and the first one is really drawn.
    await expect(page.getByText('2 pages')).toBeVisible();
    const canvas = page.locator('[data-page="1"] canvas');
    await expect(canvas).toBeVisible();
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) => {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let ink = 0;
          for (let i = 0; i < d.length; i += 4 * 97) if (d[i]! < 200) ink++;
          return ink;
        }),
      )
      .toBeGreaterThan(50);

    // "Show in CV" marks the line on the page it is on.
    await showAnalysis(page);
    await page.getByRole('button', { name: 'Show in CV' }).nth(2).click();
    await expect(page.locator('[data-page="2"] [data-testid="pdf-mark"]').first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('steps to the next CV with J and back with K, and shows a text CV on a sheet of paper', async ({
    page,
  }) => {
    await mockApi(page);
    await openReview(page);
    await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' })).toBeVisible();
    await page.keyboard.press('j');
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID2}\\?l=e2e-list$`));
    await expect(page.getByRole('heading', { name: 'Rauf Əliyev' })).toBeVisible();
    await expect(page.getByText('CV 2 of 2').first()).toBeAttached();
    const sheet = page.getByLabel('CV text').locator('article');
    await expect(sheet).toContainText('BGP route reflectors');
    await expect(sheet).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.keyboard.press('k');
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}\\?l=e2e-list$`));
  });

  test('never scrolls the page sideways', async ({ page }) => {
    await mockApi(page);
    await openReview(page);
    await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' })).toBeVisible();
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide).toBeLessThanOrEqual(1);
  });
});
