/**
 * notification-preferences.spec.ts — V8-4 Settings notification preferences.
 *
 * Supabase is STUBBED at the browser boundary (page.route), same pattern as
 * account-delete.spec.ts and night-out.spec.ts: no request reaches a live
 * database (migration 0060 is committed unapplied). Signed-in tests use the
 * fake-session-cookie pattern from those specs.
 *
 * Covers, per CLAUDE.md's "every interactive feature gets an e2e test":
 *   1. smoke — signed-out default renders the section and its explanation
 *      (no toggles for a visitor who can't use them)
 *   2. interaction — toggling saves via set_notification_preferences, and
 *      the NEGATIVE assertion: it does not navigate away or unmount the
 *      settings surface.
 * Runs against both configured viewports (iPhone 13, Pixel 7) — every
 * assertion here is viewport-agnostic.
 *
 * The two signed-in tests need NEXT_PUBLIC_SUPABASE_URL in the environment of
 * BOTH this process and the webServer — the app cannot construct a browser
 * Supabase client without it, so there is no signed-in state to assert. Every
 * request is stubbed, so the value only has to exist:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://e2estub.supabase.co \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-stub-anon-key \
 *   npx playwright test e2e/notification-preferences.spec.ts
 *
 * Without it they SKIP, which is the fail-open species night-out.spec.ts
 * already documents: a green run that asserted nothing about the signed-in
 * path. Treat a skipped run here as missing evidence, not as coverage.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';

const USER_ID = '11111111-2222-3333-4444-555555555555';

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

/**
 * The notifications section as a landmark. /settings renders other `switch`
 * and `alert` elements (the Privacy toggle; Next's route announcer), so every
 * count/text assertion below scopes here instead of querying the whole page.
 */
function notificationsSection(page: Page) {
  return page.getByRole('region', { name: /^Notifications$/ });
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

async function stubSignedInSettings(page: Page): Promise<void> {
  // Playwright matches routes LAST-registered-first (night-out.spec.ts
  // convention): the catch-all must be registered BEFORE the specific
  // stubs or it shadows them.
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route(
    '**/rest/v1/profiles**',
    fulfillJson(200, [{ handle: 'connor_f', display_name: null, is_private: false }]),
  );
  // A row exists with every preference on — the missing-row default-true
  // case is covered by NotificationPreferences.test.tsx (vitest); this
  // exercises the loaded-row path end to end.
  await page.route(
    '**/rest/v1/notification_preferences**',
    fulfillJson(200, {
      invited: true,
      accepted: true,
      bar_suggested: true,
      plan_changed: true,
    }),
  );
}

test.describe('/settings — notification preferences (V8-4)', () => {
  test('smoke: signed-out settings shows the notifications section with its explanation, no broken toggles', async ({
    page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /^Settings$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Notifications$/ })).toBeVisible();
    await expect(
      page.getByText(/Sign in to choose which Night Out notifications you get/i),
    ).toBeVisible();
    // Negative: nothing renders a live toggle for a signed-out visitor.
    await expect(notificationsSection(page).getByRole('switch')).toHaveCount(0);
  });

  test('signed-in: toggling a preference saves it, and does NOT navigate away or close the settings surface', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubSignedInSettings(page);

    let savedArgs: Record<string, unknown> | null = null;
    await page.route('**/rest/v1/rpc/set_notification_preferences*', async (route) => {
      savedArgs = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(200, true)(route);
    });

    await page.goto('/settings');
    const toggle = page.getByRole('switch', { name: /invites you to a Night Out/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => savedArgs !== null, { timeout: 5000 }).toBe(true);
    expect(savedArgs).toMatchObject({
      p_invited: false,
      p_accepted: true,
      p_bar_suggested: true,
      p_plan_changed: true,
    });

    // The negative assertion that matters: a toggle is a save, not a
    // navigation — the settings surface (and the rest of its sections)
    // must still be exactly where the user left it.
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: /^Notifications$/ })).toBeVisible();
    // Scoped to the notifications region: /settings also renders the Privacy
    // toggle, which is a `switch` too. An unscoped count of 4 was asserting
    // something that was never true on this page.
    await expect(notificationsSection(page).getByRole('switch')).toHaveCount(4);
    await expect(page.getByRole('heading', { name: /^Account$/ })).toBeVisible();
  });

  test('signed-in: a failed READ shows an error and NO toggles, so nothing overwrites stored opt-outs', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubSignedInSettings(page);
    // Registered LAST, so it wins over the stub above.
    await page.route(
      '**/rest/v1/notification_preferences**',
      fulfillJson(500, { message: 'boom' }),
    );

    await page.goto('/settings');

    await expect(notificationsSection(page).getByRole('alert')).toContainText(
      /Couldn.t load your notification settings/i,
    );
    // The negative assertion that matters: an unreadable row must not render
    // fabricated defaults, because one tap would write all four over the
    // user's real preferences.
    await expect(notificationsSection(page).getByRole('switch')).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('signed-in: a failed save reverts the toggle and reports an error instead of pretending it worked', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(SUPABASE_URL === null, 'needs NEXT_PUBLIC_SUPABASE_URL for the auth cookie');
    await context.addCookies([
      { ...sessionCookie(SUPABASE_URL as string), url: baseURL as string },
    ]);
    await stubSignedInSettings(page);
    await page.route(
      '**/rest/v1/rpc/set_notification_preferences*',
      fulfillJson(200, false),
    );

    await page.goto('/settings');
    const toggle = page.getByRole('switch', { name: /plan changes/i });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();

    // Scoped: Next's route announcer is also role="alert", so an unscoped
    // getByRole('alert') is a strict-mode violation rather than an assertion.
    await expect(notificationsSection(page).getByRole('alert')).toContainText(
      /didn.t save/i,
    );
    // Reverted, not left in a state the server never confirmed.
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/\/settings$/);
  });
});
