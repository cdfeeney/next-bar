/**
 * friends-real.spec.ts
 *
 * B3 real social graph — signed-in /friends + /u/[handle] against stubbed
 * Supabase RPCs (same cookie + route-stub pattern as claim-handle.spec.ts;
 * no real accounts or database rows are involved).
 *
 * What this guards against:
 *   - The signed-in Friends page falling back to demo curators
 *   - search → follow not landing the profile in "Your circle"
 *   - unfollow not removing the row / breaking the empty state
 *   - The zero-friends empty state regressing into a broken page
 *     (empty states are acceptance criteria per blueprint B3)
 *   - /u/<unknown handle> not 404ing for signed-in users
 *
 * WebKit note (same as auth-page.spec.ts): use click + pressSequentially,
 * not fill, so React's controlled inputs see real key events.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Route } from './helpers/test';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const USER_EMAIL = 'connor@example.com';
const FRIEND_ID = '99999999-8888-7777-6666-555555555555';

function readSupabaseUrl(): string | null {
  try {
    const env = readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    const match = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

const SUPABASE_URL = readSupabaseUrl();

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/** Build the @supabase/ssr auth cookie for a fake signed-in session. */
function sessionCookie(supabaseUrl: string): { name: string; value: string } {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const accessToken = [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(
      JSON.stringify({ sub: USER_ID, role: 'authenticated', exp: expiresAt }),
    ),
    'e2e-fake-signature',
  ].join('.');
  const session = {
    access_token: accessToken,
    refresh_token: 'e2e-fake-refresh',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: expiresAt,
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: USER_EMAIL,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${base64Url(JSON.stringify(session))}`,
  };
}

function fulfillJson(status: number, body: unknown) {
  return async (route: Route): Promise<void> => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  };
}

type ProfileRow = { id: string; handle: string; display_name: string | null };

type StubOptions = {
  /** Rows get_following returns (the circle). */
  following?: ProfileRow[];
  /** Rows search_handles returns. */
  searchResults?: Array<{ handle: string; display_name: string | null }>;
  /** Rows get_profile_by_handle returns ([] = unknown handle). */
  profileByHandle?: ProfileRow[];
  /** follow_user / unfollow_user results. */
  followResult?: boolean;
  unfollowResult?: boolean;
  /** Rows the get_friend_ratings RPC returns (view→RPC per DeepSeek review). */
  friendRatings?: Array<{
    user_id: string;
    bar_id: string;
    tier: string;
    rated_at: string;
  }>;
};

/**
 * Stub every Supabase surface the B3 pages touch when signed in. Playwright
 * checks routes newest-first, so the broad rest catch-all goes FIRST and
 * the specific endpoints override it.
 */
async function stubSupabase(page: Page, opts: StubOptions): Promise<void> {
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));

  // A settled write re-hydrates the circle (useFollows keys its hydrate on
  // `circleState.generation`), so `get_following` is read AGAIN after an
  // unfollow resolves. A stub that answers with the same row forever is
  // therefore telling the app the unfollow did not happen, and the app
  // correctly puts the row back — the assertion then wins or loses a race
  // with the re-hydrate, which is what made this test ~50% red on Pixel 7.
  // Model what the server would actually say instead. Only unfollow is
  // modelled: it is the one write whose re-read a test asserts on.
  let unfollowed = false;
  await page.route('**/rest/v1/rpc/get_following**', (route) =>
    fulfillJson(200, unfollowed ? [] : (opts.following ?? []))(route),
  );
  await page.route(
    '**/rest/v1/rpc/search_handles**',
    fulfillJson(200, opts.searchResults ?? []),
  );
  await page.route(
    '**/rest/v1/rpc/get_profile_by_handle**',
    fulfillJson(200, opts.profileByHandle ?? []),
  );
  await page.route(
    '**/rest/v1/rpc/follow_user**',
    fulfillJson(200, opts.followResult ?? true),
  );
  await page.route('**/rest/v1/rpc/unfollow_user**', (route) => {
    const removed = opts.unfollowResult ?? true;
    if (removed) unfollowed = true;
    return fulfillJson(200, removed)(route);
  });
  await page.route(
    '**/rest/v1/rpc/get_friend_ratings**',
    fulfillJson(200, opts.friendRatings ?? []),
  );
}

async function signIn(page: Page): Promise<void> {
  const cookie = sessionCookie(SUPABASE_URL as string);
  await page.context().addCookies([{ ...cookie, url: 'http://localhost:3000' }]);
}

const SAM: ProfileRow = {
  id: FRIEND_ID,
  handle: 'sam_j',
  display_name: 'Sam J.',
};

test.describe('/friends — signed in (real graph)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
  });

  test('zero friends shows the inviting empty state, not demo curators or a broken page', async ({
    page,
  }) => {
    await stubSupabase(page, { following: [] });
    await page.goto('/friends');

    // UX-A: zero-graph account shows 0/0 stats — no wall of empty states.
    await expect(page.getByRole('link', { name: /0\s+Following/i })).toBeVisible();
    // Demo curators must NOT bleed into the signed-in surface.
    await expect(page.getByText('@claire')).not.toBeVisible();
    await expect(page.getByText('@john')).not.toBeVisible();
    // The find-friends search is the way forward.
    await expect(page.getByPlaceholder(/search @username/i)).toBeVisible();
  });

  test('search → follow bumps the Following stat; the list page shows the @handle (UX-A)', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [],
      searchResults: [{ handle: 'sam_j', display_name: 'Sam J.' }],
      profileByHandle: [SAM],
      followResult: true,
    });
    await page.goto('/friends');

    const search = page.getByPlaceholder(/search @username/i);
    await search.click();
    await search.pressSequentially('sam');

    // The search result row renders with a Follow button.
    const resultRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@sam_j' })
      .first();
    await expect(resultRow).toBeVisible();
    await resultRow.getByRole('button', { name: /^Follow$/ }).click();

    // The stat ticks to 1; following must not navigate away. (The list
    // page's row rendering is covered by the unfollow test below — a
    // navigation here would remount useFollows against the stub's original
    // empty `following` fixture.)
    await expect(page.getByRole('link', { name: /1\s+Following/i })).toBeVisible();
    await expect(page).toHaveURL(/\/friends$/);
  });

  /*
   * PRESENCE, not suggestions — and the strip is `social-tonight`.
   *
   * Both of these stubbed `get_circle_suggestions` and read a `friends-tonight`
   * strip, because that is what the Tonight component read when they were
   * written. The WP1 merge (7c6b085) settled otherwise: Social → Tonight is
   * WP7's TonightPresence over `get_circle_presence`, which is night-scoped by
   * `public.nyc_night_key()` on the SERVER and audience-gated so that a `close`
   * pin needs a mutual follow. Suggestions kept its own source for its own
   * feature. A spec still stubbing the retired source proves nothing about the
   * surface that ships — it passed only because nothing was asserting.
   *
   * The row shape is `get_circle_presence`'s, and it is validated defensively
   * by fetchCirclePresence: user_id, handle, status and updated_at are all
   * required, and a row missing any of them is DROPPED rather than coerced.
   */
  test('the Tonight strip shows circle PRESENCE — the bar, then who is there (QA3)', async ({
    page,
  }) => {
    await stubSupabase(page, { following: [SAM] });
    // Later-registered routes take precedence over stubSupabase's.
    await page.route('**/rest/v1/rpc/get_circle_presence', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            user_id: FRIEND_ID,
            handle: 'sam_j',
            display_name: 'Sam J.',
            status: 'going',
            bar_id: 'attaboy',
            updated_at: '2026-08-24T02:00:00Z',
          },
        ]),
      }),
    );
    await page.goto('/friends');

    const strip = page.getByTestId('social-tonight');
    await expect(strip.getByTestId('presence-list')).toBeVisible();
    // Presence LEADS WITH THE BAR and spells the state out in words on the line
    // beneath — never by colour alone (V8-R-SOC-001).
    await expect(strip.getByText('Attaboy')).toBeVisible();
    await expect(strip.getByText(/Sam J\./)).toBeVisible();
  });

  test('the Tonight strip says nobody is out when the circle has none, and offers a way forward (QA3)', async ({
    page,
  }) => {
    await stubSupabase(page, { following: [SAM] });
    await page.route('**/rest/v1/rpc/get_circle_presence', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.goto('/friends');

    const strip = page.getByTestId('social-tonight');
    // The status pills still render (they live in the same block)…
    await expect(strip.getByRole('button', { name: /^Going out$/ })).toBeVisible();
    // …and an EMPTY circle read with a real session is the empty state, with
    // the forward path V8-R-OPS-005 asks for. This is the assertion that used
    // to live signed-out in night-out.spec.ts, where it was not a read at all.
    await expect(strip.getByTestId('presence-empty')).toBeVisible();
    await expect(
      strip.getByRole('link', { name: /invite friends/i }),
    ).toBeVisible();
    // Never confused with a failed read.
    await expect(strip.getByTestId('presence-error')).toHaveCount(0);
    await expect(strip.getByTestId('presence-list')).toHaveCount(0);
  });

  test('unfollow on the Following list removes the row (UX-A)', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [SAM],
      profileByHandle: [SAM],
      unfollowResult: true,
    });
    await page.goto('/friends/following');

    const circleRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@sam_j' })
      .first();
    await circleRow.getByRole('button', { name: /^Following$/ }).click();

    await expect(page.getByText(/not following anyone yet/i)).toBeVisible();
    await expect(page.getByText('@sam_j')).not.toBeVisible();
  });
});

test.describe('/u/[handle] — signed in (real profiles)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
  });

  test('unknown handle 404s instead of rendering a demo fallback', async ({
    page,
  }) => {
    await stubSupabase(page, { profileByHandle: [] });
    await page.goto('/u/nobody_here');

    // Next.js default not-found boundary.
    await expect(
      page.getByText(/this page could not be found/i),
    ).toBeVisible();
  });

  test("a followed friend's profile shows their tier-ranked list without scores", async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [SAM],
      profileByHandle: [SAM],
      friendRatings: [
        {
          user_id: FRIEND_ID,
          bar_id: 'attaboy',
          tier: 'liked',
          rated_at: '2026-05-12T00:00:00.000Z',
        },
        {
          user_id: FRIEND_ID,
          bar_id: 'death-and-co',
          tier: 'loved',
          rated_at: '2026-05-10T00:00:00.000Z',
        },
      ],
    });
    await page.goto('/u/sam_j');

    await expect(page.getByText('Sam J.').first()).toBeVisible();
    await expect(page.getByText('@sam_j').first()).toBeVisible();

    // Tier-ranked: loved (Death & Co) outranks liked (Attaboy) regardless
    // of recency.
    const list = page.locator('article');
    await expect(list.first()).toContainText('Death & Co');
    await expect(list.nth(1)).toContainText('Attaboy');
    // Tier badges render; numeric scores must NOT (owner-only side channel).
    await expect(list.first()).toContainText('Loved');
    await expect(page.getByText(/\d\.\d/)).toHaveCount(0);
  });
});

test.describe('/friends/consensus — REAL group pick', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
  });

  /**
   * REWRITTEN 2026-08-19 for the founder's Group Favorites rule (every member
   * scores the bar >= 8.0; a missing score is "not YET", never a vote).
   *
   * It used to assert an Attaboy card built from these same tier-only rows.
   * That assertion only ever passed because tiers were imputed as scores,
   * which the founder explicitly forbade. `get_friend_ratings` is tier-only
   * by a hard security rule (0007 / 0015) and carrying the score across the
   * friend boundary is a separate T0 goal, so a real circle contributes no
   * qualifying scores TODAY and the list is expected to be empty. The test
   * now asserts that truth — real people, and an empty state that explains
   * itself instead of blaming the user for not rating enough.
   */
  test('real circle members appear as people; with no shared scores the list explains itself', async ({
    page,
  }) => {
    const CLAIRE = { id: 'uuid-claire', handle: 'claire_r', display_name: 'Claire R.' };
    await stubSupabase(page, {
      following: [SAM, CLAIRE],
      friendRatings: [
        { user_id: FRIEND_ID, bar_id: 'attaboy', tier: 'loved', rated_at: '2026-07-01T00:00:00.000Z' },
        { user_id: 'uuid-claire', bar_id: 'attaboy', tier: 'liked', rated_at: '2026-07-02T00:00:00.000Z' },
        { user_id: FRIEND_ID, bar_id: 'death-and-co', tier: 'liked', rated_at: '2026-07-03T00:00:00.000Z' },
      ],
    });
    await page.goto('/friends/consensus');

    // Real first names as selectable people — not the demo curators. The chip
    // is the button whose name STARTS with the name; the selection summary
    // also carries a "Remove Sam" control (V9-04), so an unanchored /Sam/
    // would match two elements.
    await expect(page.getByRole('button', { name: /^Sam\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Claire\b/ })).toBeVisible();

    await expect(page.getByText(/Group Favorites/i)).toBeVisible();

    // No scores crossed the boundary, so nothing qualifies — and the copy
    // says so rather than telling the user to rate more bars.
    await expect(page.getByTestId('group-favorites-empty')).toContainText(
      /scores aren't shared yet/i,
    );
    // No consensus card at all — <article> is the ConsensusCard element, so
    // this is the direct negative of the assertion this test used to make.
    await expect(page.locator('article')).toHaveCount(0);
    // A tier-only row must never be promoted into a shareable group pick.
    await expect(
      page.getByRole('button', { name: /^Share the pick/ }),
    ).toHaveCount(0);
  });

  test('a circle with no rated friends explains itself instead of ghost-chipping', async ({
    page,
  }) => {
    await stubSupabase(page, { following: [SAM], friendRatings: [] });
    await page.goto('/friends/consensus');
    await expect(
      page.getByText(/1 of your circle hasn't ranked any bars yet/),
    ).toBeVisible();
  });
});
