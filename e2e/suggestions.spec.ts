/**
 * suggestions.spec.ts
 *
 * Coverage for "people's choice" on /friends/consensus (migration
 * 0011) — the QA3 tabular poll: each row is photo tile + bar name +
 * ▲ vote tally toggle, nothing else. Covers the suggest flow (BarPicker
 * sheet → suggest_bar RPC → list), friend suggestions rendering
 * name-free, own-row withdrawal via un-vote, the 3-per-night cap
 * message, and the stranded-RSVP escape row (the one RSVP affordance
 * left on this surface).
 *
 * Same stubbed-Supabase pattern as friends-real.spec.ts. The suggestions
 * stub is STATEFUL (suggest_bar appends, DELETE removes) because the
 * component refetches after every write.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';

const USER_ID = '11111111-2222-3333-4444-555555555555';

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

function sessionCookie(supabaseUrl: string): { name: string; value: string } {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const accessToken = [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(JSON.stringify({ sub: USER_ID, role: 'authenticated', exp: expiresAt })),
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
      email: 'connor@example.com',
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

type SuggestionRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  bar_id: string;
};

type StubOptions = {
  following?: Array<{ id: string; handle: string; display_name: string | null }>;
  friendRatings?: Array<{ user_id: string; bar_id: string; tier: string; rated_at: string }>;
  /** Initial suggestion rows; mutated by suggest/remove. */
  suggestionRows?: SuggestionRow[];
  /** Initial RSVP rows (pre-QA3 leftovers); mutated by unrsvp. */
  rsvpRows?: SuggestionRow[];
  /** Force suggest_bar to decline (cap-hit path). */
  suggestDeclines?: boolean;
  /** Signed-in "you" server ratings (ratings table rows) — enables the
   * consensus participant path. */
  youRatings?: Array<{ bar_id: string; tier: string; rated_at: string }>;
};

/** YYYY-MM-DD; every night-scoped write must carry it (see NIGHT_GUARD). */
const NIGHT_BODY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function stubSupabase(page: Page, opts: StubOptions): Promise<void> {
  const rows: SuggestionRow[] = opts.suggestionRows ?? [];
  const rsvps: SuggestionRow[] = opts.rsvpRows ?? [];

  // NIGHT_GUARD (PR #14 review LOW): the real RPCs/tables are night-
  // scoped; a client that drops the night from a write would silently
  // hit every night. Stubs 500 on a missing/malformed night so that
  // regression turns tests red instead of passing by accident.
  const nightGuard = async (route: Route, night: unknown): Promise<boolean> => {
    if (typeof night === 'string' && NIGHT_BODY_RE.test(night)) return true;
    await route.fulfill({ status: 500, body: 'missing/malformed night scope' });
    return false;
  };

  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  if (opts.youRatings) {
    await page.route('**/rest/v1/ratings**', fulfillJson(200, opts.youRatings));
  }

  await page.route('**/rest/v1/rpc/get_following**', fulfillJson(200, opts.following ?? []));
  await page.route(
    '**/rest/v1/rpc/get_friend_ratings**',
    fulfillJson(200, opts.friendRatings ?? []),
  );
  await page.route('**/rest/v1/rpc/get_circle_suggestions**', async (route) => {
    await fulfillJson(200, rows)(route);
  });
  await page.route('**/rest/v1/rpc/get_circle_rsvps**', async (route) => {
    await fulfillJson(200, rsvps)(route);
  });
  await page.route('**/rest/v1/rpc/suggest_bar**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { bar?: string; night?: string };
    if (!(await nightGuard(route, body.night))) return;
    if (opts.suggestDeclines) {
      await fulfillJson(200, false)(route);
      return;
    }
    if (body.bar && !rows.some((r) => r.user_id === USER_ID && r.bar_id === body.bar)) {
      rows.push({ user_id: USER_ID, handle: 'connor_f', display_name: 'Conor F', bar_id: body.bar });
    }
    await fulfillJson(200, true)(route);
  });
  await page.route('**/rest/v1/rpc/unrsvp_bar**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { bar?: string; night?: string };
    if (!(await nightGuard(route, body.night))) return;
    const idx = rsvps.findIndex((r) => r.user_id === USER_ID && r.bar_id === body.bar);
    if (idx !== -1) rsvps.splice(idx, 1);
    await fulfillJson(200, true)(route);
  });
  await page.route('**/rest/v1/bar_rsvps**', async (route) => {
    // 0013 closed the raw-table-delete race path — "I'm out" must go
    // through the serialized unrsvp_bar RPC. A DELETE landing here is a
    // regression; fail it loudly so the escape-row test goes red.
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 500, body: 'unserialized bar_rsvps DELETE (should use unrsvp_bar RPC)' });
      return;
    }
    await fulfillJson(200, [])(route);
  });
  await page.route('**/rest/v1/bar_suggestions**', async (route) => {
    if (route.request().method() === 'DELETE') {
      const url = new URL(route.request().url());
      const night = (url.searchParams.get('night') ?? '').replace(/^eq\./, '');
      if (!(await nightGuard(route, night))) return;
      const barId = (url.searchParams.get('bar_id') ?? '').replace(/^eq\./, '');
      const idx = rows.findIndex((r) => r.user_id === USER_ID && r.bar_id === barId);
      if (idx !== -1) rows.splice(idx, 1);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await fulfillJson(200, [])(route);
  });
}

async function signIn(page: Page): Promise<void> {
  const cookie = sessionCookie(SUPABASE_URL as string);
  await page.context().addCookies([{ ...cookie, url: 'http://localhost:3000' }]);
  // Keep OnboardingGate quiet (its behavior is covered in
  // onboarding-identity.spec.ts).
  await page.addInitScript(() => {
    window.sessionStorage.setItem('next-bar:onboarding-prompted:v1', '1');
  });
}

const FRIEND = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', handle: 'claire', display_name: 'Claire' };

/** The People's Choice row for a bar — the tabular poll's unit. */
function choiceRow(page: Page, barName: string) {
  return page
    .getByRole('list', { name: /people's choice/i })
    .getByRole('listitem')
    .filter({ hasText: barName });
}

test.describe('/friends/consensus — tonight\'s poll board', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(SUPABASE_URL === null, 'NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
    await signIn(page);
  });

  test('empty state → suggest via the picker sheet → your row lands lit at 1', async ({
    page,
  }) => {
    await stubSupabase(page, { following: [FRIEND] });
    await page.goto('/friends/consensus');

    await expect(page.getByText(/nobody's picked a spot/i)).toBeVisible();

    // "+ Find a bar" is the full-width entry at the BOTTOM of the board.
    await page.getByRole('button', { name: /\+ find a bar/i }).click();
    const sheet = page.getByRole('dialog', { name: /suggest a bar/i });
    await expect(sheet).toBeVisible();
    // Pick a known catalog bar via the picker search.
    // WebKit note (claim-handle.spec.ts pattern): click + pressSequentially,
    // not fill — React controlled inputs need real key events on iOS.
    await sheet.getByPlaceholder(/search/i).click();
    await sheet.getByPlaceholder(/search/i).pressSequentially('Ace Bar');
    await sheet.getByRole('button', { name: /^Ace Bar/ }).first().click();

    // Sheet closes; the suggestion lands with the VOTE toggle lit at a
    // tally of 1 — the row is photo + name + vote, nothing else.
    await expect(sheet).not.toBeVisible();
    await expect(page.getByText('Ace Bar')).toBeVisible();
    const vote = page.getByRole('button', { name: 'Vote for Ace Bar' });
    await expect(vote).toHaveAttribute('aria-pressed', 'true');
    await expect(vote).toContainText('1');
  });

  test("a friend's suggestion renders name-FREE (photo + bar + tally only); your toggle starts OFF", async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [FRIEND],
      suggestionRows: [
        { user_id: FRIEND.id, handle: 'claire', display_name: 'Claire', bar_id: 'attaboy' },
      ],
    });
    await page.goto('/friends/consensus');

    const row = choiceRow(page, 'Attaboy');
    await expect(row).toBeVisible();
    // QA3: no "suggested by …" line — the suggester's name must NOT be
    // in the row; the tally carries the signal.
    await expect(row.getByText(/Claire/)).toHaveCount(0);
    const vote = page.getByRole('button', { name: 'Vote for Attaboy' });
    await expect(vote).toHaveAttribute('aria-pressed', 'false');
    await expect(vote).toContainText('1');
  });

  test('un-voting your own suggestion withdraws it back to the empty state', async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [FRIEND],
      suggestionRows: [
        { user_id: USER_ID, handle: 'connor_f', display_name: 'Conor F', bar_id: 'ace-bar' },
      ],
    });
    await page.goto('/friends/consensus');

    await expect(page.getByText('Ace Bar')).toBeVisible();
    await page.getByRole('button', { name: 'Vote for Ace Bar' }).click();
    await expect(page.getByText(/nobody's picked a spot/i)).toBeVisible();
  });

  test("voting a FRIEND's suggestion adds your backing to the tally (UX-B2)", async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [FRIEND],
      suggestionRows: [
        { user_id: FRIEND.id, handle: 'claire', display_name: 'Claire', bar_id: 'attaboy' },
      ],
    });
    await page.goto('/friends/consensus');

    const vote = page.getByRole('button', { name: 'Vote for Attaboy' });
    await expect(vote).toContainText('1');
    await vote.click();
    await expect(vote).toHaveAttribute('aria-pressed', 'true');
    await expect(vote).toContainText('2');
  });

  test("a stranded RSVP gets the escape row — I'm out clears it (the one RSVP affordance left)", async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [FRIEND],
      suggestionRows: [
        { user_id: FRIEND.id, handle: 'claire', display_name: 'Claire', bar_id: 'attaboy' },
      ],
      // A pre-QA3 RSVP of YOURS — no I'm-in toggle exists anymore, so the
      // escape row is the only way out.
      rsvpRows: [
        { user_id: USER_ID, handle: 'connor_f', display_name: 'Conor F', bar_id: 'ace-bar' },
      ],
    });
    await page.goto('/friends/consensus');

    await expect(page.getByText(/You're still in at/)).toBeVisible();
    await expect(page.getByText('Ace Bar')).toBeVisible();
    await page.getByRole('button', { name: /I'm out/i }).click();
    await expect(page.getByText(/You're still in at/)).toHaveCount(0);

    // The poll itself is untouched by the RSVP exit.
    await expect(choiceRow(page, 'Attaboy')).toBeVisible();
  });

  test("the board shows BOTH parts: Group Favorites (algo) and the suggested bar in People's Choice (UX-B)", async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [FRIEND],
      // Both of you rated Ace Bar loved → it's the unanimous algorithmic
      // pick (Group Favorites).
      friendRatings: [
        { user_id: FRIEND.id, bar_id: 'ace-bar', tier: 'loved', rated_at: '2026-07-01T00:00:00Z' },
      ],
      youRatings: [
        { bar_id: 'ace-bar', tier: 'loved', rated_at: '2026-07-02T00:00:00Z' },
      ],
      // The circle suggested Attaboy — NOT in anyone's ratings, so it
      // appears only via People's Choice (the human signal).
      suggestionRows: [
        { user_id: FRIEND.id, handle: 'claire', display_name: 'Claire', bar_id: 'attaboy' },
      ],
    });
    await page.goto('/friends/consensus');

    // Part 1: Group Favorites carries the algorithmic pick + the share
    // moment on the top card. (The Put-it-to-a-vote flow is deleted.)
    await expect(page.getByText(/Group Favorites/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ace Bar' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Share the pick/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /put it to a vote/i })).toHaveCount(0);

    // Part 2: People's Choice carries the human suggestion as a bare
    // photo+name+tally row.
    const choice = page.getByRole('list', { name: /people's choice/i });
    await expect(choice.getByText('Attaboy')).toBeVisible();
  });

  test('a declined suggest (cap) surfaces the un-vote-to-switch message', async ({ page }) => {
    await stubSupabase(page, {
      following: [FRIEND],
      suggestDeclines: true,
      suggestionRows: [
        { user_id: USER_ID, handle: 'connor_f', display_name: 'Conor F', bar_id: 'ace-bar' },
        { user_id: USER_ID, handle: 'connor_f', display_name: 'Conor F', bar_id: 'attaboy' },
        { user_id: USER_ID, handle: 'connor_f', display_name: 'Conor F', bar_id: 'pdt' },
      ],
    });
    await page.goto('/friends/consensus');

    await page.getByRole('button', { name: /\+ find a bar/i }).click();
    const sheet = page.getByRole('dialog', { name: /suggest a bar/i });
    await sheet.getByPlaceholder(/search/i).click();
    await sheet.getByPlaceholder(/search/i).pressSequentially('Dead Rabbit');
    await sheet.getByRole('button', { name: /Dead Rabbit/ }).first().click();

    await expect(
      page.getByText(/You can back 3 bars a night — un-vote one to switch/i),
    ).toBeVisible();
  });
});
