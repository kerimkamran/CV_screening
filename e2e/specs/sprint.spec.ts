import { expect, test } from '@playwright/test';
import { DID2, mockApi, openReview, showAnalysis } from '../fixtures/api';

// Design additions to Stage 2: the evidence map beside the CV, and the review sprint.
test('the evidence map shows where each requirement is in the CV, and a dot shows it', async ({
  page,
}) => {
  await mockApi(page);
  await openReview(page);
  const map = page.getByRole('navigation', { name: 'Where the requirements are in the CV' });
  await expect(map).toBeVisible();
  // BGP and OSPF on page 1; 5G transport in the summary on page 1 and in the projects on page 2.
  await expect(map.getByRole('button')).toHaveCount(4);
  await map.getByRole('button', { name: '5G transport experience, page 2' }).click();
  await expect(page.locator('[data-page="2"] [data-testid="pdf-mark"]').first()).toBeVisible();
  await showAnalysis(page);
  await expect(page.getByRole('button', { name: 'Hide in CV' })).toBeVisible();
});

test('review sprint: S shortlists, the next CV opens with Undo, the end says what was decided', async ({
  page,
}) => {
  const seen = await mockApi(page);
  await openReview(page);
  await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' })).toBeVisible();
  await page.keyboard.press('s');
  await expect(page).toHaveURL(new RegExp(`#/cv/${DID2}\\?l=e2e-list$`));
  await expect(page.getByText('Aysel Məmmədova: Shortlist.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.keyboard.press('m');
  await expect(
    page.getByRole('heading', { name: 'That was the last CV in this list.' }),
  ).toBeVisible();
  await expect(page.getByText('1 Shortlist')).toBeVisible();
  await expect(page.getByText('1 Maybe')).toBeVisible();
  expect(seen.posts).toEqual([]); // decisions are PUTs; nothing else was sent
});
