/**
 * account-delete.spec.ts — H2 (N3): Settings "Delete account" flow with the
 * API route STUBBED at the browser boundary (page.route on our own
 * /api/account/delete) — no request ever reaches the server route, so
 * nothing can touch live auth. Same cookie pattern as friends-real.spec.ts.
 *
 * (Defense in depth: even if a stub leaked, the dev server under the
 * overnight loop inherits LOOP_UNATTENDED=1 and the route hard-503s.)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';

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

async function stubForSettings(
  page: Page,
  opts: { deleteResult: { status: number; body: unknown } },
): Promise<void> {
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route(
    '**/rest/v1/profiles**',
    fulfillJson(200, [
      { handle: 'connor_f', display_name: null, is_private: false },
    ]),
  );
  // Our OWN API route, stubbed in the browser — the server never sees it.
  await page.route(
    '**/api/account/delete',
    fulfillJson(opts.deleteResult.status, opts.deleteResult.body),
  );
}

test.describe('/settings — delete account (H2)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      SUPABASE_URL === null,
      'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
    );
    const cookie = sessionCookie(SUPABASE_URL as string);
    await page
      .context()
      .addCookies([{ ...cookie, url: 'http://localhost:3000' }]);
  });

  test('type-to-confirm gates the button; success signs out and lands on /', async ({
    page,
  }) => {
    await stubForSettings(page, {
      deleteResult: { status: 200, body: { ok: true } },
    });
    await page.goto('/settings');

    await page.getByRole('button', { name: /^Delete account$/ }).click();

    const confirmButton = page.getByRole('button', {
      name: /permanently delete/i,
    });
    await expect(confirmButton).toBeDisabled();

    const input = page.getByLabel(/type/i);
    await input.click();
    await input.pressSequentially('del');
    await expect(confirmButton).toBeDisabled();
    await input.pressSequentially('ete');
    await expect(confirmButton).toBeEnabled();

    const deleteCall = page.waitForRequest(
      (req) =>
        req.url().includes('/api/account/delete') && req.method() === 'POST',
    );
    await confirmButton.click();
    const req = await deleteCall;
    // The caller's token travels as a bearer header — never in a body.
    expect(req.headers()['authorization']).toMatch(/^Bearer /);

    await expect(page).toHaveURL(/\/$/);
  });

  test('a failed deletion reports honestly and stays on settings', async ({
    page,
  }) => {
    await stubForSettings(page, {
      deleteResult: {
        status: 503,
        body: { ok: false, error: 'unavailable' },
      },
    });
    await page.goto('/settings');

    await page.getByRole('button', { name: /^Delete account$/ }).click();
    const input = page.getByLabel(/type/i);
    await input.click();
    await input.pressSequentially('delete');
    await page.getByRole('button', { name: /permanently delete/i }).click();

    await expect(
      page.getByText(/couldn.t delete your account — nothing was removed/i),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);
    // Still armed for a retry.
    await expect(
      page.getByRole('button', { name: /permanently delete/i }),
    ).toBeEnabled();
  });

  test('cancel disarms without any API call', async ({ page }) => {
    let deleteCalled = false;
    await stubForSettings(page, {
      deleteResult: { status: 200, body: { ok: true } },
    });
    page.on('request', (req) => {
      if (req.url().includes('/api/account/delete')) deleteCalled = true;
    });
    await page.goto('/settings');

    await page.getByRole('button', { name: /^Delete account$/ }).click();
    await page.getByRole('button', { name: /^Cancel$/ }).click();

    await expect(
      page.getByRole('button', { name: /^Delete account$/ }),
    ).toBeVisible();
    expect(deleteCalled).toBe(false);
  });
});
