import { expect, test } from '@playwright/test';
import { mockApi, openReview, showAnalysis } from '../fixtures/api';

// parallax motion: movement is decoration only, and "reduce motion" turns all of it off.
test.describe('with reduced motion', () => {
  test.beforeEach(({ page }) => page.emulateMedia({ reducedMotion: 'reduce' }));

  test('nothing moves on the sign-in page or the review screen', async ({ page }) => {
    await mockApi(page, { signedIn: false });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test('the score and the marks are there at once', async ({ page }) => {
    await mockApi(page);
    await openReview(page);
    await expect(page.getByRole('img', { name: 'Match 88%' })).toContainText('88%');
    await showAnalysis(page);
    await page.getByRole('button', { name: 'Show in CV' }).first().click();
    await expect(page.locator('[data-testid="pdf-mark"]').first()).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

test.describe('with motion allowed', () => {
  test.beforeEach(({ page }) => page.emulateMedia({ reducedMotion: 'no-preference' }));

  test('the score counts up to its value and the requirement rows arrive', async ({ page }) => {
    await mockApi(page);
    await openReview(page);
    const dial = page.getByRole('img', { name: 'Match 88%' });
    await expect(dial).toContainText('88%'); // where it ends
    await showAnalysis(page);
    await expect(page.locator('li.m-rise').first()).toBeVisible();
  });

  test('the sign-in sky has a shooting star on screens with a pointer', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'touch screens keep the sky still');
    await mockApi(page, { signedIn: false });
    await page.goto('/');
    await expect(page.getByTestId('sky')).toBeVisible();
    await expect(page.locator('.sky-meteor').first()).toBeAttached();
  });
});
