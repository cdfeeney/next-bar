/**
 * v7-continuity.spec.ts — the offline install-over guard.
 *
 * A V7 user upgrading to V8 must keep everything already on their device.
 * The fixture below is a realistic V7 install: every localStorage key the
 * inventory in `docs/V8-DATA-CONTINUITY-2026-08-14.md` lists, seeded with
 * valid V7-shaped values, plus the session-scoped onboarding flag.
 *
 * The two `:merged-for:v1` flags are deliberately NOT in the fixture: they
 * exist only after a sign-in, and the residue rule that reads them needs a
 * configured Supabase client, which this offline fixture has none of (auth
 * resolves `unavailable`). That rule is unit-tested directly in
 * `src/lib/accountCache.test.ts`; asserting it here would only prove that
 * nothing ran.
 *
 * Survival is asserted across navigation, reload, and a simulated
 * force-close/reopen (close the tab, open a new one in the same context —
 * localStorage persists, sessionStorage is meant not to).
 *
 * Boundary: authentication, cross-device sync, real `shared_nights` rows and
 * the physical install-over remain attended/server-backed release gates. An
 * offline fixture cannot prove them.
 */

import { expect, test, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

/** Stale night-scoped values: the fixed clock below is the NEXT night. */
const LAST_NIGHT = '2026-08-12';

const V7_LOCAL: Record<string, string> = {
  'next-bar:ratings:v1': JSON.stringify([
    { barId: 'attaboy', rating: 'loved', ratedAt: '2026-08-12T23:00:00-04:00', score: 8.8 },
    { barId: 'death-and-co', rating: 'loved', ratedAt: '2026-08-12T23:30:00-04:00', score: 8.8 },
    { barId: 'bar-54', rating: 'loved', ratedAt: '2026-08-12T23:45:00-04:00', score: 9.4 },
  ]),
  'next-bar:pairwise:v1': JSON.stringify([
    {
      winnerBarId: 'bar-54',
      loserBarId: 'attaboy',
      comparedAt: '2026-08-12T23:50:00-04:00',
    },
  ]),
  'next-bar:lists:v1': JSON.stringify([
    {
      id: 'v7-favorites',
      name: 'V7 favorites',
      barIds: ['attaboy', 'death-and-co', 'bar-54'],
      createdAt: '2026-08-12T20:00:00-04:00',
      updatedAt: '2026-08-12T23:30:00-04:00',
    },
  ]),
  'next-bar:list:want-to-go:v1': JSON.stringify([
    { barId: 'employees-only', addedAt: '2026-08-12T21:00:00-04:00' },
  ]),
  'next-bar:night-log:v1': JSON.stringify({
    night: LAST_NIGHT,
    visits: [
      { barId: 'attaboy', at: '2026-08-12T22:30:00-04:00' },
      { barId: 'death-and-co', at: '2026-08-12T23:30:00-04:00' },
      { barId: 'bar-54', at: '2026-08-12T23:45:00-04:00' },
    ],
  }),
  'next-bar:profile:v1': JSON.stringify({
    tags: ['cocktail', 'rooftop'],
    preferredNeighborhoods: ['Midtown'],
    archetype: 'Skyline Sipper',
    savedAt: '2026-08-12T20:00:00-04:00',
  }),
  'next-bar:follows:v1': JSON.stringify(['claire_h', 'marcus_t']),
  'next-bar:intent:v1': JSON.stringify({
    status: 'going',
    setAt: '2026-08-12T21:30:00-04:00',
  }),
  'next-bar:night-vibe:v1': JSON.stringify({
    night: LAST_NIGHT,
    tags: ['cocktail', 'rooftop'],
  }),
  'next-bar:night-phase-override:v1': JSON.stringify({
    night: LAST_NIGHT,
    phase: 'out',
  }),
  'next-bar:saved:v1': JSON.stringify([
    { barId: 'attaboy', savedAt: '2026-08-12T20:30:00-04:00' },
  ]),
  'next-bar:age-ack:v1': '1',
  'next-bar:install-nudge-dismissed:v1': '1',
  'next-bar:handle-nudge-dismissed:v1': '1',
  // Seeded flag set: the demo seeder is a no-op, so it can never rewrite
  // `next-bar:ratings:v1` underneath these assertions.
  'next-bar:demo:seeded:v1': '1',
  'next-bar:demo:seeded-ids:v1': '[]',
};

const ONBOARDING_KEY = 'next-bar:onboarding-prompted:v1';

/** Seed once per tab, before any app code runs. */
async function seedV7Install(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await page.clock.setFixedTime(new Date('2026-08-13T09:00:00-04:00'));
  await page.addInitScript(
    ({ local, onboardingKey }) => {
      for (const [key, value] of Object.entries(local)) {
        localStorage.setItem(key, value);
      }
      sessionStorage.setItem(onboardingKey, '1');
    },
    { local: V7_LOCAL, onboardingKey: ONBOARDING_KEY },
  );
}

function readLocal(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(
    (keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    Object.keys(V7_LOCAL),
  );
}

test('V7 Bar 54, tied scores, lists, vibe profile, and night history survive navigation and reload', async ({
  page,
}) => {
  await seedV7Install(page);

  await page.goto('/rankings');
  await expect(page.getByLabel(/^score 8\.8 out of 10/i)).toHaveCount(2);
  await expect(
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('next-bar:ratings:v1') ?? '[]').some(
        (rating: { barId?: string }) => rating.barId === 'bar-54',
      ),
    ),
  ).resolves.toBe(true);

  await page.goto('/lists');
  await expect(page.getByRole('button', { name: /^V7 favorites 3 bars$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^V7 favorites 3 bars$/ })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByText('Your quiz answers are saved.')).toBeVisible();

  await page.goto('/');
  await expect(page.getByTestId('recap-card')).toContainText('Attaboy');
  await expect(page.getByTestId('recap-card')).toContainText('Death & Co');

  // Every inventoried local key is byte-identical after the whole tour.
  await expect(readLocal(page)).resolves.toEqual(V7_LOCAL);
});

test('every V7 key survives a force-close and reopen; the session-scoped flag does not', async ({
  context,
}) => {
  const first = await context.newPage();
  await seedV7Install(first);
  await first.goto('/rankings');
  await expect(first.getByLabel(/^score 8\.8 out of 10/i)).toHaveCount(2);

  // Force-close: the tab goes away, the origin's localStorage does not.
  await first.close();

  const reopened = await context.newPage();
  await reopened.clock.setFixedTime(new Date('2026-08-13T09:00:00-04:00'));
  await reopened.goto('/rankings');

  await expect(readLocal(reopened)).resolves.toEqual(V7_LOCAL);
  await expect(reopened.getByLabel(/^score 8\.8 out of 10/i)).toHaveCount(2);

  // sessionStorage is per-tab by design (inventory: "expiry with the tab is
  // intentional"), so the reopened tab must NOT inherit the prompted flag.
  await expect(
    reopened.evaluate((key) => sessionStorage.getItem(key), ONBOARDING_KEY),
  ).resolves.toBeNull();

  // Named lists and vibe profile still render from the surviving keys.
  await reopened.goto('/lists');
  await expect(reopened.getByRole('button', { name: /^V7 favorites 3 bars$/ })).toBeVisible();
  await reopened.goto('/settings');
  await expect(reopened.getByText('Your quiz answers are saved.')).toBeVisible();
  await reopened.close();
});

test('the shared-night surface never writes to V7 local storage', async ({ page }) => {
  // `shared_nights` is server-owned and bearer-token addressed. The
  // continuity property that IS provable offline is the negative one: the
  // public night route must be read-only with respect to the device's V7
  // keys — it may not import, mirror, or clear any of them. What the page
  // RENDERS from a real row is covered by `e2e/night-page.spec.ts`, which
  // needs a configured Supabase client (see this file's header).
  const token = '123e4567-e89b-42d3-a456-426614174000';
  await seedV7Install(page);

  await page.goto(`/u/conor_f/night/${token}`);
  await expect(readLocal(page)).resolves.toEqual(V7_LOCAL);

  // And back into the app: local history is still the LOCAL night, not the
  // shared one — a public link must not overwrite the device's own night.
  await page.goto('/rankings');
  await expect(page.getByLabel(/^score 8\.8 out of 10/i)).toHaveCount(2);
  await expect(readLocal(page)).resolves.toEqual(V7_LOCAL);
});
