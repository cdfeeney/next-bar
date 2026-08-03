/**
 * Minimal fake signed-in session for e2e (extracted from the pattern
 * onboarding-identity.spec.ts / claim-handle.spec.ts use): every Supabase
 * endpoint is intercepted so no real accounts or rows are involved;
 * signed-in state is faked via the @supabase/ssr auth cookie.
 *
 * This helper stubs only the generic surfaces (auth, catch-all REST with
 * empty rows, a minimal profiles row). Specs needing richer behavior
 * (handle claims, PATCH capture) keep their own inline stubs.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, Route } from '@playwright/test';

export const FAKE_USER_ID = '11111111-2222-3333-4444-555555555555';

function readSupabaseUrl(): string | null {
  try {
    const env = readFileSync(path.join(__dirname, '..', '..', '.env.local'), 'utf8');
    const match = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

export const SUPABASE_URL = readSupabaseUrl();

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sessionCookie(supabaseUrl: string): { name: string; value: string } {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const accessToken = [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(
      JSON.stringify({ sub: FAKE_USER_ID, role: 'authenticated', exp: expiresAt }),
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
      id: FAKE_USER_ID,
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
 * Fake a signed-in session: set the auth cookie and stub every Supabase
 * call with benign responses (empty row sets; a minimal onboarded
 * profiles row so gates stay quiet). Returns false when no Supabase URL
 * is configured — callers should test.skip() in that case.
 */
export async function fakeSignedIn(
  context: BrowserContext,
  page: Page,
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  const { name, value } = sessionCookie(SUPABASE_URL);
  await context.addCookies([
    { name, value, domain: 'localhost', path: '/' },
  ]);
  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route('**/rest/v1/profiles**', (route) =>
    fulfillJson(200, [
      {
        id: FAKE_USER_ID,
        handle: 'e2e_user',
        display_name: 'E2E User',
        is_private: false,
      },
    ])(route),
  );
  return true;
}
