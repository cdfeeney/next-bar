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

import { test, expect } from './helpers/test';

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

    // Tonight is PLAN-LED (Social redesign 2026-09-13, S-02): stories → the
    // plan card → Out tonight, compared by document position. The people graph
    // left Tonight in S-01 (it is /friends/people now), and the rail carries no
    // "Stories" heading here — that label belongs to Feed.
    const tonight = page.getByTestId('social-panel-tonight');
    await expect(tonight).toBeVisible();
    // (Signed out the rail is StoriesEmptyState, which keeps its own heading;
    // the heading-less Tonight rail is asserted with a session in story-rail.)
    await expect(tonight.getByRole('heading', { name: /^Groups & people$/i })).toHaveCount(0);
    await expect(tonight.getByRole('heading', { name: /^Out tonight$/i })).toBeVisible();
    await expect(page.getByTestId('follow-stats')).toHaveCount(0);
    // Signed out: the rail is its honest signed-out state, and the plan card is
    // the "No plan yet." box whose CTA goes to sign-in.
    await expect(tonight.getByTestId('stories-signed-out')).toBeVisible();
    const planCard = tonight.getByTestId('your-plan-none');
    await expect(planCard).toContainText('No plan yet.');
    await expect(tonight.getByTestId('start-night-out-tonight')).toHaveAttribute('href', '/auth');
    const order = await tonight.evaluate((panel) => {
      const ids = ['stories-signed-out', 'your-plan-none', 'out-tonight'];
      const nodes = ids.map((id) => panel.querySelector(`[data-testid="${id}"]`));
      if (nodes.some((n) => n === null)) return 'missing';
      return nodes.every(
        (n, i) =>
          i === 0 ||
          Boolean(nodes[i - 1]!.compareDocumentPosition(n!) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
    });
    expect(order).toBe(true);

    // The header carries two icon buttons and nothing else on the right: the
    // pin (your presence, in words for the reader) and the people icon.
    const pin = page.getByTestId('social-pin-icon');
    await expect(pin).toHaveAttribute('aria-label', /Set whether you are going out and where/);
    await expect(pin).toHaveAttribute('data-pin-state', 'none');
    await expect(page.getByRole('link', { name: /groups and people/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Groups & people/i })).toHaveCount(0);

    // PLANS (S-03, README §2): signed out with nothing started, the tab is the
    // heading, the Start card and the one line that says what else lands here —
    // nothing else. Invited and Earlier nights appear only with content.
    await page.getByRole('tab', { name: /^Plans$/i }).click();
    const plans = page.getByTestId('social-panel-plans');
    await expect(plans.getByRole('heading', { name: /^Plans$/i })).toBeVisible();
    await expect(plans.getByTestId('plans-empty-line')).toContainText(
      /Invitations you.ve been sent land here too\. Nothing else lives on this tab\./,
    );
    await expect(plans.getByRole('heading', { name: /^Invited$/i })).toHaveCount(0);
    await expect(plans.getByRole('heading', { name: /^Earlier nights$/i })).toHaveCount(0);
    await expect(plans.getByTestId('plan-invites')).toHaveCount(0);
    await expect(plans.getByTestId('group-invite-notifications')).toHaveCount(0);
    // Signed out, Start goes to sign-in (the same rule as Tonight's card); the
    // signed-in destination (/friends/consensus) is covered in night-out.spec.
    const start = page.getByRole('link', { name: /Start a Night Out/i });
    await expect(start).toBeVisible();
    await expect(start).toHaveAttribute('href', '/auth');
    await start.click();
    await expect(page).toHaveURL(/\/auth$/);
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

  test('the people icon pushes /friends/people in the redesign’s order, and back returns to Social', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('tab', { name: /^Feed$/i }).click();
    await page.getByRole('link', { name: /groups and people/i }).click();

    // A pushed screen with its own URL and a back affordance (README §10).
    await expect(page).toHaveURL(/\/friends\/people$/);
    await expect(page.getByRole('heading', { name: /^Groups & people$/i })).toBeVisible();
    await expect(page.getByTestId('follow-stats')).toBeVisible();
    await expect(page.getByPlaceholder(/Search @handle or name/i)).toBeVisible();

    // ORDER CHANGED with the redesign: counts → Find friends → Groups →
    // Group Favorites. Compared by document position, not by eye.
    const order = await page.evaluate(() => {
      const ids = ['follow-stats', 'find-friends', 'group-favorites'];
      const nodes = ids.map((id) => document.querySelector(`[data-testid="${id}"]`));
      const groups = Array.from(document.querySelectorAll('h3')).find(
        (h) => /^groups$/i.test(h.textContent?.trim() ?? ''),
      );
      const all = [nodes[0], nodes[1], groups ?? null, nodes[2]];
      if (all.some((n) => n === null)) return 'missing';
      return all.every((n, i) =>
        i === 0
          ? true
          : Boolean(
              all[i - 1]!.compareDocumentPosition(n!) & Node.DOCUMENT_POSITION_FOLLOWING,
            ),
      );
    });
    expect(order).toBe(true);

    await page.getByTestId('people-back').click();
    await expect(page).toHaveURL(/\/friends$/);
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
  });

  test('signed out, Tonight says so instead of rendering an empty pinned list', async ({
    page,
  }) => {
    await page.goto('/friends');
    // `social-tonight` since the WP1 merge (7c6b085): Social → Tonight is
    // WP7's TonightPresence, and the older `friends-tonight` component went
    // with the suggestions-backed source it read. The assertion itself SURVIVED
    // that merge on purpose — it is the one that caught Tonight telling a
    // visitor "No friends out yet tonight" about friends it never asked about.
    const tonight = page.getByTestId('social-tonight');
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
    // The stats and Find friends live on /friends/people since S-01.
    await page.goto('/friends/people');

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
    await page.goto('/friends/people');
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
    // Group Favorites resolves its bars through the catalog, and the catalog
    // can re-fetch mid-page (the 0019 swap-day check; same window
    // mobile-controls waits out). Under a loaded gate that re-fetch landed
    // between "cards visible" and `count()`, which does not wait, and read 0.
    // Wait for the catalog to settle, then count once it is stable.
    await expect(page.getByText(/Loading the Manhattan catalog/)).toHaveCount(0, { timeout: 15_000 });
    await expect(cards.first()).toBeVisible();
    await expect.poll(() => cards.count(), { timeout: 10_000 }).toBeGreaterThan(0);
    const cardCount = await cards.count();
    await expect(page.getByTestId('near-miss-badge')).toHaveCount(cardCount);
    await expect(
      page.getByRole('button', { name: /^Share the pick/ }),
    ).toHaveCount(0);
  });

  test('consensus needs at least two people selected', async ({ page }) => {
    await page.goto('/friends/consensus');

    // Deselect john, leaving only claire → not enough for consensus. The chip
    // is the button whose name STARTS with John; the selection summary also has
    // a "Remove John" control (V9-04), so the old /John/ matched two elements.
    await page.getByRole('button', { name: /^John/ }).click();
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

  test('a status pill never lights for a write that did not land', async ({ page }) => {
    // WAS "tonight intent pills toggle, persist, and clear (UX-A compact row)",
    // over `useIntent` — a LOCAL, device-only status that toggled and persisted
    // signed out. The WP1 merge (7c6b085) settled that Social → Tonight is
    // WP7's TonightPresence, and its pills are a SERVER write
    // (`set_night_presence`) whose whole point is that the night is resolved
    // server-side and the audience is enforced rather than displayed. No UI
    // consumer of the local intent status survives; `useIntent` is down to
    // `useNightRefresh`. The pills also renamed: Maybe → "Maybe later",
    // Not tonight → "Not going out".
    //
    // What replaces it is the stronger property the component's own header
    // promises: "Optimistically flipping the pill would tell the user their
    // friends can see a pin that was never written." Signed out the write
    // cannot land, so the pill must NOT light — and the surface must say so
    // rather than going quiet.
    await page.clock.setFixedTime(new Date('2026-07-24T22:00:00'));
    await page.goto('/friends');

    const going = page.getByRole('button', { name: /^Going out$/ });
    await expect(going).toHaveAttribute('aria-pressed', 'false');
    await going.click();

    // Not lit — not now, and not after a reload, because nothing was stored.
    await expect(going).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(/didn't save/i)).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: /^Going out$/ }),
    ).toHaveAttribute('aria-pressed', 'false');

    // The other two pills are the V8 set, and none of them is lit either.
    for (const label of [/^Maybe later$/, /^Not going out$/]) {
      await expect(page.getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
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
