import { test, expect, type Locator, type Page } from '@playwright/test';
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

/**
 * Gap between the reservation samples scenario 16 takes while the load is held
 * open.
 *
 * This replaced a `DELAY_MS` timer that the `delayed` mock used to wait out
 * before signalling load. That timer made the pending window a race the test
 * had to win, and all three external lanes found the same consequences in
 * santa round 2: the samples could drift onto a host that had already gone
 * `ready`, and a window caught late yielded too few samples to prove anything.
 * The mock now HOLDS the load until the test releases it, so the window is as
 * long as the measurements need and this value only sets their spacing.
 *
 * Keep the total (4 samples at this spacing) well inside the component's 4s
 * budget for a mounted widget that never signals readiness, or the held widget
 * gives up and renders the fallback mid-scenario.
 */
const SAMPLE_INTERVAL_MS = 150;

/**
 * Longer than EVERY budget `GooglePlacePhoto` can arm: `MAX_LOAD_MS` (11s =
 * SDK_LOAD_TIMEOUT_MS 5s + SDK_LOAD_GRACE_MS 1s + IMPORT_TIMEOUT_MS 5s) and
 * the 4s budget for a mounted widget that never signals readiness. Mirrored
 * here rather than imported from `src/lib/placesUiKit` so this spec does not
 * pull component modules into the Node test process. If those constants grow,
 * this must grow with them — the `lazy-host` guard is only meaningful while it
 * outlasts every timer the component can start.
 */
const BEYOND_EVERY_BUDGET_MS = 13_000;

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

/**
 * ANY Google-owned host, billable or not.
 *
 * Wider than `GOOGLE_MEDIA_HOSTS` on purpose. That set answers "was a billable
 * media request made"; this one answers "was Google contacted at all". A
 * request to `www.google.com`, `maps.google.com` or `fonts.googleapis.com`
 * matched neither the media set nor `/bar-photos`, so it was recorded as
 * merely `blocked` and only printed — leaving criterion 19 green while an
 * unexpected Google request had genuinely been attempted. (santa round 2:
 * Codex.)
 */
const GOOGLE_ANY_HOST = /google\.com|googleapis\.com|gstatic\.com|googleusercontent\.com/;

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
    ({ mode }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__E2E_WIDGET = mode;

      /**
       * Widgets whose load is being HELD open, and the release that finishes
       * them. Scenario 16 samples the reservation while a load is genuinely in
       * flight, and a timer made that window a race the test had to win. An
       * explicit release makes the "slow load" last exactly as long as the
       * measurements need, so the scenario can no longer miss the window, drift
       * to `ready` mid-measurement, or collect too few samples.
       * (santa round 2: Codex, DeepSeek and GLM all flagged the timer race.)
       */
      w.__E2E_HELD = [] as Array<() => void>;
      w.__E2E_RELEASE = (): number => {
        const held = w.__E2E_HELD as Array<() => void>;
        return held.splice(0).map((finish) => finish()).length;
      };

      /**
       * Proof that the widget path actually RAN. `GooglePlacePhoto` sets
       * `unavailable` synchronously — no observer, no build, no budget — when
       * `isPlacesUiKitConfigured()` is false, and that renders exactly the same
       * glyph-and-no-host DOM the fallback scenarios assert. Only `build()`
       * reaches `importLibrary`, so this counter is what separates "the
       * fallback we are testing" from "the widget never ran at all".
       * (santa round 2: Claude/FABLE, GLM.)
       */
      w.__E2E_SDK_CALLS = 0;

      w.google = {
        maps: {
          importLibrary: async () => {
            w.__E2E_SDK_CALLS = (w.__E2E_SDK_CALLS as number) + 1;
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

          // 'delayed': hold this load open until the test releases it. The
          // element is appended by build(), so its mere presence is already
          // proof the load is in flight; holding it means the reservation can
          // be measured without racing a timer.
          if (mode === 'delayed') {
            (w.__E2E_HELD as Array<() => void>).push(() => this.finishLoad());
            return;
          }

          window.setTimeout(() => this.finishLoad(), 0);
        }

        /** Populate the widget and signal readiness. Shared by both paths. */
        finishLoad(): void {
          if (mode !== 'zero') {
            // THREE photos, not one: the "multi-photo lightbox handoff"
            // scenario cannot mean anything if the widget only ever
            // renders a single photo. (santa: Claude/FABLE M-1.)
            for (let i = 0; i < 3; i += 1) {
              const media = document.createElement('div');
              media.setAttribute('data-e2e-widget-photo', String(i));
              media.style.height = '160px';
              media.style.background = '#334';
              this.appendChild(media);
            }
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
        }
      }

      if (!customElements.get('gmp-place-details-compact')) {
        customElements.define('gmp-place-details-compact', FakeDetails);
      }
    },
    { mode: scenario },
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

/** Every google-live card on the results surface, in rank order. */
const allCards = (page: Page) =>
  page.locator('article').filter({ hasText: /Vibe match/i });

const hostOf = (scope: Locator) =>
  scope.locator('[data-testid="google-place-photo"]');

/**
 * Bring the lazy widget host into view, then hand back its locator.
 *
 * `GooglePlacePhoto` arms BOTH of its load budgets inside `build()`, and in a
 * real browser `build()` is reachable only from an `IntersectionObserver`
 * entry at `rootMargin: 200px`. Playwright's `expect(locator)` POLLS but never
 * scrolls — only actions do — so before this helper existed, whether the
 * widget built at all depended on where the leading card happened to land in
 * the layout. That had two distinct consequences:
 *
 *   - the readiness assertions were load-correlated and failed on a different
 *     scenario each run, always with the same signature (an EMPTY host stuck
 *     on `data-status="pending"`, which means no budget was ever armed);
 *   - worse, the COMPLIANCE assertions were vacuous. `expectUniversalInvariants`
 *     proves criterion 19 by observing an empty Google-request list, and a
 *     widget that never builds issues no request at all — so the strongest
 *     compliance claim in this file could pass for exactly the wrong reason.
 *
 * Revealing the card first makes the widget actually run, which is the state
 * every criterion below is written about. The `lazy-host` guard is the
 * deterministic proof that this reveal is load-bearing rather than decorative.
 */
async function revealCardUntil(
  page: Page,
  settled: (host: Locator) => Promise<void>,
  timeout = 60_000,
): Promise<Locator> {
  // Scroll the CARD, not the host. The host is not guaranteed to exist: an
  // unsupported SDK is detected before a widget is ever created, so scenario
  // 18 renders the fallback glyph with no host at all, and scrolling the host
  // there waits forever on a locator that will never resolve. The article
  // always exists, and the media band sits at its top, so revealing the card
  // is what actually brings the observer target within its 200px margin.
  const target = card(page);
  const host = hostOf(target);
  // Retried as ONE unit, for the same reason openResults() retries its
  // choose-then-search step. The results list re-renders shortly after first
  // paint as the ranking settles, and the cards are keyed by bar id, so the
  // article — and the host inside it — is REPLACED. A single scroll then has
  // two ways to fail, and both were observed:
  //   - it lands mid-swap and throws "Element is not attached to the DOM";
  //   - it succeeds against the doomed node, and the replacement host is a
  //     fresh, never-intersected element that sits wherever the new layout
  //     puts it — so the card goes back to being stuck on `pending` and the
  //     readiness assertion polls a widget whose budgets were never armed.
  // Re-scrolling on every attempt means whatever element is CURRENT ends up
  // revealed, which is the property the scenarios actually need.
  await expect(async () => {
    await target.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await settled(host);
  }).toPass({ timeout });
  return host;
}

/** The common case: reveal the card and wait for the widget to finish building. */
const revealCardReady = (page: Page): Promise<Locator> =>
  revealCardUntil(page, (host) =>
    expect(host).toHaveAttribute('data-status', 'ready', { timeout: 5_000 }),
  );

// There is deliberately NO "reveal only" helper. One existed, taking an empty
// settle predicate, and it was the single defect santa round 1 found: with
// nothing to satisfy, `toPass` returned after one scroll, and the post-paint
// re-render could then swap in a fresh, never-built host that satisfied a bare
// `pending` assertion. Every caller must state a condition that only a widget
// which actually RAN can meet, so a reveal can never again be reported as
// success while the thing under test never happened.

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
  // `GOOGLE_MEDIA_HOSTS` is deliberately the BILLABLE media set, so a request
  // to any other Google host (www.google.com, maps.google.com, fonts.*) landed
  // in `blocked` — aborted, but only ever LOGGED, so criterion 19 stayed green
  // while an unexpected Google request had in fact been attempted. The fence
  // still refuses it; this makes the attempt itself a failure.
  // (santa round 2: Codex.)
  expect(
    probe.blocked.filter((url) => GOOGLE_ANY_HOST.test(url)),
    `${label}: a Google host was contacted (refused by the fence, but attempted)`,
  ).toEqual([]);

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
/**
 * `mode: 'default'` opts this FILE out of the root `fullyParallel: true`, so
 * its scenarios run sequentially in one worker (the two google-live PROJECTS
 * still run in parallel with each other).
 *
 * This is a determinism requirement, not a preference. Every scenario here
 * drives a full search flow against the SINGLE google-live dev server and then
 * asserts against the component's REAL timing budgets — 4s for a mounted
 * widget to signal readiness, MAX_LOAD_MS (11s) overall. Under `fullyParallel`
 * six of them ran concurrently against that one `next dev`, starved exactly
 * those budgets, and the component then did the correct thing: it gave up and
 * rendered the fallback. The scenario failed with `Expected "ready" / element(s)
 * not found` — a host that is ABSENT because it fell back, which is a
 * different signature from the lazy-mount bug's EMPTY host stuck on `pending`.
 *
 * Measured on this machine (6 workers vs capped): 6 workers failed 3/19 on one
 * run and passed the next; capped, two consecutive runs passed 19/19 and were
 * no slower (1.4m vs 1.5-2.0m), because the contention was pure overhead.
 */
test.describe.configure({ mode: 'default', timeout: 120_000 });

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

  /**
   * NON-VACUITY, second half — and the deterministic proof behind
   * `revealCardUntil`.
   *
   * The six criterion scenarios below all assert against the LEADING card,
   * which usually sits within the observer's 200px margin already, so a green
   * run there proves nothing about whether the reveal is needed. This guard
   * removes the luck by asserting on a card that is unambiguously below the
   * fold: it must NOT build on its own, and it must build once revealed.
   *
   * Both halves matter. The first pins the pre-fix failure mode — a host that
   * stays EMPTY on `data-status="pending"` straight through every budget the
   * component has (MAX_LOAD_MS = 11s, plus the 4s mounted-widget budget), which
   * is why no timeout ever rescued it and why an unrevealed card could never
   * satisfy a readiness assertion. The second shows the scroll is the whole
   * remedy: delete the `scrollIntoViewIfNeeded` line below and this test fails
   * on its final assertion, with the host still `pending` after 45s. That is
   * the pre-fix failure reproduced deterministically — and it is exactly what
   * the six scenarios could never detect for themselves, because each of them
   * asserts against a leading card that is usually already in view.
   */
  test('lazy-host: a below-the-fold card builds only once revealed', async ({
    page,
  }) => {
    await setup(page, 'loaded');
    await openResults(page);

    // The results surface ranks a hand of five bars; the last is far below a
    // phone viewport. Asserted, not assumed — if the surface ever returns one
    // card this guard would silently stop testing anything.
    const cards = allCards(page);
    await expect(cards).toHaveCount(5);
    const host = hostOf(cards.last());

    // It exists, and it has not built.
    await expect(host).toHaveAttribute('data-status', 'pending');

    // Still pending after longer than EVERY budget the component can arm.
    // This is the load-bearing half: it separates "lazy" from "merely slow",
    // and a widget that never builds is also a widget that never requests,
    // which is what made criterion 19 vacuous for an unrevealed card.
    await page.waitForTimeout(BEYOND_EVERY_BUDGET_MS);
    await expect(host).toHaveAttribute('data-status', 'pending');
    await expect(
      cards.last().locator('gmp-place-details-compact'),
      'an unrevealed card must not build a widget',
    ).toHaveCount(0);

    // Revealing it — and only revealing it — arms the budgets.
    await expect(async () => {
      await host.scrollIntoViewIfNeeded({ timeout: 5_000 });
      await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 5_000 });
    }).toPass({ timeout: 45_000 });
  });

  // 13 — successful widget render.
  test('scenario 13: the widget renders and our duplicates stay suppressed', async ({
    page,
  }) => {
    const probe = await setup(page, 'loaded');
    await openResults(page);

    const host = await revealCardReady(page);

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

    const host = await revealCardReady(page);

    // Photo expansion is delegated to Google's own lightbox, not re-implemented.
    const d = await inspectCard(page);
    expect(d!.mediaEls, 'lightbox-preferred must remain set').toBe(1);
    // The widget really is rendering MULTIPLE photos in this scenario.
    const widgetPhotos = card(page).locator('[data-e2e-widget-photo]');
    await expect(widgetPhotos).toHaveCount(3);

    const before = page.url();

    // Tapping Google's OWN photo must stay with Google: no app dialog, no
    // navigation. Previously this scenario never clicked the widget at all,
    // so an overlay or a wrapping click handler that hijacked the handoff
    // would have passed it. (santa: Claude/FABLE M-1.)
    await widgetPhotos.first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url()).toBe(before);
    const afterWidgetTap = await inspectCard(page);
    expect(afterWidgetTap!.ownedTiles, 'app gallery appeared on widget tap').toBe(0);
    expect(afterWidgetTap!.legacyImgs).toBe(0);
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

    const host = await revealCardReady(page);

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

    // Wait until the widget is genuinely MID-BUILD, not merely `pending`.
    //
    // The mock's element is constructed by build() and, in this mode, HELD
    // until the test releases it. So `pending` together with the widget element
    // present is positive proof that build() ran and the load is in flight.
    // `pending` alone was vacuous: the post-paint re-render can hand back a
    // fresh, NEVER-BUILT host that is also `pending`, and every measurement
    // below would then describe a widget that never ran — the same "no build,
    // so no request, so green" trap this change exists to remove, surviving in
    // the one scenario whose subject is the pending state. (santa round 1:
    // Codex, DeepSeek and GLM, independently.)
    await revealCardUntil(page, async (h) => {
      await expect(h).toHaveAttribute('data-status', 'pending', { timeout: 1_000 });
      await expect(
        card(page).locator('gmp-place-details-compact'),
        'widget element absent: this host never built, so the samples would be vacuous',
      ).toHaveCount(1, { timeout: 1_000 });
    });

    /**
     * One reservation sample, valid ONLY if taken on a host that is still
     * pending AND has actually built.
     *
     * Round 2 found that checking those conditions once, before the loop, was
     * not enough: `revealCardUntil` hands back LIVE locators, so the re-render
     * could swap in a different host and the samples would silently describe
     * it instead. Re-asserting per sample closes that, and the retry absorbs
     * the swap itself (a replacement is briefly present-but-not-yet-built)
     * without ever accepting a sample from a widget that never ran.
     */
    const sampleHeld = async (label: string): Promise<number> => {
      let height = 0;
      await expect(async () => {
        const s = await inspectCard(page);
        expect(s, `${label}: no card`).not.toBeNull();
        expect(s!.hostStatus, `${label}: host is not pending`).toBe('pending');
        expect(s!.widgets, `${label}: sampled a host that never built`).toBe(1);
        expectRatio(s!.mediaBand, label);
        height = s!.mediaBand!.h;
      }).toPass({ timeout: 5_000 });
      return height;
    };

    // While PENDING the reserved band must already be the 21/9 the loaded
    // and fallback states use — a differently-sized placeholder is the
    // layout jump criterion 4 forbids.
    const heights: number[] = [await sampleHeld('delayed/pending')];
    for (let i = 0; i < 3; i += 1) {
      await page.waitForTimeout(SAMPLE_INTERVAL_MS);
      heights.push(await sampleHeld(`delayed/held-${i + 1}`));
    }
    console.log(`MEASURE delayed-heights ${JSON.stringify(heights)}`);
    // Every sample is now mandatory, so the set can no longer shrink silently
    // to the single t0 measurement the way the old skip-on-mismatch loop
    // allowed. (santa round 1: Claude/FABLE.)
    for (const h of heights) {
      expect(Math.abs(h - heights[0]), 'reserved height moved while pending').toBeLessThanOrEqual(1);
    }

    // Release the held load and confirm it completes. A zero release count
    // means nothing was ever held, so the "slow load" never engaged and
    // everything above measured the wrong thing.
    const released = await page.evaluate(
      () => (window as unknown as { __E2E_RELEASE: () => number }).__E2E_RELEASE(),
    );
    expect(released, 'no widget was held: the slow load never engaged').toBeGreaterThanOrEqual(1);

    await revealCardReady(page);
    await expectUniversalInvariants(page, probe, 'delayed');
  });

  // 17 — error fallback: exactly ONE app-owned Maps link.
  test('scenario 17: a failed widget degrades to a 21/9 fallback with one Maps link', async ({
    page,
  }) => {
    const probe = await setup(page, 'error');
    await openResults(page);

    // The fallback is just as lazy as the success path: it appears only when a
    // load budget EXPIRES, and those budgets are armed inside build(). Without
    // the reveal this waited on a glyph whose timer had never started.
    const glyph = card(page).locator('[data-testid="google-fallback-glyph"]');
    await revealCardUntil(page, async () => {
      await expect(glyph).toHaveCount(1, { timeout: 6_000 });
      // The glyph must be the widget's TERMINAL state, not something rendered
      // beside a host that is still deciding. `CardMediaFallback` is passed to
      // `GooglePlacePhotoLazy` as its fallback, so host and glyph are mutually
      // exclusive by construction; asserting it makes that a checked property
      // rather than an assumption the settle predicate silently relies on.
      // (santa round 1: DeepSeek.)
      await expect(hostOf(card(page))).toHaveCount(0);
    });
    // ...but that DOM alone does NOT prove the widget path ran.
    // `GooglePlacePhoto` sets `unavailable` synchronously — no observer, no
    // build, no budget — when `isPlacesUiKitConfigured()` is false, and that
    // renders exactly this glyph-and-no-host state. On a server whose key
    // inlining regressed, both fallback scenarios AND their criterion-19
    // invariants would go green while the paths under test never executed.
    // Only build() reaches the SDK, so this is the assertion that separates
    // "the fallback we are testing" from "the widget never ran at all".
    // (santa round 2: Claude/FABLE, GLM.)
    expect(
      await page.evaluate(
        () => (window as unknown as { __E2E_SDK_CALLS: number }).__E2E_SDK_CALLS,
      ),
      'importLibrary was never called: the widget path never ran',
    ).toBeGreaterThanOrEqual(1);

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

    // The fallback is just as lazy as the success path: it appears only when a
    // load budget EXPIRES, and those budgets are armed inside build(). Without
    // the reveal this waited on a glyph whose timer had never started.
    const glyph = card(page).locator('[data-testid="google-fallback-glyph"]');
    await revealCardUntil(page, async () => {
      await expect(glyph).toHaveCount(1, { timeout: 6_000 });
      // The glyph must be the widget's TERMINAL state, not something rendered
      // beside a host that is still deciding. `CardMediaFallback` is passed to
      // `GooglePlacePhotoLazy` as its fallback, so host and glyph are mutually
      // exclusive by construction; asserting it makes that a checked property
      // rather than an assumption the settle predicate silently relies on.
      // (santa round 1: DeepSeek.)
      await expect(hostOf(card(page))).toHaveCount(0);
    });
    // ...but that DOM alone does NOT prove the widget path ran.
    // `GooglePlacePhoto` sets `unavailable` synchronously — no observer, no
    // build, no budget — when `isPlacesUiKitConfigured()` is false, and that
    // renders exactly this glyph-and-no-host state. On a server whose key
    // inlining regressed, both fallback scenarios AND their criterion-19
    // invariants would go green while the paths under test never executed.
    // Only build() reaches the SDK, so this is the assertion that separates
    // "the fallback we are testing" from "the widget never ran at all".
    // (santa round 2: Claude/FABLE, GLM.)
    expect(
      await page.evaluate(
        () => (window as unknown as { __E2E_SDK_CALLS: number }).__E2E_SDK_CALLS,
      ),
      'importLibrary was never called: the widget path never ran',
    ).toBeGreaterThanOrEqual(1);

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

    const host = await revealCardReady(page);

    const before = page.url();
    // Every app-owned control on the card that is not a real link.
    const buttons = card(page).locator('button');
    const count = await buttons.count();
    // Without this the loop degenerates silently: a selector drift or an
    // overlay swallowing every click would leave the test asserting nothing
    // while still reporting "interactions never change the URL".
    // (santa: Claude/FABLE M-2.)
    expect(count, 'no app-owned buttons found on the card').toBeGreaterThan(0);

    let clicked = 0;
    for (let i = 0; i < count; i += 1) {
      const b = buttons.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      // Not swallowed: a control that cannot be clicked is a real failure,
      // not something to skip past.
      await b.click({ timeout: 5_000 });
      clicked += 1;
      expect(page.url(), `button ${i} navigated`).toBe(before);
      // Close anything that opened so the next control is reachable.
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    // A google-live card always carries at least Want-to-go and Hours.
    expect(clicked, 'no card button was actually clicked').toBeGreaterThanOrEqual(2);

    await expectUniversalInvariants(page, probe, 'interactions');
  });
});
