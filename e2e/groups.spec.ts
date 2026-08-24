/**
 * groups.spec.ts — Social · Groups (V8-R-NAV-003, V8-R-GRP-001 … 008).
 *
 * WHAT THIS FILE CAN PROVE, AND WHAT IT DELIBERATELY DOES NOT CLAIM.
 *
 * The gate runs SIGNED OUT. A group is server state with no demo analogue —
 * there is no seeded group, by design — so the authenticated thread, the
 * administration verbs and the reporter's hide CANNOT be exercised here, and
 * asserting them against a signed-out browser would be asserting nothing.
 *
 * What a signed-out browser CAN settle is the half that has silently regressed
 * in this product before, and it is not a small half:
 *
 *   1. The Groups & People control still opens the relationship surface
 *      (V8-R-NAV-003) and Groups is ON it — the surface every group action is
 *      reached through.
 *   2. Signed out, Groups states the truth and offers sign-in, rather than
 *      showing an invented group. Social's Feed shipped a demo reel to
 *      signed-out visitors once; that is the regression this asserts against.
 *   3. THE NEGATIVE ASSERTIONS, which is where this file earns its place.
 *      CLAUDE.md: "every button or control that does something user-visible
 *      gets an e2e assertion on the resulting state — including the NEGATIVE
 *      state." No composer, no create control, no thread and no administrative
 *      control may render without a session. Each of those leaking would be a
 *      control that calls a server verb the caller cannot possibly satisfy.
 *   4. Groups adds no rating surface to Social, and no Hide control anywhere —
 *      the two standing V8 product boundaries in CLAUDE.md that a new
 *      message-shaped surface is most likely to violate.
 *
 * THE SERVER RULES ARE PROVEN IN THE DATABASE, NOT HERE. Membership, the single
 * administrator and D-C-38 succession, the mutual-friend restriction on adding,
 * sender-or-administrator deletion, the block, and the reporter's hide are all
 * enforced by SECURITY DEFINER functions and RLS in
 * `supabase/migrations/0067_groups.sql`; `authenticated` holds no INSERT, UPDATE
 * or DELETE grant on any of the four tables, so there is no client path that
 * could bypass them. Exercising them needs two accounts and a live database —
 * the attended staging verification, which this lane is explicitly forbidden to
 * run. Both viewports, per the project rule.
 */

import { test, expect } from '@playwright/test';

test.describe('Social · Groups', () => {
  test('the Groups & People control reveals the relationship surface', async ({
    page,
  }) => {
    await page.goto('/friends');

    // V8-R-NAV-003 — one control in the Social header, 44px, and it leads to
    // the people surface rather than to Settings.
    const control = page.getByRole('button', { name: /groups & people/i });
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await control.click();

    // It selects Tonight first: the section it targets belongs to that sub-tab.
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
    await expect(page.locator('#groups-and-people')).toBeVisible();
  });

  test('Groups is part of that surface and states the truth when signed out', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    const heading = page.getByRole('heading', { name: /^groups$/i });
    await expect(heading).toBeVisible();

    // No invented group, and the one action that changes that.
    const signedOut = page.getByTestId('groups-signed-out');
    await expect(signedOut).toBeVisible();
    await expect(page.getByTestId('groups-sign-in')).toHaveAttribute('href', '/auth');
  });

  test('signed out, no group control that needs a session renders', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    // THE NEGATIVE STATE. Each of these calls a server verb that requires a
    // session and a membership; rendering one signed out would be a control
    // that can only fail.
    await expect(page.getByTestId('group-list')).toHaveCount(0);
    await expect(page.getByTestId('group-create')).toHaveCount(0);
    await expect(page.getByTestId('group-name')).toHaveCount(0);
    await expect(page.getByTestId('group-thread')).toHaveCount(0);
    await expect(page.getByTestId('group-composer')).toHaveCount(0);
    await expect(page.getByTestId('group-send')).toHaveCount(0);
    await expect(page.getByTestId('group-photo')).toHaveCount(0);
    await expect(page.getByTestId('group-admin')).toHaveCount(0);
    await expect(page.getByTestId('group-leave')).toHaveCount(0);
    await expect(page.getByTestId('group-invite')).toHaveCount(0);
    await expect(page.getByTestId('group-unread')).toHaveCount(0);
  });

  test('tapping sign-in from Groups goes to /auth and nowhere else', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    await page.getByTestId('groups-sign-in').click();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test('Groups introduces no rating surface and no Hide control', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    const surface = page.locator('#groups-and-people');

    // CLAUDE.md: "Next Bar? displays five ranked bars but never collects a
    // rating" and "There is no Hide or 'never show me this again' control in
    // V8." A message-shaped surface is exactly where one tends to reappear.
    await expect(surface).not.toContainText(/\bhide\b/i);
    await expect(surface).not.toContainText(/never show me this again/i);
    await expect(surface.getByRole('button', { name: /^rate$/i })).toHaveCount(0);
  });

  test('the five-tab bottom nav is untouched by the Groups surface', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    // Groups is a SECTION of Social, not a sixth tab. CLAUDE.md pins the
    // five-tab contract, and a new surface is the usual way it grows a sixth.
    const nav = page.getByRole('navigation').last();
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(5);
  });
});
