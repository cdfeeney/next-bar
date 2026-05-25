/**
 * auth-page.spec.ts
 *
 * v0.5.0 coverage for /auth — magic-link sign-in form interactive states.
 *
 * Scope: client-side UI of the AuthPage component. The actual sign-in
 * round-trip (OTP email → callback → cookie → session) lives in
 * ratings-sync.spec.ts where we cookie-inject a session. Here we stub
 * `POST /auth/v1/otp` so we can assert what the form does in each state
 * without sending real email.
 *
 * What this guards against:
 *   - Validation regressions on the email field
 *   - The "Check your inbox" confirmation state failing to render
 *   - The "Use a different email" reset breaking
 *   - Error responses from Supabase not surfacing in the UI
 *   - The Skip-for-now and brand links pointing somewhere other than `/`
 *
 * WebKit (iPhone 13) note: `.fill()` writes the DOM value but on WebKit the
 * React onChange handler for a controlled `value={email}` input doesn't
 * always fire before the next interaction — the submit then sees an empty
 * `email` state and trips the "doesn't look right" validator. `.click()` +
 * `pressSequentially()` produces real key events that React's synthetic
 * event layer handles consistently on both engines.
 */

import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

async function typeEmail(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.pressSequentially(value);
  await expect(input).toHaveValue(value);
}

/**
 * Stub Supabase's OTP endpoint. The browser client posts to
 * `<SUPABASE_URL>/auth/v1/otp` regardless of project — we match by path so
 * the spec doesn't need to know which project the dev server is configured
 * against.
 */
async function stubOtpOk(page: Page): Promise<void> {
  await page.route('**/auth/v1/otp**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

async function stubOtpError(page: Page, message: string): Promise<void> {
  await page.route('**/auth/v1/otp**', async (route: Route) => {
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_request', error_description: message }),
    });
  });
}

test.describe('/auth — magic-link form', () => {
  test('renders header, brand link, and skip-for-now both pointing to /', async ({ page }) => {
    await page.goto('/auth');

    // The bottom nav has a "Next Bar?" tab so the bare-name brand link is
    // ambiguous — scope to the page <header>, which only the AuthPage owns.
    const header = page.locator('header').first();
    const brand = header.getByRole('link', { name: 'Next Bar', exact: true });
    await expect(brand).toHaveAttribute('href', '/');

    const skip = page.getByRole('link', { name: /skip for now/i });
    await expect(skip).toHaveAttribute('href', '/');
  });

  test('blocks submit until email shape is valid', async ({ page }) => {
    await stubOtpOk(page);
    await page.goto('/auth');

    const input = page.getByRole('textbox', { name: /email/i });
    const submit = page.getByRole('button', { name: /send sign-in link/i });

    // Browser-level required + type=email blocks submit when empty.
    await submit.click();
    await expect(page.getByText(/check your inbox/i)).not.toBeVisible();

    // Type=email rejects this at the browser layer; even if it slips through,
    // our client-side regex shows the "doesn't look right" error.
    await typeEmail(input, 'not-an-email');
    await submit.click();
    // Either the browser blocked submit or our app showed an error; we
    // accept both outcomes. What we DON'T accept: the confirmation state.
    await expect(page.getByText(/check your inbox/i)).not.toBeVisible();
  });

  test('successful submit shows the "Check your inbox" confirmation', async ({ page }) => {
    await stubOtpOk(page);
    await page.goto('/auth');

    const input = page.getByRole('textbox', { name: /email/i });
    await typeEmail(input, 'connor@example.com');
    await page.getByRole('button', { name: /send sign-in link/i }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
    await expect(page.getByText('connor@example.com')).toBeVisible();
    // Form should be gone; reset button should be in its place.
    await expect(page.getByRole('button', { name: /send sign-in link/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /use a different email/i })).toBeVisible();
  });

  test('"Use a different email" returns to the form, preserving the typed address', async ({
    page,
  }) => {
    await stubOtpOk(page);
    await page.goto('/auth');

    const input = page.getByRole('textbox', { name: /email/i });
    await typeEmail(input, 'first@example.com');
    await page.getByRole('button', { name: /send sign-in link/i }).click();
    await expect(page.getByText(/check your inbox/i)).toBeVisible();

    await page.getByRole('button', { name: /use a different email/i }).click();

    // Back to the form. The input keeps its value (user can edit, not retype).
    const inputAfter = page.getByRole('textbox', { name: /email/i });
    await expect(inputAfter).toBeVisible();
    await expect(inputAfter).toHaveValue('first@example.com');
    await expect(page.getByRole('button', { name: /send sign-in link/i })).toBeVisible();
  });

  test('Supabase error surfaces inline without entering the sent state', async ({ page }) => {
    await stubOtpError(page, 'Rate limit exceeded — try again in a minute.');
    await page.goto('/auth');

    const input = page.getByRole('textbox', { name: /email/i });
    await typeEmail(input, 'connor@example.com');
    await page.getByRole('button', { name: /send sign-in link/i }).click();

    // AuthPage renders the error as <p role="alert">. Next.js also injects
    // a hidden #__next-route-announcer__ with role="alert" so we narrow to
    // the form's own alert paragraph.
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/rate limit/i);

    // We did NOT advance to the confirmation state.
    await expect(page.getByText(/check your inbox/i)).not.toBeVisible();
    await expect(page.getByRole('button', { name: /send sign-in link/i })).toBeVisible();
  });

  test('submit does NOT navigate away from /auth', async ({ page }) => {
    // Regression class — the rating-buttons-redirect-home bug. Any form
    // submit that changes route is suspect.
    await stubOtpOk(page);
    await page.goto('/auth');

    const input = page.getByRole('textbox', { name: /email/i });
    await typeEmail(input, 'connor@example.com');
    await page.getByRole('button', { name: /send sign-in link/i }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });
});
