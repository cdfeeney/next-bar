/**
 * auth-cross-context.spec.ts
 *
 * Playwright coverage for the two P0s found in the 2026-08-06 auth audit.
 * Runs on iPhone 13 (WebKit) and Pixel 7 (Chromium) — both default device
 * projects — because the bug is engine-specific in its WORDING and the
 * assertions here must hold on either.
 *
 *   1. "Load failed" must never render. That string is WebKit's
 *      `TypeError.message` for a failed fetch; Chromium says "Failed to
 *      fetch". `route.abort()` below produces a REAL transport failure in
 *      the engine, so this reproduces the operator's exact bug rather than
 *      simulating it with a hand-written error object — and it is the only
 *      layer that can prove the engine wording never leaks.
 *
 *   2. The cross-browser PKCE failure must not be reported as an expired
 *      link. That misdiagnosis sent users to request a fresh link, which
 *      failed identically.
 *
 * NO NETWORK: every Supabase call is either aborted or stubbed at the route
 * layer, and the /auth/confirm cases below exercise only its parameter
 * validation — the path that provably returns before a client is built. No
 * spec here contacts Staging or any Supabase project.
 *
 * WebKit note (inherited from auth-page.spec.ts): `.fill()` writes the DOM
 * value but React's onChange does not reliably fire before the next
 * interaction, so use click + pressSequentially.
 */

import { test, expect, type Locator, type Page } from '@playwright/test';

async function typeInto(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.pressSequentially(value);
  await expect(input).toHaveValue(value);
}

/** Every engine's fetch-failure wording, so no viewport can leak its own. */
const ENGINE_FETCH_ERRORS = /load failed|failed to fetch|networkerror/i;

async function openForgotForm(page: Page): Promise<void> {
  await page.goto('/auth');
  await page.getByRole('button', { name: /forgot your password/i }).click();
  await expect(page.getByRole('heading', { name: /reset your password/i })).toBeVisible();
}

test.describe('/auth — a dead network never leaks the engine error', () => {
  test('forgot password shows connection guidance, not "Load failed"', async ({ page }) => {
    // A real aborted request: the browser rejects fetch with its own
    // TypeError, auth-js wraps the message verbatim, and the old code
    // rendered it. This is the operator's bug, reproduced.
    await page.route('**/auth/v1/recover**', (route) => route.abort('failed'));

    await openForgotForm(page);
    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/couldn't reach the server/i);
    await expect(alert).not.toContainText(ENGINE_FETCH_ERRORS);
    // A transport failure must never be mistaken for a sent email.
    await expect(page.getByText(/check your inbox/i)).not.toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test('sign in shows connection guidance, not "Load failed"', async ({ page }) => {
    await page.route('**/auth/v1/token**', (route) => route.abort('failed'));

    await page.goto('/auth');
    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await typeInto(page.getByPlaceholder('Password'), 'hunter22');
    await page.getByRole('button', { name: /^Sign in →$/ }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/couldn't reach the server/i);
    await expect(alert).not.toContainText(ENGINE_FETCH_ERRORS);
    await expect(page).toHaveURL(/\/auth$/);
  });

  test('create account shows connection guidance, not "Load failed"', async ({ page }) => {
    await page.route('**/auth/v1/signup**', (route) => route.abort('failed'));

    await page.goto('/auth');
    await page.getByRole('button', { name: /create an account/i }).click();
    await typeInto(page.getByRole('textbox', { name: /email/i }), 'new@example.com');
    await typeInto(page.getByPlaceholder(/Choose a password/), 'hunter22');
    await page.getByRole('button', { name: /^Create account →$/ }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/couldn't reach the server/i);
    await expect(alert).not.toContainText(ENGINE_FETCH_ERRORS);
  });

  test('a 500 with an HTML body still yields app copy, never markup', async ({ page }) => {
    // Non-JSON error bodies take a different auth-js branch (AuthUnknownError
    // from the failed .json() parse). It must land on app copy too.
    await page.route('**/auth/v1/recover**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'text/html',
        body: '<html><body>Internal Server Error: pg_hba.conf rejects host</body></html>',
      }),
    );

    await openForgotForm(page);
    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/pg_hba|<html>|Internal Server Error/i);
  });
});

test.describe('/auth — successful reset stays put', () => {
  test('sending a reset link does NOT change the URL', async ({ page }) => {
    await page.route('**/auth/v1/recover**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    await openForgotForm(page);
    const urlBefore = page.url();
    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
    // Negative assertion (CLAUDE.md): the confirmation is an in-place state
    // change, never a navigation.
    expect(page.url()).toBe(urlBefore);
    await expect(page).toHaveURL(/\/auth$/);
  });
});

test.describe('/auth — cross-context PKCE guidance', () => {
  test('the PKCE sentinel does NOT claim the link expired', async ({ page }) => {
    await page.goto(`/auth?error=pkce_code_verifier_not_found`);

    const banner = page.locator('div[role="alert"]').filter({ hasText: /\S/ });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/same device and browser/i);
    // The precise regression: this used to read "expired or was already used".
    await expect(banner).not.toContainText(/expired/i);
    await expect(banner).not.toContainText(/already used/i);
    // Param stripped so a refresh cannot re-show a stale banner.
    await expect(page).toHaveURL(/\/auth$/);
  });

  test('the PKCE banner offers a resend that lands in the forgot flow', async ({ page }) => {
    await page.goto(`/auth?error=pkce_code_verifier_not_found`);

    const banner = page.locator('div[role="alert"]').filter({ hasText: /\S/ });
    await banner.getByRole('button', { name: /send a new link/i }).click();

    await expect(banner).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /reset your password/i })).toBeVisible();
  });

  test('a genuinely expired link still says expired', async ({ page }) => {
    await page.goto('/auth?error=otp_expired');

    const banner = page.locator('div[role="alert"]').filter({ hasText: /\S/ });
    await expect(banner).toContainText(/expired or was already used/i);
    await expect(banner).not.toContainText(/same device and browser/i);
  });
});

test.describe('/auth/confirm — token-hash route validation', () => {
  // Only the pre-client validation path is exercised: these inputs provably
  // return before a Supabase client is constructed, so nothing here can
  // reach a project.

  test('a link with no token_hash redirects to /auth with guidance', async ({ page }) => {
    await page.goto('/auth/confirm?type=recovery');

    await expect(page).toHaveURL(/\/auth(\?|$)/);
    const banner = page.locator('div[role="alert"]').filter({ hasText: /\S/ });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/expired or was already used/i);
  });

  test('a type outside the allowlist is refused', async ({ page }) => {
    await page.goto('/auth/confirm?token_hash=abc123&type=magiclink');

    await expect(page).toHaveURL(/\/auth(\?|$)/);
    await expect(
      page.locator('div[role="alert"]').filter({ hasText: /\S/ }),
    ).toBeVisible();
  });

  /**
   * The token hash is a bearer credential: whoever reads it can complete the
   * flow. This asserts it survives nowhere the browser can reach after a
   * rejected confirmation — not the URL, not the DOM, not the browser console.
   *
   * It sends a REAL sentinel. The previous version requested `/auth/confirm`
   * with no token at all and asserted the URL lacked `token_hash`, which could
   * not fail however the route behaved (santa round 1, Codex). The rejected
   * type keeps the request server-local: the allowlist refuses it before any
   * Supabase call, so this stays loopback-only with the fence up.
   *
   * SERVER-side log redaction is not observable from here — Playwright sees the
   * browser console, not the dev server's stdout. That half is pinned by
   * src/lib/authConfirmDiagnostics.test.ts and the route unit tests.
   */
  test('a rejected confirmation leaks the token hash nowhere', async ({ page }) => {
    const SENTINEL = 'e2e-sentinel-token-hash-9f3a2b';
    const consoleText: string[] = [];
    page.on('console', (message) => consoleText.push(message.text()));
    page.on('pageerror', (error) => consoleText.push(error.message));

    await page.goto(`/auth/confirm?token_hash=${SENTINEL}&type=magiclink`);
    await expect(page).toHaveURL(/\/auth(\?|$)/);

    const banner = page.locator('div[role="alert"]').filter({ hasText: /\S/ });
    await expect(banner).toBeVisible();

    expect(page.url()).not.toContain(SENTINEL);
    expect(page.url()).not.toContain('token_hash');
    expect(await page.content()).not.toContain(SENTINEL);
    await expect(banner).not.toContainText(SENTINEL);
    expect(consoleText.join('\n')).not.toContain(SENTINEL);
  });
});
