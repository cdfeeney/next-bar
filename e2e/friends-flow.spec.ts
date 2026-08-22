/**
 * friends-flow.spec.ts
 *
 * The social layer is the product pitch ("Beli for bars"), so its
 * interactions get first-class coverage:
 *   1. Following a suggested curator moves them into "Your circle".
 *   2. Consensus surfaces bars the selected group all rated (and excludes
 *      anyone's Pass).
 *   3. The "sample night" seeder populates Rankings from an empty state.
 *   4. The profile follow toggle persists.
 *
 * Fresh Playwright contexts start with empty localStorage, so follows fall
 * back to the default set (claire, john) — see useFollows.
 */

import { test, expect } from '@playwright/test';

/**
 * V8-1 criterion 11 + 19 — Social is the approved surface from
 * `docs/design-reference/approved/next-bar-social-v2-core.png`, not the
 * 2026-07-26 Friends dashboard with a renamed tab.
 *
 * These run signed-OUT, which is the half of the surface an unauthenticated
 * gate can actually exercise; the signed-in half (presence rows, Pin my spot,
 * the request badge, the 44px search rows) is in follow-requests.spec.ts
 * against the stubbed graph.
 */
test.describe('Social — the approved surface', () => {
  test('presence leads, coordination follows, people sit behind one control', async ({
    page,
  }) => {
    await page.goto('/friends');

    // The canvas header: wordmark + night line, not an h1 reading "Friends".
    await expect(page.getByRole('heading', { name: /^Next Bar$/i })).toBeVisible();

    // V8-1f: the order the Wave-1 surface stacked is now the sub-tab order —
    // Tonight lands first, and it still leads with presence and then the
    // people graph. Plans moved to its own sub-tab, not off Social.
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
    const tonightHeadings = page
      .getByTestId('social-panel-tonight')
      .getByRole('heading', { name: /^(Stories|Out tonight|Groups & people)$/i });
    await expect(tonightHeadings.nth(0)).toHaveText(/Stories/i);
    await expect(tonightHeadings.nth(1)).toHaveText(/Out tonight/i);
    await expect(tonightHeadings.nth(2)).toHaveText(/Groups & people/i);

    // Plans' single entry point, and where it goes.
    await page.getByRole('tab', { name: /^Plans$/i }).click();
    const start = page.getByRole('link', { name: /Start a Night Out/i });
    await expect(start).toBeVisible();
    await start.click();
    await expect(page).toHaveURL(/\/friends\/consensus$/);
  });

  test('the legacy dashboard’s primary action card is gone', async ({
    page,
  }) => {
    await page.goto('/friends');
    // Negative assertion: the old accent "Plan Night Out →" card was the
    // legacy surface's one primary action. Its replacement is "Start a Night
    // Out" under Plans. Nothing on Social may carry the old label.
    await expect(
      page.getByRole('link', { name: /Plan Night Out/i }),
    ).toHaveCount(0);
  });

  test('the Groups & people control reaches the people section without leaving Social', async ({
    page,
  }) => {
    await page.goto('/friends');
    // V8-1f: the control is a button now, because the section it targets
    // lives on the Tonight sub-tab and has to be selected before it can be
    // scrolled to. It still never leaves Social.
    await page.getByRole('tab', { name: /^Feed$/i }).click();
    await page.getByRole('button', { name: /Groups & people/i }).click();

    // Same route — this is a jump within Social, not a navigation away.
    await expect(page).toHaveURL(/\/friends$/);
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
    await expect(page.getByTestId('follow-stats')).toBeVisible();
    await expect(page.getByPlaceholder(/Search @handle or name/i)).toBeVisible();
  });

  test('signed out, Tonight says so instead of rendering an empty pinned list', async ({
    page,
  }) => {
    await page.goto('/friends');
    const tonight = page.getByTestId('friends-tonight');
    await expect(tonight.getByText(/Sign in to see who's out/i)).toBeVisible();
    // No accent CTA to a write the visitor cannot perform.
    await expect(
      tonight.getByRole('button', { name: /^Pin my spot$/ }),
    ).toHaveCount(0);
    // …but the local intent flow is still live and still theirs.
    await expect(
      tonight.getByRole('button', { name: /^Going out$/ }),
    ).toBeVisible();
  });
});

test.describe('Friends + consensus', () => {
  test('following a suggested curator bumps the Following stat and lands them in the list (UX-A)', async ({ page }) => {
    await page.goto('/friends');

    // Instagram-model stats: default demo circle is 2 (claire, john).
    const followingStat = page.getByRole('link', { name: /2\s+Following/i });
    await expect(followingStat).toBeVisible();

    // Follow Sasha from Find friends; the stat ticks to 3.
    const sashaRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@sasha' });
    await sashaRow.getByRole('button', { name: /^Follow$/ }).click();
    await expect(page.getByRole('link', { name: /3\s+Following/i })).toBeVisible();

    // Tap the stat → the Following LIST page has her row.
    await page.getByRole('link', { name: /3\s+Following/i }).click();
    await expect(page).toHaveURL('/friends/following');
    await expect(page.getByText('@sasha')).toBeVisible();
  });

  test('Group Favorites shows bars the group all rated, top pick shareable (UX-B)', async ({ page }) => {
    await page.goto('/friends/consensus');

    // With the default group (claire + john), there is overlap.
    await expect(page.getByText(/Group Favorites/i)).toBeVisible();
    // Death & Co is loved by both curators → appears as a group pick,
    // and the TOP pick carries the share moment (no vote step anymore).
    await expect(
      page.getByRole('heading', { name: /Death & Co/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Share the pick/i }),
    ).toBeVisible();
  });

  /**
   * Panel finding (both lanes, HIGH): `alsoConsider` was concatenated into
   * `groupFavorites` and rendered identically, so a bar that FAILS unanimity
   * was displayed as a Group Favorite — star, rank 1, and the share moment
   * included.
   *
   * Following Sasha makes the group claire + john + sasha, and no bar is
   * scored >= 8.0 by all three (Sasha shares only Attaboy with Claire, and
   * John never rated it). Every entry is therefore a near-miss, which is the
   * exact shape that used to render as a Group Favorite.
   */
  test('near-misses are marked, never presented as Group Favorites or as the shareable pick', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page
      .locator('.bg-surface')
      .filter({ hasText: '@sasha' })
      .getByRole('button', { name: /^Follow$/ })
      .click();
    await expect(page.getByRole('link', { name: /3\s+Following/i })).toBeVisible();

    await page.goto('/friends/consensus');

    // Bars still surface — nothing is hidden, that was the whole point of
    // deleting the veto.
    await expect(
      page.getByRole('heading', { name: /Bemelmans Bar/i }),
    ).toBeVisible();

    // ...but every one of them is labelled as NOT a Group Favorite, and none
    // carries the star/share moment reserved for a unanimous pick.
    await expect(page.getByTestId('no-unanimous-pick')).toBeVisible();
    const cards = page.locator('article');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);
    await expect(page.getByTestId('near-miss-badge')).toHaveCount(cardCount);
    await expect(
      page.getByRole('button', { name: /^Share the pick/ }),
    ).toHaveCount(0);
  });

  test('consensus needs at least two people selected', async ({ page }) => {
    await page.goto('/friends/consensus');

    // Deselect john, leaving only claire → not enough for consensus.
    await page.getByRole('button', { name: /John/ }).click();
    await expect(page.getByText(/Pick at least two people/i)).toBeVisible();
  });

  test('sample-night seeder populates rankings from empty', async ({ page }) => {
    await page.goto('/rankings');
    await expect(
      page.getByRole('heading', { name: /Nothing here yet/i }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: /load a sample night/i })
      .click();

    // Rankings now show the seeded bars, sorted by score.
    await expect(
      page.getByRole('heading', { name: /Death & Co/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Nothing here yet/i }),
    ).toHaveCount(0);
  });

  test('tonight intent pills toggle, persist, and clear (UX-A compact row)', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-24T22:00:00'));
    await page.goto('/friends');

    // One tap sets; it sticks across reload; tapping the lit pill clears.
    const goingBtn = page.getByRole('button', { name: /^Going out$/ });
    await goingBtn.click();
    await expect(goingBtn).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    const goingAfter = page.getByRole('button', { name: /^Going out$/ });
    await expect(goingAfter).toHaveAttribute('aria-pressed', 'true');
    await goingAfter.click();
    await expect(goingAfter).toHaveAttribute('aria-pressed', 'false');

    // QA4: third pill "Not tonight" — same toggle semantics, persists.
    const notTonight = page.getByRole('button', { name: /^Not tonight$/ });
    await notTonight.click();
    await expect(notTonight).toHaveAttribute('aria-pressed', 'true');
    // Statuses are exclusive — setting it never lights the others.
    await expect(goingAfter).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    const notTonightAfter = page.getByRole('button', { name: /^Not tonight$/ });
    await expect(notTonightAfter).toHaveAttribute('aria-pressed', 'true');
    await notTonightAfter.click();
    await expect(notTonightAfter).toHaveAttribute('aria-pressed', 'false');
  });

  // The multi-step Put-it-to-a-vote flow is DELETED (UX-B): Group
  // Favorites + People's Choice replace it; the winner-share moment moved
  // to the top Group Favorite (covered above and in share-card.spec).

  test('profile follow toggle flips label', async ({ page }) => {
    await page.goto('/u/sasha');

    // Sasha is not in the default follow set.
    const followBtn = page.getByRole('button', { name: /^Follow$/ });
    await expect(followBtn).toBeVisible();
    await followBtn.click();
    await expect(
      page.getByRole('button', { name: /^Following$/ }),
    ).toBeVisible();
  });
});
