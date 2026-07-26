/**
 * app-store-pack.spec.ts — H1 (N2): 21+ age gate, /privacy + /terms, and
 * /api/health.
 *
 * The global playwright config pre-acknowledges the age gate for every
 * other spec; the gate tests here override storageState with a virgin
 * context so the overlay actually appears.
 */

import { test, expect } from '@playwright/test';

test.describe('21+ age gate', () => {
  // Virgin context: no pre-seeded ack.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('first visit shows the gate, confirm dismisses, ack survives reload', async ({
    page,
  }) => {
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: /are you 21 or older/i });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /21 or older/i }),
    ).toBeVisible();

    await dialog.getByRole('button', { name: /21 or older/i }).click();
    await expect(dialog).not.toBeVisible();

    // The ack persists — no gate on reload or on other routes.
    await page.reload();
    await expect(
      page.getByRole('dialog', { name: /are you 21 or older/i }),
    ).not.toBeVisible();
    await page.goto('/map');
    await expect(
      page.getByRole('dialog', { name: /are you 21 or older/i }),
    ).not.toBeVisible();
  });

  test('the gate blocks interaction until acknowledged', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('dialog', { name: /are you 21 or older/i }),
    ).toBeVisible();
    // The overlay covers the app — a REAL click on the nav underneath must
    // time out on the hit-target check (the backdrop intercepts pointer
    // events; trial:true skips that check, so a genuine click it is).
    const nav = page.getByRole('link', { name: /map/i }).first();
    const blocked = await nav
      .click({ timeout: 1500 })
      .then(() => false)
      .catch(() => true);
    expect(blocked).toBe(true);
    // Still gated after the attempt.
    await expect(
      page.getByRole('dialog', { name: /are you 21 or older/i }),
    ).toBeVisible();
  });
});

test.describe('legal pages', () => {
  test('/privacy renders the FINALIZED policy — no placeholders, live deletion copy', async ({
    page,
  }) => {
    await page.goto('/privacy');
    await expect(
      page.getByRole('heading', { name: /privacy policy/i }),
    ).toBeVisible();
    await expect(page.getByText(/the short version/i)).toBeVisible();
    // Finalized 2026-07-25 (#35): placeholders are GONE for good, the
    // deletion copy reflects the live Settings flow, and the entity
    // line exists. Regressing any of these re-blocks App Store review.
    await expect(page.getByText(/\[PLACEHOLDER/)).toHaveCount(0);
    await expect(page.getByText(/Settings → Delete account/)).toBeVisible();
    await expect(
      page.getByText(/independent, individually operated/i),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /terms of use/i }),
    ).toBeVisible();
  });

  test('/terms renders and cross-links back to /privacy', async ({ page }) => {
    await page.goto('/terms');
    await expect(
      page.getByRole('heading', { name: /terms of use/i }),
    ).toBeVisible();
    await expect(page.getByText(/you must be 21\+/i)).toBeVisible();
    await expect(
      page.getByRole('link', { name: /privacy policy/i }),
    ).toBeVisible();
  });
});

test.describe('/api/health', () => {
  test('answers with status, supabase reachability, and a build sha', async ({
    request,
  }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBeLessThan(504);
    const body = (await res.json()) as {
      ok: boolean;
      supabase: string;
      sha: string;
      at: string;
    };
    expect(typeof body.ok).toBe('boolean');
    expect(['ok', 'unreachable', 'unconfigured']).toContain(body.supabase);
    expect(body.sha.length).toBeGreaterThan(0);
    expect(new Date(body.at).toString()).not.toBe('Invalid Date');
  });
});
