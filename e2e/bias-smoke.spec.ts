/**
 * bias-smoke.spec.ts
 *
 * Simulates Midtown geolocation, navigates directly to /quiz, completes with
 * cocktail-leaning answers, asserts top result is in Midtown / Chelsea / UWS /
 * East Village.
 */

import { test, expect } from '@playwright/test';

const MIDTOWN_COORDS = { latitude: 40.7549, longitude: -73.984 };

test.describe('Bias smoke — Midtown geolocation', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(MIDTOWN_COORDS);
  });

  test('top result is a Midtown / Chelsea / UWS / East Village bar', async ({ page }) => {
    await page.goto('/quiz');

    // First-load compile of /quiz can take >10s under concurrent worker load.
    // Give the first quiz prompt a generous timeout; subsequent ones are fast.
    await expect(page.getByText('Friday, 11pm. What sounds good?')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'A hidden cocktail spot' }).click();

    await expect(page.getByText('What energy are you bringing?')).toBeVisible();
    await page.getByRole('button', { name: 'Mellow — we wanna talk' }).click();

    await expect(page.getByText('Soundtrack of the night?')).toBeVisible();
    await page.getByRole('button', { name: 'Jazz / lounge' }).click();

    await expect(page.getByText('Who do you wanna be around?')).toBeVisible();
    await page.getByRole('button', { name: 'Industry / creative' }).click();

    await expect(page.getByText('Spending vibe tonight?')).toBeVisible();
    await page.getByRole('button', { name: 'Treating myself' }).click();

    await expect(page.getByText('Any neighborhoods you love?')).toBeVisible();
    await page.getByRole('button', { name: 'Anywhere works' }).click();

    // LocationPrompt — granted_precise auto-resolves via useEffect. Wait for
    // either the results heading OR the "Use my location" button (race), then
    // click the button only if needed.
    const resultsHeading = page.getByRole('heading', { name: /Your next \d+ bars?/i });
    const useLocationBtn = page.getByRole('button', { name: /Use my location/i });

    const autoResolved = await resultsHeading.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!autoResolved) {
      await expect(useLocationBtn).toBeVisible();
      await useLocationBtn.click();
    }

    await expect(resultsHeading).toBeVisible({ timeout: 15_000 });
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    const firstCard = cards.first();
    await expect(firstCard).toContainText(/Midtown|Chelsea|UWS|East Village/i);
  });
});
