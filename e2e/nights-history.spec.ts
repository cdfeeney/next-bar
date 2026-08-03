/**
 * nights-history.spec.ts (goal g-919dae84)
 *
 * The /nights history surface:
 *   - Empty state: honest copy + a forward path, no dead controls.
 *   - Seeded archive + live log render newest-first with date labels.
 *   - Expanding a night shows its route (ordered stops) and its map;
 *     NEGATIVE: expanding does not navigate.
 *   - The Friends page links to /nights ("Nights Out" entry, crit 3).
 *   - Signed-out: no share/unshare controls render (ShareNightButton
 *     self-gates; a control that cannot work must not exist).
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';
import { fakeSignedIn } from './helpers/fakeAuth';

const ARCHIVE_KEY = 'next-bar:night-archive:v1';
const LOG_KEY = 'next-bar:night-log:v1';
const SHARED_KEY = 'next-bar:shared-nights:v1';
const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

async function clearStorage(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await page.goto('/nights');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
  await page.reload();
}

test.describe('/nights — Nights Out history (g-919dae84)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
  });

  test('empty state renders honestly with a forward path', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /^Nights Out$/ }),
    ).toBeVisible();
    await expect(page.getByText('No nights yet.')).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Find your next bar/ }),
    ).toBeVisible();
    // No share controls exist in the empty state (negative).
    await expect(
      page.getByRole('button', { name: /Share last night/ }),
    ).toHaveCount(0);
  });

  test('archived + live nights render newest-first; expand shows route + map without navigating', async ({
    page,
  }) => {
    await page.evaluate(
      ({ archiveKey, logKey }) => {
        // Two archived nights + tonight's live log.
        window.localStorage.setItem(
          archiveKey,
          JSON.stringify([
            {
              nightKey: '2026-07-30',
              visits: [
                { barId: 'attaboy', at: '2026-07-31T02:00:00.000Z' },
                { barId: 'death-and-co', at: '2026-07-31T03:00:00.000Z' },
              ],
            },
            {
              nightKey: '2026-07-24',
              visits: [{ barId: 'employees-only', at: '2026-07-25T01:00:00.000Z' }],
            },
          ]),
        );
        window.localStorage.setItem(
          logKey,
          JSON.stringify({
            night: '2026-08-01',
            visits: [{ barId: 'mr-purple', at: '2026-08-02T01:00:00.000Z' }],
          }),
        );
      },
      { archiveKey: ARCHIVE_KEY, logKey: LOG_KEY },
    );
    await page.reload();

    // Newest-first: live log night, then the two archived nights.
    const rows = page.locator('[data-testid^="night-row-"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute(
      'data-testid',
      'night-row-2026-08-01',
    );
    await expect(rows.nth(1)).toHaveAttribute(
      'data-testid',
      'night-row-2026-07-30',
    );
    await expect(rows.nth(2)).toHaveAttribute(
      'data-testid',
      'night-row-2026-07-24',
    );

    // Expand the July 30 night.
    const urlBefore = page.url();
    const row = page.getByTestId('night-row-2026-07-30');
    await row.getByRole('button', { name: /July 30/ }).click();
    await expect(row).toContainText('Attaboy');
    await expect(row).toContainText('Death & Co');
    // The map mounts inside the expanded panel.
    await expect(
      row.getByTestId('night-detail-map').locator('.leaflet-container'),
    ).toBeVisible({ timeout: 15_000 });
    // NEGATIVE: expanding is not a navigation.
    expect(page.url()).toBe(urlBefore);

    // Signed-out, WHILE EXPANDED: no share/unshare controls (negative —
    // asserting after collapse would pass vacuously; santa: Codex).
    await expect(
      row.getByRole('button', { name: /Share last night/ }),
    ).toHaveCount(0);
    await expect(
      row.getByRole('button', { name: /Stop sharing/ }),
    ).toHaveCount(0);

    // Collapse hides the detail again.
    await row.getByRole('button', { name: /July 30/ }).click();
    await expect(row.getByTestId('night-detail-map')).toHaveCount(0);
  });

  test('the Friends page links to Nights Out', async ({ page }) => {
    await page.goto('/friends');
    await page
      .getByRole('link', { name: /Nights Out — your past nights/ })
      .click();
    await expect(page).toHaveURL(/\/nights$/);
    await expect(
      page.getByRole('heading', { name: /^Nights Out$/ }),
    ).toBeVisible();
  });

  test('archive + live log COMPOSE into one history — both nights render', async ({
    page,
  }) => {
    // Composition test, deliberately: it seeds the two stores exactly as
    // recordVisit's rollover leaves them and pins that /nights merges
    // them. The rollover WRITE itself (recordVisit → archiveNight) is
    // pinned by src/lib/nightArchive.test.ts, which drives the real code
    // path — this spec would pass even if that write broke (santa: Codex),
    // so the unit test is the load-bearing coverage for the write.
    await page.evaluate(
      ({ archiveKey, logKey }) => {
        window.localStorage.setItem(
          archiveKey,
          JSON.stringify([
            {
              nightKey: '2026-07-31',
              visits: [{ barId: 'attaboy', at: '2026-08-01T02:00:00.000Z' }],
            },
          ]),
        );
        window.localStorage.setItem(
          logKey,
          JSON.stringify({
            night: '2026-08-01',
            visits: [{ barId: 'death-and-co', at: '2026-08-02T01:00:00.000Z' }],
          }),
        );
      },
      { archiveKey: ARCHIVE_KEY, logKey: LOG_KEY },
    );
    await page.reload();
    const rows = page.locator('[data-testid^="night-row-"]');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('night-row-2026-07-31')).toBeVisible();
    await expect(page.getByTestId('night-row-2026-08-01')).toBeVisible();
  });
});

test.describe('/nights — signed-in share state (g-919dae84 crit 7)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
  });

  async function seedSharedNight(page: Page): Promise<void> {
    await page.evaluate(
      ({ archiveKey, sharedKey, token }) => {
        window.localStorage.setItem(
          archiveKey,
          JSON.stringify([
            {
              nightKey: '2026-07-30',
              visits: [{ barId: 'attaboy', at: '2026-07-31T02:00:00.000Z' }],
              ratings: [
                {
                  barId: 'attaboy',
                  rating: 'loved',
                  ratedAt: '2026-07-31T03:00:00.000Z',
                },
              ],
            },
          ]),
        );
        window.localStorage.setItem(
          sharedKey,
          JSON.stringify({
            '2026-07-30': { token, sharedAt: '2026-07-31T15:00:00.000Z' },
          }),
        );
      },
      { archiveKey: ARCHIVE_KEY, sharedKey: SHARED_KEY, token: TOKEN },
    );
  }

  test('a shared night shows the badge; Stop sharing unshares and clears it', async ({
    page,
    context,
  }) => {
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');

    let unshareCalls = 0;
    await page.route('**/rest/v1/rpc/unshare_night', (route) => {
      unshareCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'true',
      });
    });

    await seedSharedNight(page);
    await page.reload();

    const row = page.getByTestId('night-row-2026-07-30');
    await expect(row).toContainText('· Shared');
    // Loved pick renders from the ARCHIVED ratings snapshot.
    await expect(row).toContainText('loved Attaboy');

    await row.getByRole('button', { name: /July 30/ }).click();
    // Signed-in with a handle: both controls exist while expanded.
    await expect(
      row.getByRole('button', { name: /Share last night/ }),
    ).toBeVisible();
    const stop = row.getByRole('button', { name: 'Stop sharing' });
    await expect(stop).toBeVisible();

    await stop.click();
    // Post-success: the RPC fired once and the share state cleared.
    await expect(row).not.toContainText('· Shared');
    await expect(
      row.getByRole('button', { name: 'Stop sharing' }),
    ).toHaveCount(0);
    expect(unshareCalls).toBe(1);
    // NEGATIVE: the night itself is untouched — still listed.
    await expect(row).toContainText('loved Attaboy');
  });

  test('busy state is PER NIGHT — stopping one share never disables or re-enables the other row', async ({
    page,
    context,
  }) => {
    // Self-initializing, byte-matched to the sequence a standalone probe
    // verified deterministic (goto → clear → sign-in stubs → gate route →
    // seed → ONE reload): interleaving with the shared beforeEach's boot
    // cycle reproducibly broke the interaction on both mobile projects.
    await page.goto('/nights');
    await page.evaluate(() => {
      window.localStorage.clear();
      window.localStorage.setItem('next-bar:age-ack:v1', '1');
    });
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');

    // Hold the unshare RPC open so the in-flight state is observable.
    let releaseUnshare: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseUnshare = resolve;
    });
    await page.route('**/rest/v1/rpc/unshare_night', async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'true',
      });
    });

    // TWO shared nights.
    await page.evaluate(
      ({ archiveKey, sharedKey, token }) => {
        window.localStorage.setItem(
          archiveKey,
          JSON.stringify([
            {
              nightKey: '2026-07-30',
              visits: [{ barId: 'attaboy', at: '2026-07-31T02:00:00.000Z' }],
              ratings: [],
            },
            {
              nightKey: '2026-07-24',
              visits: [{ barId: 'death-and-co', at: '2026-07-25T01:00:00.000Z' }],
              ratings: [],
            },
          ]),
        );
        window.localStorage.setItem(
          sharedKey,
          JSON.stringify({
            '2026-07-30': { token, sharedAt: '2026-07-31T15:00:00.000Z' },
            '2026-07-24': {
              token: token.replace('4174000', '4174111'),
              sharedAt: '2026-07-25T15:00:00.000Z',
            },
          }),
        );
      },
      { archiveKey: ARCHIVE_KEY, sharedKey: SHARED_KEY, token: TOKEN },
    );
    await page.reload();

    const rowA = page.getByTestId('night-row-2026-07-30');
    await rowA.getByRole('button', { name: /July 30/ }).click();
    const stopA = rowA.getByRole('button', { name: 'Stop sharing' });
    await expect(stopA).toBeVisible();
    await stopA.click();
    // A is in flight and shows the busy label.
    await expect(rowA.getByRole('button', { name: 'Stopping…' })).toBeDisabled();

    // Open row B while A's RPC is STILL held open. The accordion has ONE
    // expanded slot, so this UNMOUNTS A's panel — A's busy button can't be
    // asserted here; its state is asserted on re-expand below.
    const rowB = page.getByTestId('night-row-2026-07-24');
    await rowB.getByRole('button', { name: /July 24/ }).click();
    // B's control is fully enabled while A's RPC is in flight (the old
    // shared busy slot disabled/re-enabled ACROSS rows — santa: Opus).
    await expect(rowB.getByRole('button', { name: 'Stop sharing' })).toBeEnabled();

    // Re-expand A (collapses B): its busy state SURVIVED in the per-night
    // set — the shared-slot bug showed a re-enabled button here.
    await rowA.getByRole('button', { name: /July 30/ }).click();
    await expect(rowA.getByRole('button', { name: 'Stopping…' })).toBeDisabled();

    // Release A's RPC — only A's share state clears.
    releaseUnshare();
    await expect(rowA).not.toContainText('· Shared');
    await expect(rowA.getByRole('button', { name: 'Stopping…' })).toHaveCount(0);
    await expect(rowB).toContainText('· Shared');
  });

  test('unshare failure keeps the record and says so honestly', async ({
    page,
    context,
  }) => {
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');

    await page.route('**/rest/v1/rpc/unshare_night', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'boom' }),
      }),
    );

    await seedSharedNight(page);
    await page.reload();

    const row = page.getByTestId('night-row-2026-07-30');
    await row.getByRole('button', { name: /July 30/ }).click();
    await row.getByRole('button', { name: 'Stop sharing' }).click();

    await expect(row.getByRole('status')).toContainText(/Couldn't stop sharing/);
    // The record survives a failed unshare — still shared, still retryable.
    await expect(row).toContainText('· Shared');
    await expect(
      row.getByRole('button', { name: 'Stop sharing' }),
    ).toBeVisible();
  });
});
