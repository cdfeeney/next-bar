/**
 * follow-requests.spec.ts
 *
 * B3b follow requests + privacy toggle — signed-in /friends and
 * /settings/preferences
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
import { test, expect, type Page, type Route } from './helpers/test';

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
  /** Own profile row for /settings/preferences (select on profiles). */
  ownProfile?: {
    handle: string | null;
    display_name: string | null;
    is_private: boolean;
  };
  /** B3c: get_followers rows. */
  followers?: ProfileRow[];
  /** B3c: get_follower_count result (null = hidden). */
  followerCount?: number | null;
  /** unfollow_user result (default true). */
  unfollowResult?: boolean;
};

/**
 * Stub every Supabase surface the B3b pages touch when signed in.
 * Playwright checks routes newest-first, so the broad rest catch-all goes
 * FIRST and the specific endpoints override it.
 */
async function stubSupabase(page: Page, opts: StubOptions): Promise<void> {
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));

  // STATEFUL following, for the same reason the outgoing list is: after a
  // follow-back useFollows revalidates, so a 'followed' write must be reflected
  // by the next get_following or the person vanishes from the Following list
  // the moment the hook re-reads (S-09 cross-list consistency).
  let following: ProfileRow[] = [...(opts.following ?? [])];
  await page.route('**/rest/v1/rpc/get_following**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(following),
    });
  });
  await page.route(
    '**/rest/v1/rpc/search_handles**',
    fulfillJson(200, opts.searchResults ?? []),
  );
  await page.route(
    '**/rest/v1/rpc/get_profile_by_handle**',
    fulfillJson(200, opts.profileByHandle ?? []),
  );
  // STATEFUL outgoing list, for the same reason the inbox below is stateful:
  // useFollows revalidates after a write, so a `requested` outcome is followed
  // by a real get_outgoing_requests fetch. A static empty stub answers that
  // fetch with "you requested nobody" and wipes the state the write just
  // created — the server forgetting its own write, which no server does.
  let outgoing: ProfileRow[] = [...(opts.outgoingRequests ?? [])];
  await page.route('**/rest/v1/rpc/follow_user**', async (route) => {
    const result = opts.followResult ?? 'followed';
    if (result === 'requested') {
      const filed = (opts.profileByHandle ?? [])[0];
      if (filed && !outgoing.some((p) => p.id === filed.id)) outgoing = [...outgoing, filed];
    }
    if (result === 'followed') {
      const filed = (opts.profileByHandle ?? [])[0];
      if (filed && !following.some((p) => p.id === filed.id)) following = [...following, filed];
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    });
  });
  // Unfollow removes the edge from the stateful following list (default success).
  await page.route('**/rest/v1/rpc/unfollow_user**', async (route) => {
    const ok = opts.unfollowResult ?? true;
    if (ok) {
      const body = route.request().postDataJSON() as { target?: string };
      following = following.filter((p) => p.id !== body?.target);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ok),
    });
  });
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
  await page.route('**/rest/v1/rpc/get_outgoing_requests**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(outgoing),
    });
  });
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
  await page.route('**/rest/v1/rpc/cancel_follow_request**', async (route) => {
    const result = opts.cancelResult ?? true;
    // A withdrawn request is gone from the next fetch too, or the revalidation
    // puts the row straight back into "Requested".
    if (result) {
      const body = route.request().postDataJSON() as { target?: string };
      outgoing = outgoing.filter((p) => p.id !== body?.target);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    });
  });
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
    await page.goto('/friends/people');

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
    // Following stat must NOT grow (pending is not a follow, UX-A).
    await expect(
      resultRow.getByRole('button', { name: /^Requested$/ }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /0\s+Following/i })).toBeVisible();

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
    // UX-A: pending targets live on the Following LIST page as
    // withdrawable Requested rows; the /friends stat stays at 0.
    await page.goto('/friends/people');
    await expect(page.getByRole('link', { name: /0\s+Following/i })).toBeVisible();

    await page.goto('/friends/following');
    await expect(page.getByText('@ava_p').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Requested$/ }).first(),
    ).toBeVisible();
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
    await page.goto('/friends/people');

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
    await page.goto('/friends/people');

    await expect(page.getByRole('link', { name: /0\s+Following/i })).toBeVisible();
    await expect(page.getByText(/Requests ·/)).not.toBeVisible();
  });
});

test.describe('/settings/preferences — privacy toggle (B3b)', () => {
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
    // WP8 moved the switch out of the old Settings page and into the
    // Privacy & sharing group of the Settings stack at /settings/preferences.
    await page.goto('/settings/preferences');

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
    // UX-A: the stats carry the counts; the followers LIST carries the rows.
    await page.goto('/friends/people');
    await expect(page.getByRole('link', { name: /2\s+Followers/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /1\s+Following/i })).toBeVisible();

    await page.goto('/friends/followers');
    // Ava is mutual → her row reads Following (quiet); Sam gets the accent CTA.
    const avaRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@ava_p' })
      .first();
    await expect(
      avaRow.getByRole('button', { name: /^Following$/ }),
    ).toBeVisible();
    const samRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@sam_j' })
      .first();
    await expect(
      samRow.getByRole('button', { name: /follow back/i }),
    ).toBeVisible();
  });

  test('follow back creates the edge and the row settles into Following', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [],
      followers: [SAM],
      profileByHandle: [SAM],
      followResult: 'followed',
    });
    await page.goto('/friends/followers');

    const samRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@sam_j' })
      .first();
    await samRow.getByRole('button', { name: /follow back/i }).click();

    // Mutual now — the same row flips to the quiet Following state.
    await expect(
      samRow.getByRole('button', { name: /^Following$/ }),
    ).toBeVisible();
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

/**
 * V8-1 criteria 11 + 19 — the signed-in half of the approved Social surface
 * (`docs/design-reference/approved/next-bar-social-v2-core.png`), against the
 * same stubbed graph as the blocks above. Two round-1 findings are pinned
 * here so they cannot drift back: the sub-44px search rows, and the suggest
 * dialog's overlay contract.
 */
test.describe('/friends — the approved Social surface, signed in', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
  });

  const SAM: ProfileRow = {
    id: REQUESTER_ID,
    handle: 'sam_j',
    display_name: 'Sam J.',
  };

  async function stubRpc(
    page: Page,
    fn: string,
    rows: ReadonlyArray<Record<string, unknown>>,
  ): Promise<void> {
    // Registered AFTER stubSupabase so it wins the catch-all.
    await page.route(`**/rest/v1/rpc/${fn}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rows),
      }),
    );
  }

  test('Out tonight leads with the bar, names who, and spells the state out', async ({
    page,
  }) => {
    await stubSupabase(page, { following: [SAM] });
    // `get_circle_presence`, not `get_circle_suggestions`: the WP1 merge
    // (7c6b085) settled that Social → Tonight reads presence. Suggestions kept
    // its own source, and the test below still uses it on the board that reads
    // it.
    await stubRpc(page, 'get_circle_presence', [
      {
        user_id: REQUESTER_ID,
        handle: 'sam_j',
        display_name: 'Sam J.',
        status: 'going',
        bar_id: 'attaboy',
        updated_at: '2026-08-24T02:00:00Z',
      },
    ]);
    await page.goto('/friends');

    const tonight = page.getByTestId('social-tonight');
    const row = tonight.getByRole('listitem').filter({ hasText: 'Sam J.' });
    await expect(row).toHaveCount(1);
    // Bar first, then the person — presence describes a place someone backed,
    // never a person tagged with a venue they did not claim.
    await expect(row.getByText('Attaboy')).toBeVisible();
    // Never state by color alone — the state is also a word, in the contract's
    // own label (README §1.6 / S-05: "Sam J. · Going out").
    await expect(row.getByText(/Sam J\. · Going out/)).toBeVisible();
  });

  test('the bar picker opens, Escape closes it, focus comes back', async ({
    page,
  }) => {
    await stubSupabase(page, { following: [SAM] });
    await stubRpc(page, 'get_circle_suggestions', []);
    // The dialog's opener moved with its owner. `Pin my spot` was the accent
    // CTA on the suggestions-backed Tonight strip the WP1 merge retired;
    // SuggestBarDialog itself survived, and its one remaining opener is
    // `+ Find a bar` on the People's Choice board. Kept rather than deleted
    // because this is the only test that covers the overlay focus contract —
    // focus enters the dialog and comes back on close.
    await page.goto('/friends/consensus');

    const pin = page.getByRole('button', { name: /^\+ Find a bar$/ });
    // KEYBOARD, not a tap. WebKit does not focus a button on touch, so a
    // tap-opened dialog has nothing to restore focus TO — measured here on
    // iPhone 13, and already the settled position for the sibling overlays
    // (see native-shell-contract.spec.ts's lightbox focus-restore test).
    // Focus restoration is a keyboard contract.
    await pin.press('Enter');

    const dialog = page.getByRole('dialog', { name: /Suggest a bar/i });
    await expect(dialog).toBeVisible();

    /**
     * `document.activeElement`, not `toBeFocused`. The matcher additionally
     * requires the DOCUMENT to be the active one, and under a headless
     * three-worker gate it reports `inactive` for an element that genuinely
     * IS `activeElement` — the artifact CLAUDE.md records against
     * native-shell-contract.spec.ts's lightbox focus-restore assertion.
     * Reading activeElement directly asserts the contract this test is about
     * (focus enters the dialog, and comes back on close) without depending on
     * which window the OS decided to activate.
     */
    const activeLabel = (): Promise<string | null> =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? null;
      });

    // Focus must ENTER the dialog, or a keyboard user is parked behind an
    // aria-modal overlay with no way out.
    await expect.poll(activeLabel).toBe('Close');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect.poll(activeLabel).toBe('+ Find a bar');
  });

  test('signed-in search rows clear the 44px target floor', async ({ page }) => {
    await stubSupabase(page, {
      following: [],
      searchResults: [{ handle: 'sam_j', display_name: 'Sam J.' }],
      profileByHandle: [SAM],
    });
    await page.goto('/friends/people');

    const search = page.getByPlaceholder(/search @username/i);
    await search.click();
    await search.pressSequentially('sam');

    const profileLink = page.getByRole('link', { name: /Sam J\./ });
    await expect(profileLink).toBeVisible();
    const box = await profileLink.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('a pending request is counted on the Groups & people control', async ({
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
    await page.goto('/friends');

    // S-01 (2026-09-13): the control is the header's people icon; its badge
    // is the pending-request count (README §1.1).
    const control = page.getByRole('link', { name: /groups and people/i });
    await expect(control).toBeVisible();
    await expect(page.getByTestId('social-people-badge')).toHaveText(/^1/);
    // Consent is one tap away and first on the pushed screen.
    await control.click();
    await expect(page).toHaveURL(/\/friends\/people$/);
    await expect(page.getByText(/Requests · 1/)).toBeVisible();
  });
});

const S09_A: ProfileRow = { id: '10000000-0000-4000-8000-000000000001', handle: 'mara', display_name: 'Mara' };
const S09_B: ProfileRow = { id: '10000000-0000-4000-8000-000000000002', handle: 'devon', display_name: 'Devon' };
const S09_FOLLOWER: ProfileRow = { id: '10000000-0000-4000-8000-000000000003', handle: 'priya', display_name: 'Priya' };

test.describe('S-09 — Followers and Following lists', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(SUPABASE_URL === null, 'NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
    await signIn(page);
  });

  test('AC1: the tiles carry the live counts and each navigates to its list', async ({ page }) => {
    await stubSupabase(page, { following: [S09_A, S09_B], followers: [S09_FOLLOWER] });
    await page.goto('/friends/people');
    await expect(page.getByRole('link', { name: /2\s+Following/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /1\s+Followers/i })).toBeVisible();

    await page.getByRole('link', { name: /1\s+Followers/i }).click();
    await expect(page).toHaveURL(/\/friends\/followers$/);
    await expect(page.getByTestId('followers-list').locator('> *')).toHaveCount(1);

    await page.goto('/friends/people');
    await page.getByRole('link', { name: /2\s+Following/i }).click();
    await expect(page).toHaveURL(/\/friends\/following$/);
    await expect(page.getByTestId('following-list').locator('> *')).toHaveCount(2);
  });

  test('AC2: a follower you do not follow shows "Follow back"; tapping it follows, and the Following list agrees', async ({ page }) => {
    await stubSupabase(page, {
      following: [],
      followers: [S09_FOLLOWER],
      profileByHandle: [S09_FOLLOWER],
      followResult: 'followed',
    });
    await page.goto('/friends/followers');
    const row = page.getByTestId('followers-list').locator('> *').filter({ hasText: '@priya' });
    await expect(row.getByRole('button', { name: /^Follow back$/ })).toBeVisible();
    // Wait for the WRITE itself to land, not just the optimistic pill: the pill
    // flips to "Following" the instant it is tapped, and navigating before the
    // request settles would abort it, so the stub never records the follow.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rpc/follow_user')),
      row.getByRole('button', { name: /^Follow back$/ }).click(),
    ]);
    // Optimistic + confirmed: the pill settles on the quiet Following state.
    await expect(row.getByRole('button', { name: /^Following$/ })).toBeVisible();

    // The same person now appears on the Following list (the write reached get_following).
    await page.goto('/friends/following');
    await expect(
      page.getByTestId('following-list').locator('> *').filter({ hasText: '@priya' }),
    ).toHaveCount(1);
  });

  test('AC3: a refused follow-back restores the pill AND surfaces the refusal', async ({ page }) => {
    await stubSupabase(page, {
      following: [],
      followers: [S09_FOLLOWER],
      profileByHandle: [S09_FOLLOWER],
      followResult: 'rejected',
    });
    await page.goto('/friends/followers');
    const row = page.getByTestId('followers-list').locator('> *').filter({ hasText: '@priya' });
    await row.getByRole('button', { name: /^Follow back$/ }).click();
    // The server said no: the pill goes back to Follow back, and a notice says so.
    await expect(page.getByTestId('follow-notice')).toBeVisible();
    await expect(row.getByRole('button', { name: /^Follow back$/ })).toBeVisible();
    await expect(row.getByRole('button', { name: /^Following$/ })).toHaveCount(0);
  });

  test('AC4: zero followers renders the consequence copy and the invite link, not a bare "No followers"', async ({ page }) => {
    await stubSupabase(page, { following: [], followers: [] });
    await page.goto('/friends/followers');
    const empty = page.getByTestId('followers-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/pins and stories/i);
    // The Find-friends control lives on /friends/people, not the /friends hub.
    await expect(empty.getByRole('link', { name: /Find friends/i })).toHaveAttribute('href', '/friends/people');
    await expect(page.getByTestId('followers-error')).toHaveCount(0);
  });

  test('AC1 + tile/rows agree with an outgoing request: the Following count is the follow rows; requests sit apart', async ({ page }) => {
    // The tile counts follows only (Instagram semantics); the request is a
    // separate withdrawable state, so tile count === following-list rows and the
    // request is under its own heading (round-1: tile-vs-rows must not disagree).
    await stubSupabase(page, {
      following: [S09_A],
      followers: [],
      outgoingRequests: [S09_B],
    });
    await page.goto('/friends/people');
    await expect(page.getByRole('link', { name: /1\s+Following/i })).toBeVisible();
    await page.getByRole('link', { name: /1\s+Following/i }).click();
    await expect(page).toHaveURL(/\/friends\/following$/);
    // One FOLLOW row (matches the tile's 1), and the request is elsewhere.
    await expect(page.getByTestId('following-list').locator('> *')).toHaveCount(1);
    await expect(page.getByTestId('following-requested').locator('> *')).toHaveCount(1);
  });

  test('the G-01 shape does not recur: a failed outgoing-requests read shows the failure state, not "not following anyone"', async ({ page }) => {
    await stubSupabase(page, { following: [], followers: [] });
    // following + followers succeed empty, but the outgoing read fails: the page
    // must show the failure state, never the empty consequence copy.
    await page.route('**/rest/v1/rpc/get_outgoing_requests**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) }),
    );
    await page.goto('/friends/following');
    await expect(page.getByTestId('following-error')).toBeVisible();
    await expect(page.getByTestId('following-empty')).toHaveCount(0);
  });

  test('AC5: a failed read shows the failure copy + retry, distinct from empty, and the retry recovers', async ({ page }) => {
    await stubSupabase(page, { following: [], followers: [S09_FOLLOWER] });
    // Fail the following read once, then let the retry succeed.
    let calls = 0;
    await page.route('**/rest/v1/rpc/get_following**', async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([S09_A]) });
    });
    await page.goto('/friends/following');
    const error = page.getByTestId('following-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/Couldn.t load who you follow/i);
    await expect(page.getByTestId('following-empty')).toHaveCount(0);

    await error.getByRole('button', { name: /Try again/i }).click();
    await expect(page.getByTestId('following-list').locator('> *')).toHaveCount(1);
    await expect(page.getByTestId('following-error')).toHaveCount(0);
  });
});
