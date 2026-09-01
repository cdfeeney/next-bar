/**
 * onboarding-identity.spec.ts
 *
 * Coverage for the TikTok-style identity onboarding (PR #6): the
 * OnboardingGate redirect, the /onboarding name+username form, and the
 * Account identity header (name + @handle, email never rendered).
 *
 * WP8 put THREE SCREENS IN FRONT OF THE IDENTITY FORM. `/onboarding` is now
 * both the door into a sequence and its last step (src/app/onboarding/
 * _sequence.ts): a bare visit replaces itself with age → location → quiz, and
 * only a visit carrying `seq=done` renders the name+username form. Nothing the
 * form asserts was dropped, so nothing below is deleted — the gate test walks
 * the three new steps, and the tests that only exercise the form address it
 * directly at its marked URL.
 *
 * Same stubbed-Supabase pattern as claim-handle.spec.ts — every REST/RPC
 * endpoint is intercepted so no real accounts or database rows are
 * involved; signed-in state is faked via the @supabase/ssr auth cookie.
 *
 * What this guards against:
 *   - The gate not routing a confirmed handle-less account to /onboarding
 *   - The gate firing for an already-onboarded account (or re-firing after
 *     skip — the once-per-session flag regressing)
 *   - The submit not persisting display_name / not claiming the handle
 *   - A lost claim race (RPC null) not surfacing, or navigating anyway
 *   - The Settings identity header rendering the email again
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
  profileHandle: string | null;
  profileDisplayName?: string | null;
  /** What the claim_handle RPC returns (claimed handle, or null = taken). */
  claimResult?: string | null;
  /** Collects profiles PATCH bodies so tests can assert the name write. */
  patchBodies?: string[];
};

/**
 * Stub every Supabase surface the gate/onboarding/settings touch when
 * signed in. Playwright checks routes newest-first, so the broad rest
 * catch-all goes FIRST and the specific endpoints override it.
 */
async function stubSupabase(page: Page, opts: StubOptions): Promise<void> {
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));

  await page.route('**/rest/v1/profiles**', async (route) => {
    if (route.request().method() === 'PATCH') {
      opts.patchBodies?.push(route.request().postData() ?? '');
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await fulfillJson(200, [
      {
        handle: opts.profileHandle,
        display_name: opts.profileDisplayName ?? null,
        is_private: false,
      },
    ])(route);
  });
  await page.route('**/rest/v1/rpc/search_handles**', fulfillJson(200, []));
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

const nameInput = (page: Page) => page.getByPlaceholder('Your name');
const usernameInput = (page: Page) => page.getByPlaceholder('username');
const submitButton = (page: Page) =>
  page.getByRole('button', { name: /let's go/i });

/**
 * The identity step's own URL — `seq=done` is what tells `/onboarding` it is
 * being visited as the LAST step of the sequence rather than as the door into
 * it (SEQUENCE_DONE_PARAM). Without the marker the route replaces itself with
 * /onboarding/age and the form never renders.
 */
const IDENTITY_STEP = '/onboarding?seq=done';

/**
 * Walk the three screens WP8 added in front of the identity form, from the
 * age step through to the form itself. Each step is asserted on the way past,
 * so a step that stops handing off fails here rather than silently skipping
 * the rest of the sequence.
 */
async function walkSequenceToIdentity(page: Page): Promise<void> {
  // The 21+ answer is pre-seeded for every spec by playwright.config.ts's
  // storageState, so the age step opens on its ALREADY-CONFIRMED branch and
  // its forward control is Continue rather than "I'm 21 or older". The
  // question itself is covered by app-store-pack.spec.ts, which clears that
  // state on purpose.
  await expect(
    page.getByRole('heading', { name: /this app is for bars and nightlife/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/already confirmed you.re 21 or older/i),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Continue$/ }).click();

  await page.waitForURL(/\/onboarding\/location\?next=/);
  await expect(
    page.getByRole('heading', { name: /find bars near you tonight/i }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Not now$/ }).click();

  await page.waitForURL(/\/onboarding\/quiz\?next=/);
  await expect(
    page.getByRole('heading', { name: /^Tune my picks$/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /show me bars/i }).click();
}

test.describe('identity onboarding (signed in)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    await signIn(page);
  });

  test('gate routes a confirmed handle-less account to /onboarding', async ({
    page,
  }) => {
    await stubSupabase(page, { profileHandle: null });
    await page.goto('/settings');

    // The gate carries the route it interrupted as ?next= (criterion 1), and
    // `/onboarding` hands that value straight on to the first step of the
    // sequence — so the first URL that settles is the age step. Assert the
    // pathname and the carried value separately, which pins the behaviour
    // instead of the shape.
    await page.waitForURL(/\/onboarding\/age\?next=/);
    const gateUrl = new URL(page.url());
    expect(gateUrl.pathname).toBe('/onboarding/age');
    expect(
      gateUrl.searchParams.get('next'),
      'the gate must carry the interrupted route so onboarding can return to it',
    ).toBe('/settings');

    // …and the sequence ends on the identity form, still carrying the route
    // the gate interrupted.
    await walkSequenceToIdentity(page);
    await page.waitForURL(/\/onboarding\?next=/);
    const identityUrl = new URL(page.url());
    expect(identityUrl.pathname).toBe('/onboarding');
    expect(
      identityUrl.searchParams.get('next'),
      'the interrupted route must survive every step of the sequence',
    ).toBe('/settings');
    await expect(
      page.getByRole('heading', { name: /pick how friends see you/i }),
    ).toBeVisible();
    await expect(nameInput(page)).toBeVisible();
    await expect(usernameInput(page)).toBeVisible();
  });

  test('gate leaves an onboarded account alone; Settings shows name + @handle, never the email', async ({
    page,
  }) => {
    await stubSupabase(page, {
      profileHandle: 'connor_f',
      profileDisplayName: 'Conor F',
    });
    await page.goto('/settings');

    // Identity pair renders…
    await expect(page.getByText('Conor F', { exact: true })).toBeVisible();
    await expect(page.getByText('@connor_f')).toBeVisible();
    // …the gate did NOT redirect, and the email is nowhere in the DOM.
    expect(new URL(page.url()).pathname).toBe('/settings');
    await expect(page.locator('body')).not.toContainText(USER_EMAIL);
  });

  test('submit saves the name, claims the handle, and lands home — with the gate quiet', async ({
    page,
  }) => {
    const patchBodies: string[] = [];
    await stubSupabase(page, {
      profileHandle: null,
      claimResult: 'connor_f',
      patchBodies,
    });
    await page.goto(IDENTITY_STEP);

    await typeInto(nameInput(page), 'Conor F');
    await typeInto(usernameInput(page), 'connor_f');
    await submitButton(page).click();

    // Success = full navigation home; the (still handle-less) profile stub
    // must NOT bounce us back — the once-per-session flag holds the gate.
    await page.waitForURL(
      (url) => new URL(url).pathname === '/',
      { timeout: 15_000 },
    );
    expect(patchBodies.length).toBeGreaterThan(0);
    expect(patchBodies[0]).toContain('"display_name":"Conor F"');
  });

  test('a lost claim race surfaces as "taken" and stays on the form', async ({
    page,
  }) => {
    await stubSupabase(page, { profileHandle: null, claimResult: null });
    await page.goto(IDENTITY_STEP);

    await typeInto(nameInput(page), 'Conor F');
    await typeInto(usernameInput(page), 'connor_f');
    await submitButton(page).click();

    await expect(
      page.getByText(/that username is taken/i),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/onboarding');
  });

  test('skip goes home and the gate does not re-prompt this session', async ({
    page,
  }) => {
    await stubSupabase(page, { profileHandle: null });
    await page.goto(IDENTITY_STEP);

    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.waitForURL((url) => new URL(url).pathname === '/');

    // Navigate somewhere gate-eligible: the flag must keep us there.
    await page.goto('/settings');
    await page.waitForTimeout(1_000);
    expect(new URL(page.url()).pathname).toBe('/settings');
  });
});
