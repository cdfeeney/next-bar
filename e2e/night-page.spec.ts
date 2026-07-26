/**
 * night-page.spec.ts — E4.4 public shared-night page.
 *
 * The shareId in the URL is a bearer token; the RPC is stubbed so these
 * run anywhere. Covers: anonymous render (identity, date, route order,
 * loved heart, get-the-app CTA, share-onward), the handle-spoof
 * negative (a rewritten handle must never re-attribute a night), the
 * gone/unshared state (friendly forward path, R5), and the garbage-token
 * fast path (no RPC call at all).
 */

import { test, expect } from '@playwright/test';

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

const NIGHT_ROW = {
  handle: 'conor_f',
  display_name: 'Conor F',
  night: '2026-07-25',
  bar_ids: ['attaboy', 'mister-paradise'],
  loved_bar_id: 'attaboy',
  shared_at: '2026-07-26T15:00:00Z',
};

function stubNight(page: import('@playwright/test').Page, rows: unknown[]) {
  return page.route('**/rest/v1/rpc/get_shared_night', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rows),
    }),
  );
}

test.describe('E4.4 shared-night page', () => {
  test('anonymous visitor sees the night: identity, date, route in order, loved heart, join + share CTAs', async ({
    page,
  }) => {
    await stubNight(page, [NIGHT_ROW]);
    await page.goto(`/u/conor_f/night/${TOKEN}`);

    await expect(
      page.getByRole('heading', { name: /Conor F's night out/i }),
    ).toBeVisible();
    await expect(page.getByText('Saturday, July 25')).toBeVisible();
    await expect(page.getByText(/@conor_f · 2 stops · loved Attaboy/)).toBeVisible();

    const rows = page.locator('ol li');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Attaboy');
    await expect(rows.nth(1)).toContainText('Mister Paradise');

    // Signed-out recipient: the join CTA leads, and the link can travel
    // onward.
    await expect(page.getByRole('link', { name: /Get Next Bar/i })).toHaveAttribute(
      'href',
      '/install',
    );
    await expect(
      page.getByRole('button', { name: /Share Conor F's night/i }),
    ).toBeVisible();
  });

  test("handle-spoof: someone else's handle in the URL reads as gone, never as theirs", async ({
    page,
  }) => {
    await stubNight(page, [NIGHT_ROW]);
    await page.goto(`/u/impostor/night/${TOKEN}`);
    await expect(page.getByText(/This night isn't here/i)).toBeVisible();
    await expect(page.getByText(/Conor F/)).toHaveCount(0);
  });

  test('unknown or unshared token: friendly gone state with a forward path (R5)', async ({
    page,
  }) => {
    await stubNight(page, []);
    await page.goto(`/u/conor_f/night/${TOKEN}`);
    await expect(page.getByText(/This night isn't here/i)).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Find your next bar/i }),
    ).toHaveAttribute('href', '/');
  });

  test('garbage token short-circuits to gone without calling the RPC', async ({
    page,
  }) => {
    let rpcCalled = false;
    await page.route('**/rest/v1/rpc/get_shared_night', (route) => {
      rpcCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.goto('/u/conor_f/night/not-a-token');
    await expect(page.getByText(/This night isn't here/i)).toBeVisible();
    expect(rpcCalled).toBe(false);
  });
});
