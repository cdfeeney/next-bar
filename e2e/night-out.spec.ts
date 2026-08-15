import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * night-out.spec.ts — the V8-3 canonical Night Out surface.
 *
 * Supabase RPCs are STUBBED at the browser boundary (page.route on
 * /rest/v1/rpc/*) — no request reaches a live database (the 0021 migration
 * is committed unapplied). Auth uses the fake-session-cookie pattern from
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
};

async function stubMemberRpcs(page: Page): Promise<void> {
  // Playwright matches routes LAST-registered-first: the catch-all must be
  // registered BEFORE the specific RPC stubs or it shadows them.
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route(
    '**/rest/v1/rpc/join_night_out_by_token*',
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
    return fulfillJson(200, [PLAN_ROW])(route);
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

  test('anon + live link shows ONLY the bearer preview, and the CTA stores the invite context', async ({
    page,
  }) => {
    await page.route(
      '**/rest/v1/rpc/preview_night_out*',
      fulfillJson(200, [PREVIEW_ROW]),
    );
    await page.goto(`/night-out/${TOKEN}`);
    await expect(page.getByText(/you're invited/i)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /birthday crawl/i }),
    ).toBeVisible();
    await expect(page.getByText(/hosted by conor/i)).toBeVisible();
    // The preview surface never renders member identities or bar data.
    await expect(page.getByText(/attaboy/i)).toHaveCount(0);

    await page.getByRole('button', { name: /sign in to join/i }).click();
    await expect(page).toHaveURL(/\/auth/);
    const stored = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      PENDING_KEY,
    );
    expect(stored).toBe(TOKEN);
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
      const body = route.request().postDataJSON() as { p_accept: boolean };
      expect(body.p_accept).toBe(false);
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
