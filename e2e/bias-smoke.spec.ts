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
    // Full quiz walk + first-load compile + location auto-resolve is
    // legitimately slow under parallel-worker load, especially on WebKit
    // (night-loop N1): the page reaches the right state, the budget just
    // runs out. test.slow() = 3× the project timeout.
    test.slow();
    await page.goto('/quiz');

    // First-load compile of /quiz can take >10s under concurrent worker load.
    // Give the first quiz prompt a generous timeout; subsequent ones are fast.
    await expect(page.getByText('Friday, 11pm. What sounds good?')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'A hidden cocktail spot' }).click();

    await expect(page.getByText('What energy are you bringing?')).toBeVisible();
    await page.getByRole('button', { name: 'Mellow — we wanna talk' }).click();

    // Setting question (garden/rooftop axis, 2026-07-24)
    await page.getByRole('button', { name: 'Tucked away inside' }).click();

    await expect(page.getByText('Soundtrack of the night?')).toBeVisible();
    await page.getByRole('button', { name: 'Jazz / lounge' }).click();

    await expect(page.getByText('Who do you wanna be around?')).toBeVisible();
    await page.getByRole('button', { name: 'Industry / creative' }).click();

    await expect(page.getByText('Who are you out with?')).toBeVisible();
    await page.getByRole('button', { name: 'On a date' }).click();

    await expect(page.getByText('Spending vibe tonight?')).toBeVisible();
    await page.getByRole('button', { name: 'Treating myself' }).click();

    await expect(page.getByText('Any neighborhoods you love?')).toBeVisible();
    await page.getByRole('button', { name: 'Anywhere works' }).click();

    // LocationPrompt — granted_precise auto-resolves via useEffect, but the
    // resolve can take >3s under concurrent worker load (night-loop N1: the
    // old 3s race window was the real cause of the "drift" here — results
    // arrived WHILE we waited for a button that never comes on the granted
    // path). Race BOTH outcomes with one generous window, then branch.
    const resultsHeading = page.getByRole('heading', { name: /Your next \d+ bars?/i });
    const useLocationBtn = page.getByRole('button', { name: /Use my location/i });

    await expect(resultsHeading.or(useLocationBtn).first()).toBeVisible({
      timeout: 15_000,
    });
    if (!(await resultsHeading.isVisible())) {
      // The granted path renders a DISABLED "Use my location" ("Using your
      // location…") while auto-resolving — results replace it on their own,
      // sometimes mid-click (it can flash enabled). The click is therefore
      // BEST-EFFORT with a short cap; the results assertion below is the
      // real gate either way.
      if (await useLocationBtn.isEnabled().catch(() => false)) {
        await useLocationBtn.click({ timeout: 5_000 }).catch(() => {});
      }
    }

    await expect(resultsHeading).toBeVisible({ timeout: 15_000 });
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    // RETRYING assertion, not a one-shot count(). The results heading can
    // paint before the server-catalog swap finishes, and CatalogRefresh now
    // PAGES that fetch (PostgREST caps responses at 1,000 rows and the
    // catalog passed 1,000), so the swap lands a round trip later than it
    // used to. A single count() snapshot reads the pre-swap DOM and flakes.
    await expect
      .poll(async () => cards.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);

    // Hell's Kitchen joined the catalog 2026-07-24 — from Midtown coords its
    // bars are legitimately the nearest strong matches (Bar Centrale 6/6).
    const firstCard = cards.first();
    await expect(firstCard).toContainText(
      /Midtown|Hell's Kitchen|Chelsea|UWS|Upper West Side|East Village/i,
    );
  });
});
