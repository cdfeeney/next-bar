/**
 * rating-and-nav.spec.ts
 *
 * Coverage after QA5-S1 (operator 2026-07-26): ranking entry moved OFF
 * result cards — the per-card "Rank it →" link is gone, so this spec now
 * covers only the bottom nav. The /rankings?add=<barId> deep-link flow
 * (tier sheet arming, Pass exclusion, list landing) is exercised by
 * pairwise-flow.spec.ts, which navigates to the deep link directly.
 *
 * Removed here (operator 2026-07-26, ranking entry moved off result
 * cards): the two "Rank it" click tests (quiz result + Where-next
 * results) and the Pass-deep-link test that started from a card.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';
import { signIn } from './helpers/stories';

test.describe('Bottom nav', () => {
  test.beforeEach(async ({ page }) => {
    // Home is location-first; deny geo so `/` deterministically lands on the
    // manual pick-a-bar flow these tests drive.
    await denyGeolocation(page.context());
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.clear();
      // Re-ack the 21+ age gate (H1) — the config storageState seeded it,
      // and clearing storage must not resurface the overlay mid-test.
      window.localStorage.setItem('next-bar:age-ack:v1', '1');
    });
  });

  test('bottom nav switches between the 5 app tabs', async ({ page }) => {
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();
    // Exactly five — a sixth tab is explicitly out of scope for V8, and the
    // label walk below would happily pass with an extra one wedged in.
    await expect(nav.getByRole('link')).toHaveCount(5);

    await nav.getByRole('link', { name: 'Map' }).click();
    await expect(page).toHaveURL(/\/map$/);

    await nav.getByRole('link', { name: 'Rankings' }).click();
    await expect(page).toHaveURL(/\/rankings$/);

    await nav.getByRole('link', { name: 'Social' }).click();
    await expect(page).toHaveURL(/\/friends$/);

    await nav.getByRole('link', { name: 'Account' }).click();
    await expect(page).toHaveURL(/\/settings$/);

    await nav.getByRole('link', { name: 'Next Bar?' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('the bar picker hydrates ratings once', () => {
  test('one ratings request for the whole list, however many rows it renders', async ({
    page,
  }) => {
    // THE STORM. Every picker row mounted its own RatingBadge, each of which
    // ran a full useRatings hydration — ~2,107 duplicate fetches per open
    // against production, until the browser died on
    // net::ERR_INSUFFICIENT_RESOURCES. The fix reads the hook once in
    // BarPicker and hands each row its rating.
    //
    // WHY THIS EXISTS ALONGSIDE BarPicker.hydration.test.tsx: that test counts
    // hook MOUNTS with the hook stubbed, so it cannot tell one fetch from many
    // within a single mount. This counts requests actually put on the wire,
    // which is the thing that killed the browser.
    //
    // WHAT IT DOES NOT CLAIM: zero requests is accepted here. If this
    // environment never hydrates ratings at all the count is 0 and this test
    // says nothing — it is a ceiling, not a proof that hydration happened. The
    // regression it exists to catch is per-row fetching, which is unmissable
    // at this ceiling.
    let ratingsRequests = 0;
    page.on('request', (request) => {
      if (/\/rest\/v1\/ratings/.test(request.url())) ratingsRequests += 1;
    });

    await signIn(page);
    await denyGeolocation(page.context());
    await page.goto('/');

    // The assertion is only meaningful over a list long enough that per-row
    // fetching would show, so the row count is asserted rather than assumed.
    const rows = page.getByRole('listitem');
    await expect.poll(async () => rows.count()).toBeGreaterThan(20);
    await page.waitForLoadState('networkidle');

    expect(ratingsRequests).toBeLessThanOrEqual(1);
  });
});
