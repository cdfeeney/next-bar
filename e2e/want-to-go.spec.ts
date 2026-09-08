import { test, expect, type Page } from './helpers/test';

const WANT_KEY = 'next-bar:list:want-to-go:v1';

async function seedWantToGo(page: Page, barIds: string[]): Promise<void> {
  await page.goto('/lists');
  await page.evaluate(
    ({ key, ids }) => {
      window.localStorage.clear();
      window.localStorage.setItem('next-bar:age-ack:v1', '1');
      if (ids.length > 0) {
        window.localStorage.setItem(
          key,
          JSON.stringify(
            ids.map((barId) => ({ barId, addedAt: new Date().toISOString() })),
          ),
        );
      }
    },
    { key: WANT_KEY, ids: barIds },
  );
  await page.reload();
}

test.describe('Want to go under Your lists', () => {
  test('shows saved bars and removes them', async ({ page }) => {
    await seedWantToGo(page, ['attaboy', 'death-and-co']);
    const list = page.getByTestId('want-to-go-list');
    await expect(list).toContainText('Attaboy');
    await expect(list).toContainText('Death & Co');
    await page
      .getByRole('button', { name: 'Remove Attaboy from Want to go' })
      .click();
    await expect(list).not.toContainText('Attaboy');
  });

  test('deep-link ranking uses an exact number and prunes the saved bar', async ({ page }) => {
    await seedWantToGo(page, ['attaboy']);
    await page.getByRole('link', { name: /been.*rank it/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a bar' });
    await expect(dialog).toContainText('Score Attaboy');
    await dialog.getByLabel('Your score').fill('9.7');
    await dialog.getByRole('button', { name: 'Save score' }).click();

    await page.goto('/lists');
    await expect(page.getByTestId('want-to-go-empty')).toBeVisible();
  });
});
