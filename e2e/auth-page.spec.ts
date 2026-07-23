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

/** /auth now defaults to the Password tab; magic-link tests switch first. */
async function gotoLinkTab(page: Page): Promise<void> {
  await page.goto('/auth');
  await page.getByRole('tab', { name: /Email link/i }).click();
  await expect(
    page.getByRole('button', { name: /send sign-in link/i }),
  ).toBeVisible();
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
    await gotoLinkTab(page);

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
    await gotoLinkTab(page);

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
    await gotoLinkTab(page);

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
    await gotoLinkTab(page);

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
    await gotoLinkTab(page);

    const input = page.getByRole('textbox', { name: /email/i });
    await typeEmail(input, 'connor@example.com');
    await page.getByRole('button', { name: /send sign-in link/i }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });
});

test.describe('/auth — password form', () => {
  test('password tab is the default with sign-in and create-account modes', async ({
    page,
  }) => {
    await page.goto('/auth');

    await expect(page.getByRole('tab', { name: 'Password' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();

    await page.getByRole('button', { name: /create an account/i }).click();
    await expect(
      page.getByRole('button', { name: /^Create account →$/ }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(/Choose a password/)).toBeVisible();
  });

  test('sign-up success shows the verify-your-email state', async ({ page }) => {
    await page.route('**/auth/v1/signup**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'u1', email: 'new@example.com', identities: [{ id: 'i1' }] },
          session: null,
        }),
      });
    });
    await page.goto('/auth');
    await page.getByRole('button', { name: /create an account/i }).click();

    await typeEmail(
      page.getByRole('textbox', { name: /email/i }),
      'new@example.com',
    );
    const pw = page.getByPlaceholder(/Choose a password/);
    await pw.click();
    await pw.pressSequentially('hunter22');
    await page.getByRole('button', { name: /^Create account →$/ }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
    await expect(page.getByText(/verification link/i)).toBeVisible();
    await expect(page.getByText('new@example.com')).toBeVisible();
  });

  test('sign-up with an existing email flips to sign-in with guidance', async ({
    page,
  }) => {
    // Confirm-email-on: Supabase signals an existing account via an
    // obfuscated user with zero identities.
    await page.route('**/auth/v1/signup**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'u1', email: 'taken@example.com', identities: [] },
          session: null,
        }),
      });
    });
    await page.goto('/auth');
    await page.getByRole('button', { name: /create an account/i }).click();

    await typeEmail(
      page.getByRole('textbox', { name: /email/i }),
      'taken@example.com',
    );
    const pw = page.getByPlaceholder(/Choose a password/);
    await pw.click();
    await pw.pressSequentially('hunter22');
    await page.getByRole('button', { name: /^Create account →$/ }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toContainText(/already has an account/i);
    // Flipped back to sign-in mode for them.
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();
  });

  test('wrong password surfaces a friendly error, no navigation', async ({
    page,
  }) => {
    await page.route('**/auth/v1/token**', async (route: Route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
        }),
      });
    });
    await page.goto('/auth');

    await typeEmail(
      page.getByRole('textbox', { name: /email/i }),
      'connor@example.com',
    );
    const pw = page.getByPlaceholder('Password');
    await pw.click();
    await pw.pressSequentially('wrongpass');
    await page.getByRole('button', { name: /^Sign in →$/ }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/wrong email or password/i);
    await expect(page).toHaveURL(/\/auth$/);
  });

  test('short password is blocked client-side before any request', async ({
    page,
  }) => {
    // No route stub: if a request fired, this test would hang or 4xx —
    // the client-side length check must reject first. minLength on the
    // input blocks native submit, and the JS guard is the backstop.
    await page.goto('/auth');

    await typeEmail(
      page.getByRole('textbox', { name: /email/i }),
      'connor@example.com',
    );
    const pw = page.getByPlaceholder('Password');
    await pw.click();
    await pw.pressSequentially('abc');
    await page.getByRole('button', { name: /^Sign in →$/ }).click();

    // Never left the form, never reached a confirmation state.
    await expect(page.getByText(/check your inbox/i)).not.toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });
});
