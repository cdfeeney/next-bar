import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

async function clearStorage(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
}

test.describe('legacy ranking deep links', () => {
  test.beforeEach(async ({ page }) => clearStorage(page));

  test('opens numeric score entry and consumes the add parameter', async ({ page }) => {
    await page.goto('/rankings?add=attaboy');
    const dialog = page.getByRole('dialog', { name: 'Add a bar' });
    await expect(dialog).toContainText('Score Attaboy');
    await dialog.getByLabel('Your score').fill('9.4');
    await dialog.getByRole('button', { name: 'Save score' }).click();

    await expect(page.locator('article').first()).toContainText('Attaboy');
    await expect(page.locator('article').first()).toContainText('9.4');
    await expect(page.getByText('Loved', { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
