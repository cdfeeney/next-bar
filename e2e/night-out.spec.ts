import { expect, test, type BrowserContext, type Locator, type Page, type Route } from './helpers/test';
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
  // G-01: the member view reads named share-link guests; strict-REST harnesses
  // 500 anything unstubbed, so every plan surface needs it.
  await page.route('**/rest/v1/rpc/get_night_out_anon_guests*', fulfillJson(200, []));
  await page.route('**/rest/v1/ratings?*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await fulfillJson(200, [])(route);
  });
  // S-06b: PlanCover reads `night_outs.cover` under the member policy. No rows
  // = no cover, which is how every pre-cover surface must keep rendering.
  await page.route('**/rest/v1/night_outs?*', async route => {
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
    // S-03: Plans now reads the saved-nights archive for its Earlier nights list.
    'get_saved_nights',
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
    // G-01: a link holder gets the accepted COUNT and an account prompt; the
    // names are what the account is for (owner, 2026-09-16).
    await expect(page.getByTestId('invite-attendees')).toHaveCount(0);
    await expect(page.getByTestId('invite-whos-in-locked')).toBeVisible();
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
        // G-01: Going and Maybe carry the guest's name.
        p_guest_name: 'Alex',
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

    // G-01: without a name the answer is held in the field, not sent.
    await page.getByTestId('invite-rsvp-maybe').click();
    await expect(page.getByTestId('invite-name-missing')).toBeVisible();
    expect(sent).toHaveLength(0);
    await page.getByLabel('Your name').fill('Alex');
    await expect(page.getByTestId('invite-name-missing')).toHaveCount(0);
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
          p_guest_name: 'Alex',
        });
        await fulfillJson(500, { message: 'boom' })(route);
      },
    );

    await page.goto(`/night-out/${TOKEN}`);
    // G-01: Going carries the guest's name.
    await page.getByLabel('Your name').fill('Alex');
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
    // S-07: the member board is headed GOING (README §7); key on the section, not the words.
    await expect(page.getByTestId('member-board')).toContainText(/going/i);
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

    // R-03 item 4: once locked, the re-read is a DECIDED plan on the top bar and
    // the board shows it — the banner, VOTING CLOSED, PICKED on that row only.
    let locked = false;
    await page.route('**/rest/v1/rpc/get_night_out*', async (route) => {
      const url = route.request().url();
      if (!locked || !/\/rpc\/get_night_out(?:\?|$)/.test(url)) return route.fallback();
      await fulfillJson(200, [{ ...PLAN_ROW, caller_role: 'owner', status: 'decided', decided_bar_id: 'please-dont-tell' }])(route);
    });
    await page.route('**/rest/v1/rpc/lock_night_out*', async (route) => {
      lockedWith = route.request().postDataJSON() as Record<string, unknown>;
      locked = true;
      await fulfillJson(200, 'please-dont-tell')(route);
    });
    await page.getByTestId('night-out-lock').click();
    await expect.poll(() => lockedWith, { timeout: 5000 }).not.toBeNull();
    // The bar is NOT a parameter: the server picks the leader inside the same
    // serialized section that takes it.
    expect(Object.keys(lockedWith ?? {})).toEqual(['p_night_out']);
    await expect(page.getByTestId('decided-banner')).toBeVisible();
    await expect(page.getByTestId('shortlist-state')).toHaveText(/Voting closed/i);
    await expect(page.getByTestId('shortlist-picked')).toHaveCount(1);
    await expect(page.getByTestId('shortlist-row').first().getByTestId('shortlist-picked')).toBeVisible();
    await expect(page.getByTestId('night-out-lock')).toHaveCount(0);
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
    // WP1 merge (7c6b085) re-homed them deliberately, and S-01 (2026-09-13)
    // moved them again to /friends/people behind the header's people icon;
    // friends-flow.spec.ts asserts they are visible there. Keeping the old
    // negative would have made this suite and that one contradict each other on
    // the same branch. What the guard now protects is the dashboard's IDENTITY,
    // not every element that survived it.
    await page.getByRole('link', { name: /groups and people/i }).click();
    await expect(page).toHaveURL(/\/friends\/people$/);
    await expect(page.getByTestId('follow-stats')).toBeVisible();
  });
});

test.describe('Social · Tonight — the pin sequence (V8-R-PRE-002, V8-R-PRE-003)', () => {
  /**
   * A signed-in Tonight with NO presence set — the exact state round 1 found
   * unreachable: choosing "Going out" could only ever send the bar the user
   * already had, and a new pinner had none, so V8-R-PRE-001 and V8-R-PRE-003
   * could not be satisfied at all.
   *
   * S-05b (owner decision 2026-09-14): the sequence is three PUSHED screens —
   * You tonight → Where are you? → Pin your spot — mirrored to `?step=`, not
   * modal dialogs. The Custom picker is inline on Pin your spot.
   */
  async function stubTonight(page: Page, mine: unknown[]): Promise<void> {
    await stubNightOutRest(page);
    await stubSocialShellRest(page);
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    await page.route('**/rest/v1/rpc/get_circle_presence*', fulfillJson(200, []));
    await page.route('**/rest/v1/rpc/get_my_presence*', fulfillJson(200, mine));
  }

  const NO_BAR = {
    status: 'going',
    bar_id: null,
    audience: 'friends',
    updated_at: '2026-08-20T02:00:00.000Z',
    recipient_ids: [],
  };

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
    await stubTonight(page, [NO_BAR]);

    await page.goto('/friends/tonight');
    await expect(page.getByTestId('my-pin')).toContainText(/no bar pinned/i);

    // THE STEP THAT WAS MISSING.
    const pin = page.getByTestId('pin-my-spot');
    await expect(pin).toBeVisible();
    await pin.click();

    // A pushed screen with its own title, back control and URL.
    const where = page.getByTestId('pin-where-step');
    await expect(where).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /^Where are you\?$/ })).toBeVisible();
    await expect(page).toHaveURL(/\/friends\/tonight\?step=where$/);
    // One question, one field (V8-R-PRE-003).
    await expect(where.getByRole('textbox', { name: /search bars/i })).toBeVisible();
    // The trust line "stays in place throughout" (V8-R-PRE-001 accessibility).
    await expect(where.getByText(/never tracks you automatically/i)).toBeVisible();

    // Back returns to You tonight and takes nothing with it.
    await page.getByTestId('pin-step-back').click();
    await expect(page.getByTestId('pin-where-step')).toHaveCount(0);
    await expect(page.getByTestId('presence-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^You tonight$/ })).toBeVisible();
    await expect(page).toHaveURL(/\/friends\/tonight$/);

    // S-05: exactly ONE ✓, on the chosen row, and none elsewhere (README §4).
    await expect(page.getByTestId('presence-status-check')).toHaveCount(1);
    await expect(page.getByTestId('presence-status-going').getByTestId('presence-status-check')).toHaveCount(1);
    await expect(page.getByTestId('presence-status-going')).toHaveAttribute('aria-pressed', 'true');

    // S-01/S-02 (Social redesign): the header pin icon on /friends reads the
    // same row. A status without a bar is the `status` state with the neutral label.
    await page.goto('/friends');
    const pinIcon = page.getByTestId('social-pin-icon');
    await expect(pinIcon).toHaveAttribute('data-pin-state', 'status');
    await expect(pinIcon).toHaveAttribute('aria-label', /Set whether you are going out and where/);
  });

  test('the header pin icon reads a live pin: accent state and the bar named in words', async ({
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
    // Never the loading state once the read has landed (S-01 panel, both lanes).
    const pinIcon = page.getByTestId('social-pin-icon');
    await expect(pinIcon).toHaveAttribute('data-pin-state', 'pinned');
    await expect(pinIcon).toHaveAttribute('aria-label', /^Pinned at Attaboy — change your night$/);
    // And You tonight's own row agrees with it; the icon is the way there.
    await pinIcon.click();
    await expect(page).toHaveURL(/\/friends\/tonight$/);
    await expect(page.getByTestId('my-pin')).toContainText(/Attaboy/);
  });

  /**
   * V8-R-PRE-003 → V8-R-PRE-002, and the defect round 3 found (Codex gate,
   * HIGH): picking a bar used to WRITE it immediately. "Tapping a result
   * selects that bar and advances straight to the audience step." Selecting is
   * not publishing — and the assertion that matters is the negative one:
   * `set_night_presence` is not called until Pin it.
   */
  test('picking a bar advances to Pin your spot and writes NOTHING until it is confirmed', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubTonight(page, [NO_BAR]);
    let writes = 0;
    await page.route('**/rest/v1/rpc/set_night_presence*', async (route) => {
      writes += 1;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends/tonight');
    await page.getByTestId('pin-my-spot').click();
    const where = page.getByTestId('pin-where-step');
    await expect(where).toBeVisible();
    await where.getByRole('textbox', { name: /search bars/i }).fill('att');
    await where.getByRole('button', { name: /attaboy/i }).first().click();

    // The bar step gives way to the audience STEP, not to a written pin.
    await expect(page.getByTestId('pin-where-step')).toHaveCount(0);
    const step = page.getByTestId('pin-audience-step');
    await expect(step).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Pin your spot$/ })).toBeVisible();
    await expect(page).toHaveURL(/\/friends\/tonight\?step=audience$/);
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
  test('cancelling Pin your spot leaves no pin behind and returns to You tonight', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubTonight(page, [NO_BAR]);
    let writes = 0;
    await page.route('**/rest/v1/rpc/set_night_presence*', async (route) => {
      writes += 1;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends/tonight');
    await page.getByTestId('pin-my-spot').click();
    const where = page.getByTestId('pin-where-step');
    await where.getByRole('textbox', { name: /search bars/i }).fill('att');
    await where.getByRole('button', { name: /attaboy/i }).first().click();
    await page.getByTestId('pin-cancel').click();

    await expect(page.getByTestId('pin-audience-step')).toHaveCount(0);
    await expect(page.getByTestId('presence-screen')).toBeVisible();
    await expect(page).toHaveURL(/\/friends\/tonight$/);
    expect(writes, 'cancelling the pin sequence still wrote a pin').toBe(0);
  });

  /**
   * S-05b acceptance 4: back from Pin your spot returns to Where are you? with
   * the query cleared and the chosen bar still marked; back from there returns
   * to You tonight with no pending bar. Nothing is written on either.
   */
  test('back from Pin your spot keeps the bar and clears the search; back again drops it', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubTonight(page, [NO_BAR]);
    let writes = 0;
    await page.route('**/rest/v1/rpc/set_night_presence*', async (route) => {
      writes += 1;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends/tonight');
    await page.getByTestId('pin-my-spot').click();
    const where = page.getByTestId('pin-where-step');
    await where.getByRole('textbox', { name: /search bars/i }).fill('att');
    await where.getByRole('button', { name: /attaboy/i }).first().click();
    await expect(page.getByTestId('pin-audience-step')).toBeVisible();

    await page.getByTestId('pin-step-back').click();
    await expect(page.getByTestId('pin-where-step')).toBeVisible();
    await expect(page).toHaveURL(/\?step=where$/);
    await expect(page.getByTestId('pin-where-step').getByRole('textbox', { name: /search bars/i })).toHaveValue('');
    await expect(page.getByTestId('pin-where-chosen')).toContainText(/Attaboy/);

    await page.getByTestId('pin-step-back').click();
    await expect(page.getByTestId('presence-screen')).toBeVisible();
    await expect(page).toHaveURL(/\/friends\/tonight$/);
    // The in-app ‹ WALKED history rather than pushing (S-05b panel, Fable
    // medium): the bar step is a forward entry now, not a new one.
    await page.goForward();
    await expect(page).toHaveURL(/\?step=where$/);
    await expect(page.getByTestId('pin-where-step')).toBeVisible();
    // …and the OS back gesture is the in-app ‹ by another route: it drops the
    // pending pin too (S-05b panel, Codex medium).
    await page.goBack();
    await expect(page.getByTestId('presence-screen')).toBeVisible();
    // The pending bar is gone: re-entering the bar step shows no chosen line.
    await page.getByTestId('pin-my-spot').click();
    await expect(page.getByTestId('pin-where-step')).toBeVisible();
    await expect(page.getByTestId('pin-where-chosen')).toHaveCount(0);
    expect(writes).toBe(0);
  });

  test('a deep link to the audience step with nothing chosen is the status screen', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubTonight(page, [NO_BAR]);

    await page.goto('/friends/tonight?step=audience');
    await expect(page.getByTestId('presence-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^You tonight$/ })).toBeVisible();
    await expect(page.getByTestId('tonight-back')).toHaveAttribute('href', '/friends');

    // The ADDRESS follows: the page rewrote the stale step out of the URL, and
    // the entry it consumed is the one the back gesture leaves from — one press
    // (S-05c, both lanes: the entry stack used to keep saying 'audience', so a
    // later back pushed a duplicate the user had to press through twice).
    await expect(page).toHaveURL(/\/friends\/tonight$/);
    await page.getByTestId('pin-my-spot').click();
    await expect(page.getByTestId('pin-where-step')).toBeVisible();
    await page.getByTestId('pin-step-back').click();
    await expect(page.getByTestId('presence-screen')).toBeVisible();
    await expect(page).toHaveURL(/\/friends\/tonight$/);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/friends\/tonight/);

    // …while a deep link to the bar step is that step.
    await page.goto('/friends/tonight?step=where');
    await expect(page.getByTestId('pin-where-step')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /^Where are you\?$/ })).toBeVisible();
  });

  test('all three audience choices are offered on a live pin, and Custom opens Pin your spot on that bar', async ({
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
    let writes = 0;
    await page.route('**/rest/v1/rpc/set_night_presence*', async (route) => {
      writes += 1;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends/tonight');
    const choices = page.getByRole('group', { name: /who can see my pin tonight/i });
    await expect(choices).toBeVisible();
    await expect(page.getByTestId('pin-audience-friends')).toBeVisible();
    await expect(page.getByTestId('pin-audience-close')).toBeVisible();
    await expect(page.getByTestId('pin-audience-people')).toHaveText('Custom');

    // Custom cannot be one tap: it needs a recipient list, and writing it
    // without one is refused server-side. So the tap opens Pin your spot on the
    // live bar, with the picker inline and Pin it HELD.
    await page.getByTestId('pin-audience-people').click();
    const step = page.getByTestId('pin-audience-step');
    await expect(step).toBeVisible();
    await expect(step.getByRole('heading', { name: /attaboy/i })).toBeVisible();
    await expect(page.getByTestId('pin-pending-audience-people')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pin-friend-picker')).toBeVisible();
    await expect(page.getByTestId('pin-audience-search')).toBeVisible();
    await expect(page.getByTestId('pin-pending-audience-count')).toHaveText(/^0 people will see this pin tonight\.$/);
    const pinIt = page.getByTestId('pin-confirm');
    await expect(pinIt).toBeDisabled();
    await expect(pinIt).toHaveAttribute('data-held', 'true');
    // Held is not a click target: force the event and prove nothing was written.
    await pinIt.dispatchEvent('click');
    expect(writes).toBe(0);

    // S-05b addendum: the inline picker never widens the page (iPhone 13 / Pixel 7).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the Custom picker widened the page').toBeLessThanOrEqual(0);

    await page.getByTestId('pin-cancel').click();
    await expect(page.getByTestId('presence-screen')).toBeVisible();
    expect(writes).toBe(0);
  });

  /**
   * S-05 acceptance (Social redesign, README §4): a status tap is ONE write
   * carrying that status, and the ✓ moves to the row that was chosen.
   */
  test('tapping Maybe later writes once with status maybe and moves the one ✓', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    let mine: unknown[] = [];
    await stubTonight(page, []);
    await page.route('**/rest/v1/rpc/get_my_presence*', async (route) => {
      await fulfillJson(200, mine)(route);
    });
    const writes: Array<Record<string, unknown>> = [];
    await page.route('**/rest/v1/rpc/set_night_presence*', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      mine = [{
        status: 'maybe',
        bar_id: null,
        audience: 'friends',
        updated_at: '2026-08-20T02:00:00.000Z',
        recipient_ids: [],
      }];
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends/tonight');
    await expect(page.getByTestId('presence-status-check')).toHaveCount(0);
    await page.getByTestId('presence-status-maybe').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(String(writes[0]?.p_status ?? Object.values(writes[0] ?? {}).find((v) => v === 'maybe'))).toBe('maybe');
    await expect(page.getByTestId('presence-status-check')).toHaveCount(1);
    await expect(page.getByTestId('presence-status-maybe').getByTestId('presence-status-check')).toHaveCount(1);
    await expect(page.getByTestId('presence-status-maybe')).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * S-05 / S-05b acceptance (README §5): the bar search narrows, Custom holds
   * Pin it until somebody is picked, the inline friends search narrows and says
   * "Nobody matches", and Pin it is the ONE write — carrying the bar, the
   * audience `people` and the recipient — after which the screen returns to
   * Social.
   */
  test('the pin sequence: held Pin it, friends search, one write with a recipient, back to Social', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubTonight(page, [NO_BAR]);
    // One MUTUAL friend: in the circle AND a follower (D-C-37).
    const MUTUAL = '66666666-6666-4666-8666-666666666666';
    const mutualRow = [{ id: MUTUAL, handle: 'sam_j', display_name: 'Sam J.' }];
    await page.route('**/rest/v1/rpc/get_following*', fulfillJson(200, mutualRow));
    await page.route('**/rest/v1/rpc/get_followers*', fulfillJson(200, mutualRow));
    // The own-pin read answers with whatever the last write stored, so the
    // header icon on /friends can read the pin this sequence creates.
    let mine: unknown[] = [NO_BAR];
    await page.route('**/rest/v1/rpc/get_my_presence*', async (route) => {
      await fulfillJson(200, mine)(route);
    });
    const writes: Array<Record<string, unknown>> = [];
    await page.route('**/rest/v1/rpc/set_night_presence*', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      mine = [{
        status: body.p_status,
        bar_id: body.p_bar_id,
        audience: body.p_audience,
        updated_at: '2026-08-20T02:05:00.000Z',
        recipient_ids: body.p_recipient_ids ?? [],
      }];
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends/tonight');
    await page.getByTestId('pin-my-spot').click();
    const where = page.getByTestId('pin-where-step');
    // The search NARROWS: "att" keeps Attaboy and drops a bar that does not match.
    const search = where.getByRole('textbox', { name: /search bars/i });
    await search.fill('att');
    await expect(where.getByRole('button', { name: /attaboy/i }).first()).toBeVisible();
    await expect(where.getByRole('button', { name: /death & co/i })).toHaveCount(0);
    await where.getByRole('button', { name: /attaboy/i }).first().click();

    const step = page.getByTestId('pin-audience-step');
    await expect(step).toBeVisible();
    await expect(step).toContainText(/Nothing is shared until you pin it\./);
    expect(writes.length, 'selecting a bar must not write').toBe(0);

    // Custom lights the row, opens the picker INLINE and HOLDS Pin it.
    await page.getByTestId('pin-pending-audience-people').click();
    await expect(page.getByTestId('pin-pending-audience-people')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pin-friend-picker')).toBeVisible();
    await expect(page.getByTestId('pin-pending-audience-count')).toHaveText(/^0 people will see this pin tonight\.$/);
    const pinIt = page.getByTestId('pin-confirm');
    await expect(pinIt).toHaveAttribute('data-held', 'true');
    await expect(pinIt).toBeDisabled();
    // Held is not a click target: force the event and prove nothing was written.
    await pinIt.dispatchEvent('click');
    expect(writes.length, 'a held Pin it must not write').toBe(0);

    // The friends search narrows and says when nobody matches.
    const friendSearch = page.getByTestId('pin-audience-search');
    await friendSearch.fill('zzz');
    await expect(page.getByTestId('pin-audience-no-match')).toContainText(/Nobody matches “zzz”\./);
    await friendSearch.fill('sam');
    await expect(step.getByRole('checkbox')).toHaveCount(1);
    await step.getByRole('checkbox').check();

    // One person picked: the count reads in words and Pin it is live.
    await expect(page.getByTestId('pin-pending-audience-count')).toHaveText(/^1 person will see this pin tonight\.$/);
    await expect(pinIt).toHaveAttribute('data-held', 'false');
    await expect(pinIt).toBeEnabled();
    await pinIt.click();

    // THE ONE WRITE, carrying bar + audience + recipient — then back to Social.
    await expect.poll(() => writes.length, { timeout: 5000 }).toBe(1);
    const body = JSON.stringify(writes[0]);
    expect(body).toContain('attaboy');
    expect(body).toContain('people');
    expect(body).toContain(MUTUAL);
    expect(body).toContain('going');
    await expect(page).toHaveURL(/\/friends$/);
    await expect(page.getByTestId('social-pin-icon')).toHaveAttribute('data-pin-state', 'pinned');
  });

  /**
   * THE ONE WHERE A FAILED READ USED TO CHANGE WHO CAN SEE YOU — round 2, both
   * gates, HIGH. `fetchMyPresence` returned the same `null` for "no pin
   * tonight" and "the read failed", so a transport error rendered the unset
   * row and the next status tap widened a live 'close' or 'people' pin to every
   * follower. The rows are disabled and the row says the read failed; the
   * assertion that protects the user is the negative one.
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

    await page.goto('/friends/tonight');
    // Says what happened, and does NOT render the unset row as if there were
    // no pin (V8-R-OPS-005).
    await expect(page.getByTestId('my-pin-error')).toBeVisible();
    await expect(page.getByTestId('my-pin')).toHaveCount(0);

    // Scoped to the presence region: since S-01 the header's pin icon is also
    // a button whose accessible name says "going out", and it is never disabled.
    const going = page.getByTestId('presence-status-going');
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
 * S-08 — the saved-night recap as drawn (README §8), on the snapshot that
 * S-08a/0083 captures. The archive holds the ordered, rated stops; the recap
 * composes them with the header, the rank action, the photos and the map.
 */
test.describe('S-08: the saved night recap', () => {
  const S8_SAVED = '723e4567-e89b-42d3-a456-426614174111';
  const S8_MEDIA = '823e4567-e89b-42d3-a456-426614174111';

  async function openRecap(
    page: Page,
    context: BrowserContext,
    baseURL: string | undefined,
    bars: Array<{ bar_id: string; sort_order: number; rating: string | null }>,
    opts: { photo?: boolean; barsFail?: boolean } = {},
  ): Promise<void> {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([{ ...sessionCookie(SUPABASE_URL as string), url: baseURL as string }]);
    await stubNightOutRest(page);
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    await page.route('**/api/media/*/url', fulfillJson(404, { ok: false }));
    const photo = opts.photo !== false;
    // get_saved_night* also matches _bars; register the detail first, the bars
    // read LAST so Playwright's newest-first match routes _bars to it.
    await page.route(
      '**/rest/v1/rpc/get_saved_night*',
      fulfillJson(200, [
        {
          id: S8_SAVED, title: 'Birthday crawl', night: CLOSED_WINDOW_NIGHT,
          bar_count: bars.length, archived_at: '2020-01-02T05:00:00.000Z',
          media_id: photo ? S8_MEDIA : null,
          storage_path: photo ? `${USER_ID}/${S8_MEDIA}` : null,
          sort_order: photo ? 1 : null,
        },
      ]),
    );
    await page.route(
      '**/rest/v1/rpc/get_saved_night_bars*',
      opts.barsFail === true
        ? fulfillJson(500, { message: 'stops read failed' })
        : fulfillJson(200, bars),
    );
    await page.goto(`/nights/${S8_SAVED}`);
    await expect(page.getByTestId('saved-night-open')).toBeVisible();
  }

  // R-05a (carried from the S-08 panel): "couldn't read the stops" is its own
  // state, distinct from a night with none.
  test('a failed stops read says so, and shows no stop rows and no map', async ({ page, context, baseURL }) => {
    await openRecap(page, context, baseURL, [], { barsFail: true });
    await expect(page.getByTestId('saved-night-stops-failed')).toBeVisible();
    await expect(page.getByTestId('saved-night-stop')).toHaveCount(0);
    await expect(page.getByTestId('saved-night-map')).toHaveCount(0);
    // The header and photos still render — the night is not "missing".
    await expect(page.getByTestId('saved-night-photos')).toBeVisible();
  });

  test('two stops in order with the right badge on each, and the headline names the Loved bar', async ({ page, context, baseURL }) => {
    // R-05a: the photo-BEARING recap is console-clean too. openRecap
    // deliberately 404s /api/media/*/url ("photos no longer available"), and the
    // browser logs that as a resource error; exactly that one is excluded, so
    // any other error still fails this test.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (/Failed to load resource.*404/.test(text) || /\/api\/media\/.*\/url/.test(text)) return;
      consoleErrors.push(text);
    });
    await openRecap(page, context, baseURL, [
      { bar_id: 'attaboy', sort_order: 1, rating: 'loved' },
      { bar_id: 'dead-rabbit', sort_order: 2, rating: 'pass' },
    ]);
    const stops = page.getByTestId('saved-night-stop');
    await expect(stops).toHaveCount(2);
    await expect(stops.nth(0)).toContainText(/attaboy/i);
    await expect(stops.nth(0)).toContainText(/Loved/i);
    await expect(stops.nth(1)).toContainText(/dead rabbit/i);
    await expect(stops.nth(1)).toContainText(/Pass/);
    await expect(page.getByTestId('saved-night-headline')).toContainText(/2 stops · you loved Attaboy/i);
    // Both stops are rated, so the action points at the rankings.
    await expect(page.getByTestId('saved-night-rank')).toContainText(/See your rankings/i);
    // S-08b: a small inert map with one marker per resolvable stop, the Loved
    // one highlighted, and no zoom control (assert the DOM, not the basemap).
    const map = page.getByTestId('saved-night-map');
    await expect(map).toBeVisible();
    await expect(map.locator('[data-stop]')).toHaveCount(2);
    await expect(map.locator('[data-stop="loved"]')).toHaveCount(1);
    await expect(map.locator('.leaflet-control-zoom')).toHaveCount(0);
    // S-08c #1: the inert pins must not be keyboard tab stops. leaflet's marker
    // icon (the parent of our [data-stop] div) gets tabindex=0 + role=button when
    // `keyboard` is truthy; keyboard={false} must strip both.
    const markerIcons = map.locator('.leaflet-marker-icon');
    await expect(markerIcons).toHaveCount(2);
    await expect(map.locator('.leaflet-marker-icon[tabindex="0"]')).toHaveCount(0);
    await expect(map.locator('.leaflet-marker-icon[role="button"]')).toHaveCount(0);
    expect(consoleErrors, `console errors on /nights/[id]: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  // S-08c #2 (was S-08b acceptance #4): the recap + map render with no console
  // errors on /nights/[id]. Its own test with photo:false, because openRecap
  // deliberately 404s /api/media/*/url to model "photos no longer available",
  // and that intentional 404 is not the map's doing. With no photo the only
  // things loading are the recap shell and the inert map. app-shell-smoke's
  // error filter (type === 'error'), attached BEFORE the goto so mount-time
  // errors are caught too.
  test('the recap and its map render with no console errors', async ({ page, context, baseURL }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await openRecap(
      page,
      context,
      baseURL,
      [
        { bar_id: 'attaboy', sort_order: 1, rating: 'loved' },
        { bar_id: 'dead-rabbit', sort_order: 2, rating: 'pass' },
      ],
      { photo: false },
    );
    // Wait for the inert map and its markers to actually mount before asserting.
    await expect(page.getByTestId('saved-night-map').locator('[data-stop]')).toHaveCount(2);
    // Yield once so any post-mount errors land in the array (app-shell-smoke style).
    await page.waitForTimeout(250);
    expect(consoleErrors, `console errors on /nights/[id]: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('a night with an unrated stop shows "Rank last night" and it navigates', async ({ page, context, baseURL }) => {
    await openRecap(page, context, baseURL, [
      { bar_id: 'attaboy', sort_order: 1, rating: 'liked' },
      { bar_id: 'dead-rabbit', sort_order: 2, rating: null },
    ]);
    // A liked stop, one unrated → rank what is still unrated.
    await expect(page.getByTestId('saved-night-headline')).toContainText(/2 stops$/);
    const rank = page.getByTestId('saved-night-rank');
    await expect(rank).toContainText(/Rank last night/i);
    await rank.click();
    await expect(page).toHaveURL(/\/rankings$/);
  });

  test('nothing on this screen writes, and tapping a stop row does not navigate away', async ({ page, context, baseURL }) => {
    await openRecap(page, context, baseURL, [
      { bar_id: 'attaboy', sort_order: 1, rating: 'loved' },
    ]);
    const url = page.url();
    await page.getByTestId('saved-night-stop').first().click();
    await expect(page).toHaveURL(url);
    await expect(page.getByTestId('saved-night-open')).toBeVisible();
  });

  test('a night with no snapshot bars (a pre-0083 archive) shows the header and photos, no empty stop list', async ({ page, context, baseURL }) => {
    await openRecap(page, context, baseURL, []);
    await expect(page.getByTestId('saved-night-stops')).toHaveCount(0);
    await expect(page.getByTestId('saved-night-headline')).toHaveCount(0);
    await expect(page.getByTestId('saved-night-photos')).toBeVisible();
    // S-08b: no resolvable stop → no map.
    await expect(page.getByTestId('saved-night-map')).toHaveCount(0);
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
    // S-06: WHO'S GOING is mutual follows, so Sam follows back.
    for (const rpc of ['get_following', 'get_followers']) {
      await page.route(
        `**/rest/v1/rpc/${rpc}*`,
        fulfillJson(200, [
          { id: FRIEND_ID, handle: 'sam', display_name: 'Sam Ruiz' },
        ]),
      );
    }
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
    // The suggest fixture is HELD, not slow (V10-04, both lanes of the cycle-2
    // round-2 panel): the test knows exactly when the request has arrived and
    // decides exactly when it is answered, so "no retry while the sequence is
    // in flight" is asserted inside a window the test controls rather than
    // inside 1.5 s that a slow machine could outrun.
    let suggestArrived!: () => void;
    const suggestRequested = new Promise<void>((resolve) => { suggestArrived = resolve; });
    let releaseSuggest!: () => void;
    const suggestReleased = new Promise<void>((resolve) => { releaseSuggest = resolve; });
    await page.route('**/rest/v1/rpc/suggest_night_out_bar*', async (route) => {
      const body = route.request().postDataJSON() as { p_night_out: string; p_bar: string };
      expect(body.p_night_out).toBe(PLAN_ID);
      suggested.push(body.p_bar);
      suggestArrived();
      await suggestReleased;
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
    await expect(action).toHaveText(/Create the night out · 1 invited/);
    await expect(page.getByRole('button', { name: /create the night out/i })).toHaveCount(1);
    // The generic /join share is not a plan invitation and is gone from the planner.
    await expect(page.getByRole('button', { name: /Invite friends to plan tonight/ })).toHaveCount(0);

    // The organizer shortlists a bar by name.
    await barSearch.fill('attaboy');
    await page.getByRole('button', { name: /^Add Attaboy to the shortlist/ }).click();
    await expect(page.getByTestId('shortlist-count')).toHaveText(/1 of 3/);
    await expect(page.getByRole('button', { name: /^Remove Attaboy from the shortlist/ })).toBeVisible();

    await action.click();
    // While the sequence is still running (the suggest request has ARRIVED and
    // is being held), the refused invite is already known — the invite fixture
    // answered before suggest was called — but no retry may be offered yet
    // (cycle-2 round-1 panel, Codex HIGH: `failedInviteIds` publishes before
    // `busy` clears). Three checks 200 ms apart inside the held window: a
    // single check could pass on the render before the panel appears.
    await expect(action).toHaveText(/Creating/);
    await suggestRequested;
    expect(invites).toEqual([FRIEND_ID]);
    for (let check = 0; check < 3; check += 1) {
      await expect(page.getByTestId('unsent-outcome')).toHaveCount(0);
      await expect(action).toHaveText(/Creating/);
      await page.waitForTimeout(200);
    }
    releaseSuggest();
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
    await expect(when).toHaveValue('21:00');
    await when.fill('22:30');
    await expect(when).toHaveValue('22:30');
    const night = '2026-07-24';
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

  /**
   * S-06 — Create a night out, as drawn (README §6). Identity first, then
   * logistics; the WHEN overlap the owner saw on the phone is acceptance 2.
   */
  test.describe('S-06: the create form as drawn', () => {
    const ALEX_ID = '623e4567-e89b-42d3-a456-426614174000';
    const SAM = { id: FRIEND_ID, handle: 'sam', display_name: 'Sam Ruiz' };
    const ALEX = { id: ALEX_ID, handle: 'alex', display_name: 'Alex Chen' };
    const rated = (user_id: string, bar_id: string, score: number) => ({
      user_id,
      bar_id,
      tier: 'loved',
      score,
      rated_at: '2026-07-01T00:00:00.000Z',
    });

    /** Signed in, two mutual friends, optional shared scores. Lands on the form. */
    async function openDrawnForm(
      page: Page,
      context: BrowserContext,
      baseURL: string | undefined,
      opts: { friends?: typeof SAM[]; friendRatings?: ReturnType<typeof rated>[]; youRatings?: Array<{ bar_id: string; score: number }> } = {},
    ): Promise<void> {
      test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
      await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
      await context.addCookies([
        { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
      ]);
      await stubNightOutRest(page);
      await stubSocialShellRest(page);
      for (const rpc of ['get_my_night_outs', 'get_circle_rsvps', 'get_circle_suggestions', 'get_circle_vibe_votes']) {
        await page.route(`**/rest/v1/rpc/${rpc}*`, fulfillJson(200, []));
      }
      await page.route('**/auth/v1/**', fulfillJson(200, {}));
      const friends = opts.friends ?? [SAM, ALEX];
      for (const rpc of ['get_following', 'get_followers']) {
        await page.route(`**/rest/v1/rpc/${rpc}*`, fulfillJson(200, friends));
      }
      await page.route('**/rest/v1/rpc/get_friend_ratings*', fulfillJson(200, opts.friendRatings ?? []));
      await page.route('**/rest/v1/ratings?*', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await fulfillJson(
          200,
          (opts.youRatings ?? []).map((r) => ({ ...r, tier: 'loved', rated_at: '2026-07-02T00:00:00.000Z' })),
        )(route);
      });
      await page.goto('/friends/consensus');
      await expect(page.getByTestId('night-out-plan-fields')).toBeVisible();
      await expect(page.getByText(/Loading your (circle|groups)/)).toHaveCount(0);
      await expect(page.getByTestId('create-night-out')).toBeEnabled({ timeout: 15_000 });
    }

    const topOf = async (locator: Locator): Promise<number> => (await locator.boundingBox())!.y;

    test('1: cover, name, WHEN, AREA, WHO’S GOING, SHORTLIST and the CTA, in that order', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL);
      const cover = page.getByTestId('cover-tile');
      await expect(cover).toContainText(/add a cover photo/i);
      const name = page.getByLabel('Name the night');
      await expect(name).toHaveAttribute('placeholder', 'Name the night');
      await expect(page.getByText('The name and cover are what people see on the invite.')).toBeVisible();
      const when = page.getByTestId('when-field');
      await expect(when).toContainText('Tonight,');
      const area = page.getByLabel(/^Area/);
      await expect(area).toHaveAttribute('placeholder', 'Anywhere');
      const who = page.getByRole('heading', { name: /who.s going/i });
      const shortlist = page.getByRole('heading', { name: /^shortlist$/i });
      await expect(page.getByText(/Seed the vote with up to three bars/)).toBeVisible();
      const cta = page.getByTestId('create-night-out');
      await expect(page.getByText('Creates the plan and sends the invitations.')).toBeVisible();
      const ys = [
        await topOf(cover), await topOf(name), await topOf(when), await topOf(area),
        await topOf(who), await topOf(shortlist), await topOf(cta),
      ];
      for (let i = 1; i < ys.length; i += 1) {
        expect(ys[i], `section ${i} sits below section ${i - 1}: ${ys.join(', ')}`).toBeGreaterThan(ys[i - 1]);
      }
      // The empty tile is inert here (S-06b brings the picker): nothing to tap.
      await expect(cover.getByRole('button')).toHaveCount(0);
    });

    test('2: nothing inside the WHEN field overlaps, and it clears 44px (the owner’s phone bug)', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL);
      const geometry = await page.evaluate(() => {
        const field = document.querySelector<HTMLElement>('[data-testid="when-field"]');
        if (!field) return null;
        const boxes = Array.from(field.querySelectorAll<HTMLElement>('*'))
          .map((el) => ({ tag: el.tagName, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0)
          .map(({ tag, r }) => ({ tag, left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
        const overlaps: string[] = [];
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i];
            const b = boxes[j];
            const inside = (x: typeof a, y: typeof b) =>
              x.left >= y.left && x.right <= y.right && x.top >= y.top && x.bottom <= y.bottom;
            if (inside(a, b) || inside(b, a)) continue; // a wrapper and its child
            const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
            if (!apart) overlaps.push(`${a.tag}${JSON.stringify(a)} x ${b.tag}${JSON.stringify(b)}`);
          }
        }
        return { height: field.getBoundingClientRect().height, width: field.getBoundingClientRect().width, vw: window.innerWidth, overlaps };
      });
      expect(geometry).not.toBeNull();
      expect(geometry!.overlaps, geometry!.overlaps.join('\n')).toEqual([]);
      expect(geometry!.height).toBeGreaterThanOrEqual(44);
      expect(geometry!.width).toBeLessThanOrEqual(geometry!.vw);
      // The tappable control itself, not only its wrapper (round-1 Fable MEDIUM).
      const input = await page.locator('#night-out-when').boundingBox();
      expect(input!.height).toBeGreaterThanOrEqual(44);
    });

    test('3: a name and two friends make the CTA read “Create the night out · 2 invited”', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL);
      await page.getByLabel('Name the night').fill('Sam’s birthday');
      const cta = page.getByTestId('create-night-out');
      const alex = page.getByRole('button', { name: /^Alex Chen/ });
      await expect(alex).toHaveAttribute('aria-pressed', 'true');
      await expect(cta).toHaveText('Create the night out · 2 invited');
      await alex.click();
      await expect(alex).toHaveAttribute('aria-pressed', 'false');
      await expect(cta).toHaveText('Create the night out · 1 invited');
      await alex.click();
      await expect(cta).toHaveText('Create the night out · 2 invited');
      // The name is capped where the column is.
      await page.getByLabel('Name the night').fill('x'.repeat(90));
      await expect(page.getByLabel('Name the night')).toHaveValue('x'.repeat(80));
      await expect(page.getByText('80 characters is the limit.')).toBeVisible();
    });

    test('4: the shortlist caps at three — a fourth + does nothing and the counter stops at 3 of 3', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL);
      const count = page.getByTestId('shortlist-count');
      await expect(count).toHaveText('0 of 3');
      await page.getByLabel('Add a bar to the shortlist').fill('a');
      const adds = page.getByRole('button', { name: /^Add .* to the shortlist$/ });
      await expect.poll(() => adds.count()).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < 3; i += 1) {
        // Always the first still-addable row; picked rows move to the top.
        await adds.first().click();
        await expect(count).toHaveText(`${i + 1} of 3`);
      }
      await expect(page.getByRole('button', { name: /^Remove .* from the shortlist$/ })).toHaveCount(3);
      const fourth = adds.first();
      await expect(fourth).toBeDisabled();
      await fourth.click({ force: true });
      await expect(count).toHaveText('3 of 3');
      await expect(page.getByRole('button', { name: /^Remove .* from the shortlist$/ })).toHaveCount(3);
    });

    test('5: Group Favorites are offered first, before the search; the top pick is shareable and a near-miss is marked', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL, {
        friendRatings: [
          rated(FRIEND_ID, 'death-and-co', 9), rated(ALEX_ID, 'death-and-co', 8.5),
          rated(FRIEND_ID, 'attaboy', 7), rated(ALEX_ID, 'attaboy', 9),
        ],
        youRatings: [{ bar_id: 'death-and-co', score: 9 }, { bar_id: 'attaboy', score: 9 }],
      });
      await expect(page.getByRole('button', { name: /Share the pick: Death & Co/ })).toBeVisible();
      await expect(page.getByTestId('near-miss-badge')).toHaveCount(1);
      const rows = page.getByTestId('shortlist-row');
      await expect(rows.first()).toHaveAttribute('data-bar-id', 'death-and-co');
      await expect(rows.nth(1)).toHaveAttribute('data-bar-id', 'attaboy');
      await page.getByLabel('Add a bar to the shortlist').fill('mood ring');
      await expect(rows.filter({ hasText: /mood ring/i })).toHaveCount(1);
      // Still favourites first, the search result after them.
      await expect(rows.first()).toHaveAttribute('data-bar-id', 'death-and-co');
      const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-bar-id')));
      expect(ids.indexOf('death-and-co')).toBeLessThan(ids.indexOf('mood-ring'));
      expect(ids.indexOf('attaboy')).toBeLessThan(ids.indexOf('mood-ring'));
    });

    test('6: one create call carries the title; a 500 keeps the form and its values, and says so', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL);
      let createCalls = 0;
      let invites = 0;
      let suggests = 0;
      await page.route('**/rest/v1/rpc/create_night_out*', async (route) => {
        createCalls += 1;
        expect(route.request().postDataJSON()).toEqual({
          p_night: '2026-07-24',
          p_title: 'Sam’s birthday',
          p_idempotency_key: expect.any(String),
        });
        await fulfillJson(500, { message: 'boom' })(route);
      });
      await page.route('**/rest/v1/rpc/invite_one_to_night_out*', async (route) => {
        invites += 1;
        await fulfillJson(200, true)(route);
      });
      await page.route('**/rest/v1/rpc/suggest_night_out_bar*', async (route) => {
        suggests += 1;
        await fulfillJson(200, true)(route);
      });
      await page.getByLabel('Name the night').fill('Sam’s birthday');
      await page.getByLabel(/^Area/).fill('East Village');
      await page.getByLabel('Add a bar to the shortlist').fill('attaboy');
      await page.getByRole('button', { name: /^Add Attaboy to the shortlist/ }).click();
      const cta = page.getByTestId('create-night-out');
      await expect(cta).toHaveText('Create the night out · 2 invited');
      await cta.click();
      await expect.poll(() => createCalls).toBe(1);
      await expect(page.getByText(/Couldn.t start it/)).toBeVisible();
      await expect(page).toHaveURL(/\/friends\/consensus/);
      await expect(page.getByLabel('Name the night')).toHaveValue('Sam’s birthday');
      await expect(page.getByLabel(/^Area/)).toHaveValue('East Village');
      await expect(page.getByRole('button', { name: /^Remove Attaboy from the shortlist/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Sam Ruiz/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(cta).toBeEnabled();
      expect(createCalls).toBe(1);
      expect(invites, 'no plan, so nobody to invite').toBe(0);
      expect(suggests, 'no plan, so nothing to suggest').toBe(0);
    });

    test('6b: one named submission carries the title, both invitees and the shortlist, then opens the plan', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL);
      await stubOwnerRpcs(page);
      const creates: unknown[] = [];
      const invited: string[] = [];
      const suggested: string[] = [];
      await page.route('**/rest/v1/rpc/create_night_out*', async (route) => {
        creates.push(route.request().postDataJSON());
        await fulfillJson(200, PLAN_ID)(route);
      });
      await page.route('**/rest/v1/rpc/invite_one_to_night_out*', async (route) => {
        const body = route.request().postDataJSON() as { p_night_out: string; p_user: string; p_group: string | null };
        expect(body.p_night_out).toBe(PLAN_ID);
        expect(body.p_group).toBeNull();
        invited.push(body.p_user);
        await fulfillJson(200, true)(route);
      });
      await page.route('**/rest/v1/rpc/suggest_night_out_bar*', async (route) => {
        const body = route.request().postDataJSON() as { p_night_out: string; p_bar: string };
        expect(body.p_night_out).toBe(PLAN_ID);
        suggested.push(body.p_bar);
        await fulfillJson(200, true)(route);
      });
      await page.route('**/rest/v1/rpc/get_my_night_outs*', fulfillJson(200, []));
      await page.getByLabel('Name the night').fill('Sam’s birthday');
      await page.getByLabel('Add a bar to the shortlist').fill('attaboy');
      await page.getByRole('button', { name: /^Add Attaboy to the shortlist/ }).click();
      await page.getByTestId('create-night-out').click();
      await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}$`));
      expect(creates).toEqual([
        { p_night: '2026-07-24', p_title: 'Sam’s birthday', p_idempotency_key: expect.any(String) },
      ]);
      expect(invited.sort()).toEqual([FRIEND_ID, ALEX_ID].sort());
      expect(suggested).toEqual(['attaboy']);
    });

    test('8: a failed followers read holds the CTA and says the circle could not load (round-1 HIGH)', async ({
      page,
      context,
      baseURL,
    }) => {
      test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
      await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
      await context.addCookies([
        { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
      ]);
      await stubNightOutRest(page);
      await stubSocialShellRest(page);
      for (const rpc of ['get_my_night_outs', 'get_circle_rsvps', 'get_circle_suggestions', 'get_circle_vibe_votes']) {
        await page.route(`**/rest/v1/rpc/${rpc}*`, fulfillJson(200, []));
      }
      await page.route('**/auth/v1/**', fulfillJson(200, {}));
      await page.route('**/rest/v1/rpc/get_following*', fulfillJson(200, [SAM, ALEX]));
      await page.route('**/rest/v1/rpc/get_followers*', fulfillJson(500, { message: 'boom' }));
      await page.goto('/friends/consensus');
      await expect(page.getByTestId('night-out-plan-fields')).toBeVisible();
      await expect(page.getByText(/Couldn.t load your circle/)).toBeVisible();
      await expect(page.getByTestId('create-night-out')).toBeDisabled();
      // Nobody is offered, and nobody is counted.
      await expect(page.getByRole('button', { name: /^Sam Ruiz/ })).toHaveCount(0);
      await expect(page.getByTestId('create-night-out')).toHaveText('Create the night out');
    });

    /** S-06b — the cover: tile → picker → template → the created plan carries it → the board shows it. */
    test('S-06b 2+4: the tile opens the picker, a template fills it, the plan carries it and the board header shows it', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL);
      await stubOwnerRpcs(page);
      await page.route('**/rest/v1/rpc/create_night_out*', fulfillJson(200, PLAN_ID));
      await page.route('**/rest/v1/rpc/invite_one_to_night_out*', fulfillJson(200, true));
      await page.route('**/rest/v1/rpc/get_my_night_outs*', fulfillJson(200, []));
      const coverWrites: unknown[] = [];
      await page.route('**/rest/v1/rpc/set_night_out_cover*', async (route) => {
        coverWrites.push(route.request().postDataJSON());
        await fulfillJson(200, true)(route);
      });
      // What the board will read back once the plan exists.
      await page.route('**/rest/v1/night_outs?*', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await fulfillJson(200, [{ id: PLAN_ID, cover: 'template:rooftop' }])(route);
      });

      const tile = page.getByTestId('cover-tile');
      await expect(tile).toContainText(/add a cover photo/i);
      await tile.click();
      const picker = page.getByTestId('cover-picker');
      await expect(picker).toBeVisible();
      await expect(picker.getByRole('button', { name: /cover$/ })).toHaveCount(6);
      await picker.getByTestId('cover-template-rooftop').click();
      await expect(picker).toHaveCount(0);
      await expect(tile).toHaveAttribute('data-cover', 'template:rooftop');
      await expect(page.getByTestId('cover-tile-image')).toContainText(/rooftop/i);
      await expect(page.getByTestId('cover-tile-image')).toHaveAttribute('data-cover-state', 'ok');

      await page.getByTestId('create-night-out').click();
      await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}$`));
      expect(coverWrites).toEqual([{ p_night_out: PLAN_ID, p_cover: 'template:rooftop' }]);

      // The board header: cover on top, title still legible under it.
      const boardCover = page.getByTestId('plan-cover');
      await expect(boardCover).toBeVisible();
      await expect(boardCover).toHaveAttribute('data-cover', 'rooftop');
      await expect(boardCover).toHaveAttribute('data-cover-state', 'ok');
      const title = page.getByRole('heading', { level: 1 });
      await expect(title).toBeVisible();
      // R-03 item 10: the title lies ENTIRELY below the cover, not merely lower.
      const coverBox = (await boardCover.boundingBox())!;
      const titleBox = (await title.boundingBox())!;
      expect(titleBox.y).toBeGreaterThanOrEqual(coverBox.y + coverBox.height);
    });

    test('S-06b 3: a plan created without a cover writes none and renders as before on the board', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL);
      await stubOwnerRpcs(page);
      await page.route('**/rest/v1/rpc/create_night_out*', fulfillJson(200, PLAN_ID));
      await page.route('**/rest/v1/rpc/invite_one_to_night_out*', fulfillJson(200, true));
      await page.route('**/rest/v1/rpc/get_my_night_outs*', fulfillJson(200, []));
      let coverWrites = 0;
      await page.route('**/rest/v1/rpc/set_night_out_cover*', async (route) => {
        coverWrites += 1;
        await fulfillJson(200, true)(route);
      });
      await page.route('**/rest/v1/night_outs?*', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await fulfillJson(200, [{ id: PLAN_ID, cover: null }])(route);
      });
      await page.getByTestId('create-night-out').click();
      await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('plan-cover-state')).toHaveAttribute('data-plan-cover-state', 'none');
      await expect(page.getByTestId('plan-cover')).toHaveCount(0);
      expect(coverWrites, 'NULL is the default; no write for no cover').toBe(0);
    });

    /** S-06c — "Choose from library": the file goes through /api/media/upload, the plan carries media:<id>, the board shows the signed picture. */
    test('S-06c 2+4: a library photo uploads through the boundary, fills the tile, the plan carries media:<id>, and the board shows it via /api/media/:id/url', async ({
      page,
      context,
      baseURL,
    }) => {
      const MEDIA_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
      await openDrawnForm(page, context, baseURL);
      await stubOwnerRpcs(page);
      await page.route('**/rest/v1/rpc/create_night_out*', fulfillJson(200, PLAN_ID));
      await page.route('**/rest/v1/rpc/invite_one_to_night_out*', fulfillJson(200, true));
      await page.route('**/rest/v1/rpc/get_my_night_outs*', fulfillJson(200, []));
      const coverWrites: unknown[] = [];
      await page.route('**/rest/v1/rpc/set_night_out_cover*', async (route) => {
        coverWrites.push(route.request().postDataJSON());
        await fulfillJson(200, true)(route);
      });
      // The ONLY way bytes reach the media bucket: one multipart POST with a bearer token.
      const uploads: Array<{ auth: string | undefined; hasFile: boolean }> = [];
      await page.route('**/api/media/upload', async (route) => {
        const headers = route.request().headers();
        uploads.push({
          auth: headers['authorization'],
          hasFile: /name="file"/.test(route.request().postData() ?? ''),
        });
        await fulfillJson(200, { ok: true, mediaId: MEDIA_ID, storagePath: `${USER_ID}/${MEDIA_ID}` })(route);
      });
      // The picture resolves through the boundary route, never off Storage.
      const urlReads: string[] = [];
      await page.route('**/api/media/*/url', async (route) => {
        urlReads.push(route.request().url());
        await fulfillJson(200, { ok: true, url: '/covers/birthday.svg', expiresInSeconds: 300 })(route);
      });
      await page.route('**/rest/v1/night_outs?*', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await fulfillJson(200, [{ id: PLAN_ID, cover: `media:${MEDIA_ID}` }])(route);
      });

      const tile = page.getByTestId('cover-tile');
      await tile.click();
      const picker = page.getByTestId('cover-picker');
      await expect(picker).toBeVisible();
      const library = picker.getByTestId('cover-choose-library');
      await expect(library).toContainText(/choose from library/i);
      expect((await library.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // A native file input: on a phone this is the photo library.
      await picker.getByTestId('cover-library-input').setInputFiles({
        name: 'me.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('not-really-a-jpeg'),
      });
      await expect(picker).toHaveCount(0);
      await expect.poll(() => uploads.length).toBe(1);
      expect(uploads[0].auth).toMatch(/^Bearer /);
      expect(uploads[0].hasFile).toBe(true);
      await expect(tile).toHaveAttribute('data-cover', `media:${MEDIA_ID}`);
      const tileImage = page.getByTestId('cover-tile-image');
      await expect(tileImage).toHaveAttribute('data-cover', 'media');
      await expect(tileImage).toHaveAttribute('data-cover-state', 'ok');
      // R-05a: a library cover is seen by every member, so it carries no
      // "Your photo" chip; the image's alt is neutral.
      await expect(tileImage).not.toContainText(/your photo/i);
      await expect(tileImage.getByRole('img')).toHaveAttribute('alt', 'Cover photo');
      expect(urlReads[0]).toContain(`/api/media/${MEDIA_ID}/url`);

      await page.getByTestId('create-night-out').click();
      await expect(page).toHaveURL(new RegExp(`/night-out/${TOKEN}$`));
      expect(coverWrites).toEqual([{ p_night_out: PLAN_ID, p_cover: `media:${MEDIA_ID}` }]);

      // The board header shows the same photo, read back from the plan and resolved through the route.
      const boardCover = page.getByTestId('plan-cover');
      await expect(boardCover).toBeVisible();
      await expect(boardCover).toHaveAttribute('data-cover', 'media');
      await expect(boardCover).toHaveAttribute('data-cover-state', 'ok');
      await expect(boardCover.locator('img')).toHaveAttribute('src', /covers\/birthday\.svg$/);

      // It survives a reload of the board.
      await page.reload();
      await expect(page.getByTestId('plan-cover')).toHaveAttribute('data-cover-state', 'ok');
    });

    test('S-06c: a refused upload says so in the sheet and leaves the cover untouched — never a dead end', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDrawnForm(page, context, baseURL);
      await stubOwnerRpcs(page);
      await page.route('**/api/media/upload', fulfillJson(413, { ok: false, error: 'too_large' }));
      const tile = page.getByTestId('cover-tile');
      await tile.click();
      const picker = page.getByTestId('cover-picker');
      await picker.getByTestId('cover-library-input').setInputFiles({
        name: 'huge.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('x'),
      });
      await expect(picker.getByTestId('cover-library-error')).toContainText(/too large/i);
      await expect(picker).toBeVisible();
      await expect(tile).toHaveAttribute('data-cover', '');
      // The templates are still there to fall back on.
      await picker.getByTestId('cover-template-rooftop').click();
      await expect(tile).toHaveAttribute('data-cover', 'template:rooftop');
    });

    test('S-06b 3+4 (invitation): the Plans card shows the cover only when the plan has one', async ({
      page,
      context,
      baseURL,
    }) => {
      test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
      await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
      await context.addCookies([
        { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
      ]);
      const WITH_COVER = '723e4567-e89b-42d3-a456-426614174000';
      const NO_COVER = '823e4567-e89b-42d3-a456-426614174000';
      const notification = (id: number, nightOutId: string, title: string) => ({
        id,
        night_out_id: nightOutId,
        night: '2026-07-24',
        title,
        group_name: null,
        invited_by: 'sam',
        created_at: '2026-07-24T20:00:00.000Z',
        read_at: null,
      });
      await stubNightOutRest(page);
      await stubSocialShellRest(page);
      for (const rpc of ['get_my_night_outs', 'get_circle_rsvps', 'get_circle_suggestions', 'get_circle_vibe_votes']) {
        await page.route(`**/rest/v1/rpc/${rpc}*`, fulfillJson(200, []));
      }
      await page.route('**/auth/v1/**', fulfillJson(200, {}));
      await page.route(
        '**/rest/v1/rpc/get_my_night_out_invitation_notifications*',
        fulfillJson(200, [notification(1, WITH_COVER, 'Birthday drinks'), notification(2, NO_COVER, 'Quiet one')]),
      );
      // The card people actually see (round-1 Codex HIGH): a membership-backed
      // pending invitation renders through PlanInvites, and PlansSection hides
      // the matching notification. So a THIRD plan comes through get_my_night_outs.
      const PENDING = '923e4567-e89b-42d3-a456-426614174000';
      await page.route('**/rest/v1/rpc/get_my_night_outs*', fulfillJson(200, [{
        night_out_id: PENDING,
        night: '2026-07-24',
        title: 'Rooftop first',
        status: 'open',
        owner_handle: 'sam',
        owner_display_name: 'Sam Ruiz',
        my_status: 'pending',
        responded_at: null,
        accepted_count: 1,
        share_token: null,
        plan_updated: false,
        is_past: false,
        my_revision: 1,
      }]));
      await page.route('**/rest/v1/night_outs?*', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const url = route.request().url();
        const body = url.includes(WITH_COVER)
          ? [{ id: WITH_COVER, cover: 'template:birthday' }]
          : url.includes(PENDING)
            ? [{ id: PENDING, cover: 'template:rooftop' }]
            : [{ id: NO_COVER, cover: null }];
        await fulfillJson(200, body)(route);
      });
      await page.goto('/friends');
      const plans = page.getByRole('tab', { name: 'Plans' });
      await expect(plans).toBeEnabled({ timeout: 15_000 });
      await plans.click();
      const pending = page.getByTestId('invite-pending');
      await expect(pending).toHaveCount(1);
      await expect(pending.getByTestId('invite-cover')).toBeVisible();
      await expect(pending.getByTestId('invite-cover')).toHaveAttribute('data-cover', 'rooftop');
      await expect(pending).toContainText('Rooftop first');
      const cards = page.getByTestId('group-invite-notification');
      await expect(cards).toHaveCount(2);
      const withCover = cards.filter({ hasText: 'Birthday drinks' });
      await expect(withCover.getByTestId('invite-cover')).toBeVisible();
      await expect(withCover.getByTestId('invite-cover')).toHaveAttribute('data-cover', 'birthday');
      const noCover = cards.filter({ hasText: 'Quiet one' });
      await expect(noCover.getByTestId('invite-cover')).toHaveCount(0);
      await expect(noCover.getByTestId('invite-cover-state')).toHaveAttribute('data-plan-cover-state', 'none');
    });

    test('R-03 8: nothing unanimous — every card is a near-miss, none is shareable; and fewer than two people is the empty state', async ({
      page,
      context,
      baseURL,
    }) => {
      // Sam loves it, Alex does not: no bar clears 8.0 for everyone selected.
      await openDrawnForm(page, context, baseURL, {
        friendRatings: [
          rated(FRIEND_ID, 'death-and-co', 9), rated(ALEX_ID, 'death-and-co', 7),
          rated(FRIEND_ID, 'attaboy', 8.5), rated(ALEX_ID, 'attaboy', 6),
        ],
        youRatings: [{ bar_id: 'death-and-co', score: 9 }, { bar_id: 'attaboy', score: 9 }],
      });
      await expect(page.getByTestId('no-unanimous-pick')).toBeVisible();
      const cards = page.locator('article');
      await expect.poll(() => cards.count()).toBeGreaterThan(0);
      await expect(page.getByTestId('near-miss-badge')).toHaveCount(await cards.count());
      await expect(page.getByRole('button', { name: /^Share the pick/ })).toHaveCount(0);
      // Deselect everyone but You: consensus needs a group.
      await page.getByRole('button', { name: /^Sam Ruiz/ }).click();
      await page.getByRole('button', { name: /^Alex Chen/ }).click();
      await expect(page.getByText(/Pick at least two people/i)).toBeVisible();
      await expect(page.getByTestId('no-unanimous-pick')).toHaveCount(0);
    });


    test('7: signed out, the screen is /auth', async ({ page }) => {
      await stubNightOutRest(page);
      await stubSocialShellRest(page);
      await page.route('**/auth/v1/**', fulfillJson(200, {}));
      await page.goto('/friends/consensus');
      await expect(page).toHaveURL(/\/auth(\?|$)/);
      await expect(page.getByTestId('night-out-plan-fields')).toHaveCount(0);
    });
  });

});

/**
 * S-07 — the plan board as drawn (README §7). Acceptance 1 (the split changes
 * no behaviour) is the unedited run of everything above this block on the
 * split commit. Acceptance 4 (single-transfer voting) is NOT asserted: the
 * server's vote writer is insert-only and nothing clears a vote, so the goal's
 * own instruction applies — surface it, no migration — and the last case here
 * states what the board does today instead.
 */
test.describe('S-07: the plan board as drawn', () => {
  const PDT = 'please-dont-tell';

  /** The owner's view with a get_night_out override layered on top of stubOwnerRpcs. */
  async function openOwnerBoard(
    page: Page,
    context: BrowserContext,
    baseURL: string | undefined,
    planPatch: Record<string, unknown> = {},
    opts: { boardFails?: boolean; board?: unknown[] } = {},
  ): Promise<void> {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubOwnerRpcs(page);
    await page.route('**/rest/v1/rpc/get_night_out*', async (route) => {
      const url = route.request().url();
      if (opts.boardFails && url.includes('get_night_out_board')) {
        return fulfillJson(500, { message: 'boom' })(route);
      }
      if (opts.board && url.includes('get_night_out_board')) {
        return fulfillJson(200, opts.board)(route);
      }
      if (!/\/rpc\/get_night_out(?:\?|$)/.test(url)) return route.fallback();
      await fulfillJson(200, [{ ...PLAN_ROW, caller_role: 'owner', ...planPatch }])(route);
    });
    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('plan-header')).toBeVisible();
  }

  test('2: a plan with a name shows it; one without says "Where are we going?"', async ({
    page,
    context,
    baseURL,
  }) => {
    await openOwnerBoard(page, context, baseURL);
    await expect(page.getByTestId('plan-title')).toHaveText(PLAN_ROW.title);
    await expect(page.getByTestId('plan-meta')).toContainText(/hosted by you/);
    await page.goto('/friends');
    await page.route('**/rest/v1/rpc/get_night_out*', async (route) => {
      const url = route.request().url();
      if (!/\/rpc\/get_night_out(?:\?|$)/.test(url)) return route.fallback();
      await fulfillJson(200, [{ ...PLAN_ROW, caller_role: 'owner', title: null }])(route);
    });
    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('plan-title')).toHaveText('Where are we going?');
  });

  test('3+5+6: LEADING on exactly one row while open, a zero-vote suggestion shows 0, and the host locks the TOP bar', async ({
    page,
    context,
    baseURL,
  }) => {
    await openOwnerBoard(page, context, baseURL, {}, {
      board: [
        { bar_id: 'attaboy', suggested_by_handle: 'conor', votes: 1, caller_voted: false },
        { bar_id: PDT, suggested_by_handle: 'sam', votes: 5, caller_voted: false },
        { bar_id: 'mood-ring', suggested_by_handle: 'conor', votes: 0, caller_voted: false },
      ],
    });
    const rows = page.getByTestId('shortlist-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute('data-bar-id', PDT);
    await expect(page.getByTestId('shortlist-leading')).toHaveCount(1);
    await expect(rows.first().getByTestId('shortlist-leading')).toBeVisible();
    await expect(page.getByTestId('shortlist-picked')).toHaveCount(0);
    await expect(page.getByTestId('shortlist-state')).toHaveCount(0);
    // A suggestion lands with zero votes, including the suggester's own.
    await expect(rows.nth(2)).toHaveAttribute('data-bar-id', 'mood-ring');
    await expect(rows.nth(2)).toContainText(/suggested by you/);
    await expect(rows.nth(2).getByRole('button', { name: /^Vote for Mood Ring/ })).toContainText('0');
    // The vote control is 46px and the host's lock names the leader.
    const vote = await rows.first().getByRole('button', { name: /^Vote for/ }).boundingBox();
    expect(vote!.width).toBeGreaterThanOrEqual(46);
    expect(vote!.height).toBeGreaterThanOrEqual(46);
    const lock = page.getByTestId('night-out-lock');
    await expect(lock).toHaveText(`Lock in ${PDT}`);
    expect((await lock.boundingBox())!.height).toBeGreaterThanOrEqual(52);
    await expect(page.getByText(/You.re the host, so you decide/)).toBeVisible();
  });

  test('6: a member never sees Lock in', async ({ page, context, baseURL }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page);
    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('plan-shortlist')).toBeVisible();
    await expect(page.getByTestId('night-out-lock')).toHaveCount(0);
    await expect(page.getByTestId('member-board')).toContainText(/Going/);
  });

  test('7: decided — the banner renders, the shortlist reads VOTING CLOSED, PICKED marks the bar, nothing votes', async ({
    page,
    context,
    baseURL,
  }) => {
    let votes = 0;
    await openOwnerBoard(page, context, baseURL, { status: 'decided', decided_bar_id: PDT });
    await page.route('**/rest/v1/rpc/vote_night_out_bar*', async (route) => {
      votes += 1;
      await fulfillJson(200, true)(route);
    });
    const banner = page.getByTestId('decided-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Decided/i);
    await expect(banner.getByRole('link', { name: 'Directions' })).toHaveCount(0); // PDT is not in the catalog fixture
    await expect(banner.getByRole('button', { name: 'Share' })).toBeVisible();
    await expect(page.getByTestId('shortlist-state')).toHaveText(/Voting closed/i);
    await expect(page.getByTestId('shortlist-picked')).toHaveCount(1);
    await expect(page.getByTestId('shortlist-row').first().getByTestId('shortlist-picked')).toBeVisible();
    await expect(page.getByTestId('shortlist-leading')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Vote for/ })).toHaveCount(0);
    await expect(page.getByTestId('night-out-lock')).toHaveCount(0);
    expect(votes).toBe(0);
  });

  test('8: a failed board read says so and never renders an empty shortlist', async ({
    page,
    context,
    baseURL,
  }) => {
    await openOwnerBoard(page, context, baseURL, {}, { boardFails: true });
    await expect(page.getByTestId('night-out-board-failed')).toBeVisible();
    await expect(page.getByTestId('night-out-board')).toHaveCount(0);
    await expect(page.getByText(/No suggestions yet/)).toHaveCount(0);
    await expect(page.getByTestId('night-out-lock')).toBeDisabled();
  });

  test('4: one vote that moves — vote A, vote B: one call each, exactly one vote remains and it is on B; tapping the held bar clears it', async ({
    page,
    context,
    baseURL,
  }) => {
    const votes: Array<Record<string, unknown>> = [];
    const unvotes: unknown[] = [];
    // R-04 item 1: acceptance 1 is "vote A, vote B, exactly one vote remains —
    // on B", so the board starts with NO vote held (the earlier version began
    // from a held vote and only ever proved "vote B, then clear B"). The board
    // the server hands back after each write: A held, then B held, then none.
    let phase: 'start' | 'heldA' | 'heldB' | 'cleared' = 'start';
    const boards = {
      start: [
        { bar_id: PDT, suggested_by_handle: 'sam', votes: 4, caller_voted: false },
        { bar_id: 'attaboy', suggested_by_handle: 'conor', votes: 1, caller_voted: false },
      ],
      heldA: [
        { bar_id: PDT, suggested_by_handle: 'sam', votes: 5, caller_voted: true },
        { bar_id: 'attaboy', suggested_by_handle: 'conor', votes: 1, caller_voted: false },
      ],
      heldB: [
        { bar_id: PDT, suggested_by_handle: 'sam', votes: 4, caller_voted: false },
        { bar_id: 'attaboy', suggested_by_handle: 'conor', votes: 2, caller_voted: true },
      ],
      cleared: [
        { bar_id: PDT, suggested_by_handle: 'sam', votes: 4, caller_voted: false },
        { bar_id: 'attaboy', suggested_by_handle: 'conor', votes: 1, caller_voted: false },
      ],
    };
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubOwnerRpcs(page);
    await page.route('**/rest/v1/rpc/get_night_out*', async (route) => {
      const url = route.request().url();
      if (url.includes('get_night_out_board')) return fulfillJson(200, boards[phase])(route);
      return route.fallback();
    });
    await page.route('**/rest/v1/rpc/vote_night_out_bar*', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      votes.push(body);
      phase = body.p_bar === PDT ? 'heldA' : 'heldB';
      await fulfillJson(200, true)(route);
    });
    await page.route('**/rest/v1/rpc/unvote_night_out_bar*', async (route) => {
      unvotes.push(route.request().postDataJSON());
      phase = 'cleared';
      await fulfillJson(200, true)(route);
    });
    await page.goto(`/night-out/${TOKEN}`);
    const rows = page.getByTestId('shortlist-row');
    await expect(rows.first()).toHaveAttribute('data-bar-id', PDT);
    await expect(page.getByTestId('shortlist-voted')).toHaveCount(0);

    // Vote A: one call, and the refreshed board holds exactly one vote — on A.
    await rows.first().getByRole('button', { name: /^Vote for/ }).click();
    await expect.poll(() => votes.length).toBe(1);
    expect(votes[0]).toEqual({ p_night_out: PLAN_ID, p_bar: PDT });
    await expect(page.getByTestId('shortlist-voted')).toHaveCount(1);
    await expect(rows.first().getByTestId('shortlist-voted')).toBeVisible();

    // Vote B: a second call for B, and the vote MOVED — one held row, and it is B; A's row is no longer held.
    await rows.nth(1).getByRole('button', { name: /^Vote for Attaboy/ }).click();
    await expect.poll(() => votes.length).toBe(2);
    expect(votes[1]).toEqual({ p_night_out: PLAN_ID, p_bar: 'attaboy' });
    await expect(page.getByTestId('shortlist-voted')).toHaveCount(1);
    await expect(page.getByTestId('shortlist-voted')).toHaveAttribute('aria-label', /^Your vote on Attaboy/);
    await expect(rows.first().getByTestId('shortlist-voted')).toHaveCount(0);
    await expect(page.getByTestId('shortlist-row').filter({ hasText: /your vote/i })).toHaveCount(1);
    expect(unvotes.length, 'moving a vote is one cast, never an unvote').toBe(0);

    // Tap the held bar: one unvote call, no vote left.
    await page.getByTestId('shortlist-voted').click();
    await expect.poll(() => unvotes.length).toBe(1);
    expect(unvotes[0]).toEqual({ p_night_out: PLAN_ID, p_bar: 'attaboy' });
    await expect(page.getByTestId('shortlist-voted')).toHaveCount(0);
    expect(votes.length, 'clearing never casts').toBe(2);
  });
});

/** R-03 — the wave-2 MEDIUMs, each pinned where it was found. */
test.describe('R-03: wave-2 review follow-ups', () => {
  const PDT = 'please-dont-tell';
  const FRIEND_ID = '523e4567-e89b-42d3-a456-426614174000';

  async function ownerBoard(
    page: Page,
    context: BrowserContext,
    baseURL: string | undefined,
    planPatch: Record<string, unknown> = {},
    board?: unknown[],
  ): Promise<void> {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubOwnerRpcs(page);
    await page.route('**/rest/v1/rpc/get_night_out*', async (route) => {
      const url = route.request().url();
      if (board && url.includes('get_night_out_board')) return fulfillJson(200, board)(route);
      if (!/\/rpc\/get_night_out(?:\?|$)/.test(url)) return route.fallback();
      await fulfillJson(200, [{ ...PLAN_ROW, caller_role: 'owner', ...planPatch }])(route);
    });
    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('plan-header')).toBeVisible();
  }

  test('1: the row that holds your vote says so in words, and its control has an accessible name', async ({
    page,
    context,
    baseURL,
  }) => {
    await ownerBoard(page, context, baseURL, {}, [
      { bar_id: PDT, suggested_by_handle: 'sam', votes: 5, caller_voted: true },
      { bar_id: 'attaboy', suggested_by_handle: 'conor', votes: 1, caller_voted: false },
    ]);
    const held = page.getByTestId('shortlist-row').first();
    await expect(held).toContainText(/your vote/i);
    // Open plan (S-07b): the held control is a button named for what a tap does.
    await expect(held.getByRole('button', { name: /^Your vote on/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('5: "Suggest another bar" is a picker — type a name, tap +, one suggest call; nothing matches says so', async ({
    page,
    context,
    baseURL,
  }) => {
    await ownerBoard(page, context, baseURL);
    const calls: unknown[] = [];
    await page.route('**/rest/v1/rpc/suggest_night_out_bar*', async (route) => {
      calls.push(route.request().postDataJSON());
      await fulfillJson(200, true)(route);
    });
    const box = page.getByRole('searchbox', { name: /suggest a bar/i });
    await box.fill('zzzz-no-such-bar');
    await expect(page.getByText('No matching bars.')).toBeVisible();
    await box.fill('mood');
    const row = page.getByTestId('suggest-matches').locator('[data-bar-id="mood-ring"]');
    await expect(row).toContainText('Mood Ring');
    await row.getByRole('button', { name: /^Suggest Mood Ring/ }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual({ p_night_out: PLAN_ID, p_bar: 'mood-ring' });
    await expect(box).toHaveValue('');
    // A bar already on the shortlist is offered as held, never suggested twice.
    await box.fill('attaboy');
    await expect(page.getByRole('button', { name: /Attaboy is already on the shortlist/ })).toBeDisabled();
    await expect(page.getByText(/Pick a bar from the catalog/)).toHaveCount(0);
  });

  test('2: Share on the decided banner reports beside the banner, not only in the footer', async ({
    page,
    context,
    baseURL,
  }) => {
    await ownerBoard(page, context, baseURL, { status: 'decided', decided_bar_id: PDT });
    await page.getByTestId('decided-banner').getByRole('button', { name: 'Share' }).click();
    const notice = page.getByTestId('decided-share-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/Invite link copied|night-out/);
    await expect(page.getByTestId('plan-footer').getByRole('status')).toHaveCount(0);
  });

  test('3: a pending invitee sees "I’m in" in the first viewport, above the shortlist', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubMemberRpcs(page);
    await page.route('**/rest/v1/rpc/get_night_out*', async (route) => {
      const url = route.request().url();
      if (!/\/rpc\/get_night_out(?:\?|$)/.test(url)) return route.fallback();
      await fulfillJson(200, [{ ...PLAN_ROW, caller_role: 'member', caller_status: 'pending' }])(route);
    });
    await page.goto(`/night-out/${TOKEN}`);
    const accept = page.getByTestId('rsvp-row-accept').getByRole('button', { name: /I.m in/ });
    await expect(accept).toBeVisible();
    const box = (await accept.boundingBox())!;
    const vh = await page.evaluate(() => window.innerHeight);
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
    expect(box.y).toBeLessThan((await page.getByTestId('plan-shortlist').boundingBox())!.y);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // The rest of the row (Not tonight) stays by the footer, and there is one I'm in, not two.
    await expect(page.getByRole('button', { name: /I.m in/ })).toHaveCount(1);
    await expect(page.getByTestId('rsvp-row-rest').getByRole('button', { name: /not tonight/i })).toBeVisible();
  });

  test('6: the three recovery "Open it" buttons are 44px', async ({ page, context, baseURL }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubNightOutRest(page);
    await stubSocialShellRest(page);
    for (const rpc of ['get_my_night_outs', 'get_circle_rsvps', 'get_circle_suggestions', 'get_circle_vibe_votes']) {
      await page.route(`**/rest/v1/rpc/${rpc}*`, fulfillJson(200, []));
    }
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    for (const rpc of ['get_following', 'get_followers']) {
      await page.route(`**/rest/v1/rpc/${rpc}*`, fulfillJson(200, [{ id: FRIEND_ID, handle: 'sam', display_name: 'Sam Ruiz' }]));
    }
    await stubOwnerRpcs(page);
    await page.route('**/rest/v1/rpc/create_night_out*', fulfillJson(200, PLAN_ID));
    // One refused invite holds the screen with an Open it beside the report.
    await page.route('**/rest/v1/rpc/invite_one_to_night_out*', fulfillJson(200, false));
    await page.route('**/rest/v1/rpc/get_my_night_outs*', fulfillJson(200, []));
    await page.goto('/friends/consensus');
    await expect(page.getByTestId('create-night-out')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('create-night-out').click();
    await expect(page.getByTestId('unsent-outcome')).toBeVisible();
    const open = page.getByRole('button', { name: /^Open it$/ });
    await expect(open).toBeVisible();
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

/** G-01 — a share-link guest answers with a name; who else is going needs an account. */
test.describe('G-01: the guest RSVP and the sign-up funnel', () => {
  test('a guest sees the COUNT and a create-account prompt, never the names', async ({ page }) => {
    await stubBearerRpcs(page);
    let attendeeReads = 0;
    await page.route('**/rest/v1/rpc/preview_night_out_attendees*', async (route) => {
      attendeeReads += 1;
      // 0080 revokes this from anon; the client no longer asks as a guest.
      await fulfillJson(403, { message: 'permission denied' })(route);
    });
    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('invite-preview')).toBeVisible();
    const locked = page.getByTestId('invite-whos-in-locked');
    await expect(locked).toBeVisible();
    await expect(locked).toContainText(/in so far|Nobody has said yes/);
    await expect(page.getByTestId('invite-whos-in-signup')).toBeVisible();
    await expect(page.getByTestId('invite-attendees')).toHaveCount(0);
    await expect(page.getByTestId('invite-limitation')).toContainText(/who else is going/i);
    // R-04 item 5: counted since G-01, asserted now — a guest never asks.
    await expect(page.getByTestId('invite-shortlist')).toBeVisible();
    expect(attendeeReads, 'a guest must not issue the attendee read').toBe(0);
  });

  test("Can't make it may stay anonymous, and the prompt leads to /auth with the invite kept", async ({
    page,
  }) => {
    await stubBearerRpcs(page);
    const sent: Array<Record<string, unknown>> = [];
    await page.route('**/rest/v1/rpc/rsvp_night_out_by_token*', async (route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      await fulfillJson(200, true)(route);
    });
    await page.goto(`/night-out/${TOKEN}`);
    await page.getByTestId('invite-rsvp-declined').click();
    await expect(page.getByTestId('invite-rsvp-sent')).toContainText(/can.t make it/i);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      p_token: TOKEN, p_key: expect.any(String), p_response: 'declined', p_guest_name: null,
    });
    await expect(page.getByTestId('invite-name-missing')).toHaveCount(0);

    await page.getByTestId('invite-whos-in-signup').click();
    await expect(page).toHaveURL(/\/auth$/);
    const stored = await page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_KEY);
    expect(stored, 'the invite context survives the trip to /auth').toBe(TOKEN);
  });

  test('a member sees named guests as rows, and the nameless ones only as a count', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubOwnerRpcs(page);
    let countReads = 0;
    await page.route('**/rest/v1/rpc/get_night_out_anon_rsvps*', async (route) => {
      countReads += 1;
      await fulfillJson(200, [{ going: 9, maybe: 9, declined: 9 }])(route);
    });
    // R-04 item 3: ONE read carries every reply; the nameless come with a null name.
    await page.route('**/rest/v1/rpc/get_night_out_anon_guests*', fulfillJson(200, [
      { guest_name: 'Alex', response: 'going' },
      { guest_name: 'Jo', response: 'maybe' },
      { guest_name: null, response: 'going' },
      { guest_name: null, response: 'declined' },
    ]));
    await page.goto(`/night-out/${TOKEN}`);
    const guests = page.getByTestId('anon-guest');
    await expect(guests).toHaveCount(2);
    await expect(guests.first()).toContainText('Alex');
    await expect(guests.first()).toContainText('Going');
    await expect(guests.first()).toContainText(/via the invite link/i);
    await expect(guests.nth(1)).toContainText('Jo');
    await expect(guests.nth(1)).toContainText('Maybe');
    // Two named rows, one nameless Going, one nameless decline — from the same snapshot.
    await expect(page.getByTestId('anon-guests-nameless')).toContainText('1 more reply');
    await expect(page.getByTestId('night-out-link-replies')).toContainText(/1 going, 0 maybe, 1 can.t make it/);
    // The separate counts read is gone; a 9/9/9 answer to it changes nothing.
    expect(countReads, 'the board no longer subtracts two independent reads').toBe(0);
  });

  test('a failed replies read (a pre-0080 database) says nothing rather than zero, and the board still renders', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubOwnerRpcs(page);
    await page.route('**/rest/v1/rpc/get_night_out_anon_guests*', fulfillJson(404, { message: 'no such function' }));
    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByTestId('member-board')).toBeVisible();
    await expect(page.getByTestId('anon-guest')).toHaveCount(0);
    // R-04 item 3: with one read there is no second source to fall back on, and
    // a failed read must not be reported as "nobody replied".
    await expect(page.getByTestId('anon-guests-nameless')).toHaveCount(0);
    await expect(page.getByTestId('night-out-link-replies')).toHaveCount(0);
  });
});
