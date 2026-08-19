import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * plan-invites.spec.ts — Social → Plans, the invitee-facing surface.
 *
 * Filed as a MEDIUM by the Claude review lane: this interactive surface shipped
 * with no Playwright coverage at all, against a repo rule (CLAUDE.md) that every
 * interactive feature gets one. The component tests mock `nightOuts.server`
 * wholesale, so they can never see what the browser actually sends — which is
 * exactly where this round's two HIGHs lived (the RPC was called with a
 * signature the serving database does not have).
 *
 * Supabase RPCs are STUBBED at the browser boundary (`page.route` on
 * `/rest/v1/rpc/*`); no request reaches a database. Auth uses the
 * fake-session-cookie pattern from night-out.spec.ts.
 *
 * What this proves end-to-end:
 *   1. a pending invitation renders on /friends as the approved card
 *   2. Accept issues respond_night_out with ALL FOUR params, carrying the
 *      status and revision the card was RENDERED from
 *   3. accepting does NOT navigate — the card resolves in place
 *   4. no invitations → no section at all (the Requests idiom)
 */

const PLAN_ID = '723e4567-e89b-42d3-a456-426614174000';
const USER_ID = '823e4567-e89b-42d3-a456-426614174000';

/** Env first, then .env.local — the fail-open lesson from night-out.spec.ts. */
function readSupabaseUrl(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (fromEnv) return fromEnv;
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

/**
 * Derived from the clock, never hardcoded. The component hides anything more
 * than two days past, so a literal date is a test with a fuse in it — green
 * until the day it silently isn't (this suite has been bitten by exactly that).
 */
function nightsFromNow(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const RENDERED_REVISION = 2;

function pendingInviteRow(): Record<string, unknown> {
  return {
    night_out_id: PLAN_ID,
    night: nightsFromNow(1),
    title: 'Birthday crawl',
    status: 'open',
    owner_handle: 'conor',
    owner_display_name: 'Conor',
    my_status: 'pending',
    responded_at: null,
    accepted_count: 3,
    share_token: null,
    plan_updated: false,
    is_past: false,
    my_revision: RENDERED_REVISION,
  };
}

/**
 * Playwright matches routes LAST-registered-first, so the catch-all is
 * registered FIRST or it shadows every specific stub.
 */
async function stubFriendsPage(
  page: Page,
  invites: Array<Record<string, unknown>>,
): Promise<void> {
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route('**/rest/v1/rpc/get_my_night_outs*', fulfillJson(200, invites));
}

test.describe('/friends — Social → Plans invitation cards', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
  });

  test('a pending invitation renders, and Accept sends the rendered status AND revision', async ({
    page,
  }) => {
    await stubFriendsPage(page, [pendingInviteRow()]);
    let respondBody: Record<string, unknown> | null = null;
    await page.route('**/rest/v1/rpc/respond_night_out*', async (route) => {
      respondBody = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends');
    await expect(page.getByTestId('plan-invites')).toBeVisible();
    await expect(page.getByTestId('invite-pending')).toBeVisible();
    await expect(page.getByText(/conor invited you/i)).toBeVisible();

    await page.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(() => respondBody, { timeout: 10_000 }).not.toBeNull();

    // The exact defect both lanes filed: the browser used to send only
    // p_night_out + p_accept, an overload 0057 dropped, so Accept resolved no
    // function on the serving database and every acceptance failed live.
    expect(respondBody).toEqual({
      p_night_out: PLAN_ID,
      p_accept: true,
      p_expected_status: 'pending',
      p_expected_revision: RENDERED_REVISION,
    });
  });

  test('accepting resolves the card in place and does NOT navigate away', async ({
    page,
  }) => {
    // The negative half. /friends is a tab surface: an accept that pushed a
    // route would drop the user out of Social, which is the class of bug this
    // repo has shipped before ("rating a bar pushes me back to home").
    let accepted = false;
    await page.route('**/rest/v1/**', fulfillJson(200, []));
    await page.route('**/auth/v1/**', fulfillJson(200, {}));
    await page.route('**/rest/v1/rpc/get_my_night_outs*', async (route) => {
      const row = pendingInviteRow();
      await fulfillJson(
        200,
        accepted
          ? [{
            ...row,
            my_status: 'accepted',
            share_token: PLAN_ID,
            my_revision: RENDERED_REVISION + 1,
          }]
          : [row],
      )(route);
    });
    await page.route('**/rest/v1/rpc/respond_night_out*', async (route) => {
      accepted = true;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/friends');
    const urlBefore = page.url();
    await expect(page.getByTestId('invite-pending')).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();

    await expect(page.getByTestId('invite-accepted-confirm')).toBeVisible();
    await expect(page.getByText(/you accepted — see you/i)).toBeVisible();
    expect(page.url(), 'accepting an invite navigated away from /friends').toBe(urlBefore);
  });

  test('no invitations means no section at all — the Requests idiom', async ({ page }) => {
    await stubFriendsPage(page, []);
    await page.goto('/friends');
    // The page itself still renders; only the Plans section is absent.
    await expect(page.getByPlaceholder(/search @username/i)).toBeVisible();
    await expect(page.getByTestId('plan-invites')).toHaveCount(0);
  });
});
