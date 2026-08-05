/**
 * profile-anon.spec.ts — g-4a0f81a5 (social audit finding #1/#2).
 *
 * THE GAP THIS PINS. A signed-out recipient of a REAL user's /u/[handle]
 * link used to get the demo-only lookup and its "No one here … they may
 * not be on Next Bar yet" copy — a FALSE claim about a real person, at the
 * exact moment the share loop is supposed to convert. Signed-out, the app
 * cannot distinguish a real handle from a nonexistent one (anon lookups
 * are revoked by design), so the only honest state is "we can't look this
 * up while you're signed out" + a sign-in path.
 *
 * The audit found this shipped unnoticed precisely because every existing
 * spec was signed-in-only (friends-real) or demo-handle-only (share-card).
 * This spec is the missing signed-out + real-shaped-handle coverage.
 */
import { test, expect } from '@playwright/test';

// Real-shaped, guaranteed NOT in the seeded demo curator list.
const REAL_SHAPED_HANDLE = 'connor_dogfood_2026';

test.describe('/u/[handle] signed out (real-shaped handle)', () => {
  test('no false "not on Next Bar" claim; honest sign-in path instead', async ({ page }) => {
    await page.goto(`/u/${REAL_SHAPED_HANDLE}`);

    // The honest state: says we can't LOOK UP the list signed out…
    await expect(page.getByRole('heading', { name: /sign in to see/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(`@${REAL_SHAPED_HANDLE}`).first()).toBeVisible();

    // …NEVER the false existence claim (the pre-fix dead end).
    await expect(page.getByText(/No one here/i)).toHaveCount(0);
    await expect(page.getByText(/may not be on Next Bar/i)).toHaveCount(0);

    // Forward paths: sign-in CTA and a way to learn what Next Bar is.
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /what is next bar/i })).toBeVisible();

    // The sign-in link actually goes to /auth (and does not dead-end).
    await page.getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/auth/);
  });

  test('demo curator handles keep their seeded profile signed out', async ({ page }) => {
    // The demo surface is a deliberate signed-out experience — the honest
    // fallback must not swallow it. 'claire' is a seeded curator.
    await page.goto('/u/claire');
    await expect(page.getByText(/demo/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/sign in to see/i)).toHaveCount(0);
  });
});
