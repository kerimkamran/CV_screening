import { expect, test } from '@playwright/test';
import { DID, DID2, DID3, mockApi } from '../fixtures/api';

// Stage 2, R4: select across the whole list and download the chosen CVs as one ZIP.
test('selects all CVs in the list and hands the ZIP to the browser download manager', async ({
  page,
}) => {
  const token = 'A'.repeat(43);
  const zip = Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18), 'binary'); // an empty archive
  const seen = await mockApi(page, {
    total: 3,
    extra: async (route, url) => {
      if (url.pathname === '/downloads' && route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          json: {
            url: `/downloads/${token}`,
            files: 2,
            bytes: 2 * 1024 * 1024,
            archiveName: 'CVs - Network Engineer - 2026-10-20.zip',
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
            excluded: [{ documentId: DID3, label: 'Candidate 03', reason: 'erased' }],
          },
        });
        return true;
      }
      if (url.pathname === `/downloads/${token}`) {
        // No session header: the single-use token in the URL is the credential.
        expect(route.request().headers()['authorization']).toBeUndefined();
        await route.fulfill({
          body: zip,
          headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename*=UTF-8''CVs%20-%20Network%20Engineer.zip`,
          },
        });
        return true;
      }
      return false;
    },
  });
  await page.goto('/#/candidates');
  await expect(page.getByRole('link', { name: 'Aysel Məmmədova' })).toBeVisible();
  const all = page.getByRole('checkbox', { name: /Select all shown|Select all/ });
  await all.first().check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Select all 3 in this list' }).click();
  await expect(page.getByText('3 selected')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CVs' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  expect(seen.posts.find((x) => x.url === '/downloads')?.body).toEqual({
    documentIds: [DID, DID2, DID3],
  });
  await expect(
    page.getByText(/Downloading 2 CVs \(2\.0 MB\) as one ZIP\. 1 left out/),
  ).toBeVisible();
});
