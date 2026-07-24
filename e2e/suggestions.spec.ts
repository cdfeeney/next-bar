/**
 * suggestions.spec.ts
 *
 * Coverage for "Tonight's suggestions" on /friends/consensus (migration
 * 0011): the suggest flow (BarPicker sheet → suggest_bar RPC → list),
 * friend suggestions rendering as the identity pair, own-row removal,
 * and the 3-per-night cap message.
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
  /** Initial RSVP rows; mutated by rsvp/unrsvp (move semantics mirrored). */
  rsvpRows?: SuggestionRow[];
  /** Force suggest_bar to decline (cap-hit path). */
  suggestDeclines?: boolean;
};

async function stubSupabase(page: Page, opts: StubOptions): Promise<void> {
  const rows: SuggestionRow[] = opts.suggestionRows ?? [];
  const rsvps: SuggestionRow[] = opts.rsvpRows ?? [];

  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));

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
    if (opts.suggestDeclines) {
      await fulfillJson(200, false)(route);
      return;
    }
    const body = JSON.parse(route.request().postData() ?? '{}') as { bar?: string };
    if (body.bar && !rows.some((r) => r.user_id === USER_ID && r.bar_id === body.bar)) {
      rows.push({ user_id: USER_ID, handle: 'connor_f', display_name: 'Conor F', bar_id: body.bar });
    }
    await fulfillJson(200, true)(route);
  });
  await page.route('**/rest/v1/rpc/rsvp_bar**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { bar?: string };
    // Mirror 0012 move semantics: one RSVP per night — drop own others.
    for (let i = rsvps.length - 1; i >= 0; i--) {
      if (rsvps[i].user_id === USER_ID) rsvps.splice(i, 1);
    }
    if (body.bar) {
      rsvps.push({ user_id: USER_ID, handle: 'connor_f', display_name: 'Conor F', bar_id: body.bar });
    }
    await fulfillJson(200, true)(route);
  });
  await page.route('**/rest/v1/bar_rsvps**', async (route) => {
    if (route.request().method() === 'DELETE') {
      const url = new URL(route.request().url());
      const barId = (url.searchParams.get('bar_id') ?? '').replace(/^eq\./, '');
      const idx = rsvps.findIndex((r) => r.user_id === USER_ID && r.bar_id === barId);
      if (idx !== -1) rsvps.splice(idx, 1);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await fulfillJson(200, [])(route);
  });
  await page.route('**/rest/v1/bar_suggestions**', async (route) => {
    if (route.request().method() === 'DELETE') {
      const url = new URL(route.request().url());
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

test.describe('/friends/consensus — tonight\'s suggestions', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(SUPABASE_URL === null, 'NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
    await signIn(page);
  });

  test('empty state → suggest via the picker sheet → own suggestion listed with Remove', async ({
    page,
  }) => {
    await stubSupabase(page, { following: [FRIEND] });
    await page.goto('/friends/consensus');

    await expect(page.getByText(/nobody's pitched a spot/i)).toBeVisible();

    await page.getByRole('button', { name: /\+ suggest a bar/i }).click();
    const sheet = page.getByRole('dialog', { name: /suggest a bar/i });
    await expect(sheet).toBeVisible();
    // Pick a known catalog bar via the picker search.
    await sheet.getByPlaceholder(/search/i).fill('Ace Bar');
    await sheet.getByRole('button', { name: /^Ace Bar/ }).first().click();

    // Sheet closes; the suggestion lands with "You" as the suggester.
    await expect(sheet).not.toBeVisible();
    await expect(page.getByText('Ace Bar')).toBeVisible();
    await expect(page.getByText(/suggested by.*You/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /remove your suggestion of ace bar/i }),
    ).toBeVisible();
  });

  test("a friend's suggestion renders with their name; Remove only on own rows", async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [FRIEND],
      suggestionRows: [
        { user_id: FRIEND.id, handle: 'claire', display_name: 'Claire', bar_id: 'attaboy' },
      ],
    });
    await page.goto('/friends/consensus');

    await expect(page.getByText('Attaboy')).toBeVisible();
    await expect(page.getByText(/suggested by.*Claire/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /remove your suggestion/i })).toHaveCount(0);
  });

  test('removing an own suggestion deletes it and returns to the empty state', async ({
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
    await page.getByRole('button', { name: /remove your suggestion of ace bar/i }).click();
    await expect(page.getByText(/nobody's pitched a spot/i)).toBeVisible();
  });

  test("RSVP: I'm-in toggles on, MOVES between bars, and toggles off", async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [FRIEND],
      suggestionRows: [
        { user_id: FRIEND.id, handle: 'claire', display_name: 'Claire', bar_id: 'ace-bar' },
        { user_id: FRIEND.id, handle: 'claire', display_name: 'Claire', bar_id: 'attaboy' },
      ],
    });
    await page.goto('/friends/consensus');

    const aceRow = page.locator('li').filter({ hasText: 'Ace Bar' });
    const attaboyRow = page.locator('li').filter({ hasText: 'Attaboy' });

    // In at Ace Bar.
    await aceRow.getByRole('button', { name: /^I'm in$/ }).click();
    await expect(aceRow.getByRole('button', { name: /I'm in ✓/ })).toBeVisible();
    await expect(aceRow.getByText(/You.*are in/)).toBeVisible();

    // Move to Attaboy — Ace Bar must drop the RSVP (single-RSVP night).
    await attaboyRow.getByRole('button', { name: /^I'm in$/ }).click();
    await expect(attaboyRow.getByRole('button', { name: /I'm in ✓/ })).toBeVisible();
    await expect(aceRow.getByRole('button', { name: /^I'm in$/ })).toBeVisible();
    await expect(aceRow.getByText(/are in/)).toHaveCount(0);

    // Tap again — out entirely.
    await attaboyRow.getByRole('button', { name: /I'm in ✓/ }).click();
    await expect(attaboyRow.getByRole('button', { name: /^I'm in$/ })).toBeVisible();
    await expect(page.getByText(/are in|is in/)).toHaveCount(0);
  });

  test("a friend's RSVP renders in the going-list with their name", async ({
    page,
  }) => {
    await stubSupabase(page, {
      following: [FRIEND],
      suggestionRows: [
        { user_id: FRIEND.id, handle: 'claire', display_name: 'Claire', bar_id: 'ace-bar' },
      ],
      rsvpRows: [
        { user_id: FRIEND.id, handle: 'claire', display_name: 'Claire', bar_id: 'ace-bar' },
      ],
    });
    await page.goto('/friends/consensus');

    await expect(page.getByText(/Claire is in/)).toBeVisible();
  });

  test('a declined suggest (cap) surfaces the inline message', async ({ page }) => {
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

    await page.getByRole('button', { name: /\+ suggest a bar/i }).click();
    const sheet = page.getByRole('dialog', { name: /suggest a bar/i });
    await sheet.getByPlaceholder(/search/i).fill('Dead Rabbit');
    await sheet.getByRole('button', { name: /Dead Rabbit/ }).first().click();

    await expect(
      page.getByText(/already suggested 3 bars tonight/i),
    ).toBeVisible();
  });
});
