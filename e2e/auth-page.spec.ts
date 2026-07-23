/**
 * auth-page.spec.ts
 *
 * Coverage for /auth — conventional email + password sign-in.
 *
 * Scope: client-side UI of the AuthPage component. We stub Supabase's REST
 * endpoints (`/auth/v1/signup`, `/auth/v1/token`, `/auth/v1/recover`) so we
 * can assert each form state without real accounts or email.
 *
 * What this guards against:
 *   - Validation regressions on the email/password fields
 *   - Sign-up verification + forgot-password confirmation states breaking
 *   - Error responses from Supabase not surfacing (or surfacing raw)
 *   - The Skip-for-now and brand links pointing somewhere other than `/`
 *
 * WebKit (iPhone 13) note: `.fill()` writes the DOM value but on WebKit the
 * React onChange handler for a controlled input doesn't always fire before
 * the next interaction — the submit then sees empty state. `.click()` +
 * `pressSequentially()` produces real key events that React's synthetic
 * event layer handles consistently on both engines.
 */

import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

async function typeInto(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.pressSequentially(value);
  await expect(input).toHaveValue(value);
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

test.describe('/auth — sign in', () => {
  test('renders header, brand link, and skip-for-now both pointing to /', async ({ page }) => {
    await page.goto('/auth');

    // The bottom nav is hidden on /auth, but scope to the page <header>
    // anyway — it's the element AuthPage owns.
    const header = page.locator('header').first();
    const brand = header.getByRole('link', { name: 'Next Bar', exact: true });
    await expect(brand).toHaveAttribute('href', '/');

    const skip = page.getByRole('link', { name: /skip for now/i });
    await expect(skip).toHaveAttribute('href', '/');
  });

  test('renders the conventional form: email, password, forgot link', async ({ page }) => {
    await page.goto('/auth');

    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /forgot your password/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create an account/i }),
    ).toBeVisible();
  });

  test('wrong password surfaces a friendly error, no navigation', async ({ page }) => {
    await page.route(
      '**/auth/v1/token**',
      fulfillJson(400, {
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
      }),
    );
    await page.goto('/auth');

    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await typeInto(page.getByPlaceholder('Password'), 'wrongpass');
    await page.getByRole('button', { name: /^Sign in →$/ }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/wrong email or password/i);
    await expect(page).toHaveURL(/\/auth$/);
  });

  test('short password is blocked client-side before any request', async ({ page }) => {
    // No route stub: if a request fired, this test would hang or 4xx — the
    // client-side length check must reject first. minLength on the input
    // blocks native submit, and the JS guard is the backstop.
    await page.goto('/auth');

    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await typeInto(page.getByPlaceholder('Password'), 'abc');
    await page.getByRole('button', { name: /^Sign in →$/ }).click();

    await expect(page.getByText(/check your inbox/i)).not.toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });
});

test.describe('/auth — create account', () => {
  test('sign-up success shows the verify-your-email state', async ({ page }) => {
    await page.route(
      '**/auth/v1/signup**',
      fulfillJson(200, {
        user: { id: 'u1', email: 'new@example.com', identities: [{ id: 'i1' }] },
        session: null,
      }),
    );
    await page.goto('/auth');
    await page.getByRole('button', { name: /create an account/i }).click();
    await expect(
      page.getByRole('heading', { name: /create your account/i }),
    ).toBeVisible();

    await typeInto(page.getByRole('textbox', { name: /email/i }), 'new@example.com');
    await typeInto(page.getByPlaceholder(/Choose a password/), 'hunter22');
    await page.getByRole('button', { name: /^Create account →$/ }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
    await expect(page.getByText(/verification link/i)).toBeVisible();
    await expect(page.getByText('new@example.com')).toBeVisible();
  });

  test('sign-up with an existing email flips to sign-in with guidance', async ({ page }) => {
    // Confirm-email-on: Supabase signals an existing account via an
    // obfuscated user with zero identities.
    await page.route(
      '**/auth/v1/signup**',
      fulfillJson(200, {
        user: { id: 'u1', email: 'taken@example.com', identities: [] },
        session: null,
      }),
    );
    await page.goto('/auth');
    await page.getByRole('button', { name: /create an account/i }).click();

    await typeInto(page.getByRole('textbox', { name: /email/i }), 'taken@example.com');
    await typeInto(page.getByPlaceholder(/Choose a password/), 'hunter22');
    await page.getByRole('button', { name: /^Create account →$/ }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toContainText(/already has an account/i);
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();
  });
});

test.describe('/auth — forgot password', () => {
  test('sends the reset email and shows the confirmation state', async ({ page }) => {
    await page.route('**/auth/v1/recover**', fulfillJson(200, {}));
    await page.goto('/auth');

    await page.getByRole('button', { name: /forgot your password/i }).click();
    await expect(
      page.getByRole('heading', { name: /reset your password/i }),
    ).toBeVisible();
    // Password field is gone in the forgot view.
    await expect(page.getByPlaceholder('Password')).not.toBeVisible();

    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
    await expect(page.getByText(/We sent a reset link/i)).toBeVisible();
    await expect(page.getByText('connor@example.com')).toBeVisible();

    // Back link returns to the sign-in form.
    await page.getByRole('button', { name: /back to sign in/i }).click();
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();
  });

  test('reset error surfaces inline without entering the sent state', async ({ page }) => {
    await page.route(
      '**/auth/v1/recover**',
      fulfillJson(429, {
        error: 'over_email_send_rate_limit',
        error_description: 'Rate limit exceeded — try again in a minute.',
      }),
    );
    await page.goto('/auth');

    await page.getByRole('button', { name: /forgot your password/i }).click();
    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/rate limit/i);
    await expect(page.getByText(/check your inbox/i)).not.toBeVisible();
  });
});
