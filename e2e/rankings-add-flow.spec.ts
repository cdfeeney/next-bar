import { test, expect, type Locator, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

async function typeInto(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.pressSequentially(value);
  await expect(input).toHaveValue(value);
}

async function clearStorage(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
}

async function addScore(page: Page, name: string, score: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add a bar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a bar' });
  await typeInto(dialog.getByLabel('Search bars'), name);
  await dialog.locator('li button').filter({ hasText: name }).first().click();
  await expect(dialog).toContainText(`Score ${name}`);
  await dialog.getByLabel('Your score').fill(score);
  await dialog.getByRole('button', { name: 'Save score' }).click();
  await expect(dialog).not.toBeVisible();
}

test.describe('/rankings numeric-first flow', () => {
  test.beforeEach(async ({ page }) => clearStorage(page));

  test('accepts exact scores, permits ties, and sorts descending', async ({ page }) => {
    await page.goto('/rankings');
    await addScore(page, 'Attaboy', '9.3');
    await addScore(page, 'Death & Co', '10');
    await addScore(page, 'Employees Only', '10');

    await expect(page.getByRole('button', { name: 'Loved' })).toHaveCount(0);
    await expect(page.getByText('Loved', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const cards = page.locator('article');
    await expect(cards).toHaveCount(3);
    await expect(cards.filter({ hasText: 'Death & Co' })).toContainText('10.0');
    await expect(cards.filter({ hasText: 'Employees Only' })).toContainText('10.0');
    await expect(cards.filter({ hasText: 'Attaboy' })).toContainText('9.3');

    await page.reload();
    await expect(page.locator('article')).toHaveCount(3);
    await expect(page.getByText('9.3', { exact: true })).toBeVisible();
  });
});
