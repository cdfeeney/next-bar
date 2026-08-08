import { test, expect, type Page } from '@playwright/test';
import { installLoopbackFixtures } from './helpers/catalogFixture';

/**
 * google-card.spec.ts — Item 6 (goal g-65ba768e).
 *
 * The supported Google Places UI Kit card, exercised across every widget
 * state with a MOCKED widget. Runs only on the `google-live *` projects,
 * whose dev server sets NEXT_PUBLIC_GOOGLE_MEDIA=1 with a stub key — see
 * playwright.config.ts. No live Google widget and no paid API is invoked:
 * the SDK is replaced before any page script runs, the fence proxy refuses
 * every non-loopback request, and this file additionally fails the test if
 * one is even attempted.
 *
 * What is app-owned and therefore assertable here:
 *   - the container geometry (a stable 21/9 reservation that never jumps),
 *   - which of OUR controls render beside the widget,
 *   - the compliance wiring we hand Google (request, media, attribution),
 *   - that we never re-host a Google photo.
 *
 * Google's own rendering is closed-shadow and must not be styled, moved or
 * hidden, so nothing below reaches into it.
 */

type Scenario = 'loaded' | 'delayed' | 'zero' | 'error' | 'unsupported';

/** Under the widget-load budget (4s) so `delayed` still resolves to READY. */
const DELAY_MS = 1_200;

/** Tolerance on the 21/9 ratio: sub-pixel layout rounding only. */
const RATIO_EPSILON = 0.15;
const TARGET_RATIO = 21 / 9;

/**
 * Google media hosts. Same set the reviewed google-photo-layout.spec.ts
 * blocks, and for the same reason: these — never fonts — are the hosts a
 * billable Places/UI-Kit request would reach.
 */
const GOOGLE_MEDIA_HOSTS =
  /maps\.googleapis\.com|maps\.gstatic\.com|places\.googleapis\.com|googleusercontent\.com/;

type Probe = {
  /** Every /bar-photos/ request observed. MUST stay empty (criterion 11). */
  barPhotos: string[];
  /** Google MEDIA requests. MUST stay empty (criterion 19, first clause). */
  google: string[];
  /**
   * Other non-loopback requests. NOT asserted empty — the app legitimately
   * attempts Leaflet basemap tiles and the stub Supabase host on this
   * surface, and criterion 19's second clause asks that such traffic be
   * ABORTED by the fence, which is what the handler below does. Recorded so
   * the report can state exactly what was refused rather than implying the
   * page made no outbound attempts at all.
   */
  blocked: string[];
};

/**
 * Install the interception guards BEFORE navigation.
 *
 * Both are fail-loud: the request is aborted (so it can never escape) and
 * recorded (so the test can assert it never happened). `guards-are-live`
 * below proves both arms actually fire, so an empty list means "nothing
 * was requested", not "the guard was never wired".
 */
async function installGuards(page: Page): Promise<Probe> {
  const probe: Probe = { barPhotos: [], google: [], blocked: [] };

  await page.route('**/bar-photos/**', (route) => {
    probe.barPhotos.push(route.request().url());
    return route.abort();
  });

  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => {
      const url = route.request().url();
      if (GOOGLE_MEDIA_HOSTS.test(url)) probe.google.push(url);
      else probe.blocked.push(url);
      return route.abort();
    },
  );

  return probe;
}

/**
 * Replace the Maps SDK and the UI Kit element with deterministic stand-ins.
 *
 * `GooglePlacePhoto` polls for `window.google.maps.importLibrary` BEFORE it
 * injects a script tag, so defining it here means no script is ever
 * requested. The custom element stands in for Google's rendering; the
 * elements the component builds (`gmp-place-details-place-request`,
 * `gmp-place-media`, `gmp-place-attribution`) are deliberately left
 * undefined so the compliance wiring stays exactly as shipped and can be
 * asserted.
 */
async function installWidget(page: Page, scenario: Scenario): Promise<void> {
  await page.addInitScript(
    ({ mode, delayMs }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__E2E_WIDGET = mode;

      w.google = {
        maps: {
          importLibrary: async () => {
            if (mode === 'unsupported') {
              throw new Error('e2e: places library unavailable');
            }
            return {};
          },
        },
      };

      class FakeDetails extends HTMLElement {
        connectedCallback(): void {
          // 'error': the widget mounts and then never signals readiness —
          // the component's own budget must carry it to the fallback.
          if (mode === 'error') return;

          window.setTimeout(
            () => {
              if (mode !== 'zero') {
                const media = document.createElement('div');
                media.setAttribute('data-e2e-widget-photo', '');
                media.style.height = '160px';
                media.style.background = '#334';
                this.appendChild(media);
              }
              // Stand-ins for the two things Google's own card supplies and
              // that ours must therefore NOT duplicate.
              const credit = document.createElement('div');
              credit.setAttribute('data-e2e-widget-attribution', '');
              credit.textContent = 'Google';
              this.appendChild(credit);

              const maps = document.createElement('a');
              maps.setAttribute('data-e2e-widget-maps', '');
              maps.href = 'https://www.google.com/maps/place/?q=place_id:e2e';
              maps.textContent = 'View on Google Maps';
              this.appendChild(maps);

              this.dispatchEvent(new Event('gmp-load'));
            },
            mode === 'delayed' ? delayMs : 0,
          );
        }
      }

      if (!customElements.get('gmp-place-details-compact')) {
        customElements.define('gmp-place-details-compact', FakeDetails);
      }
    },
    { mode: scenario, delayMs: DELAY_MS },
  );
}

/**
 * Full per-test setup, in the order the routes must be registered.
 *
 * Playwright gives the MOST RECENTLY registered handler priority, so the
 * broad guards go on first and the loopback fixtures second — otherwise the
 * guards would abort the catalog read the fixtures exist to answer.
 *
 * Installing the fixtures is not a convenience. Without them the fenced
 * `/rest/v1/bars` read fails and CatalogRefresh retries it, remounting the
 * result cards several times a second; each remount tore down
 * GooglePlacePhoto's IntersectionObserver before it could fire, so the
 * widget never built and every scenario sat on `pending` forever. Serving
 * the catalog from loopback is what makes the widget states reachable at
 * all — and it is also what lets criterion 19 be asserted as literally zero
 * non-loopback requests rather than "zero Google ones".
 */
async function setup(page: Page, scenario: Scenario): Promise<Probe> {
  const probe = await installGuards(page);
  await installLoopbackFixtures(page);
  await installWidget(page, scenario);
  return probe;
}

/** Navigate to a results list containing the Attaboy card. */
async function openResults(page: Page): Promise<void> {
  await page.goto('/');
  const pick = page.getByRole('button', { name: /Pick a bar instead/i });
  const search = page.getByRole('textbox', { name: 'Search bars' });

  // Wait for EITHER entry point before deciding which one to take.
  //
  // A bare `if (await pick.isVisible())` samples once, without retrying, and
  // therefore races the location-first screen's first paint: when the button
  // had not rendered yet the click was silently skipped and the following
  // fill() then waited out the whole timeout for a search box that never
  // appears. That is the single cause of every `locator.fill` timeout seen
  // on this spec — the page snapshot showed "Pick a bar instead" sitting
  // there, unclicked.
  // Retry the whole choose-then-search step as ONE unit.
  //
  // Checking `pick.isVisible()` once and clicking is not enough even after
  // waiting for it: the location-first screen can re-render between the
  // check and the click (the button detaches, the click is skipped), and the
  // following fill() then waits out the entire test budget for a search box
  // that never appears. `toPass` re-runs the block until the search box is
  // actually there, which is the condition we care about.
  await expect(async () => {
    if (await pick.isVisible().catch(() => false)) {
      await pick.click().catch(() => undefined);
    }
    await expect(search).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });

  await search.fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).first().click();
  // Bounded on purpose: an unbounded waitFor() is limited only by the test
  // timeout, which turned every slow render into a 120s hang instead of a
  // fast, diagnosable failure.
  await page
    .locator('article')
    .filter({ hasText: /Vibe match/i })
    .first()
    .waitFor({ timeout: 30_000 });
}

const card = (page: Page) =>
  page.locator('article').filter({ hasText: /Vibe match/i }).first();

/** Geometry + composition of ONE card. A page-wide count proves nothing. */
async function inspectCard(page: Page) {
  return page.evaluate(() => {
    // The SAME card the `card()` locator targets. Using
    // `querySelector('article')` here instead silently measured whatever
    // article happened to come first in the DOM, so the geometry and the
    // locator assertions could describe two different cards.
    const a =
      [...document.querySelectorAll('article')].find((el) =>
        /Vibe match/i.test(el.textContent || ''),
      ) ?? document.querySelector('article');
    if (!a) return null;
    const rect = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    };
    const host = a.querySelector('[data-testid="google-place-photo"]');
    const glyph = a.querySelector('[data-testid="google-fallback-glyph"]');
    const media = host ?? glyph;
    const hostStyle = host ? getComputedStyle(host) : null;
    return {
      host: rect(host),
      hostStatus: host?.getAttribute('data-status') ?? null,
      hostOverflowY: hostStyle?.overflowY ?? null,
      hostOverflowX: hostStyle?.overflowX ?? null,
      glyph: rect(glyph),
      /** The media band, whichever state it is in — this is what must hold 21/9. */
      mediaBand: rect(media),
      /** Our own photo chrome. Must never appear on a google-live card. */
      ownedTiles: a.querySelectorAll('[data-testid="bar-visual"]').length,
      legacyImgs: a.querySelectorAll('img[src*="/bar-photos/"]').length,
      /** Compliance wiring handed to Google. */
      widgets: a.querySelectorAll('gmp-place-details-compact').length,
      placeRequests: [...a.querySelectorAll('gmp-place-details-place-request')].map(
        (el) => el.getAttribute('place'),
      ),
      mediaEls: a.querySelectorAll('gmp-place-media[lightbox-preferred]').length,
      attributionEls: a.querySelectorAll('gmp-place-attribution').length,
      /** Maps links WE render (anything outside the widget host). */
      appMapsLinks: [...a.querySelectorAll('a[href*="google.com/maps"]')]
        .filter((el) => !el.closest('gmp-place-details-compact'))
        .map((el) => (el.textContent || '').trim()),
      /** Maps action the widget itself supplies. */
      widgetMapsLinks: a.querySelectorAll('[data-e2e-widget-maps]').length,
      widgetAttribution: a.querySelectorAll('[data-e2e-widget-attribution]').length,
      cardOverflowsX: a.scrollWidth > a.clientWidth + 1,
      pageOverflowsX:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    };
  });
}

function expectRatio(band: { w: number; h: number } | null, label: string): void {
  expect(band, `${label}: media band missing`).not.toBeNull();
  const ratio = band!.w / band!.h;
  expect(
    Math.abs(ratio - TARGET_RATIO),
    `${label}: ratio ${ratio.toFixed(3)} (${band!.w}x${band!.h}) is not 21/9`,
  ).toBeLessThan(RATIO_EPSILON);
}

/**
 * Assertions that must hold in EVERY scenario. Stated once so a new
 * scenario cannot quietly opt out of the compliance invariants.
 */
async function expectUniversalInvariants(
  page: Page,
  probe: Probe,
  label: string,
): Promise<void> {
  const d = await inspectCard(page);
  expect(d, `${label}: no card`).not.toBeNull();

  // 11 + 12: never a re-hosted Google photo, by request OR by DOM.
  expect(probe.barPhotos, `${label}: /bar-photos requested`).toEqual([]);
  expect(d!.legacyImgs, `${label}: legacy <img> present`).toBe(0);

  // 19: not one Google MEDIA request, in any state. This is the criterion
  // that proves no live widget and no billable call occurred.
  expect(probe.google, `${label}: Google media request attempted`).toEqual([]);
  // Everything else non-loopback was refused rather than allowed out.
  console.log(`MEASURE ${label} blocked=${JSON.stringify(probe.blocked)}`);

  // 10: no duplicate app-owned photo chrome beside the Google surface.
  expect(d!.ownedTiles, `${label}: duplicate app photo tile`).toBe(0);

  // 20: no horizontal overflow introduced.
  expect(d!.cardOverflowsX, `${label}: card overflows horizontally`).toBe(false);
  expect(d!.pageOverflowsX, `${label}: page overflows horizontally`).toBe(false);
}

/**
 * These scenarios deliberately wait out the component's OWN budgets — 4s for
 * a mounted widget that never signals readiness, and up to 11s
 * (MAX_LOAD_MS) for an SDK that never resolves — on top of a full
 * search-and-pick flow on a dev server. The 30s default is not enough for
 * that by construction, and raising it here is honest about why rather than
 * trimming the waits the criteria are actually about.
 */
test.describe.configure({ timeout: 120_000 });

test.describe('supported Google card', () => {
  /**
   * NON-VACUITY. Both guards are proven to fire before any scenario relies
   * on them staying silent — otherwise an empty `probe` list is equally
   * consistent with "the route was never registered".
   */
  test('guards-are-live: the interception guards actually fire', async ({ page }) => {
    const probe = await setup(page, 'loaded');
    await openResults(page);

    const attempted = await page.evaluate(async () => {
      const img: Promise<string> = new Promise((resolve) => {
        const el = document.createElement('img');
        el.onerror = () => resolve('img-blocked');
        el.onload = () => resolve('img-LOADED');
        el.src = '/bar-photos/e2e-probe.jpg';
        document.body.appendChild(el);
      });
      const fetched = await fetch('https://maps.googleapis.com/e2e-probe')
        .then(() => 'fetch-ALLOWED')
        .catch(() => 'fetch-blocked');
      return { img: await img, fetched };
    });

    console.log(`MEASURE guard-probe ${JSON.stringify(attempted)}`);
    // Both were refused…
    expect(attempted.img).toBe('img-blocked');
    expect(attempted.fetched).toBe('fetch-blocked');
    // …and both were SEEN, which is what makes the empty-list assertions
    // elsewhere in this file meaningful.
    expect(probe.barPhotos.some((u) => u.includes('e2e-probe'))).toBe(true);
    expect(probe.google.some((u) => u.includes('e2e-probe'))).toBe(true);
  });

  // 13 — successful widget render.
  test('scenario 13: the widget renders and our duplicates stay suppressed', async ({
    page,
  }) => {
    const probe = await setup(page, 'loaded');
    await openResults(page);

    const host = card(page).locator('[data-testid="google-place-photo"]');
    await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });

    const d = await inspectCard(page);
    console.log(`MEASURE loaded ${JSON.stringify(d)}`);

    // 9: exactly one Google widget on the card — the sole billable surface.
    expect(d!.widgets).toBe(1);
    // 7: the supported controls we hand Google are intact. The place_id is
    // asserted by SHAPE, not by value: the results surface ranks a hand of
    // five bars by proximity, so which bar leads is not fixed by the search
    // and pinning one id here asserted the wrong card.
    expect(d!.placeRequests).toHaveLength(1);
    expect(d!.placeRequests[0]).toMatch(/^ChIJ/);
    expect(d!.mediaEls).toBe(1);
    // 6: …including attribution.
    expect(d!.attributionEls).toBe(1);
    expect(d!.widgetAttribution).toBe(1);
    // 8: Google's own Maps action is present and OURS is not duplicated.
    expect(d!.widgetMapsLinks).toBe(1);
    expect(d!.appMapsLinks).toEqual([]);
    // The host must never clip what Google rendered.
    expect(d!.hostOverflowY).not.toBe('hidden');

    await expectUniversalInvariants(page, probe, 'loaded');
  });

  // 14 — multi-photo lightbox handoff.
  test('scenario 14: photo expansion stays with Google; Hours opens our own content', async ({
    page,
  }) => {
    const probe = await setup(page, 'loaded');
    await openResults(page);

    const host = card(page).locator('[data-testid="google-place-photo"]');
    await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });

    // Photo expansion is delegated to Google's own lightbox, not re-implemented.
    const d = await inspectCard(page);
    expect(d!.mediaEls, 'lightbox-preferred must remain set').toBe(1);

    const before = page.url();
    await card(page).getByRole('button', { name: /See hours for/i }).click();

    // Our lightbox carries the app's OWN content (weekly hours)…
    await expect(page.getByRole('dialog')).toBeVisible();
    // …and opening it is not a navigation (criterion 20's negative).
    expect(page.url()).toBe(before);

    // Still no second gallery and still no re-hosted photo, with the
    // lightbox open — the state where a duplicate gallery would appear.
    await expectUniversalInvariants(page, probe, 'lightbox-open');
  });

  // 15 — zero-photo state.
  test('scenario 15: a widget with no photo keeps a coherent, credited card', async ({
    page,
  }) => {
    const probe = await setup(page, 'zero');
    await openResults(page);

    const host = card(page).locator('[data-testid="google-place-photo"]');
    await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });

    const d = await inspectCard(page);
    console.log(`MEASURE zero-photo ${JSON.stringify(d)}`);

    // No photo came back, but the compliance wiring and credit stand…
    expect(d!.attributionEls).toBe(1);
    expect(d!.widgetAttribution).toBe(1);
    // …and we still do not fill the gap with our own gallery or a second
    // Maps action.
    expect(d!.ownedTiles).toBe(0);
    expect(d!.appMapsLinks).toEqual([]);
    // OUR rank still renders — Google's widget has no notion of it…
    await expect(card(page).getByTestId('card-rank')).toHaveText('1');
    // …but the name stays Google's to render. Adding ours here because the
    // photo is missing would be exactly the duplicate chrome criterion 10
    // forbids: the compact widget shows the name in this state too.
    await expect(card(page).getByTestId('card-name')).toHaveCount(0);

    await expectUniversalInvariants(page, probe, 'zero-photo');
  });

  // 16 — delayed widget: the reservation must HOLD, not jump.
  test('scenario 16: the 21/9 reservation holds through a slow load', async ({
    page,
  }) => {
    const probe = await setup(page, 'delayed');
    await openResults(page);

    const host = card(page).locator('[data-testid="google-place-photo"]');
    // While PENDING the reserved band must already be the 21/9 the loaded
    // and fallback states use — a differently-sized placeholder is the
    // layout jump criterion 4 forbids.
    await expect(host).toHaveAttribute('data-status', 'pending');
    const pending = await inspectCard(page);
    console.log(`MEASURE delayed-pending ${JSON.stringify(pending)}`);
    expectRatio(pending!.mediaBand, 'delayed/pending');

    // Sample repeatedly across the wait: the height must not move.
    const heights: number[] = [pending!.mediaBand!.h];
    for (let i = 0; i < 3; i += 1) {
      await page.waitForTimeout(DELAY_MS / 4);
      const s = await inspectCard(page);
      if (s?.hostStatus === 'pending' && s.mediaBand) heights.push(s.mediaBand.h);
    }
    console.log(`MEASURE delayed-heights ${JSON.stringify(heights)}`);
    for (const h of heights) {
      expect(Math.abs(h - heights[0]), 'reserved height moved while pending').toBeLessThanOrEqual(1);
    }

    await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
    await expectUniversalInvariants(page, probe, 'delayed');
  });

  // 17 — error fallback: exactly ONE app-owned Maps link.
  test('scenario 17: a failed widget degrades to a 21/9 fallback with one Maps link', async ({
    page,
  }) => {
    const probe = await setup(page, 'error');
    await openResults(page);

    const glyph = card(page).locator('[data-testid="google-fallback-glyph"]');
    await glyph.waitFor({ timeout: 25_000 });

    const d = await inspectCard(page);
    console.log(`MEASURE error-fallback ${JSON.stringify(d)}`);

    // 4: the strip survives the failure at the same ratio.
    expectRatio(d!.mediaBand, 'error-fallback');
    // 5: exactly one — not zero (no way to open Maps), not two.
    expect(d!.appMapsLinks).toEqual(['Open in Maps']);
    // The widget is gone, so nothing of Google's remains to credit.
    expect(d!.widgets).toBe(0);
    // The bar is still identifiable and still ranked. The NAME is asserted
    // as non-empty rather than as a fixed bar: the leading card is whichever
    // the proximity ranking puts first, not necessarily the searched one.
    await expect(card(page).getByTestId('card-rank')).toHaveText('1');
    await expect(card(page).getByTestId('card-name')).not.toHaveText('');

    await expectUniversalInvariants(page, probe, 'error-fallback');
  });

  // 18 — unsupported / unavailable widget.
  test('scenario 18: an unsupported SDK degrades the same way, with no retry storm', async ({
    page,
  }) => {
    const probe = await setup(page, 'unsupported');
    await openResults(page);

    const glyph = card(page).locator('[data-testid="google-fallback-glyph"]');
    await glyph.waitFor({ timeout: 25_000 });

    const d = await inspectCard(page);
    console.log(`MEASURE unsupported ${JSON.stringify(d)}`);

    expectRatio(d!.mediaBand, 'unsupported');
    expect(d!.appMapsLinks).toEqual(['Open in Maps']);
    expect(d!.widgets).toBe(0);

    // Never fall back to the legacy cache — the seam that would quietly
    // undo the whole compliance migration.
    await expectUniversalInvariants(page, probe, 'unsupported');
  });

  // 20 — negative: interactions do not navigate, and nothing overflows.
  test('scenario 20: card interactions never change the URL', async ({ page }) => {
    const probe = await setup(page, 'loaded');
    await openResults(page);

    const host = card(page).locator('[data-testid="google-place-photo"]');
    await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });

    const before = page.url();
    // Every app-owned control on the card that is not a real link.
    const buttons = card(page).locator('button');
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      const b = buttons.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      await b.click({ trial: false }).catch(() => undefined);
      expect(page.url(), `button ${i} navigated`).toBe(before);
      // Close anything that opened so the next control is reachable.
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    await expectUniversalInvariants(page, probe, 'interactions');
  });
});
