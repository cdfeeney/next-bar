import { expect, test, type Page, type Route } from '@playwright/test';
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

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';
const PLAN_ID = '223e4567-e89b-42d3-a456-426614174000';
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
async function stubBearerRpcs(page: Page): Promise<void> {
  // ORDER MATTERS TWICE OVER. Playwright matches routes last-registered-first,
  // and `preview_night_out*` is a prefix of all three bearer functions' names —
  // so the general patterns go FIRST and the specific ones after, or the 0044
  // preview's stub would answer `preview_night_out_shortlist` with a plan row.
  await page.route('**/rest/v1/**', fulfillJson(200, []));
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
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route(
    '**/rest/v1/rpc/join_night_out_by_token*',
    fulfillJson(200, PLAN_ID),
  );
  // Viewing never mutates: existing members RESOLVE (read) to their plan.
  await page.route(
    '**/rest/v1/rpc/resolve_night_out_by_token*',
    fulfillJson(200, PLAN_ID),
  );
  await page.route('**/rest/v1/rpc/get_night_out*', (route) => {
    const url = route.request().url();
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
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route(
    '**/rest/v1/rpc/resolve_night_out_by_token*',
    fulfillJson(200, PLAN_ID),
  );
  await page.route('**/rest/v1/rpc/get_night_out*', (route) => {
    const url = route.request().url();
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
   */
  test('a refused RSVP says it has not been sent, and does not show as chosen', async ({
    page,
  }) => {
    await stubBearerRpcs(page);
    await page.route(
      '**/rest/v1/rpc/rsvp_night_out_by_token*',
      fulfillJson(500, { message: 'boom' }),
    );

    await page.goto(`/night-out/${TOKEN}`);
    await page.getByTestId('invite-rsvp-going').click();
    await expect(page.getByTestId('invite-rsvp-error')).toContainText(
      /hasn't been sent/i,
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
      if (url.includes('get_night_out_members')) return fulfillJson(200, [])(route);
      if (url.includes('get_night_out_board')) return fulfillJson(200, [])(route);
      planReads += 1;
      return fulfillJson(200, [PLAN_ROW])(route);
    });
    // The row moved on in the other tab, so this render's pair is stale.
    await page.route('**/rest/v1/rpc/respond_night_out*', fulfillJson(200, false));

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
    await page.route('**/rest/v1/**', fulfillJson(200, []));
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
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
      await fulfillJson(200, PLAN_ID)(route);
    });
    await page.route('**/rest/v1/rpc/decline_night_out_by_token*', async (route) => {
      declineCalled = true;
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
      await page.route('**/rest/v1/**', fulfillJson(200, []));
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
    await page.route('**/rest/v1/**', fulfillJson(200, []));
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

  test('the Next Bar? card names a bar, a lead line and ONE Open action (V8-R-SOC-003)', async ({
    page,
  }) => {
    await page.goto('/friends');

    // The card is signed-out reachable on purpose: the ranker runs on the local
    // catalog and a saved quiz profile, neither of which needs a session. It
    // renders nothing at all when the ranker has no suggestion — the contract's
    // "none" state — so this asserts the shape only when a bar is present.
    const card = page.getByTestId('next-bar-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Next Bar?' })).toBeVisible();
    // The lead line carries the state in WORDS. Either a walk/Uber time or the
    // honest neighborhood fallback — never an invented distance.
    await expect(page.getByTestId('next-bar-line')).not.toBeEmpty();

    // "ONE Open action", and it must be a 44px target.
    const open = page.getByTestId('next-bar-open');
    await expect(open).toHaveCount(1);
    expect((await open.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Opening lands in the SHARED lightbox rather than navigating away: the
    // card is a peek at a bar, not a route change out of Social.
    const urlBefore = page.url();
    await open.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(page.url()).toBe(urlBefore);
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
    await page.route('**/rest/v1/**', fulfillJson(200, []));
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
    await page.route('**/rest/v1/**', fulfillJson(200, []));
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
   */
  async function stubMedia(
    page: Page,
    rows: unknown[],
    windowRows: unknown[] | 'fail' = [{ expires_at: futureIso(20), is_open: true }],
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
      { expires_at: '2020-01-02T02:00:00.000Z', is_open: false },
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
      { expires_at: futureIso(-48), is_open: true },
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
      { expires_at: futureIso(48), is_open: false },
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
    await page.route('**/rest/v1/**', fulfillJson(200, []));
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
    await page.route('**/rest/v1/**', fulfillJson(200, []));
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
    await page.route('**/rest/v1/**', fulfillJson(200, []));
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
