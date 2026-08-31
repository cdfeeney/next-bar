/**
 * night-page.spec.ts — the legacy shared-night route is RETIRED (WP7, EC-04).
 *
 * This file used to prove that /u/[handle]/night/[shareId] rendered someone's
 * night to an anonymous visitor: identity, date, route order, the loved heart,
 * and a share-onward control. That surface is not part of the V8 product model
 * — the founder-approved contract 3.1.0 contains no `shared_night`,
 * `share_night`, `loved_bar_id` or "share token", and V8-R-RNK-001 excludes
 * tiers from the model. Its read RPC, `public.get_shared_night(uuid)`, was a
 * SECURITY DEFINER function with a live **anon** EXECUTE grant returning
 * another account's handle, display name and legacy tier.
 *
 * The tests are inverted rather than deleted. A deleted spec proves nothing; an
 * inverted one FAILS if the surface comes back, which is the property worth
 * keeping. The RPC stub is retained deliberately: it makes "the page does not
 * call it" a real assertion rather than an absence nobody checked.
 *
 * Retirement has two halves and this file covers the client one:
 *   * server — migration 0068 drops share_night, unshare_night and
 *     get_shared_night;
 *   * client — the route answers 404 and ShareNightButton renders nothing.
 *
 * NOT retired, and deliberately still covered elsewhere: /night-out/[token]
 * (V8-R-INV-001..007), the approved bearer-token Night Out invitation preview,
 * and Saved Nights Out (V8-R-NO-009, V8-R-ACC-002), a private in-app archive.
 */

import { test, expect } from '@playwright/test';

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

/**
 * The retired RPC, stubbed with a full row. If any code path still reaches it
 * the call is recorded — and every test below asserts it was never made.
 */
function watchRetiredRpc(page: import('@playwright/test').Page): {
  wasCalled: () => boolean;
} {
  let called = false;
  void page.route('**/rest/v1/rpc/get_shared_night', (route) => {
    called = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          handle: 'conor_f',
          display_name: 'Conor F',
          night: '2026-07-25',
          bar_ids: ['attaboy', 'death-and-co'],
          loved_bar_id: 'attaboy',
          shared_at: '2026-07-26T15:00:00Z',
        },
      ]),
    });
  });
  return { wasCalled: () => called };
}

test.describe('the legacy shared-night route is retired (EC-04)', () => {
  test('a share link answers not-found and never names the account', async ({
    page,
  }) => {
    const rpc = watchRetiredRpc(page);
    const response = await page.goto(`/u/conor_f/night/${TOKEN}`);

    // 404 is the retirement: not a redirect, not an empty render.
    expect(response?.status()).toBe(404);

    // The negative that matters. Even with the RPC answering a full row, none
    // of the private payload it used to publish reaches the page.
    await expect(page.getByText(/Conor F/)).toHaveCount(0);
    await expect(page.getByText(/@conor_f/)).toHaveCount(0);
    await expect(page.getByText(/Attaboy/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /night out/i })).toHaveCount(0);

    // …and the retired read was not called at all.
    expect(rpc.wasCalled()).toBe(false);
  });

  test('no share-onward control survives on the retired route', async ({
    page,
  }) => {
    watchRetiredRpc(page);
    await page.goto(`/u/conor_f/night/${TOKEN}`);
    await expect(page.getByRole('button', { name: /share/i })).toHaveCount(0);
  });

  test('a garbage token is retired identically — no special-casing left', async ({
    page,
  }) => {
    const rpc = watchRetiredRpc(page);
    const response = await page.goto('/u/conor_f/night/not-a-token');
    expect(response?.status()).toBe(404);
    expect(rpc.wasCalled()).toBe(false);
  });
});
