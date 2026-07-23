/**
 * claim-handle.spec.ts
 *
 * Coverage for the B2 claim-username flow on /settings.
 *
 * Scope: client-side UI of ClaimHandle + the settings account card. Same
 * stubbed-Supabase pattern as auth-page.spec.ts — every REST/RPC endpoint
 * is intercepted so no real accounts or database rows are involved.
 *
 * Signed-in state is faked by pre-setting the @supabase/ssr auth cookie
 * (`sb-<project-ref>-auth-token` = `base64-` + base64url(session JSON))
 * with a far-future expiry, so `getSession()` resolves locally without a
 * network round-trip. The project ref comes from NEXT_PUBLIC_SUPABASE_URL
 * in .env.local (the dev server bakes the same value into the bundle).
 *
 * What this guards against:
 *   - The claim card not rendering for a signed-in, handle-less account
 *   - Availability states (checking/available/taken) regressing
 *   - Invalid charset input reaching the search RPC (must be client-blocked)
 *   - A lost claim race (RPC returns null) not surfacing as "taken"
 *   - The claimed state / existing-handle display (@handle) breaking
 *   - The nudge line not dismissing
 *
 * WebKit note (same as auth-page.spec.ts): use click + pressSequentially,
 * not fill, so React's controlled inputs see real key events.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  test,
  expect,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const USER_EMAIL = 'connor@example.com';

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
  // Shape-only JWT: supabase-js reads expiry from the stored session JSON,
  // and every network call that would validate this token is stubbed.
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

type StubOptions = {
  /** The signed-in user's profiles row (fetchOwnProfile). */
  profileHandle: string | null;
  /** Rows the search_handles RPC returns. */
  searchResults?: Array<{ handle: string; display_name: string | null }>;
  /** What the claim_handle RPC returns (claimed handle, or null = taken). */
  claimResult?: string | null;
  /** Collects search RPC hits so tests can assert none fired. */
  searchRequests?: string[];
};

/**
 * Stub every Supabase surface /settings touches when signed in. Playwright
 * checks routes newest-first, so the broad rest catch-all goes FIRST and
 * the specific endpoints override it.
 */
async function stubSupabase(page: Page, opts: StubOptions): Promise<void> {
  // Broad catch-alls: ratings / pairwise_comparisons selects → empty.
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));

  await page.route(
    '**/rest/v1/profiles**',
    fulfillJson(200, [
      { handle: opts.profileHandle, display_name: null, is_private: false },
    ]),
  );
  await page.route('**/rest/v1/rpc/search_handles**', async (route) => {
    opts.searchRequests?.push(route.request().postData() ?? '');
    await fulfillJson(200, opts.searchResults ?? [])(route);
  });
  await page.route(
    '**/rest/v1/rpc/claim_handle**',
    fulfillJson(200, opts.claimResult ?? null),
  );
}

async function typeInto(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.pressSequentially(value);
  await expect(input).toHaveValue(value);
}

async function signIn(page: Page): Promise<void> {
  const cookie = sessionCookie(SUPABASE_URL as string);
  await page.context().addCookies([
    { ...cookie, url: 'http://localhost:3000' },
  ]);
}

const usernameInput = (page: Page) => page.getByPlaceholder('username');
const claimButton = (page: Page) =>
  page.getByRole('button', { name: /claim username/i });

test.describe('/settings — claim username (signed in, no handle)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
  });

  test('renders the claim card, charset hint, and nudge; nudge dismisses', async ({
    page,
  }) => {
    await stubSupabase(page, { profileHandle: null });
    await page.goto('/settings');

    await expect(page.getByText('Claim your username')).toBeVisible();
    await expect(usernameInput(page)).toBeVisible();
    await expect(
      page.getByText(/3–20 characters: letters, numbers, underscores/i),
    ).toBeVisible();

    // Nudge line renders and dismisses — and STAYS dismissed (negative
    // assertion: the claim card itself must survive the dismissal).
    const nudge = page.getByText(/claim yours so friends can find you/i);
    await expect(nudge).toBeVisible();
    await page
      .getByRole('button', { name: /dismiss username nudge/i })
      .click();
    await expect(nudge).not.toBeVisible();
    await expect(usernameInput(page)).toBeVisible();
  });

  test('available handle shows the available state after the debounce', async ({
    page,
  }) => {
    await stubSupabase(page, { profileHandle: null, searchResults: [] });
    await page.goto('/settings');

    await typeInto(usernameInput(page), 'connor_f');

    await expect(page.getByText(/@connor_f looks available/i)).toBeVisible();
    await expect(claimButton(page)).toBeEnabled();
  });

  test('taken handle (exact match in search) shows the taken state', async ({
    page,
  }) => {
    await stubSupabase(page, {
      profileHandle: null,
      searchResults: [{ handle: 'ConnorF', display_name: 'Connor' }],
    });
    await page.goto('/settings');

    await typeInto(usernameInput(page), 'connorf');

    await expect(page.getByText(/that one's taken/i)).toBeVisible();
    await expect(page.getByText(/looks available/i)).not.toBeVisible();
  });

  test('invalid charset never hits the search RPC and disables the claim button', async ({
    page,
  }) => {
    const searchRequests: string[] = [];
    await stubSupabase(page, { profileHandle: null, searchRequests });
    await page.goto('/settings');

    await typeInto(usernameInput(page), 'a!');

    await expect(claimButton(page)).toBeDisabled();
    // Outwait the 400ms availability debounce, then assert the RPC never
    // fired — charset rejection must happen client-side.
    await page.waitForTimeout(700);
    expect(searchRequests).toHaveLength(0);
    await expect(page.getByText(/checking availability/i)).not.toBeVisible();
  });

  test('successful claim shows the claimed @handle state and hides the form', async ({
    page,
  }) => {
    await stubSupabase(page, {
      profileHandle: null,
      searchResults: [],
      claimResult: 'ConnorF',
    });
    await page.goto('/settings');

    await typeInto(usernameInput(page), 'ConnorF');
    await claimButton(page).click();

    // On success, Settings' onClaimed updates the account card and UNMOUNTS
    // the ClaimHandle card entirely — the @handle line in the account card
    // is the persistent success feedback (the card's internal claimed-state
    // copy is unreachable in this integration; documented seam).
    await expect(page.getByText('@ConnorF').first()).toBeVisible();
    await expect(usernameInput(page)).not.toBeVisible();
    // Still on /settings — claiming must not navigate.
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('lost race / taken claim (RPC returns null) surfaces the taken error', async ({
    page,
  }) => {
    await stubSupabase(page, {
      profileHandle: null,
      searchResults: [],
      claimResult: null,
    });
    await page.goto('/settings');

    await typeInto(usernameInput(page), 'connor_f');
    await claimButton(page).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/taken/i);
    // Form stays up for another attempt.
    await expect(usernameInput(page)).toBeVisible();
  });
});

test.describe('/settings — handle already claimed', () => {
  test('shows @handle in the account card and no claim UI', async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
    await stubSupabase(page, { profileHandle: 'ConnorF' });
    await page.goto('/settings');

    await expect(page.getByText('@ConnorF')).toBeVisible();
    await expect(page.getByText('Claim your username')).not.toBeVisible();
    await expect(usernameInput(page)).not.toBeVisible();
  });
});

test.describe('/settings — signed out', () => {
  test('no claim UI; the sign-in CTA renders instead', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
    await expect(page.getByText('Claim your username')).not.toBeVisible();
    await expect(usernameInput(page)).not.toBeVisible();
  });
});
