/**
 * analytics-silence.spec.ts (goal g-ee6c250d, crit 10)
 *
 * The dark-analytics contract, proven at the network layer: with the
 * gates absent (this dev build sets neither NEXT_PUBLIC_ANALYTICS nor any
 * PostHog value), a flow that exercises every instrumented boundary —
 * completed search, successful save, successful copy-share — produces
 * ZERO analytics traffic: no /api/event beacon, no PostHog capture, no
 * analytics cookie or storage key. Adapter registration alone (mounted in
 * the root layout) must also be network-silent.
 */

import { test, expect } from '@playwright/test';

test.describe('dark analytics stays silent when disabled', () => {
  test('search + save + share flow emits no analytics traffic', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'clipboard permission is chromium-only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const analyticsHits: string[] = [];
    await page.route('**/api/event**', async (route) => {
      analyticsHits.push(route.request().url());
      await route.fulfill({ status: 204, body: '' });
    });
    await page.route('**/capture/**', async (route) => {
      analyticsHits.push(route.request().url());
      await route.fulfill({ status: 204, body: '' });
    });

    // Completed search (select a result) + successful save + lightbox.
    await page.goto('/search');
    await expect(page.getByRole('heading', { name: 'Search bars' })).toBeVisible();
    await expect(async () => {
      await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
      await expect(
        page.getByTestId('search-results').getByRole('button', { name: /^Attaboy/ }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await page
      .getByTestId('search-results')
      .getByRole('button', { name: /^Attaboy/ })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save Attaboy to Want to go' }).click();
    await expect(
      page.getByRole('button', { name: 'Remove Attaboy from Want to go' }),
    ).toBeVisible();

    // Successful share (clipboard copy) on the rankings Want-to-go view.
    await page.goto('/rankings');
    await page.getByRole('button', { name: /Lists — showing/ }).click();
    await page.getByRole('button', { name: 'Want to go', exact: true }).click();
    await page
      .getByRole('button', { name: 'Share the list Want to go as text' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Copied to clipboard' }),
    ).toBeVisible();

    // THE contract: total analytics-shaped traffic is zero.
    expect(analyticsHits).toEqual([]);

    // And nothing analytics-shaped landed in storage or cookies.
    const storageKeys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(storageKeys.filter((k) => /posthog|ph_|analytic/i.test(k))).toEqual([]);
    const cookies = await context.cookies();
    expect(cookies.filter((c) => /posthog|ph_|analytic/i.test(c.name))).toEqual([]);
  });
});
