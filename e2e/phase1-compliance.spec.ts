import { expect, test } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

/**
 * Phase 1 behavioral gate: prove the compliance changes actually render.
 *
 * These assert USER-VISIBLE outcomes, not internals — the unit tests
 * already cover the resolution logic. What can only be proven by running
 * the app is that the catalog still loads past PostgREST's 1,000-row cap,
 * that Google-derived hours are labelled rather than presented as fact,
 * and that the required Google attribution is on screen.
 */

// Fixed clock: several results surfaces filter by open-now, and an
// off-hours run would otherwise produce an empty page and a false pass.
const FIXED = new Date('2026-07-24T23:00:00');

test('catalog loads past the 1,000-row PostgREST cap', async ({ page }) => {
  const sizes: number[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/rest/v1/bars') && res.request().method() === 'GET') {
      try {
        const body = await res.json();
        if (Array.isArray(body)) sizes.push(body.length);
      } catch {
        /* non-JSON response, ignore */
      }
    }
  });

  await page.clock.setFixedTime(FIXED);
  await page.goto('/');
  await page.waitForTimeout(4000);

  const total = sizes.reduce((n, s) => n + s, 0);
  // >1000 proves the paging loop ran; a single capped page would be exactly 1000.
  expect(total, `catalog page sizes seen: ${JSON.stringify(sizes)}`).toBeGreaterThan(1000);
});

test('Google-derived hours are labelled unverified, with attribution', async ({
  page,
  context,
}) => {
  await denyGeolocation(context);
  await page.clock.setFixedTime(FIXED);
  await page.goto('/');
  // Same seeding path the photo-card spec uses — search reaches results
  // deterministically without depending on geolocation.
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();

  const cards = page.locator('article').filter({ hasText: /Vibe match/i });
  await expect(cards).toHaveCount(5);

  // Open the first card's lightbox.
  await cards.first().locator('[data-testid="bar-visual"]').first().click();

  // Hours must never render bare and unqualified — whichever venue the
  // recommender surfaces, its hours carry one of the sanctioned provenance
  // notes from `hoursProvenanceNote` (src/lib/openNow.ts). Keep this list in
  // sync with that function.
  //
  // COVERAGE BOUNDARY (deliberate, flagged in review): because the surfaced
  // venue is whatever the recommender picks, this cannot assert the
  // google-specific string. A regression confined to the `google` branch
  // would slip past here. That branch is owned by
  // src/lib/openNow.test.ts:254 ("google/unverified → /not verified/"),
  // which asserts the mapping directly. What THIS test uniquely guards is
  // that the note is actually rendered in the lightbox, next to the hours,
  // together with the Google attribution.
  //
  // This used to assert /Hours not verified/ on the stated premise that
  // "every venue's hours are Google-derived today". H3 slice 5 falsified
  // that premise — 280 venues now carry hours_source='osm' and render the
  // ODbL note instead. The old assertion survived only because the first
  // recommended card happened to be a Google-hours venue, so it went red as
  // soon as card ordering shifted. The invariant below is what the
  // compliance requirement actually is.
  const PROVENANCE_NOTES = [
    'Hours not verified — confirm before a special trip.',
    'Hours via OpenStreetMap contributors (ODbL).',
    'Hours from the venue’s own website.',
    'Hours reported by a Next Bar user.',
    'Hours confirmed with the venue.',
  ];
  const provenanceNote = new RegExp(
    PROVENANCE_NOTES.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  );
  await expect(page.getByText(provenanceNote).first()).toBeVisible({
    timeout: 10_000,
  });

  // Attribution is the permission that lets us show Places data on a
  // non-Google (Leaflet) map — it must actually be rendered.
  await expect(page.getByText(/powered by Google/i)).toBeVisible();
});
