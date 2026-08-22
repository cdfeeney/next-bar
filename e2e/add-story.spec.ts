/**
 * add-story.spec.ts — the Add-to-Story branch, after the V8 Stories backend.
 *
 * WHAT THIS FILE NO LONGER DOES, AND WHY. Cycle 1 could walk the whole branch
 * signed-OUT: capture wrote a data URL, compose picked from `demoFriends`, and
 * "Add to my story" wrote a `localStorage` record, so the receipt and the
 * stored payload were both assertable here.
 *
 * None of that is true now. Publication uploads real bytes to a private bucket
 * and calls `publish_story`, which requires a session, and the recipients come
 * from the real mutual-friend graph. Driving the full branch end to end
 * therefore needs two real accounts and a database — writes this cycle is not
 * authorised to make.
 *
 * COVERAGE THAT MOVED, so the shorter file is not mistaken for lost coverage:
 *   - upload-then-publish ordering, cleanup of a partial upload, "Shared" only
 *     after BOTH succeed, honest failure text, signed-URL lifetime →
 *     `src/lib/stories.server.test.ts` (runs in this gate).
 *   - custom-audience enforcement, non-mutual refusal, expiry, delete/undo,
 *     tag withdrawal → `src/lib/storiesRls.live.test.ts` (two identities,
 *     needs a database; NOT run here — the attended staging verification).
 *
 * What is asserted below is what a signed-out browser can still honestly show:
 * the entry point is absent without a session, and the audience surface no
 * longer offers a group feature that does not exist.
 */

import { test, expect } from '@playwright/test';

test.describe('Add to Story', () => {
  test('there is no add entry point without a session', async ({ page }) => {
    await page.goto('/friends');
    await expect(page.getByTestId('social-subtabs')).toBeVisible();

    // The plus lives on your own rail cell, and there is no rail signed out.
    await expect(page.getByTestId('add-story')).toHaveCount(0);
    await expect(page.getByTestId('capture-modes')).toHaveCount(0);
    await expect(page.getByTestId('story-compose')).toHaveCount(0);

    // And the surface says why rather than showing a dead control.
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
  });

  test('"Selected groups" is removed from the V8 audience surface', async ({
    page,
  }) => {
    // Item 6 of the amendment: no saved-groups capability exists, so a people
    // picker must not be presented as a group feature. Asserted as ABSENCE of
    // the string anywhere on Social — the sheet itself needs a session, and a
    // test that could only run signed-in would not catch a stray label here.
    await page.goto('/friends');
    await expect(page.locator('main')).not.toContainText(/Selected groups/i);
  });

  test('no story is ever written to browser storage', async ({ page }) => {
    // The strongest local assertion left: whatever the surface does signed
    // out, it must not create the retired story records.
    await page.goto('/friends');
    await page.getByRole('tab', { name: /Feed/i }).click();
    const stored = await page.evaluate(() => ({
      stories: window.localStorage.getItem('next-bar:stories:v1'),
      replies: window.localStorage.getItem('next-bar:story-replies:v1'),
      untagged: window.localStorage.getItem('next-bar:stories-untagged:v1'),
    }));
    expect(stored.stories).toBeNull();
    expect(stored.replies).toBeNull();
    expect(stored.untagged).toBeNull();
  });
});
