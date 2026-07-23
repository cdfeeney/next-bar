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
import { test, expect, type Page, type Route } from '@playwright/test';

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
  /** Rows the friend_ratings view select returns. */
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

  await page.route(
    '**/rest/v1/rpc/get_following**',
    fulfillJson(200, opts.following ?? []),
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
  await page.route(
    '**/rest/v1/rpc/unfollow_user**',
    fulfillJson(200, opts.unfollowResult ?? true),
  );
  await page.route(
    '**/rest/v1/friend_ratings**',
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

    await expect(page.getByText(/no one in your circle yet/i)).toBeVisible();
    await expect(
      page.getByText(/search a friend.s @username below/i),
    ).toBeVisible();
    // Demo curators must NOT bleed into the signed-in circle.
    await expect(page.getByText('@maya')).not.toBeVisible();
    await expect(page.getByText('@jordan')).not.toBeVisible();
    // The find-friends search is the way forward.
    await expect(page.getByPlaceholder(/search @username/i)).toBeVisible();
  });

  test('search → follow lands the friend in "Your circle" with their @handle', async ({
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

    // Circle grows to 1 and shows the followed @handle.
    await expect(page.getByText(/Your circle · 1/)).toBeVisible();
    await expect(page.getByText('Sam J.').first()).toBeVisible();
    // Empty state is gone; still on /friends (following must not navigate).
    await expect(page.getByText(/no one in your circle yet/i)).not.toBeVisible();
    await expect(page).toHaveURL(/\/friends$/);
  });

  test('unfollow removes the friend from the circle and restores the empty state', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [SAM],
      profileByHandle: [SAM],
      unfollowResult: true,
    });
    await page.goto('/friends');

    await expect(page.getByText(/Your circle · 1/)).toBeVisible();
    const circleRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@sam_j' })
      .first();
    await circleRow.getByRole('button', { name: /^Following$/ }).click();

    await expect(page.getByText(/no one in your circle yet/i)).toBeVisible();
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
