/**
 * v7-continuity.spec.ts — the offline install-over guard.
 *
 * A V7 user upgrading to V8 must keep everything already on their device.
 * The fixture below is a realistic V7 install: every localStorage key the
 * inventory in `docs/V8-DATA-CONTINUITY-2026-08-14.md` lists, seeded with
 * valid V7-shaped values, plus the session-scoped onboarding flag.
 *
 * The fixture covers every inventoried localStorage key, including the two
 * `:merged-for:v1` ownership latches — see the note beside them below for why
 * that is sound with no Supabase env configured.
 *
 * Survival is asserted across navigation, reload, and a simulated
 * force-close/reopen (close the tab, open a new one in the same context —
 * localStorage persists, sessionStorage is meant not to).
 *
 * Boundary: authentication, cross-device sync, real `shared_nights` rows and
 * the physical install-over remain attended/server-backed release gates. An
 * offline fixture cannot prove them.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';
import { CATALOG_ROUTE, fulfillCatalog } from './helpers/catalogTest';

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
  // Import sentinels. A V7 user who ever signed in has these, so a faithful
  // install-over fixture carries them. They must survive even when Supabase is
  // configured but no session exists; ownership is now tracked separately by
  // `next-bar:account:owner:v1`. See `src/lib/accountCache.test.ts`.
  'next-bar:ratings:merged-for:v1': 'v7-user-11111111-2222-3333-4444-555555555555',
  'next-bar:pairwise:merged-for:v1': 'v7-user-11111111-2222-3333-4444-555555555555',
  'next-bar:age-ack:v1': '1',
  'next-bar:install-nudge-dismissed:v1': '1',
  'next-bar:handle-nudge-dismissed:v1': '1',
  // Seeded flag set: the demo seeder is a no-op, so it can never rewrite
  // `next-bar:ratings:v1` underneath these assertions.
  'next-bar:demo:seeded:v1': '1',
  'next-bar:demo:seeded-ids:v1': '[]',
};

const ONBOARDING_KEY = 'next-bar:onboarding-prompted:v1';

/**
 * Seed ONCE per tab, before any app code runs.
 *
 * The seeded-sentinel is load-bearing, not tidiness: `addInitScript` runs on
 * every navigation and every reload, so an unguarded seeder silently restores
 * V7_LOCAL right before the survival assertions — masking exactly the deletion
 * or mutation this spec exists to catch. Removing this guard turned the whole
 * file into a tautology once already; the Codex lane caught it.
 */
const SEEDED_SENTINEL = 'v7-continuity-seeded';

async function seedV7Install(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await page.clock.setFixedTime(new Date('2026-08-13T09:00:00-04:00'));
  await page.addInitScript(
    ({ local, onboardingKey, sentinel }) => {
      if (sessionStorage.getItem(sentinel)) return;
      for (const [key, value] of Object.entries(local)) {
        localStorage.setItem(key, value);
      }
      sessionStorage.setItem(onboardingKey, '1');
      sessionStorage.setItem(sentinel, '1');
    },
    { local: V7_LOCAL, onboardingKey: ONBOARDING_KEY, sentinel: SEEDED_SENTINEL },
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
  // …and the session-scoped key survives WITHIN the tab. Only the reopen test
  // asserts it is gone, so without this a code path that deletes it on first
  // navigation would satisfy both specs (Codex, V8-2 round-2).
  await expect(
    page.evaluate((key) => sessionStorage.getItem(key), ONBOARDING_KEY),
  ).resolves.toBe('1');
});

/**
 * The named-lists row of the coverage map used to rest on `V7 favorites 3 bars`
 * alone. That badge reads `list.barIds.length` — pure localStorage — so it
 * cannot fail for a RENDERING reason, which is exactly the distinction this
 * spec draws for Bar 54 on /rankings. The list BODY resolves each id through
 * the catalog and drops what it cannot resolve, so that is where a named list
 * loses a bar.
 *
 * Holding the catalog response reproduces the cold-load ORDER a deep link,
 * reload or PWA restore produces: render against the ~39-bar `coreBars`
 * emergency set first, swap the real catalog in after. Bar 54 is not in that
 * set, so pre-swap the card shows 2 rows while its badge still claims 3.
 * Without a `useBars()` subscription on the route the swap fires no re-render
 * and it stays 2 — the same silently-vanished-bar defect fixed on /rankings.
 */
test('a named list renders every V7 bar once the real catalog lands, with no second interaction', async ({
  page,
}) => {
  await seedV7Install(page);

  let releaseCatalog: () => void = () => {};
  const heldCatalog = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  // Most-recently-registered wins, so this supersedes the fixture's route.
  await page.route(CATALOG_ROUTE, async (route) => {
    await heldCatalog;
    await fulfillCatalog(route);
  });

  await page.goto('/lists');
  const card = page.getByRole('button', { name: /^V7 favorites 3 bars$/ });
  await expect(card).toBeVisible();
  await card.click();

  // One row per RESOLVED bar: the remove control is per-row and names its bar.
  const rows = page.getByRole('button', { name: /from V7 favorites$/ });
  await expect(rows).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Remove Bar 54 from V7 favorites' }),
  ).toHaveCount(0);

  releaseCatalog();

  // No second click, no reload. The subscription is the only thing that can
  // make this row appear.
  await expect(rows).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: 'Remove Bar 54 from V7 favorites' }),
  ).toBeVisible();
  // The badge never moved — proving the count and the body are separate claims.
  await expect(card).toBeVisible();
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

  const response = await page.goto(`/u/conor_f/night/${token}`);
  // The route must actually SERVE, and its own code must actually RUN.
  // Without both, the storage assertion below passes just as happily on a 500
  // — or on a deleted route's 404 — having never executed a line of
  // shared-night code, so "writes no local key" would prove nothing
  // (Codex, V8-2 rounds 1 and 2). With no Supabase configured the page
  // resolves to its terminal "gone" state, which is the shared-night
  // component rendering.
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /this night isn't here/i })).toBeVisible();
  await expect(readLocal(page)).resolves.toEqual(V7_LOCAL);

  // And back into the app: local history is still the LOCAL night, not the
  // shared one — a public link must not overwrite the device's own night.
  await page.goto('/rankings');
  await expect(page.getByLabel(/^score 8\.8 out of 10/i)).toHaveCount(2);
  await expect(readLocal(page)).resolves.toEqual(V7_LOCAL);
});

/**
 * ---------------------------------------------------------------------------
 * Gap-filling coverage (2026-08-19). See docs/V8-CONTINUITY-DEVICE-PROCEDURE-2026-08-19.md
 * for the per-item map these tests close.
 * ---------------------------------------------------------------------------
 *
 * The tests above deliberately assert on STORAGE and on the two core-set bars.
 * That is not enough for the PRD's named items: `/rankings` renders a rated bar
 * only if `getBarById` resolves it, and the runtime catalog is the Supabase
 * `bars` table — the bundled fallback is the tiny emergency core, which does
 * NOT contain Bar 54. So "bar-54 is still in localStorage" and "the user still
 * sees Bar 54" are different claims, and only the second is the requirement.
 *
 * These tests therefore serve the catalog deterministically from the repo's own
 * bar data (`e2e/helpers/catalogTest`), so a rendering assertion fails for a
 * continuity reason and never because a remote table was slow or short.
 */

/**
 * Every ranking row as "<position>.<name> | <score aria-label>", in render
 * order. One string per row so an ORDER change fails as loudly as a value
 * change — which is what a tie needs: `toHaveCount(2)` on 8.8 passes just as
 * happily if the two tied bars swap places on every reload, or if one of them
 * is dropped and a different 8.8 bar takes its place.
 */
function renderedRanking(page: Page): Promise<string[]> {
  return page.locator('main section article').evaluateAll((articles) =>
    articles.map((el) => {
      const name = el.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const score = el.querySelector('[aria-label*="core"]')?.getAttribute('aria-label') ?? '';
      return `${name} | ${score}`;
    }),
  );
}

/** Seed the V7 install AND pin the catalog, in that order. */
async function seedV7InstallWithCatalog(page: Page): Promise<void> {
  await page.route(CATALOG_ROUTE, fulfillCatalog);
  await seedV7Install(page);
}

test('Bar 54 renders by name with its own score, and the tied pair keeps its order across a reload', async ({
  page,
}) => {
  await seedV7InstallWithCatalog(page);
  await page.goto('/rankings');

  // Wait for the catalog swap before snapshotting order: until it lands the
  // page renders the emergency core only, which is a smaller, DIFFERENT list.
  await expect(page.getByRole('heading', { name: /Bar 54$/ })).toBeVisible();

  const first = await renderedRanking(page);
  // The PRD names Bar 54 specifically, so prove the catalog resolves it, the
  // page renders it, and its 9.4 outranks the tied pair.
  expect(first[0]).toBe('1.Bar 54 | Score 9.4 out of 10');
  expect(first).toHaveLength(3);
  expect(first.slice(1).map((row) => row.split(' | ')[1])).toEqual([
    'Score 8.8 out of 10',
    'Score 8.8 out of 10',
  ]);
  // Both tied bars are still there — a tie that collapsed to one row and pulled
  // some other 8.8 bar up behind it would still show two 8.8 labels.
  expect(first.join('\n')).toContain('Attaboy');
  expect(first.join('\n')).toContain('Death & Co');

  await page.reload();
  await expect(page.getByRole('heading', { name: /Bar 54$/ })).toBeVisible();
  // Ties are order-STABLE, not merely present: same three rows, same order.
  await expect(renderedRanking(page)).resolves.toEqual(first);
  await expect(readLocal(page)).resolves.toEqual(V7_LOCAL);
});

test('night history keeps every V7 stop, Bar 54 included', async ({ page }) => {
  await seedV7InstallWithCatalog(page);
  await page.goto('/');

  const recap = page.getByTestId('recap-card');
  // Three visits in `next-bar:night-log:v1`, three stops on the card. The count
  // is what catches a dropped visit; naming two of the three bars cannot.
  await expect(recap).toContainText('3 stops');
  await expect(recap.locator('li')).toHaveCount(3);
  await expect(recap).toContainText('Attaboy');
  await expect(recap).toContainText('Death & Co');
  await expect(recap).toContainText('Bar 54');
  await expect(readLocal(page)).resolves.toEqual(V7_LOCAL);
});

/**
 * The V7 user's OWN account id, taken from the fixture's import latch rather
 * than repeated. A fixture edit that changed one and not the other would
 * silently turn every assertion below into the FOREIGN-sign-in case, where
 * wiping the V7 keys is the correct behavior — the test would then pass by
 * testing the opposite property.
 */
const V7_USER_ID = V7_LOCAL['next-bar:ratings:merged-for:v1'];

/** Just the fields the server row is built from. */
type BarRatingFixture = {
  barId: string;
  rating: string;
  ratedAt: string;
  score: number;
};

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * Same shape as `readSupabaseUrl` in `e2e/account-delete.spec.ts` and
 * `e2e/claim-handle.spec.ts`: returns null rather than throwing, so a checkout
 * with no repo-root `.env.local` — normal for a worktree, since the file is
 * gitignored and does not propagate — reports a visible SKIP instead of turning
 * the release gate red for an environment reason.
 */
function readSupabaseUrl(): string | null {
  try {
    const env = readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    const match = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

const SUPABASE_URL = readSupabaseUrl();

/**
 * A session cookie in the shape `@supabase/ssr` reads — the same construction
 * `e2e/account-delete.spec.ts` uses. Cookies are not port-scoped, so the URL
 * below is correct whatever ephemeral port the release runner picked.
 */
function v7SessionCookie(supabaseUrl: string): { name: string; value: string; url: string } {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const accessToken = [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(JSON.stringify({ sub: V7_USER_ID, role: 'authenticated', exp: expiresAt })),
    'e2e-fake-signature',
  ].join('.');
  const session = {
    access_token: accessToken,
    refresh_token: 'e2e-fake-refresh',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: expiresAt,
    user: {
      id: V7_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'v7-tester@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${base64Url(JSON.stringify(session))}`,
    url: 'http://localhost:3000',
  };
}

test('signing back in to the SAME V7 account keeps every V7 key and everything it renders', async ({
  page,
}) => {
  test.skip(
    SUPABASE_URL === null,
    'NEXT_PUBLIC_SUPABASE_URL not found in .env.local',
  );
  // The install-over does not end signed-out. It ends with the user signing
  // back in, and THAT path runs guardAgainstForeignCache, writeCacheOwner and
  // the ratings import — each of which can delete local rows. A fixture that
  // only ever renders signed-out proves survival for the one mode that has no
  // way to lose data.
  //
  // Routes match MOST-RECENTLY-REGISTERED first, so these go broadest-first:
  // a blanket `[]` would otherwise starve CatalogRefresh and drop Bar 54 for a
  // reason that has nothing to do with signing in.
  await page.route('**/rest/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // The server holds this account's rows. That is what the fixture's
  // `:merged-for:` latch MEANS — the V7 import completed — so an empty
  // `ratings` table would be an incoherent fixture, not a harsher one.
  await page.route('**/rest/v1/ratings*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: route.request().method() === 'GET'
        ? JSON.stringify(
            (JSON.parse(V7_LOCAL['next-bar:ratings:v1']) as BarRatingFixture[]).map(
              (rating) => ({
                bar_id: rating.barId,
                tier: rating.rating,
                rated_at: rating.ratedAt,
                score: rating.score,
              }),
            ),
          )
        : '[]',
    }),
  );
  await page.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await seedV7InstallWithCatalog(page);
  await page.context().addCookies([v7SessionCookie(SUPABASE_URL as string)]);

  await page.goto('/rankings');
  // The signed-in branch actually rendered — without this the assertions below
  // would pass just as well on a session the app never accepted, which is the
  // signed-out case the tests above already cover.
  await expect(page.getByText('Synced to your account')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Bar 54$/ })).toBeVisible();

  const ranking = await renderedRanking(page);
  expect(ranking[0]).toBe('1.Bar 54 | Score 9.4 out of 10');
  expect(ranking.slice(1).map((row) => row.split(' | ')[1])).toEqual([
    'Score 8.8 out of 10',
    'Score 8.8 out of 10',
  ]);

  await page.goto('/lists');
  await expect(page.getByRole('button', { name: /^V7 favorites 3 bars$/ })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByText('Your quiz answers are saved.')).toBeVisible();

  // Sign-in ADDS `next-bar:account:owner:v1` (and may add the journal-era
  // marker); it may not change or remove anything the V7 device already had —
  // with one contracted exception. `next-bar:follows:v1` is signed-out demo
  // state that the server set is SUPPOSED to replace on sign-in
  // (docs/V8-DATA-CONTINUITY-2026-08-14.md, Follows: "No import, by design"),
  // so pinning it here would assert the opposite of the contract.
  const { 'next-bar:follows:v1': _follows, ...mustSurvive } = V7_LOCAL;
  await expect(
    page.evaluate(
      (keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
      Object.keys(mustSurvive),
    ),
  ).resolves.toEqual(mustSurvive);
});

test('a V7 shared night still renders after the upgrade, and viewing it changes no V7 key', async ({
  page,
}) => {
  // The negative property (the route writes no local key) is asserted above.
  // This is the POSITIVE half the PRD asks for: shared-night state is a server
  // row addressed by a bearer token, so the row is stubbed — what is under test
  // is that a V7 user's shared night is still reachable and still renders its
  // own night, Bar 54 included.
  const token = '123e4567-e89b-42d3-a456-426614174000';
  await page.route('**/rest/v1/rpc/get_shared_night', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          handle: 'conor_f',
          display_name: 'Conor F',
          night: LAST_NIGHT,
          bar_ids: ['attaboy', 'death-and-co', 'bar-54'],
          loved_bar_id: 'bar-54',
          shared_at: '2026-08-13T03:00:00Z',
        },
      ]),
    }),
  );
  await seedV7InstallWithCatalog(page);

  await page.goto(`/u/conor_f/night/${token}`);
  await expect(
    page.getByRole('heading', { name: /Conor F's night out/i }),
  ).toBeVisible();
  await expect(page.getByText(/@conor_f · 3 stops · loved Bar 54/)).toBeVisible();
  const stops = page.locator('ol li');
  await expect(stops).toHaveCount(3);
  await expect(stops.nth(2)).toContainText('Bar 54');

  await expect(readLocal(page)).resolves.toEqual(V7_LOCAL);
});
