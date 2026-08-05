/**
 * signin-gate.spec.ts (goal g-31c59158)
 *
 * Operator decision 2026-08-05 (a): opening the INSTALLED APP while signed
 * out must present a login window. Confirmed missing on live Staging
 * 2026-08-05 (docs/STAGING-ACCEPTANCE-2026-08-05.md) on both viewports.
 *
 * The negative assertions carry as much weight as the positive one
 * (CLAUDE.md): this gate must NOT appear in an ordinary web browser — the
 * signed-out web surface is a deliberate product (local mode, /install
 * marketing, anonymous browsing) — and it must never trap the user.
 */

import { test, expect } from '@playwright/test';
import { asInstalledApp } from './helpers/standalone';
import { fakeSignedIn } from './helpers/fakeAuth';
import { installLoopbackFixtures } from './helpers/catalogFixture';

const GATE = { name: /sign in to next bar/i };

test.beforeEach(async ({ page }) => {
  await installLoopbackFixtures(page);
});

test.describe('installed-app sign-in gate', () => {
  test('signed out in the installed app: the login window appears', async ({
    page,
    context,
  }) => {
    await asInstalledApp(context);
    await page.goto('/');
    const dialog = page.getByRole('dialog', GATE);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('link', { name: /sign in/i })).toBeVisible();
  });

  test('NEGATIVE: an ordinary web browser never sees it', async ({ page }) => {
    // No asInstalledApp() — this is the plain web surface.
    await page.goto('/');
    // Give it the same settle time the positive case gets, so this cannot
    // pass merely by being faster than the gate.
    await page.waitForTimeout(3_000);
    await expect(page.getByRole('dialog', GATE)).toHaveCount(0);
  });

  test('NEGATIVE: a signed-in installed app never sees it', async ({
    page,
    context,
  }) => {
    await asInstalledApp(context);
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');
    await page.goto('/');
    await page.waitForTimeout(3_000);
    await expect(page.getByRole('dialog', GATE)).toHaveCount(0);
  });

  test('dismissing it reveals the app and does NOT navigate', async ({
    page,
    context,
  }) => {
    await asInstalledApp(context);
    await page.goto('/');
    const before = page.url();
    const dialog = page.getByRole('dialog', GATE);
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await dialog.getByRole('button', { name: /not now/i }).click();

    await expect(dialog).toHaveCount(0);
    // NEGATIVE: dismissal is not navigation — the user stays where they were.
    expect(page.url()).toBe(before);
    // And the app underneath is actually usable, not left scroll-locked.
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .not.toBe('hidden');
  });

  test('the sign-in action goes to /auth', async ({ page, context }) => {
    await asInstalledApp(context);
    await page.goto('/');
    const dialog = page.getByRole('dialog', GATE);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/auth/);
  });

  test('NEGATIVE: it does not cover the age gate on a first-ever open', async ({
    page,
    context,
  }) => {
    // Age gate is the 21+ legal gate and must be answered FIRST; the sign-in
    // window must not render on top of it.
    await asInstalledApp(context);
    await context.clearCookies();
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('next-bar:age-ack:v1');
      } catch {
        /* storage unavailable */
      }
    });
    await page.goto('/');
    await expect(
      page.getByRole('dialog', { name: /21/i }).or(page.getByText(/21 or older/i)).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog', GATE)).toHaveCount(0);
  });
});
