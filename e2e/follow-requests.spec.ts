/**
 * follow-requests.spec.ts
 *
 * B3b follow requests + privacy toggle — signed-in /friends and /settings
 * against stubbed Supabase RPCs (same cookie + route-stub pattern as
 * friends-real.spec.ts; no real accounts or database rows are involved).
 *
 * What this guards against:
 *   - following a PRIVATE account silently creating an edge instead of a
 *     request ("Requested" state must render, circle must not grow)
 *   - the Requests inbox not rendering, or accept/decline not clearing rows
 *   - withdrawing a request (tap "Requested") not reverting to "Follow"
 *   - the Settings privacy toggle not reflecting/flipping is_private
 *
 * WebKit note (same as auth-page.spec.ts): use click + pressSequentially,
 * not fill, so React's controlled inputs see real key events.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const USER_EMAIL = 'connor@example.com';
const PRIVATE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const REQUESTER_ID = '99999999-8888-7777-6666-555555555555';

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
type RequestRow = {
  id: string;
  handle: string;
  display_name: string | null;
  requested_at: string;
};

type StubOptions = {
  following?: ProfileRow[];
  searchResults?: Array<{ handle: string; display_name: string | null }>;
  profileByHandle?: ProfileRow[];
  /** Post-0008 follow_user returns text. */
  followResult?: 'followed' | 'requested' | 'rejected';
  /** get_follow_requests rows (the inbox). */
  incomingRequests?: RequestRow[];
  /** get_outgoing_requests rows ("Requested" states after reload). */
  outgoingRequests?: ProfileRow[];
  acceptResult?: boolean;
  declineResult?: boolean;
  cancelResult?: boolean;
  /** Own profile row for /settings (select on profiles). */
  ownProfile?: {
    handle: string | null;
    display_name: string | null;
    is_private: boolean;
  };
  /** B3c: get_followers rows. */
  followers?: ProfileRow[];
  /** B3c: get_follower_count result (null = hidden). */
  followerCount?: number | null;
};

/**
 * Stub every Supabase surface the B3b pages touch when signed in.
 * Playwright checks routes newest-first, so the broad rest catch-all goes
 * FIRST and the specific endpoints override it.
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
    fulfillJson(200, opts.followResult ?? 'followed'),
  );
  // STATEFUL inbox: resolving a request removes it from later fetches —
  // the hook refetches after accept/decline (shared-badge refresh bus),
  // and a static stub would resurrect resolved rows.
  let inbox: RequestRow[] = [...(opts.incomingRequests ?? [])];
  await page.route('**/rest/v1/rpc/get_follow_requests**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(inbox),
    });
  });
  await page.route(
    '**/rest/v1/rpc/get_outgoing_requests**',
    fulfillJson(200, opts.outgoingRequests ?? []),
  );
  const resolveRoute = (result: boolean) => async (route: Route) => {
    if (result) {
      const body = route.request().postDataJSON() as { requester?: string };
      inbox = inbox.filter((r) => r.id !== body?.requester);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    });
  };
  await page.route(
    '**/rest/v1/rpc/accept_follow_request**',
    resolveRoute(opts.acceptResult ?? true),
  );
  await page.route(
    '**/rest/v1/rpc/decline_follow_request**',
    resolveRoute(opts.declineResult ?? true),
  );
  await page.route(
    '**/rest/v1/rpc/cancel_follow_request**',
    fulfillJson(200, opts.cancelResult ?? true),
  );
  await page.route(
    '**/rest/v1/rpc/get_followers**',
    fulfillJson(200, opts.followers ?? []),
  );
  await page.route(
    '**/rest/v1/rpc/get_follower_count**',
    fulfillJson(200, opts.followerCount ?? null),
  );
  if (opts.ownProfile) {
    // GET (select) returns the row; PATCH (privacy update) returns 204-ish
    // empty success — both arrive on the same endpoint.
    await page.route('**/rest/v1/profiles**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([opts.ownProfile]),
      });
    });
  }
}

async function signIn(page: Page): Promise<void> {
  const cookie = sessionCookie(SUPABASE_URL as string);
  await page.context().addCookies([{ ...cookie, url: 'http://localhost:3000' }]);
}

const AVA: ProfileRow = {
  id: PRIVATE_ID,
  handle: 'ava_p',
  display_name: 'Ava P.',
};

test.describe('/friends — follow requests (B3b)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
  });

  test('following a private account files a request: "Requested" state, no circle growth, tap withdraws', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [],
      searchResults: [{ handle: 'ava_p', display_name: 'Ava P.' }],
      profileByHandle: [AVA],
      followResult: 'requested',
      cancelResult: true,
    });
    await page.goto('/friends');

    const search = page.getByPlaceholder(/search @username/i);
    await search.click();
    await search.pressSequentially('ava');

    const resultRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@ava_p' })
      .first();
    await expect(resultRow).toBeVisible();
    await resultRow.getByRole('button', { name: /^Follow$/ }).click();

    // The server said 'requested' — the row settles into Requested, and the
    // circle count must NOT grow to 1.
    await expect(
      resultRow.getByRole('button', { name: /^Requested$/ }),
    ).toBeVisible();
    await expect(page.getByText(/Your circle · 1/)).not.toBeVisible();

    // Tap again withdraws the request → back to Follow.
    await resultRow.getByRole('button', { name: /^Requested$/ }).click();
    await expect(
      resultRow.getByRole('button', { name: /^Follow$/ }),
    ).toBeVisible();
  });

  test('outgoing request survives reload via get_outgoing_requests', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [],
      outgoingRequests: [AVA],
    });
    await page.goto('/friends');

    // The pending target renders under Your circle with a Requested button
    // (withdrawable), not as a follower row.
    await expect(page.getByText('@ava_p').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Requested$/ }).first(),
    ).toBeVisible();
    await expect(page.getByText(/Your circle · 1/)).not.toBeVisible();
  });

  test('the Requests inbox renders and accept/decline clear their rows', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [],
      incomingRequests: [
        {
          id: REQUESTER_ID,
          handle: 'sam_j',
          display_name: 'Sam J.',
          requested_at: '2026-07-25T01:00:00.000Z',
        },
        {
          id: PRIVATE_ID,
          handle: 'ava_p',
          display_name: 'Ava P.',
          requested_at: '2026-07-25T02:00:00.000Z',
        },
      ],
      acceptResult: true,
      declineResult: true,
    });
    await page.goto('/friends');

    await expect(page.getByText(/Requests · 2/)).toBeVisible();
    await expect(page.getByText(/wants to follow you/).first()).toBeVisible();

    // Accept Sam — the row leaves the inbox.
    const samRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@sam_j' })
      .first();
    await samRow.getByRole('button', { name: /^Accept$/ }).click();
    await expect(page.getByText('@sam_j')).not.toBeVisible();
    await expect(page.getByText(/Requests · 1/)).toBeVisible();

    // Decline Ava — the whole section disappears with the last row.
    const avaRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@ava_p' })
      .first();
    await avaRow
      .getByRole('button', { name: /decline follow request/i })
      .click();
    await expect(page.getByText(/Requests ·/)).not.toBeVisible();
  });

  test('an empty inbox renders no Requests section (public users see nothing new)', async ({
    page,
  }) => {
    await stubSupabase(page, { following: [], incomingRequests: [] });
    await page.goto('/friends');

    await expect(page.getByText(/no one in your circle yet/i)).toBeVisible();
    await expect(page.getByText(/Requests ·/)).not.toBeVisible();
  });
});

test.describe('/settings — privacy toggle (B3b)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
  });

  test('renders the real is_private value and flips it via the profiles update', async ({
    page,
  }) => {
    await stubSupabase(page, {
      ownProfile: { handle: 'connor_f', display_name: null, is_private: false },
    });
    await page.goto('/settings');

    const toggle = page.getByRole('switch', { name: /private account/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText(/anyone can follow you/i)).toBeVisible();

    const patch = page.waitForRequest(
      (req) =>
        req.url().includes('/rest/v1/profiles') && req.method() === 'PATCH',
    );
    await toggle.click();
    const req = await patch;

    // Payload is ONLY is_private (0006 column grant) and the switch settles.
    expect(req.postDataJSON()).toEqual({ is_private: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(
      page.getByText(/new followers must send a request/i),
    ).toBeVisible();
  });
});


test.describe('/friends — friends list (B3c)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
  });

  const SAM = { id: REQUESTER_ID, handle: 'sam_j', display_name: 'Sam J.' };

  test('mutuals show as Friends; a follower you do not follow gets a Follow back button', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [AVA],
      followers: [AVA, SAM],
    });
    await page.goto('/friends');

    // Ava is mutual → Friends section.
    await expect(page.getByText(/Friends · 1/)).toBeVisible();
    // Sam follows you but you don't follow back → Followers section with CTA.
    await expect(page.getByText(/Followers · 2/)).toBeVisible();
    const samRow = page
      .locator('.bg-surface')
      .filter({ hasText: 'follows you' })
      .filter({ hasText: '@sam_j' })
      .first();
    await expect(samRow).toBeVisible();
    await expect(
      samRow.getByRole('button', { name: /follow back/i }),
    ).toBeVisible();
  });

  test('follow back creates the edge and the follower becomes a Friend', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [],
      followers: [SAM],
      profileByHandle: [SAM],
      followResult: 'followed',
    });
    await page.goto('/friends');

    const samRow = page
      .locator('.bg-surface')
      .filter({ hasText: 'follows you' })
      .first();
    await samRow.getByRole('button', { name: /follow back/i }).click();

    // Mutual now → Friends section counts them.
    await expect(page.getByText(/Friends · 1/)).toBeVisible();
  });

  test('pending incoming requests badge the Friends tab in the nav', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [],
      incomingRequests: [
        {
          id: REQUESTER_ID,
          handle: 'sam_j',
          display_name: 'Sam J.',
          requested_at: '2026-07-25T01:00:00.000Z',
        },
      ],
    });
    await page.goto('/rankings');

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByLabel(/1 pending follow request/)).toBeVisible();
  });

  test('public profile shows the follower count; hidden profiles show nothing', async ({
    page,
  }) => {
    await stubSupabase(page, {
      profileByHandle: [SAM],
      followerCount: 12,
    });
    await page.goto('/u/sam_j');
    await expect(page.getByText(/12 followers/)).toBeVisible();
  });
});
