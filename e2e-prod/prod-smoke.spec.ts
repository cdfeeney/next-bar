/**
 * prod-smoke.spec.ts — READ-ONLY production smoke (N3, night-5).
 *
 * One command after any deploy:
 *   npx playwright test --config playwright.prod.config.ts
 *
 * Every check is anonymous and side-effect-free: page renders, health
 * JSON, OG image content-types. NO writes, NO sign-in, NO RPC calls
 * beyond what anonymous pages already make. The age-ack localStorage
 * flag is the single allowed storage write (without it the 21+ gate
 * intercepts every page).
 */

import { test, expect, type Page } from '@playwright/test';

async function ackAgeGate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
}

test.describe('prod smoke — pages render', () => {
  test.beforeEach(async ({ page }) => {
    await ackAgeGate(page);
  });

  test('/ renders the app shell (nav + a home surface)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    // Any of the home states counts as alive: primer, locating, results,
    // or the manual pick fallback — we only prove the surface mounted.
    await expect(
      page
        .getByRole('heading', { name: /Find bars near you|Finding bars|Where are you\?|Your next/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('/map renders the Find Bar surface', async ({ page }) => {
    await page.goto('/map');
    await expect(
      page.getByRole('heading', { name: /Find Bar/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('/join renders the waitlist form', async ({ page }) => {
    await page.goto('/join');
    // WaitlistForm renders h2s, not an h1 (either the form or the
    // already-on-the-list state).
    await expect(
      page
        .getByRole('heading', { name: /Want it on your phone|on the list/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('/privacy renders', async ({ page }) => {
    await page.goto('/privacy');
    await expect(
      page.getByRole('heading', { name: /privacy/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('/friends renders anonymously', async ({ page }) => {
    await page.goto('/friends');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('prod smoke — endpoints', () => {
  test('/api/health is ok with a sha and reachable supabase', async ({
    request,
  }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      supabase: string;
      sha: string;
    };
    expect(body.ok).toBe(true);
    expect(body.supabase).toBe('ok');
    expect(body.sha).toMatch(/^[0-9a-f]{7,40}$/);
  });

  test('site OG image serves a PNG', async ({ request }) => {
    const res = await request.get('/opengraph-image');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test('/join OG image serves a PNG', async ({ request }) => {
    const res = await request.get('/join/opengraph-image');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test('share-card OG image serves a PNG (edge route, slim-catalog bundle)', async ({
    request,
  }) => {
    // attaboy is a stable catalog id; this exercises the EDGE OG path
    // whose 1MB bundle limit has bitten deploys before (PR #11 incident).
    const res = await request.get('/share/attaboy/opengraph-image');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });
});
