import { expect, test, type Page, type Route } from './helpers/test';
import { assertNoUnexpectedRest, stubStrictRest } from './helpers/strictRest';
import { CATALOG_ROUTE, fulfillCatalog } from './helpers/catalogTest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// Shared with src/lib/authenticatedE2eConfig.test.ts, which is what puts this
// guard inside the DEFAULT gate — vitest never loads this spec (round 2, Codex).
import {
  assertAuthenticatedE2eConfigured,
  authenticatedE2eSkipAllowed,
  resolveSupabaseUrl,
} from '../src/lib/authenticatedE2eConfig';

/**
 * night-out.spec.ts — the V8-3 canonical Night Out surface.
 *
 * Supabase RPCs are STUBBED at the browser boundary (page.route on
 * /rest/v1/rpc/*) — no request reaches a live database (the 0044 migration
 * is applied to staging). Auth uses the fake-session-cookie pattern from
 * account-delete.spec.ts. What this proves end-to-end:
 *
 *   1. anon + dead link  → terminal "isn't here" state (smoke for the route)
 *   2. anon + live link  → bearer PREVIEW only, and the sign-in CTA stores
 *                          the invite context (criterion 7, first half)
 *   3. signed-in         → join-by-token fires, the member board renders,
 *                          and "Not tonight" issues respond(accept=false)
 *   4. signed-in + stored context, landing ANYWHERE → redirected to that
 *                          exact plan (criterion 7, second half)
 */

test.afterEach(async ({ page }) => {
  assertNoUnexpectedRest(page);
});

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';
const PLAN_ID = '223e4567-e89b-42d3-a456-426614174000';
/**
 * The plan reads a member view may issue. Anything else under the get_night_out
 * prefix is NOT answered here: it falls back to the strict recorder and fails the
 * test as an unexpected request (cycle-2 panel: the broad glob used to answer
 * unknown suffixes with a plan row).
 */
const PLAN_READ_RE = /\/rpc\/get_night_out(?:_(?:members|board|voting|anon_rsvps|media))?(?:\?|$)/;
const USER_ID = '323e4567-e89b-42d3-a456-426614174000';
const PENDING_KEY = 'next-bar:pending-invite:v1';

/**
 * Read the Supabase URL from the process environment FIRST, then .env.local.
 *
 * Cold panel (Codex): this only ever read .env.local, so a CI or shell that
 * supplies NEXT_PUBLIC_SUPABASE_URL through the environment — the normal way to
 * configure a runner — got null, and every authenticated test below called
 * test.skip. The suite reported green while asserting nothing about the signed-in
 * lifecycle. Same fail-open species as the CI=1 skip in the live RLS suite.
 */
function readEnvFile(): string | null {
  try {
    return readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  } catch {
    return null;
  }
}

const SUPABASE_URL = resolveSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  readEnvFile(),
);

/**
 * Reading the environment fixed HOW the URL is found; it did not stop the suite
 * skipping when it is absent (fix round 1, Codex). Eight `test.skip` calls below
 * still turn a missing URL into a green run that asserts nothing about the
 * signed-in lifecycle — criterion 5 is "run or fail loudly", and a config-shaped
 * silence is the failure mode it names.
 *
 * Same shape and same acknowledgement flag as the live RLS suite: a CI runner
 * legitimately has no credentials, anywhere else a missing URL means the
 * authenticated coverage did NOT run and must say so.
 */
assertAuthenticatedE2eConfigured(
  SUPABASE_URL,
  authenticatedE2eSkipAllowed(process.env),
  'night-out.spec.ts',
);

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

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
      email: 'e2e@example.com',
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

const PREVIEW_ROW = {
  night: '2026-08-20',
  title: 'Birthday crawl',
  status: 'open',
  owner_handle: 'conor',
  owner_display_name: 'Conor',
  accepted_count: 3,
};

const PLAN_ROW = {
  id: PLAN_ID,
  night: '2026-08-20',
  title: 'Birthday crawl',
  status: 'open',
  decided_bar_id: null,
  owner_handle: 'conor',
  owner_display_name: 'Conor',
  share_token: TOKEN,
  caller_role: 'member',
  caller_status: 'accepted',
  // 0059 added the caller's response revision to get_night_out, and
  // respond_night_out will not take a response without it. A fixture missing it
  // makes the decline below unsendable rather than merely untyped.
  caller_revision: 0,
};

/**
 * A night in the future, computed at run time so a fixed fixture date cannot
 * rot into the past between the day these are written and the day they run.
 *
 * NOTE, ROUND 2: this used to be the whole window fixture, because the client
 * computed the window from the night key. It no longer does — the server owns
 * that answer through `night_out_media_window`, and the tests stub it directly
 * (see `stubMedia`). This still exists so the plan row is coherent with the
 * window being stubbed alongside it.
 */
function openWindowNight(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return tomorrow.toISOString().slice(0, 10);
}

/** Long past — the other half of the pair. */
const CLOSED_WINDOW_NIGHT = '2020-01-01';

/**
 * The BEARER surface's reads (0068 section 8b) — the plan as a token-scoped
 * recipient without an account is allowed to see it.
 *
 * `starts_at` is stubbed as the server would answer it: the plan's scheduled
 * start, 9:00 PM America/New_York on its night (01:00Z the next day, in EDT).
 * The client renders that instant and computes no hour of its own, which is why
 * the assertion can be on a fixed "9:00 PM".
 */
async function stubNightOutRest(page: Page): Promise<void> {
  await stubStrictRest(page);
  // Root-layout reads: a curated catalog and an account with no profile yet.
  await page.route(CATALOG_ROUTE, fulfillCatalog);
  await page.route('**/rest/v1/profiles?*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await fulfillJson(200, [])(route);
  });
  // App-shell reads that every signed-in page issues regardless of route: the
  // follow-request inbox badge and the server ratings sync. The old blanket
  // `[]` answered these silently; the strict fixture surfaced them (36 tests,
  // 2026-09-09). Shell traffic, not Night Out behaviour — an empty inbox and
  // an empty ratings set are the honest fixtures, registered ONCE here so every
  // site that used to carry a catch-all gets them.
  await page.route('**/rest/v1/rpc/get_follow_requests*', fulfillJson(200, []));
  await page.route('**/rest/v1/ratings?*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await fulfillJson(200, [])(route);
  });
}

/**
 * The Social page (/friends) loads its whole shell on entry: circle lists,
 * groups, stories, unread counts, invitation notifications, friend ratings and
 * presence. Tests that walk through Social to reach Tonight or the Start form
 * used to get all of these answered by the blanket `[]`; under the strict
 * fixture each is named here, empty, so a test that cares about one of them
 * overrides it AFTER this call (last-registered wins).
 */
async function stubSocialShellRest(page: Page): Promise<void> {
  for (const rpc of [
    'get_following',
    'get_followers',
    'get_outgoing_requests',
    'group_unread_counts',
    'get_my_night_out_invitation_notifications',
    'get_friend_ratings',
    'get_circle_presence',
    'get_my_presence',
  ]) {
    await page.route(`**/rest/v1/rpc/${rpc}*`, fulfillJson(200, []));
  }
  for (const table of ['groups', 'stories']) {
    await page.route(`**/rest/v1/${table}?*`, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      await fulfillJson(200, [])(route);
    });
  }
}

async function stubBearerRpcs(page: Page): Promise<void> {
  // ORDER MATTERS TWICE OVER. Playwright matches routes last-registered-first,
  // and `preview_night_out*` is a prefix of all three bearer functions' names —
  // so the general patterns go FIRST and the specific ones after, or the 0044
  // preview's stub would answer `preview_night_out_shortlist` with a plan row.
  await stubNightOutRest(page);
  await page.route(
    '**/rest/v1/rpc/preview_night_out*',
    fulfillJson(200, [PREVIEW_ROW]),
  );
  await page.route(
    '**/rest/v1/rpc/preview_night_out_detail*',
    fulfillJson(200, [
      { starts_at: '2026-08-21T01:00:00.000Z', decided_bar_id: null },
    ]),
  );
  await page.route(
    '**/rest/v1/rpc/preview_night_out_attendees*',
    fulfillJson(200, [{ display_name: 'Sam', handle: 'sam' }]),
  );
  await page.route(
    '**/rest/v1/rpc/preview_night_out_shortlist*',
    fulfillJson(200, [{ bar_id: 'attaboy', votes: 1 }]),
  );
  await page.route(
    '**/rest/v1/rpc/get_anon_rsvp_by_token*',
    fulfillJson(200, null),
  );
}

async function stubMemberRpcs(page: Page, night?: string): Promise<void> {
  const planRow = night === undefined ? PLAN_ROW : { ...PLAN_ROW, night };
  // Playwright matches routes LAST-registered-first: the catch-all must be
  // registered BEFORE the specific RPC stubs or it shadows them.
  await stubNightOutRest(page);
  await page.route('**/rest/v1/rpc/night_out_media_window', fulfillJson(200, [{
    opens_at: '2026-08-21T01:00:00.000Z',
    expires_at: '2026-08-22T01:00:00.000Z',
    is_open: false,
    state: 'closed',
  }]));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route(
    '**/rest/v1/rpc/join_night_out_by_token*',
    async route => {
      expect(route.request().postDataJSON()).toEqual({ p_token: TOKEN });
      await fulfillJson(200, PLAN_ID)(route);
    },
  );
  // Viewing never mutates: existing members RESOLVE (read) to their plan.
  await page.route(
    '**/rest/v1/rpc/resolve_night_out_by_token*',
    async route => {
      expect(route.request().postDataJSON()).toEqual({ p_token: TOKEN });
      await fulfillJson(200, PLAN_ID)(route);
    },
  );
  await page.route('**/rest/v1/rpc/get_night_out*', (route) => {
    const url = route.request().url();
    if (!PLAN_READ_RE.test(url)) return route.fallback();
    // Every plan read names THIS plan; a fixture that answered any id would
    // keep an exact-plan regression green (V9-03).
    expect(route.request().postDataJSON()).toEqual(
      expect.objectContaining({ p_night_out: PLAN_ID }),
    );
    // Set-returning reads with their own row shapes: an empty set is the honest
    // default, never the plan row the bare `get_night_out` returns.
    // get_night_out_anon_rsvps is an ungrouped aggregate: exactly ONE row, zeros
    // when nothing was answered (0068:2268-2282). Never an empty set.
    if (url.includes('get_night_out_anon_rsvps')) {
      return fulfillJson(200, [{ going: 0, maybe: 0, declined: 0 }])(route);
    }
    if (/get_night_out_(voting|media)/.test(url)) {
      return fulfillJson(200, [])(route);
    }
    if (url.includes('get_night_out_members')) {
      return fulfillJson(200, [
        {
          user_id: USER_ID,
          handle: 'me',
          display_name: 'Me',
          role: 'member',
          invite_status: 'accepted',
        },
        {
          user_id: '423e4567-e89b-42d3-a456-426614174000',
          handle: 'conor',
          display_name: 'Conor',
          role: 'owner',
          invite_status: 'accepted',
        },
      ])(route);
    }
    if (url.includes('get_night_out_board')) {
      return fulfillJson(200, [
        {
          bar_id: 'attaboy',
          suggested_by_handle: 'conor',
          votes: 2,
          caller_voted: false,
        },
      ])(route);
    }
    return fulfillJson(200, [planRow])(route);
  });
}

/**
 * The same plan seen by its OWNER, with a two-bar shortlist so "the top bar" is
 * a real question. Bar B leads on votes and is deliberately returned SECOND, so
 * a board that renders in RPC order fails the ranking assertion.
 */
async function stubOwnerRpcs(page: Page): Promise<void> {
  await stubNightOutRest(page);
  await page.route('**/rest/v1/rpc/night_out_media_window', fulfillJson(200, [{
    opens_at: '2026-08-21T01:00:00.000Z',
    expires_at: '2026-08-22T01:00:00.000Z',
    is_open: false,
    state: 'closed',
  }]));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route(
    '**/rest/v1/rpc/resolve_night_out_by_token*',
    async route => {
      expect(route.request().postDataJSON()).toEqual({ p_token: TOKEN });
      await fulfillJson(200, PLAN_ID)(route);
    },
  );
  await page.route('**/rest/v1/rpc/get_night_out*', (route) => {
    const url = route.request().url();
    if (!PLAN_READ_RE.test(url)) return route.fallback();
    expect(route.request().postDataJSON()).toEqual(
      expect.objectContaining({ p_night_out: PLAN_ID }),
    );
    // Set-returning reads with their own row shapes: an empty set is the honest
    // default, never the plan row the bare `get_night_out` returns.
    // get_night_out_anon_rsvps is an ungrouped aggregate: exactly ONE row, zeros
    // when nothing was answered (0068:2268-2282). Never an empty set.
    if (url.includes('get_night_out_anon_rsvps')) {
      return fulfillJson(200, [{ going: 0, maybe: 0, declined: 0 }])(route);
    }
    if (/get_night_out_(voting|media)/.test(url)) {
      return fulfillJson(200, [])(route);
    }
    if (url.includes('get_night_out_members')) {
      return fulfillJson(200, [
        {
          user_id: USER_ID,
          handle: 'conor',
          display_name: 'Conor',
          role: 'owner',
          invite_status: 'accepted',
        },
      ])(route);
    }
    if (url.includes('get_night_out_board')) {
      return fulfillJson(200, [
        {
          bar_id: 'attaboy',
          suggested_by_handle: 'conor',
          votes: 1,
          caller_voted: false,
        },
        {
          bar_id: 'please-dont-tell',
          suggested_by_handle: 'sam',
          votes: 5,
          caller_voted: false,
        },
      ])(route);
    }
    return fulfillJson(200, [{ ...PLAN_ROW, caller_role: 'owner' }])(route);
  });
}

test.describe('/night-out/[token] — V8-3 canonical plan', () => {
  test('anon + dead link resolves to the terminal state and offers a way home', async ({
    page,
  }) => {
    await page.route(
      '**/rest/v1/rpc/preview_night_out*',
      fulfillJson(404, { message: 'not found' }),
    );
    const response = await page.goto(`/night-out/${TOKEN}`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: /this night out isn't here/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /find your next bar/i })).toBeVisible();
  });

  test('anon + live link shows the bearer plan, and the CTA stores the invite context', async ({
    page,
  }) => {
    await stubBearerRpcs(page);
    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByText(/you're invited/i)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /birthday crawl/i }),
    ).toBeVisible();
    await expect(page.getByText(/hosted by conor/i)).toBeVisible();

    // V8-R-INV-002: time, who is going, and the shortlist so far — the halves
    // that were absent until round 3.
    await expect(page.getByTestId('invite-when')).toContainText(/9:00\s*PM/i);
    await expect(page.getByTestId('invite-attendees')).toContainText('Sam');
    await expect(page.getByTestId('invite-shortlist')).toContainText(/1 vote/);

    // ...and the exclusions still hold. A bearer may not vote or suggest, so
    // there is no control for either — the negative assertion is the one that
    // catches a widened anon surface.
    await expect(page.getByRole('button', { name: /^vote$/i })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^suggest$/i }),
    ).toHaveCount(0);
    // The limitation is STATED, not discovered by failure (V8-R-INV-001/002
    // accessibility).
    await expect(page.getByTestId('invite-limitation')).toBeVisible();

    await page.getByTestId('invite-sign-in').click();
    await expect(page).toHaveURL(/\/auth/);
    const stored = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      PENDING_KEY,
    );
    expect(stored).toBe(TOKEN);
  });

  /**
   * V8-R-INV-001 / V8-R-INV-003 (D-C-23, D-C-22) — the requirement that was
   * inverted until round 3.
   *
   * The surface used to offer a signed-out recipient one button, "Sign in to
   * join". D-C-23 SUPERSEDES the frozen PRD sentence that pre-signup RSVP is not
   * authorized: the three choices are Going, Maybe and Can't make it, and a
   * token-scoped recipient may submit one WITHOUT an account.
   */
  test('anon can RSVP without signing up, and the optional upsell keeps the RSVP', async ({
    page,
  }) => {
    await stubBearerRpcs(page);
    const sent: Record<string, unknown>[] = [];
    await page.route('**/rest/v1/rpc/rsvp_night_out_by_token*', async (route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      expect(sent.at(-1)).toEqual({
        p_token: TOKEN, p_key: expect.any(String), p_response: 'maybe',
      });
      await fulfillJson(200, true)(route);
    });

    await page.goto(`/night-out/${TOKEN}`);
    // All three, in the contract's own words. "Not tonight" belongs to neither
    // RSVP nor presence and must not appear here (D-C-21, D-C-22).
    await expect(page.getByTestId('invite-rsvp-going')).toBeVisible();
    await expect(page.getByTestId('invite-rsvp-maybe')).toBeVisible();
    await expect(page.getByTestId('invite-rsvp-declined')).toContainText(
      /can't make it/i,
    );

    await page.getByTestId('invite-rsvp-maybe').click();
    await expect(page.getByTestId('invite-rsvp-sent')).toContainText(/maybe/i);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.p_response).toBe('maybe');
    // The key is the recipient's own capability, minted on the device.
    expect(typeof sent[0]?.p_key).toBe('string');

    // V8-R-INV-004: the upsell arrives AFTER the RSVP, is explicitly optional,
    // and dismissing it does not take the RSVP with it.
    const upsell = page.getByTestId('invite-upsell');
    await expect(upsell).toContainText(/rsvp'd either way/i);
    await page.getByTestId('invite-upsell-dismiss').click();
    await expect(page.getByTestId('invite-upsell')).toHaveCount(0);
    await expect(page.getByTestId('invite-rsvp-sent')).toContainText(/maybe/i);
    // Dismissing an upsell is not a navigation.
    await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}`));
  });

  /**
   * "A failed RSVP must be labelled as not yet sent" (V8-R-INV-003, failure
   * recovery). Showing the choice as taken would tell a recipient the host can
   * see an answer that never landed.
   *
   * ROUND-6 PANEL (Codex, MEDIUM): the label must not promise a retry either.
   * A refusal is the SERVER answering no — an expired link, a cancelled plan, a
   * plan whose link replies are at their cap — and every one of those is
   * durable, so "try again in a moment" was a retry that could never succeed.
   */
  test('a refused RSVP says so without promising a retry, and does not show as chosen', async ({
    page,
  }) => {
    await stubBearerRpcs(page);
    await page.route(
      '**/rest/v1/rpc/rsvp_night_out_by_token*',
      async route => {
        expect(route.request().postDataJSON()).toEqual({
          p_token: TOKEN, p_key: expect.any(String), p_response: 'going',
        });
        await fulfillJson(500, { message: 'boom' })(route);
      },
    );

    await page.goto(`/night-out/${TOKEN}`);
    await page.getByTestId('invite-rsvp-going').click();
    await expect(page.getByTestId('invite-rsvp-error')).toContainText(
      /let the host know/i,
    );
    await expect(page.getByTestId('invite-rsvp-error')).not.toContainText(
      /try again in a moment/i,
    );
    await expect(page.getByTestId('invite-rsvp-sent')).toHaveCount(0);
    await expect(page.getByTestId('invite-rsvp-going')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('signed-in: joins by token, renders the member board, and "Not tonight" issues the decline', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page);
    let declineCalled = false;
    await page.route('**/rest/v1/rpc/respond_night_out*', async (route) => {
      declineCalled = true;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      // All four params of the only overload the serving database has, carrying
      // the state this page RENDERED (0057 dropped the 2-argument form).
      expect(body).toEqual({
        p_night_out: PLAN_ID,
        p_accept: false,
        p_expected_status: 'accepted',
        p_expected_revision: 0,
      });
      await fulfillJson(200, true)(route);
    });

    await page.goto(`/night-out/${TOKEN}`);
    await expect(
      page.getByRole('heading', { name: /birthday crawl/i }),
    ).toBeVisible();
    await expect(page.getByText(/who's in/i)).toBeVisible();
    await expect(page.getByText('Conor', { exact: true })).toBeVisible();
    await expect(page.getByText(/2 votes/i)).toBeVisible();

    await page.getByRole('button', { name: /not tonight/i }).click();
    await expect
      .poll(() => declineCalled, { timeout: 5000 })
      .toBe(true);
  });

  /**
   * V8-R-SOC-007 — "Closes voting immediately, TAKES THE TOP BAR, and tells
   * everyone", one action with a fixed object.
   *
   * Until round 3 the owner got a "Pick this" on every row, calling
   * `decide_night_out` with that row's bar: an unranked board and an arbitrary
   * choice, which is a different requirement from the one the contract states.
   * The negative assertion is the point — a per-row decide control must not come
   * back, because it is how "the top bar" stops being the thing that gets taken.
   */
  test('the owner gets ONE "Lock the plan", not a Pick-this on every row', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubOwnerRpcs(page);
    let lockedWith: Record<string, unknown> | null = null;
    await page.route('**/rest/v1/rpc/lock_night_out*', async (route) => {
      lockedWith = route.request().postDataJSON() as Record<string, unknown>;
      expect(lockedWith).toEqual({ p_night_out: PLAN_ID });
      await fulfillJson(200, 'attaboy')(route);
    });

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('night-out-lock')).toBeVisible();
    await expect(page.getByRole('button', { name: /pick this/i })).toHaveCount(0);

    // THE BOARD IS RANKED, so the row on top is the one a lock takes.
    const rows = page.getByTestId('night-out-board').getByRole('listitem');
    await expect(rows.first()).toContainText(/5 votes/);

    await page.getByTestId('night-out-lock').click();
    await expect.poll(() => lockedWith, { timeout: 5000 }).not.toBeNull();
    // The bar is NOT a parameter: the server picks the leader inside the same
    // serialized section that takes it.
    expect(Object.keys(lockedWith ?? {})).toEqual(['p_night_out']);
  });

  /**
   * V8-R-SOC-008 — "The overflow renders only on a row the viewer may act on",
   * and the removal behind it is server-authorized.
   */
  test('the shortlist overflow removes an entry, and renders only where it may act', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubOwnerRpcs(page);
    let removedWith: Record<string, unknown> | null = null;
    await page.route(
      '**/rest/v1/rpc/remove_night_out_suggestion*',
      async (route) => {
        removedWith = route.request().postDataJSON() as Record<string, unknown>;
        await fulfillJson(200, true)(route);
      },
    );

    await page.goto(`/night-out/${TOKEN}`);
    // The owner may act on every row, so every row has one.
    const overflows = page.getByTestId('shortlist-overflow');
    await expect(overflows).toHaveCount(2);
    // 44px, as the requirement's accessibility clause states.
    const box = await overflows.first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The menu is not open until it is opened — "ownership and removal are
    // carried by the control and its menu".
    await expect(page.getByTestId('shortlist-remove')).toHaveCount(0);
    await overflows.first().click();
    await page.getByTestId('shortlist-remove').click();

    await expect.poll(() => removedWith, { timeout: 5000 }).not.toBeNull();
    // The FIRST row is the vote leader, because the board is ranked.
    expect(removedWith).toEqual({
      p_night_out: PLAN_ID,
      p_bar: 'please-dont-tell',
    });
  });

  test('a REFUSED response re-reads the plan before telling you to try again', async ({
    page,
    context,
    baseURL,
  }) => {
    // Round-2 review (Codex, medium). 0059's expected-status/revision guard
    // makes a rejection DETERMINISTIC: the view still holds the revision the
    // RPC just refused, so "try again" from the same render re-sends the same
    // rejected pair and fails identically, forever. Reproduced by declining the
    // plan in another tab first — the classic stale-tab case. The page must
    // re-read before advising a retry, or the advice can never succeed.
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page);

    let planReads = 0;
    await page.route('**/rest/v1/rpc/get_night_out*', (route) => {
      const url = route.request().url();
      if (!PLAN_READ_RE.test(url)) return route.fallback();
      // Every plan read names THIS plan, and set-returning reads get an empty set,
      // never the plan row (round-3 panel: the broad glob shadowed both checks).
      expect(route.request().postDataJSON()).toEqual(
        expect.objectContaining({ p_night_out: PLAN_ID }),
      );
      // get_night_out_anon_rsvps is an ungrouped aggregate: exactly ONE row, zeros
      // when nothing was answered (0068:2268-2282). Never an empty set.
      if (url.includes('get_night_out_anon_rsvps')) {
        return fulfillJson(200, [{ going: 0, maybe: 0, declined: 0 }])(route);
      }
      if (/get_night_out_(voting|media)/.test(url)) {
        return fulfillJson(200, [])(route);
      }
      if (url.includes('get_night_out_members')) return fulfillJson(200, [])(route);
      if (url.includes('get_night_out_board')) return fulfillJson(200, [])(route);
      planReads += 1;
      return fulfillJson(200, [PLAN_ROW])(route);
    });
    // The row moved on in the other tab, so this render's pair is stale.
    await page.route('**/rest/v1/rpc/respond_night_out*', async route => {
      expect(route.request().postDataJSON()).toEqual({
        p_night_out: PLAN_ID, p_accept: false,
        p_expected_status: 'accepted', p_expected_revision: 0,
      });
      await fulfillJson(200, false)(route);
    });

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByRole('heading', { name: /birthday crawl/i })).toBeVisible();
    await expect.poll(() => planReads, { timeout: 10_000 }).toBeGreaterThan(0);
    const readsBeforeTap = planReads;

    await page.getByRole('button', { name: /not tonight/i }).click();

    // The advice is only honest if the state behind it was refreshed.
    await expect(page.getByText(/didn't go through/i)).toBeVisible();
    expect(
      planReads,
      'the page advised a retry without re-reading the state the RPC just refused',
    ).toBeGreaterThan(readsBeforeTap);
  });

  test('signed-in non-member declines from the preview WITHOUT joining first', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    // Non-member: resolve finds nothing, so the page shows the bearer preview.
    await stubNightOutRest(page);
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    // After a successful decline the page deliberately loads the member view
    // (page.tsx loadMemberView): decline_night_out_by_token writes a member row
    // with invite_status 'declined' (0046), and get_night_out returns the plan
    // for ANY member row, declined included (0059). So the server's real answer
    // here is the plan with caller_status 'declined' and an empty board — and
    // the page must paint the declined state, not the expired-link error. The
    // old blanket `[]` made loadMemberView fail and hid that paint entirely.
    // The member view also mounts NightOutMedia, whose two reads are gated on
    // night_out_role() being non-null — and that is NULL for a declined member
    // (0044:203-210), so the server returns ZERO rows for both. Named as such.
    await page.route('**/rest/v1/rpc/night_out_media_window', fulfillJson(200, []));
    await page.route('**/rest/v1/rpc/get_night_out*', async (route) => {
      const url = route.request().url();
      if (!PLAN_READ_RE.test(url)) return route.fallback();
      expect(route.request().postDataJSON()).toEqual(
        expect.objectContaining({ p_night_out: PLAN_ID }),
      );
      if (url.includes('get_night_out_anon_rsvps')) {
        // One aggregate row, always (0068:2268-2282); zeros for a declined caller.
        return fulfillJson(200, [{ going: 0, maybe: 0, declined: 0 }])(route);
      }
      if (/get_night_out_(members|board|voting|media)/.test(url)) {
        return fulfillJson(200, [])(route);
      }
      // share_token is returned only to accepted members (0059:236); a declined
      // caller gets null.
      await fulfillJson(200, [{ ...PLAN_ROW, caller_status: 'declined', share_token: null }])(route);
    });
    await page.route(
      '**/rest/v1/rpc/resolve_night_out_by_token*',
      fulfillJson(200, null),
    );
    await page.route(
      '**/rest/v1/rpc/preview_night_out*',
      fulfillJson(200, [PREVIEW_ROW]),
    );
    let joinCalled = false;
    let declineCalled = false;
    await page.route('**/rest/v1/rpc/join_night_out_by_token*', async (route) => {
      joinCalled = true;
      expect(route.request().postDataJSON()).toEqual({ p_token: TOKEN });
      await fulfillJson(200, PLAN_ID)(route);
    });
    await page.route('**/rest/v1/rpc/decline_night_out_by_token*', async (route) => {
      declineCalled = true;
      // The decline names THIS invite; a fixture that accepted any token would
      // keep an exact-invite regression green.
      expect(route.request().postDataJSON()).toEqual({ p_token: TOKEN });
      await fulfillJson(200, PLAN_ID)(route);
    });

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByRole('button', { name: /join this night out/i })).toBeVisible();
    await page.getByRole('button', { name: /not tonight/i }).click();
    await expect.poll(() => declineCalled, { timeout: 5000 }).toBe(true);

    // The negative half, and the whole point of the round-2 finding: saying no
    // must NOT route through joining. Before the fix the only way to decline a
    // bearer link was to join first, which recorded an acceptance and emitted
    // an 'accepted' event the host could see.
    expect(joinCalled, 'declining a bearer link still joined first').toBe(false);
    // And the paint after a successful decline is the declined member state,
    // never the expired-link error that an empty get_night_out would produce.
    await expect(page.getByText(/You're out for this one/i)).toBeVisible();
    await expect(page.getByText(/Couldn't send that/i)).toHaveCount(0);
  });

  test('a decided plan closes voting and suggesting instead of failing on tap', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page);
    // Re-stub the plan as decided — the RPCs reject writes in this state.
    await page.route('**/rest/v1/rpc/get_night_out*', (route) => {
      const url = route.request().url();
      if (!PLAN_READ_RE.test(url)) return route.fallback();
      // Every plan read names THIS plan, and set-returning reads get an empty set,
      // never the plan row (round-3 panel: the broad glob shadowed both checks).
      expect(route.request().postDataJSON()).toEqual(
        expect.objectContaining({ p_night_out: PLAN_ID }),
      );
      // get_night_out_anon_rsvps is an ungrouped aggregate: exactly ONE row, zeros
      // when nothing was answered (0068:2268-2282). Never an empty set.
      if (url.includes('get_night_out_anon_rsvps')) {
        return fulfillJson(200, [{ going: 0, maybe: 0, declined: 0 }])(route);
      }
      if (/get_night_out_(voting|media)/.test(url)) {
        return fulfillJson(200, [])(route);
      }
      if (url.includes('get_night_out_members')) return fulfillJson(200, [])(route);
      if (url.includes('get_night_out_board')) {
        return fulfillJson(200, [
          { bar_id: 'attaboy', suggested_by_handle: 'conor', votes: 2, caller_voted: false },
        ])(route);
      }
      return fulfillJson(200, [
        { ...PLAN_ROW, status: 'decided', decided_bar_id: 'attaboy' },
      ])(route);
    });

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByText(/it's decided/i)).toBeVisible();
    // suggest_night_out_bar and vote_night_out_bar both require status in
    // ('draft','open'), so offering these controls only produced a generic
    // "that didn't go through" that reads as an app bug rather than a settled plan.
    await expect(page.getByRole('button', { name: /^vote$/i })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /suggest a bar/i })).toHaveCount(0);
    await expect(page.getByText(/suggestions are closed/i)).toBeVisible();
  });

  test('the plan page offers a way to share its own invite link', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page);
    // Deliberately NOT granting clipboard permissions: WebKit rejects the
    // 'clipboard-write' permission name outright, and both engines are in
    // scope. Skipping the grant also makes this exercise the real branch that
    // matters — where the clipboard is unavailable, the control must still
    // surface the link rather than fail silently. The assertion below accepts
    // either outcome, so it is honest on Chromium and WebKit alike.
    await page.goto(`/night-out/${TOKEN}`);
    // Creating a plan used to produce a link the app gave you no way to send:
    // the consensus page's "Invite friends" shares /join, not this plan.
    const share = page.getByRole('button', { name: /copy invite link/i });
    await expect(share).toBeVisible();
    await share.click();
    await expect(page.getByText(/invite link copied|\/night-out\//i).first()).toBeVisible();
  });

  /**
   * The pending-invite token must be spent once the page SETTLES — in ANY
   * terminal state, not just 'member'. Three rounds of review each fixed a
   * different approximation of that one invariant:
   *   r1 consumed in the redirect, r2 on mount, r3 on member-only.
   * The r3 form stranded a signed-in user who settled in 'preview' or 'gone':
   * PendingInviteRedirect replayed the navigation on every route change for the
   * rest of the session, and 'gone' had no in-app escape at all.
   *
   * Covering all three terminal states here is what stops a fourth variant.
   */
  for (const settled of ['member', 'preview', 'gone'] as const) {
    test(`the invite token is consumed when the page settles in '${settled}'`, async ({
      page,
      context,
      baseURL,
    }) => {
      test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
      await context.addCookies([
        { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
      ]);
      await stubNightOutRest(page);
      await page.route('**/auth/v1/**', fulfillJson(200, {}));

      if (settled === 'member') {
        await stubMemberRpcs(page);
      } else {
        // Not a member: resolve finds nothing. 'preview' still has a live
        // bearer row; 'gone' is a dead/cancelled link.
        await page.route('**/rest/v1/rpc/resolve_night_out_by_token*', fulfillJson(200, null));
        await page.route(
          '**/rest/v1/rpc/preview_night_out*',
          fulfillJson(200, settled === 'preview' ? [PREVIEW_ROW] : []),
        );
      }

      // Arrive WITH a pending token, exactly as the post-sign-in handoff does.
      await page.addInitScript(
        ([key, token]) => window.sessionStorage.setItem(key, token),
        [PENDING_KEY, TOKEN] as const,
      );
      await page.goto(`/night-out/${TOKEN}`);

      // Wait for the terminal state to actually render before asserting.
      if (settled === 'member') {
        await expect(page.getByRole('heading', { name: /birthday crawl/i })).toBeVisible();
      } else if (settled === 'preview') {
        await expect(page.getByRole('button', { name: /join this night out/i })).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { name: /isn't here/i })).toBeVisible();
      }

      await expect
        .poll(
          async () => page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_KEY),
          { timeout: 5000 },
        )
        .toBeNull();
    });
  }

  test("a dead link offers a real way out of the app's own invite page", async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubNightOutRest(page);
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    await page.route('**/rest/v1/rpc/resolve_night_out_by_token*', fulfillJson(200, null));
    await page.route('**/rest/v1/rpc/preview_night_out*', fulfillJson(200, []));
    await page.addInitScript(
      ([key, token]) => window.sessionStorage.setItem(key, token),
      [PENDING_KEY, TOKEN] as const,
    );

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByRole('heading', { name: /isn't here/i })).toBeVisible();

    // The escape must actually escape: with the token spent, following it must
    // NOT be replayed straight back to the invite page.
    await page.getByRole('link', { name: /back to your circle/i }).click();
    await expect(page).toHaveURL(/\/friends$/);
    await expect(page).not.toHaveURL(new RegExp(`/night-out/${TOKEN}`));
  });

  test('criterion 7: signed-in with stored invite context lands back on THAT plan from anywhere', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page);
    await page.addInitScript(
      ([key, token]) => window.sessionStorage.setItem(key, token),
      [PENDING_KEY, TOKEN] as const,
    );

    // Land on the DEFAULT post-auth page — not the plan.
    await page.goto('/rankings');
    // PendingInviteRedirect completes the handoff to the exact plan…
    await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}`));
    await expect(
      page.getByRole('heading', { name: /birthday crawl/i }),
    ).toBeVisible();
    // …and consumes the context so it cannot fire twice.
    const remaining = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      PENDING_KEY,
    );
    expect(remaining).toBeNull();
  });
});

/**
 * Social — the surface the Night Out is planned FROM (V8-R-NAV-002,
 * V8-R-SOC-001, V8-R-PRE-001..005, V8-R-OPS-005).
 *
 * /friends used to serve a Friends dashboard: a Plan Night Out card, an intent
 * strip and two follower statistics. It now serves Social with three sub-tabs —
 * Tonight, Plans, Feed — and Tonight is the landing surface.
 *
 * These run SIGNED OUT deliberately. Every assertion below is about the
 * surface's own structure and its honest empty states, which is exactly the
 * part that must hold with no session, no Supabase and no seeded circle. The
 * signed-in presence path is unit-covered in usePinnedHandles.test.ts, where
 * the three-state read can be driven directly.
 *
 * Both viewports, no viewport-specific selectors: everything here is by role or
 * by test id.
 */
test.describe('Social sub-tabs (V8-R-NAV-002)', () => {
  test('lands on Tonight with all three sub-tabs present', async ({ page }) => {
    await page.goto('/friends');

    // The surface names itself through the TABLIST, not a heading. This asked
    // for `heading "Social"` until the WP1 merge (7c6b085) settled which
    // /friends shell ships: the approved Social canvas heads the page with the
    // product name and labels the segmented control "Social". The requirement
    // (V8-R-NAV-002) is that this screen IS Social and carries three sub-tabs,
    // which the accessible name proves exactly as well — and unlike a heading,
    // it is the name assistive tech reads out for the control itself.
    await expect(page.getByRole('tablist', { name: 'Social' })).toBeVisible();
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.getByRole('tab', { name: 'Tonight' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The documented landing surface actually renders.
    await expect(page.getByTestId('social-tonight')).toBeVisible();
  });

  test('tapping a sub-tab swaps the content below it — and does NOT change the URL', async ({
    page,
  }) => {
    await page.goto('/friends');
    const urlBefore = page.url();

    await page.getByRole('tab', { name: 'Plans' }).click();
    await expect(page.getByTestId('start-night-out')).toBeVisible();
    // The swapped-out panel is genuinely gone, not merely hidden behind it.
    await expect(page.getByTestId('social-tonight')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Plans' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByRole('tab', { name: 'Feed' }).click();
    // `social-panel-feed`, not `feed-empty`. Signed out there is no story read
    // to be empty OF: the merged Feed renders `feed-empty` only once the story
    // status is `ready`, and offers the signed-out state until then. This test
    // is about the SWAP — the panel changed and the previous one is gone — so
    // it asserts the panel, and the empty-feed state is covered with a session
    // in story-rail.spec.ts.
    await expect(page.getByTestId('social-panel-feed')).toBeVisible();
    await expect(page.getByTestId('start-night-out')).toHaveCount(0);
    await expect(page.getByTestId('social-tonight')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Tonight' }).click();
    await expect(page.getByTestId('social-tonight')).toBeVisible();

    // The negative that defines a segmented control: three sub-tab taps put
    // nothing in the browser's history, because this is one screen.
    expect(page.url()).toBe(urlBefore);
  });

  test('Tonight signed out asks for a session, never claims nobody is out', async ({
    page,
  }) => {
    await page.goto('/friends');

    // This asserted `presence-empty` — "No friends out yet tonight" — at a
    // VISITOR, which is a claim about friends we never asked about. The hook's
    // own header already said so ("there is simply no circle to ask about")
    // while handing back the empty-circle value anyway; the surface now has a
    // fourth state and this is it. The genuinely-empty circle moved to
    // friends-real.spec.ts, where a stubbed session makes it a real read.
    const signedOut = page.getByTestId('presence-signed-out');
    await expect(signedOut).toBeVisible();
    // Scoped: the stories rail offers its OWN "Sign in" on this same panel, and
    // an unscoped role query matches both.
    await expect(signedOut.getByRole('link', { name: /^Sign in$/ })).toBeVisible();

    // The distinctions this surface must never blur: no session is not a failed
    // read, and it is not an empty circle either.
    await expect(page.getByTestId('presence-error')).toHaveCount(0);
    await expect(page.getByTestId('presence-empty')).toHaveCount(0);
    await expect(page.getByTestId('presence-list')).toHaveCount(0);
  });

  test('the legacy Friends dashboard is gone from Social', async ({ page }) => {
    await page.goto('/friends');

    // The affordances that MADE it the old dashboard, asserted absent so it
    // cannot quietly return: the old primary card and the "Friends" page
    // heading.
    await expect(
      page.getByRole('link', { name: /^Plan Night Out/i }),
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Friends$/ })).toHaveCount(0);

    // NOT follow-stats, and the change is a DECISION, not a relaxation. This
    // used to assert the two follower statistics absent as well, because on the
    // pre-merge /friends they were part of the dashboard being replaced. The
    // WP1 merge (7c6b085) re-homed them deliberately: they are now a section of
    // Groups & people INSIDE Tonight, reached by the header control, and
    // friends-flow.spec.ts asserts they are visible there. Keeping the old
    // negative would have made this suite and that one contradict each other on
    // the same branch. What the guard now protects is the dashboard's IDENTITY,
    // not every element that survived it.
    await page.getByRole('button', { name: /Groups & people/i }).click();
    await expect(page.getByTestId('follow-stats')).toBeVisible();
  });
});

test.describe('Social · Tonight — the pin sequence (V8-R-PRE-002, V8-R-PRE-003)', () => {
  /**
   * A signed-in Tonight with NO presence set — the exact state round 1 found
   * unreachable: choosing "Going out" could only ever send the bar the user
   * already had, and a new pinner had none, so V8-R-PRE-001 and V8-R-PRE-003
   * could not be satisfied at all.
   */
  async function stubTonight(page: Page, mine: unknown[]): Promise<void> {
    await stubNightOutRest(page);
    await stubSocialShellRest(page);
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    await page.route('**/rest/v1/rpc/get_circle_presence*', fulfillJson(200, []));
    await page.route('**/rest/v1/rpc/get_my_presence*', fulfillJson(200, mine));
  }

  test('a new pinner can reach the bar step, and the trust line is on it', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    // Status set, no bar — the state a first "Going out" tap produces.
    await stubTonight(page, [
      {
        status: 'going',
        bar_id: null,
        audience: 'friends',
        updated_at: '2026-08-20T02:00:00.000Z',
        recipient_ids: [],
      },
    ]);

    await page.goto('/friends');
    await expect(page.getByTestId('my-pin')).toContainText(/no bar pinned/i);

    // THE STEP THAT WAS MISSING.
    const pin = page.getByTestId('pin-my-spot');
    await expect(pin).toBeVisible();
    await pin.click();

    const dialog = page.getByTestId('pin-bar-dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: /where are you tonight/i }),
    ).toBeVisible();
    // One question, one field (V8-R-PRE-003).
    await expect(dialog.getByRole('textbox', { name: /search bars/i })).toBeVisible();
    // The trust line "stays in place throughout" (V8-R-PRE-001 accessibility).
    await expect(dialog.getByText(/never tracks you automatically/i)).toBeVisible();

    // Back returns to Tonight and takes nothing with it.
    await dialog.getByRole('button', { name: /^Back$/ }).click();
    await expect(page.getByTestId('pin-bar-dialog')).toHaveCount(0);
    await expect(page.getByTestId('social-tonight')).toBeVisible();
  });

  /**
   * V8-R-PRE-003 → V8-R-PRE-002, and the defect round 3 found (Codex gate,
   * HIGH): picking a bar used to WRITE it immediately, carrying whatever
   * audience was already there or the 'friends' default, and then close the
   * dialog. A first-time pinner's location went live to every follower before
   * anyone asked who should see it.
   *
   * "Tapping a result selects that bar and advances straight to the audience
   * step." Selecting is not publishing — and the assertion that matters is the
   * negative one: `set_night_presence` is not called until Pin it.
   */
  test('picking a bar advances to the audience step and writes NOTHING until it is confirmed', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubTonight(page, [
      {
        status: 'going',
        bar_id: null,
        audience: 'friends',
        updated_at: '2026-08-20T02:00:00.000Z',
        recipient_ids: [],
      },
    ]);
    let writes = 0;
    await page.route('**/rest/v1/rpc/set_night_presence*', async (route) => {
      writes += 1;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends');
    await page.getByTestId('pin-my-spot').click();
    const dialog = page.getByTestId('pin-bar-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: /search bars/i }).fill('att');
    await dialog.getByRole('button', { name: /attaboy/i }).first().click();

    // The dialog closes into the audience STEP, not into a written pin.
    await expect(page.getByTestId('pin-bar-dialog')).toHaveCount(0);
    const step = page.getByTestId('pin-audience-step');
    await expect(step).toBeVisible();
    await expect(step).toContainText(/who can see this/i);
    expect(writes, 'selecting a bar published the pin before it was confirmed').toBe(0);

    // Confirming is the ONE write, and it carries the chosen audience.
    await page.getByTestId('pin-pending-audience-close').click();
    await page.getByTestId('pin-confirm').click();
    await expect.poll(() => writes, { timeout: 5000 }).toBe(1);
  });

  /**
   * Cancelling the sequence takes the selection with it and still writes
   * nothing — the other half of "selecting is not publishing".
   */
  test('cancelling the audience step leaves no pin behind', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubTonight(page, [
      {
        status: 'going',
        bar_id: null,
        audience: 'friends',
        updated_at: '2026-08-20T02:00:00.000Z',
        recipient_ids: [],
      },
    ]);
    let writes = 0;
    await page.route('**/rest/v1/rpc/set_night_presence*', async (route) => {
      writes += 1;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends');
    await page.getByTestId('pin-my-spot').click();
    const dialog = page.getByTestId('pin-bar-dialog');
    await dialog.getByRole('textbox', { name: /search bars/i }).fill('att');
    await dialog.getByRole('button', { name: /attaboy/i }).first().click();
    await page.getByTestId('pin-cancel').click();

    await expect(page.getByTestId('pin-audience-step')).toHaveCount(0);
    await expect(page.getByTestId('social-tonight')).toBeVisible();
    expect(writes, 'cancelling the pin sequence still wrote a pin').toBe(0);
  });

  test('all three audience choices are offered, and "some people" opens a picker', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubTonight(page, [
      {
        status: 'going',
        bar_id: 'attaboy',
        audience: 'friends',
        updated_at: '2026-08-20T02:00:00.000Z',
        recipient_ids: [],
      },
    ]);

    await page.goto('/friends');
    const choices = page.getByRole('group', { name: /who can see my pin tonight/i });
    await expect(choices).toBeVisible();
    await expect(page.getByTestId('pin-audience-friends')).toBeVisible();
    await expect(page.getByTestId('pin-audience-close')).toBeVisible();
    await expect(page.getByTestId('pin-audience-people')).toBeVisible();

    // 'people' cannot be one tap: it needs a recipient list, and writing it
    // without one is refused server-side rather than falling back to a wider
    // audience. So the tap opens the picker instead of sending a request that
    // could only fail.
    await page.getByTestId('pin-audience-people').click();
    const picker = page.getByTestId('pin-audience-dialog');
    await expect(picker).toBeVisible();

    // FAILS CLOSED IN THE UI TOO: nothing selected, nothing to confirm.
    await expect(picker.getByTestId('pin-audience-confirm')).toBeDisabled();

    await picker.getByRole('button', { name: /^Back$/ }).click();
    await expect(page.getByTestId('pin-audience-dialog')).toHaveCount(0);
  });

  /**
   * THE ONE WHERE A FAILED READ USED TO CHANGE WHO CAN SEE YOU — round 2, both
   * gates, HIGH.
   *
   * `fetchMyPresence` returned the same `null` for "no pin tonight" and "the
   * read failed", so a transport error rendered the unset row. The next status
   * tap then wrote `audience: mine?.audience ?? 'friends'`, and
   * `set_night_presence` REPLACES the row and deletes its recipients wholesale
   * — turning a live 'close' or 'people' pin into one every follower can see,
   * on a tap the user made about something else entirely.
   *
   * The pills are disabled and the row says the read failed. The assertion that
   * actually protects the user is the negative one: `set_night_presence` is
   * never called.
   */
  test('a FAILED own-pin read disables the write instead of widening the audience', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubNightOutRest(page);
    await stubSocialShellRest(page);
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    await page.route('**/rest/v1/rpc/get_circle_presence*', fulfillJson(200, []));
    await page.route(
      '**/rest/v1/rpc/get_my_presence*',
      fulfillJson(500, { message: 'boom' }),
    );
    let wrote = false;
    await page.route('**/rest/v1/rpc/set_night_presence*', async (route) => {
      wrote = true;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends');
    // Says what happened, and does NOT render the unset row as if there were
    // no pin (V8-R-OPS-005).
    await expect(page.getByTestId('my-pin-error')).toBeVisible();
    await expect(page.getByTestId('my-pin')).toHaveCount(0);

    const going = page.getByRole('button', { name: /going out/i }).first();
    await expect(going).toBeDisabled();
    // Force the tap past the disabled attribute: the guard must hold in the
    // handler too, not only in the styling.
    await going.dispatchEvent('click');
    await expect(page.getByTestId('my-pin-error')).toBeVisible();
    expect(wrote).toBe(false);
  });
});

test.describe('Night Out media and Saved Nights Out (V8-R-NO-008/009, V8-R-ACC-002)', () => {
  const MEDIA_ID = '523e4567-e89b-42d3-a456-426614174000';
  const SAVED_ID = '623e4567-e89b-42d3-a456-426614174000';

  /** One live photo on the plan. */
  const MEDIA_ROW = {
    destination_id: '723e4567-e89b-42d3-a456-426614174000',
    media_id: MEDIA_ID,
    author_id: USER_ID,
    storage_path: `${USER_ID}/${MEDIA_ID}`,
    created_at: '2026-08-21T02:00:00.000Z',
    expires_at: '2026-08-21T08:00:00.000Z',
  };

  /** An instant safely inside the future, for the "still open" window stub. */
  function futureIso(hours: number): string {
    return new Date(Date.now() + hours * 3_600_000).toISOString();
  }

  /**
   * THE WINDOW IS A SERVER ANSWER NOW, so it is stubbed like any other RPC
   * rather than implied by the fixture's night key (round 2, both gates).
   *
   * `stubMemberRpcs` routes `get_night_out*`, which also matches
   * `get_night_out_media`, and its rest/v1 catch-all matches
   * `night_out_media_window`. Registering both stubs AFTER it wins, because
   * Playwright matches last-registered-first.
   *
   * `windowRows: 'fail'` is the third state the surface must keep separate:
   * a window we could not READ, which is neither open nor closed.
   *
   * ROUND 3 CHANGED THE ROW SHAPE, and these stubs have to change with it
   * (round-3 panel, Claude gate, HIGH). The window gained a lower bound, so
   * `night_out_media_window` now returns `opens_at` and a server-decided
   * `state` alongside the two old columns, and `fetchNightOutMediaWindow`
   * rejects any row missing either — a round-2 fixture parses as "could not
   * read", which is neither of the two states these tests assert. `windowRow`
   * below builds a complete row so no fixture can drift from the parser again.
   */
  function windowRow(
    state: 'before' | 'open' | 'closed',
    opensAt: string,
    expiresAt: string,
  ): Record<string, unknown> {
    return {
      opens_at: opensAt,
      expires_at: expiresAt,
      is_open: state === 'open',
      state,
    };
  }

  async function stubMedia(
    page: Page,
    rows: unknown[],
    windowRows: unknown[] | 'fail' = [
      windowRow('open', futureIso(-4), futureIso(20)),
    ],
  ): Promise<void> {
    await page.route(
      '**/rest/v1/rpc/night_out_media_window*',
      windowRows === 'fail'
        ? fulfillJson(500, { message: 'boom' })
        : fulfillJson(200, windowRows),
    );
    await page.route('**/rest/v1/rpc/get_night_out_media*', fulfillJson(200, rows));
  }

  test('the window is stated in words on BOTH sides of it', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page, CLOSED_WINDOW_NIGHT);
    await stubMedia(page, [], [
      windowRow('closed', '2020-01-01T02:00:00.000Z', '2020-01-02T02:00:00.000Z'),
    ]);

    await page.goto(`/night-out/${TOKEN}`);
    // A closed window says SO, and withdraws both controls rather than offering
    // actions the server would refuse.
    await expect(page.getByTestId('night-out-media-window')).toContainText(
      /window has closed/i,
    );
    await expect(page.getByTestId('night-out-add-photo')).toHaveCount(0);
    await expect(page.getByTestId('night-out-archive')).toHaveCount(0);
  });

  test('an open window names its deadline and offers the add control', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page, openWindowNight());
    await stubMedia(page, []);

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('night-out-media')).toBeVisible();
    // "the window is stated in words" (V8-R-NO-008 accessibility).
    await expect(page.getByTestId('night-out-media-window')).toContainText(
      /stay here until/i,
    );
    await expect(page.getByTestId('night-out-add-photo')).toBeVisible();

    // Empty is EMPTY, not an error and not a loading state left on screen.
    await expect(page.getByTestId('night-out-media-empty')).toBeVisible();
    await expect(page.getByTestId('night-out-media-error')).toHaveCount(0);
    await expect(page.getByTestId('night-out-media-list')).toHaveCount(0);

    // Nothing to archive means no archive control — an action that could only
    // report "nothing happened" is not an action.
    await expect(page.getByTestId('night-out-archive')).toHaveCount(0);
  });

  /**
   * V8-R-NO-008 FAILURE CLAUSE: "a skewed device clock must not hide media the
   * server still serves."
   *
   * The two fixtures below make the server's verdict CONTRADICT any local
   * comparison of `expires_at` against the device clock. Only a client that
   * takes `is_open` from the server can pass both — which is the point: before
   * round 2 the recap recomputed the boundary itself, so a phone running fast
   * hid Add-a-photo and Archive while the server was still serving and still
   * accepting writes.
   *
   * This is a stronger proof than mocking the clock, and it does not have to
   * skew the session token to get it.
   */
  test('an OPEN window whose deadline has already passed still offers the controls', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page, openWindowNight());
    // The deadline is in the PAST and the server says the window is OPEN. A
    // local `now < expiresAt` check reads this as closed; the server does not.
    await stubMedia(page, [MEDIA_ROW], [
      windowRow('open', futureIso(-72), futureIso(-48)),
    ]);
    await page.route('**/api/media/*/url', fulfillJson(404, { ok: false }));

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('night-out-media-window')).not.toContainText(
      /window has closed/i,
    );
    await expect(page.getByTestId('night-out-add-photo')).toBeVisible();
    await expect(page.getByTestId('night-out-archive')).toBeVisible();
  });

  test('a CLOSED window whose deadline is still ahead withdraws them anyway', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page, openWindowNight());
    // The mirror: a device clock running SLOW must not show what the server has
    // stopped serving either.
    await stubMedia(page, [MEDIA_ROW], [
      windowRow('closed', futureIso(24), futureIso(48)),
    ]);
    await page.route('**/api/media/*/url', fulfillJson(404, { ok: false }));

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('night-out-media-window')).toContainText(
      /window has closed/i,
    );
    await expect(page.getByTestId('night-out-add-photo')).toHaveCount(0);
    await expect(page.getByTestId('night-out-archive')).toHaveCount(0);
  });

  /**
   * A window we could not read is NEITHER open nor closed. It must not claim the
   * window has closed, and it must not offer actions it cannot stand behind.
   */
  test('an unreadable window says it could not check, and asserts nothing', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page, openWindowNight());
    await stubMedia(page, [MEDIA_ROW], 'fail');
    await page.route('**/api/media/*/url', fulfillJson(404, { ok: false }));

    await page.goto(`/night-out/${TOKEN}`);
    await expect(
      page.getByTestId('night-out-media-window-unknown'),
    ).toBeVisible();
    // Neither claim is made, and neither control is offered.
    await expect(page.getByTestId('night-out-media-window')).toHaveCount(0);
    await expect(page.getByTestId('night-out-add-photo')).toHaveCount(0);
    await expect(page.getByTestId('night-out-archive')).toHaveCount(0);
  });

  test('a failed read says so, and NEVER renders the empty state', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page, openWindowNight());
    await stubMedia(page, []);
    await page.route(
      '**/rest/v1/rpc/get_night_out_media*',
      fulfillJson(500, { message: 'boom' }),
    );

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('night-out-media-error')).toBeVisible();
    // The distinction this surface must never blur.
    await expect(page.getByTestId('night-out-media-empty')).toHaveCount(0);
  });

  test('archiving reports what it actually saved and offers the private destination', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page, openWindowNight());
    await stubMedia(page, [MEDIA_ROW]);
    // Archiving lands on the private destination, which reads the saved night
    // back; under the strict fixture that read is named (and empty) here.
    await page.route('**/rest/v1/rpc/get_saved_night*', fulfillJson(200, []));
    // The photo itself resolves through the boundary route, not off Storage.
    let urlRouteCalled = false;
    await page.route('**/api/media/*/url', async (route) => {
      urlRouteCalled = true;
      await fulfillJson(404, { ok: false, error: 'not_found' })(route);
    });

    let archiveBody: Record<string, unknown> | null = null;
    await page.route('**/rest/v1/rpc/archive_night_out*', async (route) => {
      archiveBody = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(200, [{ saved_night_id: SAVED_ID, photo_count: 1 }])(route);
    });

    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('night-out-media-list')).toBeVisible();

    await page.getByTestId('night-out-archive').click();
    await expect(page.getByTestId('night-out-media-notice')).toContainText(
      /Saved 1 photo to your Saved Nights Out/i,
    );
    expect(archiveBody).toEqual({ p_night_out: PLAN_ID });

    // "the private destination is named in words" — and it is reachable.
    const open = page.getByTestId('night-out-open-archive');
    await expect(open).toBeVisible();
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/nights/${SAVED_ID}$`));

    // The photo went through the media boundary; a 404 there renders the
    // honest absence rather than a broken image.
    expect(urlRouteCalled).toBe(true);
  });

  /**
   * V8-R-NO-008 / V8-R-NO-009 vs the SUGGESTION predicate — round 2, Codex gate.
   *
   * `add_night_out_media` and `archive_night_out` authorize an ACCEPTED member
   * throughout the media window; they do not care whether the plan is still
   * open. The recap used to receive the page's `canParticipate`, which also
   * requires draft/open because suggesting and voting close on a decided plan —
   * so locking a plan hid Add-a-photo from every member, at precisely the moment
   * the night is about to be photographed.
   */
  test('a DECIDED plan still offers its accepted members the photo controls', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    const night = openWindowNight();
    await stubMemberRpcs(page, night);
    await page.route('**/rest/v1/rpc/get_night_out*', (route) => {
      const url = route.request().url();
      if (!PLAN_READ_RE.test(url)) return route.fallback();
      // Every plan read names THIS plan, and set-returning reads get an empty set,
      // never the plan row (round-3 panel: the broad glob shadowed both checks).
      expect(route.request().postDataJSON()).toEqual(
        expect.objectContaining({ p_night_out: PLAN_ID }),
      );
      // get_night_out_anon_rsvps is an ungrouped aggregate: exactly ONE row, zeros
      // when nothing was answered (0068:2268-2282). Never an empty set.
      if (url.includes('get_night_out_anon_rsvps')) {
        return fulfillJson(200, [{ going: 0, maybe: 0, declined: 0 }])(route);
      }
      if (/get_night_out_(voting|media)/.test(url)) {
        return fulfillJson(200, [])(route);
      }
      if (url.includes('get_night_out_members')) return fulfillJson(200, [])(route);
      if (url.includes('get_night_out_board')) return fulfillJson(200, [])(route);
      return fulfillJson(200, [
        { ...PLAN_ROW, night, status: 'decided', decided_bar_id: 'attaboy' },
      ])(route);
    });
    await stubMedia(page, [MEDIA_ROW]);
    await page.route('**/api/media/*/url', fulfillJson(404, { ok: false }));

    await page.goto(`/night-out/${TOKEN}`);
    // The plan really is settled — the negative half of the pair, so this cannot
    // pass by accidentally rendering an open plan.
    await expect(page.getByText(/suggestions are closed/i)).toBeVisible();
    // ...and the photo controls are still there.
    await expect(page.getByTestId('night-out-add-photo')).toBeVisible();
    await expect(page.getByTestId('night-out-archive')).toBeVisible();
  });

  test('a refused archive never reports a save', async ({ page, context, baseURL }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page, openWindowNight());
    await stubMedia(page, [MEDIA_ROW]);
    await page.route('**/api/media/*/url', fulfillJson(404, { ok: false }));
    await page.route(
      '**/rest/v1/rpc/archive_night_out*',
      fulfillJson(403, { message: 'denied' }),
    );

    await page.goto(`/night-out/${TOKEN}`);
    await page.getByTestId('night-out-archive').click();

    // "a failed archive must not report success" (V8-R-NO-009).
    const notice = page.getByTestId('night-out-media-notice');
    await expect(notice).toContainText(/didn.t save/i);
    await expect(notice).not.toContainText(/Saved \d/i);
    await expect(page.getByTestId('night-out-open-archive')).toHaveCount(0);
  });

  test('Saved Nights Out keeps signed-out, empty and unreadable apart', async ({
    page,
  }) => {
    await page.goto('/nights');
    // No session: there is no archive to ask about, which is not an empty one.
    await expect(page.getByTestId('saved-nights-signed-out')).toBeVisible();
    await expect(page.getByTestId('saved-nights-empty')).toHaveCount(0);
    await expect(page.getByTestId('saved-nights-error')).toHaveCount(0);
  });

  test('Saved Nights Out lists a card and opens that night', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubNightOutRest(page);
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    await page.route('**/api/media/*/url', fulfillJson(404, { ok: false }));
    // ORDER MATTERS, AND THE GLOBS OVERLAP. `get_saved_night*` also matches
    // `get_saved_nights`, and Playwright takes the LAST-registered match — so
    // the list stub has to be registered SECOND or every list read is answered
    // with a detail row (which is a row with no photo_count, and the card
    // silently reads "0 photos").
    await page.route(
      '**/rest/v1/rpc/get_saved_night*',
      fulfillJson(200, [
        {
          id: SAVED_ID,
          title: 'Birthday crawl',
          night: CLOSED_WINDOW_NIGHT,
          bar_count: 3,
          archived_at: '2020-01-02T05:00:00.000Z',
          media_id: MEDIA_ID,
          storage_path: `${USER_ID}/${MEDIA_ID}`,
          sort_order: 1,
        },
      ]),
    );
    await page.route(
      '**/rest/v1/rpc/get_saved_nights*',
      fulfillJson(200, [
        {
          id: SAVED_ID,
          title: 'Birthday crawl',
          night: CLOSED_WINDOW_NIGHT,
          bar_count: 3,
          photo_count: 1,
          archived_at: '2020-01-02T05:00:00.000Z',
          cover_media_ids: [MEDIA_ID],
        },
      ]),
    );

    await page.goto('/nights');
    const card = page.getByTestId('saved-night-card');
    await expect(card).toBeVisible();
    // "one quiet metadata line — name, date, bar count, photo count".
    await expect(card).toContainText('Birthday crawl');
    await expect(card).toContainText(/3 bars/);
    await expect(card).toContainText(/1 photo/);

    await card.click();
    await expect(page).toHaveURL(new RegExp(`/nights/${SAVED_ID}$`));
    await expect(page.getByTestId('saved-night-open')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /birthday crawl/i }),
    ).toBeVisible();

    // The archive holds the night even when its bytes cannot be served — the
    // photo renders its worded absence rather than a broken image.
    await expect(page.getByTestId('saved-night-photos')).toBeVisible();
    await expect(page.getByTestId('media-gone').first()).toBeVisible();
  });

  test('an archived night that is not yours is not found, not an empty archive', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubNightOutRest(page);
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    // `get_saved_night` filters on auth.uid(), so somebody else's id is zero
    // rows — the same answer a genuinely missing night gets, on purpose.
    await page.route('**/rest/v1/rpc/get_saved_night*', fulfillJson(200, []));

    await page.goto(`/nights/${SAVED_ID}`);
    await expect(page.getByTestId('saved-night-missing')).toBeVisible();
    await expect(page.getByTestId('saved-night-photos')).toHaveCount(0);
    // ...and it is NOT the failure state, which is a different sentence.
    await expect(page.getByTestId('saved-night-error')).toHaveCount(0);
  });

  /**
   * V8-R-ACC-002 FAILURE CLAUSE — round 2, both gates: "a night that cannot be
   * read states so rather than rendering an empty archive."
   *
   * A failed RPC used to land in the same branch as zero rows, so a network
   * blip told the owner their own night was not in their archive. The /nights
   * LIST page already kept the two apart; the detail page did not.
   */
  test('an archived night that cannot be READ says so, never that it is missing', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubNightOutRest(page);
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    await page.route(
      '**/rest/v1/rpc/get_saved_night*',
      fulfillJson(500, { message: 'boom' }),
    );

    await page.goto(`/nights/${SAVED_ID}`);
    await expect(page.getByTestId('saved-night-error')).toBeVisible();
    // The claim it must never make about somebody's own archive.
    await expect(page.getByTestId('saved-night-missing')).toHaveCount(0);
    await expect(page.getByTestId('saved-night-open')).toHaveCount(0);
  });
});

/**
 * THE START A NIGHT OUT FORM — When, Area and Voting closes (V8-R-NO-002,
 * V8-R-NO-003, V8-R-NO-005).
 *
 * ROUND-9 PANEL. Migration 0068 grew `starts_at`, `area` and
 * `voting_closes_at` plus their three owner-only writers in round 4, and for
 * five rounds nothing in `src` called any of them: Social → Plans → Start a
 * Night Out reached a screen with a CTA and none of the three rows, so all
 * three approved requirements were unreachable from the product. This drives
 * the reviewer's own reproduction in a browser, on both viewports.
 *
 * The rows exist only for a session — creation is an authenticated RPC — so
 * this is a signed-in test. What each row WRITES is unit-covered in
 * nightOutPlanFields.test.tsx, where the three RPCs can be driven directly.
 */
test.describe('the Start a Night Out form (V8-R-NO-002/003/005)', () => {
  const FRIEND_ID = '523e4567-e89b-42d3-a456-426614174000';

  async function openTheForm(page: Page): Promise<void> {
    await stubNightOutRest(page);
    await stubSocialShellRest(page);
    // The Plans sub-tab reads the caller's plans and the circle's tonight
    // signals on entry. Named and empty here: these tests are about the form,
    // and `get_my_night_outs` -> [] is the "no plans yet" state — the V9-03
    // discoverability journey asserts this same read with a real row instead.
    for (const rpc of [
      'get_my_night_outs',
      'get_circle_rsvps',
      'get_circle_suggestions',
      'get_circle_vibe_votes',
    ]) {
      await page.route(`**/rest/v1/rpc/${rpc}*`, fulfillJson(200, []));
    }
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    // Somebody to invite: NO-005's row exists "once at least one person or
    // group is selected", and a solo plan has no vote to put a deadline on.
    await page.route(
      '**/rest/v1/rpc/get_following*',
      fulfillJson(200, [
        { id: FRIEND_ID, handle: 'sam', display_name: 'Sam Ruiz' },
      ]),
    );
    await page.goto('/friends');
    await openPlansTab(page);
    await page.getByTestId('start-night-out').click();
    await expect(page.getByTestId('night-out-plan-fields')).toBeVisible();
    // The recipient picker fetches the circle and groups on mount; let those
    // settle before a test types into the form, so a late re-render under a
    // loaded gate cannot race a fill.
    await expect(page.getByText(/Loading your (circle|groups)/)).toHaveCount(0);
  }

  /**
   * Open the Plans sub-tab with ONE tap. The tabs are disabled until the page
   * has mounted (src/app/friends/page.tsx — the VibeQuiz pattern), so
   * Playwright's own enabled-wait IS the hydration signal; before that fix a
   * tap in the pre-hydration window was silently swallowed for tests and real
   * users alike (measured on a loaded 3-worker gate after a reload, 2026-09-09;
   * round-1/round-2 panels).
   */
  async function openPlansTab(page: Page): Promise<void> {
    const plans = page.getByRole('tab', { name: 'Plans' });
    await expect(plans).toBeEnabled({ timeout: 15_000 });
    await plans.click();
    await expect(plans).toHaveAttribute('aria-selected', 'true');
  }

  /**
   * V9-03 — the owner's reported failure: "after starting a night I can no
   * longer find it". The journey the phone report describes, end to end, from
   * the visible entry point: create once → land on the plan → leave for another
   * tab → come back → reload → the SAME plan is still listed. The `get_my_night_outs`
   * fixture is stateful — empty until the create RPC has been issued, then the
   * created row — so a list that does not re-read after creation, or a create
   * that never happens, fails here instead of passing against a blanket `[]`.
   */
  test('V9-03: a plan created once is discoverable again after leaving, returning and reloading', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await openTheForm(page);
    // Landing on the created plan reads it as its owner.
    await stubOwnerRpcs(page);

    let createdNight: string | null = null;
    let createCalls = 0;
    let listReadsAfterCreate = 0;
    await page.route('**/rest/v1/rpc/create_night_out*', async (route) => {
      const body = route.request().postDataJSON() as { p_night: string; p_idempotency_key: string | null };
      expect(body).toEqual({
        p_night: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        p_title: null,
        p_idempotency_key: expect.any(String),
      });
      createCalls += 1;
      createdNight = body.p_night;
      await fulfillJson(200, PLAN_ID)(route);
    });
    // OBSERVED under the strict fixture (2026-09-09): with nobody selected, the
    // Start action still invites the one person in the circle. That is V9-04's
    // "implicit default" symptom, asserted in its own test below; here the
    // invite is answered so the V9-03 journey can continue, and recorded.
    const invited: string[] = [];
    await page.route('**/rest/v1/rpc/invite_one_to_night_out*', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ p_night_out: PLAN_ID, p_user: FRIEND_ID, p_group: null });
      invited.push(FRIEND_ID);
      await fulfillJson(200, true)(route);
    });
    // Registered AFTER openTheForm's empty Plans-tab fixture, so it wins. It is
    // shaped as the SERVER answers: `get_my_night_outs` excludes the caller's
    // own plans (0059_night_outs_respond_revision.sql:296, `n.owner_id <>
    // auth.uid()`; restated at src/lib/nightOuts.server.ts:355-357), so an
    // owner's list stays EMPTY after creating — which is V9-03's symptom, and
    // is asserted as the known failure in the test that follows this one. The
    // first draft of this fixture returned the owner's row, and the round-3
    // panel caught it as the exact fail-open this file exists to remove.
    await page.route('**/rest/v1/rpc/get_my_night_outs*', async (route) => {
      if (createdNight !== null) listReadsAfterCreate += 1;
      await fulfillJson(200, [])(route);
    });

    await expect(page.getByTestId('night-out-plan-fields')).toBeVisible();
    await page.getByRole('button', { name: /create the night out/i }).click();

    // Created once, and landed on that exact plan.
    await expect.poll(() => createCalls, { timeout: 10_000 }).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}$`));
    await expect(page.getByRole('heading', { name: PLAN_ROW.title })).toBeVisible();

    // Leave for another tab, come back, reload: Plans re-reads the list each
    // time and NEVER creates a second plan.
    await page.goto('/map');
    await expect(page.locator('main')).toBeVisible();
    await page.goto('/friends');
    await openPlansTab(page);
    // Plans has rendered before the list read is judged; under a loaded gate
    // the tab's content can trail the click.
    await expect(page.getByTestId('start-night-out')).toBeVisible();
    await expect.poll(() => listReadsAfterCreate, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.reload();
    await openPlansTab(page);
    await expect(page.getByTestId('start-night-out')).toBeVisible();
    expect(createCalls, 'returning or reloading must never create a second plan').toBe(1);
  });

  /**
   * V9-02 — the plan form spills past the right edge on iPhone. Geometry, not a
   * screenshot: with long content in the free-text field and the deadline TIME
   * FIELD shown (the "Pick a time" radio; emulation cannot open the native
   * datetime picker chrome or raise the on-screen keyboard — those are the
   * attended iPhone step), the document must not be wider than the viewport
   * and every field must end inside it. On this base the layout passes in both
   * emulators, so the phone overflow is NOT reproduced here; this case keeps
   * the CSS-layout half of the report under the gate for any future change.
   */
  test('V9-02: the plan form never exceeds the viewport width, with long content and the deadline picker open', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await openTheForm(page);
    await expect(page.getByTestId('night-out-plan-fields')).toBeVisible();

    // Long content in every free-text field, and the second datetime-local open.
    await page.getByLabel(/^Area/).fill('Lower East Side below Houston and east of the Bowery, near the bridges');
    await page.getByLabel('Pick a time').check();
    await expect(page.getByLabel('Voting closes at')).toBeVisible();

    const geometry = await page.evaluate(() => {
      const vw = window.innerWidth;
      const fields = document.querySelector('[data-testid="night-out-plan-fields"]');
      const controls = fields
        ? Array.from(fields.querySelectorAll<HTMLElement>('input, select, textarea, button'))
        : [];
      const spill = controls
        .map((el) => ({ tag: el.tagName, id: el.id || el.getAttribute('aria-label') || '', right: Math.round(el.getBoundingClientRect().right) }))
        .filter((c) => c.right > vw);
      return {
        vw,
        docWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        spill,
      };
    });
    expect(geometry.docWidth, `document is wider than the viewport: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.vw);
    expect(geometry.bodyWidth, `body is wider than the viewport: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.vw);
    expect(geometry.spill, `controls end past the viewport: ${JSON.stringify(geometry.spill)}`).toEqual([]);
    // The primary action is still reachable. V9-05 moved it to the BOTTOM of
    // the flow (details → people → bars → action), so "reachable" means it can
    // be scrolled to and then sits fully inside the viewport horizontally — not
    // that it is on screen before scrolling, which is what the old assertion
    // implied when the button lived in the header.
    const action = page.getByRole('button', { name: /create the night out/i });
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
    const actionBox = await action.boundingBox();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.x).toBeGreaterThanOrEqual(0);
    expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(geometry.vw + 1);
  });

  /**
   * V9-03 — the owner's report: after starting a night the owner could not find
   * it. Cause: `get_my_night_outs` excludes plans the caller owns (0059:296) and
   * no surface listed owned plans (StartNightOutButton.tsx:38-41). Foundation B
   * reproduced this as a known failure; the Night Out goal fixed it on the
   * CLIENT with `YourPlanTonight`, which lists the plan the Start button parked
   * for tonight (localStorage, keyed by account + night) by reading it through
   * `get_night_out`. The `get_my_night_outs` fixture stays `[]` — the server's
   * real answer for an owner — so this test passes only because the new surface
   * exists, and it would go red again if the card were removed.
   */
  test('V9-03: the plan an owner just created is listed under Plans after returning', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await openTheForm(page);
    await stubOwnerRpcs(page);
    await page.route('**/rest/v1/rpc/create_night_out*', async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        p_night: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        p_title: null,
        p_idempotency_key: expect.any(String),
      });
      await fulfillJson(200, PLAN_ID)(route);
    });
    await page.route('**/rest/v1/rpc/invite_one_to_night_out*', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ p_night_out: PLAN_ID, p_user: FRIEND_ID, p_group: null });
      await fulfillJson(200, true)(route);
    });
    // The server's answer for an owner: their own plans are excluded. A mock
    // cannot notice a server change, so this row and the marker below are
    // updated BY HAND when the Night Out goal lands; the check that goes red on
    // the server side the moment 0059:296 changes is
    // src/lib/nightOutsRls.live.test.ts:909, which pins the exclusion today and
    // must be inverted by that goal.
    await page.route('**/rest/v1/rpc/get_my_night_outs*', fulfillJson(200, []));

    // Preconditions are HARD expectations: a failure here is a real failure,
    // never something the known-defect marker below may absorb.
    await expect(page.getByTestId('night-out-plan-fields')).toBeVisible();
    await page.getByRole('button', { name: /create the night out/i }).click();
    await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}$`));
    await expect(page.getByRole('heading', { name: PLAN_ROW.title })).toBeVisible();
    await page.goto('/friends');
    await openPlansTab(page);
    await expect(page.getByTestId('start-night-out')).toBeVisible();

    // V9-03 FIXED (Night Out goal): `get_my_night_outs` still excludes owned
    // plans — the fixture above stays [] because that is the server's answer —
    // and the owner's plan is now listed by `YourPlanTonight`, which reads the
    // plan the Start button parked for tonight back through `get_night_out`.
    const card = page.getByTestId('your-plan-tonight');
    await expect(card).toContainText(PLAN_ROW.title);
    await expect(card).toHaveAttribute('href', `/night-out/${TOKEN}`);
    // Reload: the record survives (localStorage, keyed by account + night).
    await page.reload();
    await openPlansTab(page);
    await expect(page.getByTestId('your-plan-tonight')).toContainText(PLAN_ROW.title);
    assertNoUnexpectedRest(page);
  });

  /**
   * V9-04 — "make actual recipients clear before submission; do not silently
   * invite everyone because of an implicit default". The default is still
   * everyone you follow, but it is no longer silent: the RecipientPicker states
   * it ("Selected · 1 person") with a remove control per person. Two things
   * must hold: the stated selection is exactly who gets invited, and removing
   * everyone from it invites nobody.
   */
  test('V9-04: the default selection is stated, editable, and removing everyone invites nobody', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await openTheForm(page);
    await stubOwnerRpcs(page);
    await page.route('**/rest/v1/rpc/create_night_out*', async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        p_night: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        p_title: null,
        p_idempotency_key: expect.any(String),
      });
      await fulfillJson(200, PLAN_ID)(route);
    });
    const invited: string[] = [];
    await page.route('**/rest/v1/rpc/invite_one_to_night_out*', async (route) => {
      const body = route.request().postDataJSON() as { p_night_out: string; p_user: string };
      expect(body.p_night_out).toBe(PLAN_ID);
      invited.push(body.p_user);
      await fulfillJson(200, true)(route);
    });

    await expect(page.getByTestId('night-out-plan-fields')).toBeVisible();
    // The default is stated, not silent: the one circle member is selected and
    // the summary says so, with a remove control.
    await expect(page.getByText(/Selected · 1 (person|people)/)).toBeVisible();
    const sam = page.getByRole('button', { name: /^Sam\b/ });
    await expect(sam).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Remove Sam/ })).toBeVisible();
    // Remove from the summary: back to nobody, visibly, and the chip agrees.
    await page.getByRole('button', { name: /^Remove Sam/ }).click();
    await expect(page.getByText(/Selected · 0 people/)).toBeVisible();
    await expect(sam).toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: /create the night out/i }).click();
    await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}$`));
    expect(invited, 'nobody is selected, so nobody may be invited').toEqual([]);
  });

  test('V9-04: a picked person is exactly who gets invited', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await openTheForm(page);
    await stubOwnerRpcs(page);
    await page.route('**/rest/v1/rpc/create_night_out*', fulfillJson(200, PLAN_ID));
    const invited: string[] = [];
    await page.route('**/rest/v1/rpc/invite_one_to_night_out*', async (route) => {
      const body = route.request().postDataJSON() as { p_night_out: string; p_user: string };
      expect(body.p_night_out).toBe(PLAN_ID);
      invited.push(body.p_user);
      await fulfillJson(200, true)(route);
    });

    await expect(page.getByTestId('night-out-plan-fields')).toBeVisible();
    // Clear the stated default, then pick Sam back explicitly through search.
    await page.getByRole('button', { name: /^Remove Sam/ }).click();
    await expect(page.getByText(/Selected · 0 people/)).toBeVisible();
    await page.getByLabel('Search people').fill('sam');
    await page.getByRole('button', { name: /^Sam\b/ }).click();
    await expect(page.getByText(/Selected · 1 (person|people)/)).toBeVisible();

    await page.getByRole('button', { name: /create the night out/i }).click();
    await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}$`));
    expect(invited, 'exactly the visible selection is invited').toEqual([FRIEND_ID]);
  });

  /**
   * V9-05 — "Start Night Out belongs at the bottom, not among people's names";
   * the organizer picks the shortlist in the planning flow; a partial failure
   * keeps the created plan, says what did not send, and retries ONLY that.
   *
   * The invite fixture refuses the FIRST attempt and accepts the retry, so the
   * assertions can tell "retried the failed invite" from "re-ran everything":
   * exactly one create, exactly one suggestion, exactly two invite calls for
   * the same person, and the plan opens only once nothing is left unsent.
   */
  test('V9-05: details → people → bars → one action; the shortlist is suggested and only the failed invite is retried', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await openTheForm(page);
    await stubOwnerRpcs(page);
    let createCalls = 0;
    await page.route('**/rest/v1/rpc/create_night_out*', async (route) => {
      createCalls += 1;
      await fulfillJson(200, PLAN_ID)(route);
    });
    const invites: string[] = [];
    await page.route('**/rest/v1/rpc/invite_one_to_night_out*', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ p_night_out: PLAN_ID, p_user: FRIEND_ID, p_group: null });
      invites.push(FRIEND_ID);
      // First attempt refused, retry accepted.
      await fulfillJson(200, invites.length > 1)(route);
    });
    const suggested: string[] = [];
    await page.route('**/rest/v1/rpc/suggest_night_out_bar*', async (route) => {
      const body = route.request().postDataJSON() as { p_night_out: string; p_bar: string };
      expect(body.p_night_out).toBe(PLAN_ID);
      suggested.push(body.p_bar);
      // Slow on purpose: the invite has already failed by now, and the outcome
      // panel must NOT offer a retry while the create sequence is still in
      // flight (cycle-2 round-1 panel, Codex HIGH) — see the assertion below.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await fulfillJson(200, true)(route);
    });

    // Flow order, measured: details above people above bars above the ONE action.
    const top = async (locator: ReturnType<Page['locator']>): Promise<number> =>
      (await locator.boundingBox())!.y;
    const fields = page.getByTestId('night-out-plan-fields');
    const people = page.getByLabel('Search people');
    const barSearch = page.getByLabel('Add a bar to the shortlist');
    const action = page.getByTestId('create-night-out');
    await expect(action).toBeVisible();
    expect(await top(fields)).toBeLessThan(await top(people));
    expect(await top(people)).toBeLessThan(await top(barSearch));
    expect(await top(barSearch)).toBeLessThan(await top(action));
    await expect(action).toHaveText(/Create the Night Out & invite 1/);
    await expect(page.getByRole('button', { name: /create the night out/i })).toHaveCount(1);
    // The generic /join share is not a plan invitation and is gone from the planner.
    await expect(page.getByRole('button', { name: /Invite friends to plan tonight/ })).toHaveCount(0);

    // The organizer shortlists a bar by name.
    await barSearch.fill('attaboy');
    await page.getByRole('button', { name: /^Attaboy/ }).click();
    await expect(page.getByText(/Shortlist · 1 of 3/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Remove Attaboy from the shortlist/ })).toBeVisible();

    await action.click();
    // While the sequence is still running (the suggest fixture is slow), the
    // refused invite is already known but no retry may be offered yet.
    await expect(action).toHaveText(/Creating/);
    await expect.poll(() => invites.length).toBe(1);
    await expect(page.getByTestId('unsent-outcome')).toHaveCount(0);
    // Created once; the shortlist reached the board; the refused invite HOLDS
    // the screen instead of navigating, and says exactly what did not send.
    // Names, not counts: the organizer is told WHO did not get the invite.
    await expect(page.getByTestId('unsent-outcome')).toContainText(/the invite to Sam Ruiz didn't send/);
    expect(createCalls).toBe(1);
    expect(suggested).toEqual(['attaboy']);
    expect(invites).toEqual([FRIEND_ID]);
    await expect(page).not.toHaveURL(new RegExp(`/night-out/${TOKEN}`));
    await expect(action).toBeDisabled();

    // Retry re-sends ONLY the failed invite — no second create, no second
    // suggestion — then opens the plan, whose page carries its invite link.
    await page.getByRole('button', { name: /Retry what didn't send/ }).click();
    await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}$`));
    expect(createCalls).toBe(1);
    expect(invites).toEqual([FRIEND_ID, FRIEND_ID]);
    expect(suggested).toEqual(['attaboy']);
    await expect(page.getByRole('button', { name: /Copy invite link/ })).toBeVisible();
    assertNoUnexpectedRest(page);
  });

  test('Social → Plans reaches a form whose three rows are editable in place', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    // The deadline this test picks is "tonight at 23:00", and the row it then
    // asserts on says how long is LEFT — `remainingLabel` returns 'immediately'
    // once that moment has passed. Read off the real clock, the fixture is a
    // future deadline before 23:00 and a past one after it, so the run's START
    // TIME decided the assertion: measured red at 23:47 EDT on 7366b06, both
    // viewports, with "Voting closes immediately." Pin the clock the way
    // `home-phase.spec.ts` and `friends-flow.spec.ts` already do.
    //
    // The OFFSET is not decoration. A timezone-free literal is parsed in the
    // HOST's zone, so on a PDT machine 20:00 is the instant 23:00 in New York
    // — exactly the deadline — and the pin reintroduces the failure it exists
    // to remove (reproduced by independent V9 review, 2026-09-08). Naming
    // -04:00 makes the pinned instant the same three hours of headroom on
    // every host. Not a widening: the past-deadline cases elsewhere in this
    // file keep their own setup and their own assertions.
    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await openTheForm(page);

    await expect(page.getByTestId('night-out-plan-fields')).toBeVisible();

    // WHEN — "Tonight, 9:00 PM", in the field rather than behind a tap.
    const when = page.getByLabel('When');
    await expect(when).toHaveValue(/T21:00$/);
    const night = (await when.inputValue()).slice(0, 10);
    await when.fill(`${night}T22:30`);
    await expect(when).toHaveValue(`${night}T22:30`);
    // Editing it never withdraws the CTA.
    await expect(
      page.getByRole('button', { name: /create the night out/i }),
    ).toBeEnabled();

    // AREA — optional, and editable in place.
    const area = page.getByLabel(/^Area/);
    await area.fill('East Village');
    await expect(area).toHaveValue('East Village');

    // VOTING CLOSES — the approved sheet's two labelled states, defaulting to
    // No deadline, with the picked time stated in words.
    await expect(page.getByLabel('No deadline')).toBeChecked();
    await page.getByLabel('Pick a time').check();
    // Chosen but not yet picked: said in the ROW, while it can still be acted
    // on. This used to be reported after creation as a refused edit, which was
    // false twice — no RPC was ever called, and the notice arrived on a screen
    // the owner was already leaving (round-10 panel).
    await expect(page.getByTestId('deadline-missing')).toBeVisible();
    await page.getByLabel('Voting closes at').fill(`${night}T23:00`);
    await expect(page.getByTestId('deadline-missing')).toHaveCount(0);
    await expect(page.getByTestId('deadline-remaining')).toContainText(/in about/i);
  });

  test('a time on another night is explained in the row, and still does not block the CTA', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await openTheForm(page);

    // `set_night_out_start` bounds the start to the plan's own night, and a
    // server-side refusal with nothing on screen is what this replaces.
    await page.getByLabel('When').fill('2030-01-01T22:00');
    await expect(page.getByTestId('when-off-night')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create the night out/i }),
    ).toBeEnabled();
  });
});
