/**
 * mobile-shell-pack.spec.ts (goal g-b07c73bc)
 *
 * Web-provable regression pins for the operator's TestFlight build-5 shell
 * feedback (docs/MORNING-HANDOFF-2026-08-05.md): oversized top/safe-area
 * region, background issue, wonky scrolling. Login-on-open already has its
 * own spec (signin-gate.spec.ts) and is NOT duplicated here.
 *
 * SCOPE HONESTY. Build 5 wraps Production, and a browser cannot render real
 * status-bar insets or suspend a WKWebView. These tests pin only the WEB
 * LAYER's contribution to each reported item; the native halves live in
 * docs/MOBILE-SHELL-DEVICE-CHECKLIST-2026-08-05.md as attended checks.
 *
 *   1. Top region: the header sits at y=0 with no top padding creep from
 *      body/main, and its height stays inside a one-row budget — so any
 *      oversize a device shows is the shell's inset handling, not this CSS.
 *      Also pins `viewport-fit=cover`: removing it silently changes how the
 *      shell resolves env(safe-area-inset-*) and would surface exactly as
 *      the reported defect.
 *   2. Background/resume: a hidden→visible cycle must not navigate, jump
 *      the scroll position (immediately OR within a bounded settle window),
 *      or kill interactivity — checked signed-out and signed-in, because
 *      useAuth's resume revalidation only runs signed-in. The app's four
 *      visibilitychange listeners (useAuth, useIntent, deferredCatalogSwap,
 *      searchBarAutoHide) act together here, which no unit test covers.
 *   3. Deferred catalog swap across backgrounding: a swap deferred because
 *      the user is scrolled must commit while hidden and the resumed page
 *      must show the new catalog (the designed option-C behavior of
 *      lib/deferredCatalogSwap — the web-provable slice of the operator's
 *      "background issue").
 *   4. Overlay idempotency under resume events in the installed context:
 *      repeated visibility cycles must keep exactly ONE sign-in dialog —
 *      the double-mounted-overlay class of resume defect.
 *
 * KNOWN LIMITS of the simulation, on purpose:
 *   - Only `visibilitychange` is dispatched. No pageshow/pagehide/freeze
 *     listener exists anywhere in src (verified 2026-08-05), so simulating
 *     those would exercise nothing; if one is ever added, extend
 *     cycleVisibility alongside it.
 *   - Post-resume stability is asserted for a bounded 800ms window; a jump
 *     scheduled later than that is out of reach for a deterministic spec.
 */
import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';
import { asInstalledApp } from './helpers/standalone';
import { fakeSignedIn } from './helpers/fakeAuth';
import {
  installCatalogFixture,
  installLoopbackFixtures,
  loadBundledRows,
} from './helpers/catalogFixture';

const SEARCH = { name: 'Search bars' };

/**
 * Reach BarPicker deterministically. `/` is location-first: with denial
 * installed the flow normally lands on the picker by itself, but when the
 * Permissions API answers slower than WhereNextFlow's 400ms primer grace
 * timer (real under parallel-worker CPU load), the primer renders and
 * STAYS — the step-decision effect routes denied→picker only from the
 * 'locating' step. A real user taps "Pick a bar instead"; so does this
 * helper. (Observed as an iPhone-13-project flake before this existed.)
 */
async function openBarPicker(page: Page): Promise<void> {
  const search = page.getByRole('textbox', SEARCH);
  const pickInstead = page.getByRole('button', { name: /pick a bar instead/i });
  // The primer can also self-route away (denied resolves while it shows),
  // detaching the button mid-click — so the whole attempt retries as a
  // unit rather than committing to one click that can strand on a
  // detached element.
  await expect(async () => {
    if (await search.isVisible()) return;
    await pickInstead.click({ timeout: 500 }).catch(() => {});
    await expect(search).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
}

/**
 * One-row header geometry on the configured 390–412px viewports measures
 * ~72px (px-6 py-4 + one line of text); 90px allows breathing room without
 * re-admitting the "oversized top region" class — a py-9 header (~112px)
 * must FAIL. None of the configured projects is narrow enough (≤360px) to
 * wrap the header to two rows, so the budget is deliberately one-row.
 */
const HEADER_HEIGHT_BUDGET_PX = 90;

/** Bounded window in which a delayed post-resume scroll jump must surface. */
const RESUME_SETTLE_MS = 800;

/**
 * Fake a background/resume cycle the way the unit suites do: override
 * visibilityState/hidden, dispatch visibilitychange, then restore. All
 * configured projects run Chromium, where the property override is honored
 * by every listener in the app.
 */
async function goHidden(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function goVisible(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function cycleVisibility(page: Page): Promise<void> {
  await goHidden(page);
  await goVisible(page);
}

/**
 * Scroll fingerprint. On `/` the WINDOW is the scroller (verified against
 * src: no ancestor of the list has overflow-y auto/scroll — the sticky
 * search bar depends on document-level scrolling; the inner-scroller trap
 * mobile-controls.spec.ts documents is specific to /rankings). The keyed
 * element map below is future-proofing for layouts that add real inner
 * scrollers: keys are structural paths, so a React remount at the same
 * position keeps its key, while membership changes cannot misalign an
 * index-based comparison (santa round-1: DeepSeek). Tradeoff, on purpose
 * (santa round-2: DeepSeek): a sibling mounted ABOVE a scroller renames its
 * key, which fails LOUDLY as "scroller disappeared" — a false alarm to fix
 * in the test, never a silently masked jump, because a vanished before-key
 * with scrollTop>0 can only fail. Scrollers at 0 that start scrolling on
 * resume are outside this net; the window — the actual scroller on / — is
 * always compared directly.
 */
type Fingerprint = {
  url: string;
  window: number;
  scrollers: Record<string, number>;
};

async function readFingerprint(page: Page): Promise<Fingerprint> {
  return page.evaluate(() => {
    const pathOf = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur !== document.body && parts.length < 8) {
        const parent: Element | null = cur.parentElement;
        const idx = parent ? Array.from(parent.children).indexOf(cur) : 0;
        parts.unshift(`${cur.tagName}[${idx}]`);
        cur = parent;
      }
      return parts.join('>');
    };
    const scrollers: Record<string, number> = {};
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const oy = window.getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        scrollers[pathOf(el)] = el.scrollTop;
      }
    }
    return { url: location.pathname, window: window.scrollY, scrollers };
  });
}

function expectSamePlace(before: Fingerprint, after: Fingerprint): void {
  expect(after.url).toBe(before.url);
  expect(Math.abs(after.window - before.window)).toBeLessThanOrEqual(2);
  for (const [key, top] of Object.entries(before.scrollers)) {
    // Every scroller the user was actually inside must survive with its
    // position; scrollers at rest that legitimately unmount are ignored.
    if (top > 0) {
      expect(after.scrollers[key], `scroller ${key} disappeared on resume`).toBeDefined();
      expect(Math.abs((after.scrollers[key] ?? 0) - top)).toBeLessThanOrEqual(2);
    }
  }
}

/**
 * Scroll a third of the way in (instant — globals.css sets `html {
 * scroll-behavior: smooth }`, and reading positions mid-animation
 * fabricates a "jump" that is really the animation finishing; caught on
 * Pixel 7, whose taller viewport gives the longest settle) and wait until
 * the position holds still for three consecutive samples.
 */
async function scrollMidListAndSettle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => {
      const oy = window.getComputedStyle(el).overflowY;
      return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
    });
    for (const el of scrollables) el.scrollTop = Math.floor(el.scrollHeight / 3);
    window.scrollTo({ top: Math.floor(document.body.scrollHeight / 3), behavior: 'instant' });
  });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __settle?: { y: number; n: number } };
      const y = window.scrollY;
      const s = w.__settle;
      w.__settle = s && s.y === y ? { y, n: s.n + 1 } : { y, n: 1 };
      return w.__settle.n >= 3;
    },
    undefined,
    { polling: 200, timeout: 5_000 },
  );
}

test.describe('/ top region stays compact (web layer of the safe-area report)', () => {
  test.beforeEach(async ({ page, context }) => {
    await denyGeolocation(context);
    await page.goto('/');
    await openBarPicker(page);
  });

  test('header starts at the very top with no padding creep above it', async ({ page }) => {
    // Exactly one header — a double-mounted header is the same defect class
    // as the double-mounted overlay pinned below.
    await expect(page.locator('main > header')).toHaveCount(1);
    const header = page.locator('main > header');
    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    // y=0 is the pin: any top padding/margin added to html/body/main — the
    // double-inset class of defect — pushes the header down and fails here.
    // A future `padding-top: env(safe-area-inset-top)` fix stays GREEN:
    // env() resolves to 0px in these browser contexts, so this pin blocks
    // hardcoded creep while permitting the legitimate inset mechanism.
    expect(box!.y).toBeLessThanOrEqual(1);
    expect(box!.height).toBeLessThanOrEqual(HEADER_HEIGHT_BUDGET_PX);

    const creep = await page.evaluate(() => {
      const top = (el: Element | null) => {
        if (!el) return { pad: '0px', margin: '0px' };
        const s = window.getComputedStyle(el);
        return { pad: s.paddingTop, margin: s.marginTop };
      };
      return {
        body: top(document.body),
        main: top(document.querySelector('main')),
      };
    });
    expect(creep.body.pad).toBe('0px');
    expect(creep.body.margin).toBe('0px');
    expect(creep.main.pad).toBe('0px');
    expect(creep.main.margin).toBe('0px');
  });

  test('viewport meta keeps viewport-fit=cover (the shell inset contract)', async ({ page }) => {
    const content = await page.evaluate(
      () => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
    );
    expect(content).toContain('viewport-fit=cover');
  });
});

test.describe('/ background/resume keeps the surface (web analog of the background report)', () => {
  test('signed out: a visibility cycle never navigates, jumps scroll, or kills input', async ({
    page,
    context,
  }) => {
    await denyGeolocation(context);
    await page.goto('/');
    await openBarPicker(page);

    await scrollMidListAndSettle(page);
    const before = await readFingerprint(page);
    // The pin below must discriminate: we are genuinely mid-list.
    expect(before.window).toBeGreaterThan(300);

    await cycleVisibility(page);

    // With the network fence up no deferred catalog swap can be pending, so
    // resume must be a no-op for the viewport — immediately AND after the
    // settle window, because resume handlers are async and a delayed jump
    // would otherwise be sampled away (santa round-1: Codex).
    expectSamePlace(before, await readFingerprint(page));
    await page.waitForTimeout(RESUME_SETTLE_MS);
    expectSamePlace(before, await readFingerprint(page));

    // Interactivity survives resume: reveal the search bar (scroll to top is
    // a reveal condition for the autohide controller) and filter with it.
    await page.evaluate(() => window.scrollTo(0, 0));
    const search = page.getByRole('textbox', SEARCH);
    await expect(search).toHaveCSS('pointer-events', 'auto', { timeout: 5_000 });
    await search.fill('a');
    await expect(search).toHaveValue('a');
  });

  test('signed in: an installed-app resume leaves the surface alone', async ({
    page,
    context,
  }) => {
    // useAuth's visibilitychange handler early-returns unless signed in, so
    // the signed-out test above never reaches it (santa round-1: Codex).
    // SCOPE (santa round-2: Codex + DeepSeek): the immediate cycle takes
    // useAuth's THROTTLED branch — lastValidationAt is stamped at load and
    // network revalidation is skipped for REVALIDATE_MIN_INTERVAL_MS
    // (5 min), which is exactly the path a user re-opening within minutes
    // hits. The past-interval revalidation (including deleted-account
    // sign-out) is unit-covered in useAuth.test.tsx and is not re-simulated
    // here. The installed-app context is what makes the no-gate assertion
    // meaningful: in a plain browser the gate never renders regardless.
    // No loopback fixture install: fakeSignedIn's catch-all /rest/v1/**
    // stub fulfills locally and registers later, so a fixture would be
    // LIFO-shadowed into a no-op (santa round-2: Fable) — CatalogRefresh's
    // small-set guard keeps the static catalog either way.
    await asInstalledApp(context);
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');
    await denyGeolocation(context);
    await page.goto('/');
    await openBarPicker(page);
    // Signed in: the gate must not be up before the cycle either.
    await expect(page.getByRole('dialog', { name: /sign in to next bar/i })).toHaveCount(0);

    await scrollMidListAndSettle(page);
    const before = await readFingerprint(page);
    expect(before.window).toBeGreaterThan(300);

    await cycleVisibility(page);

    expectSamePlace(before, await readFingerprint(page));
    await page.waitForTimeout(RESUME_SETTLE_MS);
    expectSamePlace(before, await readFingerprint(page));
    // And resume must not have surfaced a sign-in gate for a signed-in user.
    await expect(page.getByRole('dialog', { name: /sign in to next bar/i })).toHaveCount(0);
  });

  test('a swap deferred while scrolled commits during backgrounding', async ({
    page,
    context,
  }) => {
    // The option-C contract (lib/deferredCatalogSwap): a catalog swap that
    // arrives while the user is scrolled defers; leaving the page (hidden)
    // is a safe point, so backgrounding commits it and the resumed page
    // shows the new catalog. This is the web-provable slice of the
    // operator's "background issue" (santa round-1: Codex + GLM).
    const sentinelName = 'Deferred Swap Sentinel Bar';
    const rows = loadBundledRows();
    const sentinel = { ...rows[0], id: 'zzz-deferred-swap-sentinel', name: sentinelName };
    await installCatalogFixture(page, { rows: [...rows, sentinel] });
    // Hold the catalog response until the page is scrolled: routes register
    // LIFO, so this gate intercepts before the fixture and releases into it
    // via fallback().
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route(/\/rest\/v1\/bars(\?|$)/, async (route) => {
      await gate;
      await route.fallback();
    });

    await denyGeolocation(context);
    await page.goto('/');
    await openBarPicker(page);
    const search = page.getByRole('textbox', SEARCH);
    await expect(page.locator('html')).not.toHaveAttribute('data-catalog-swapped', '1');
    // Pre-swap catalog check: the sentinel must NOT be findable yet — this
    // is what makes the post-resume positive assertion discriminate the
    // swap rather than the search box (santa round-2: DeepSeek).
    await search.fill('deferred swap sentinel');
    await expect(page.getByRole('button', { name: new RegExp(sentinelName, 'i') })).toHaveCount(0);
    await search.fill('');

    // Get scrolled (> SAFE_SCROLL_PX = 4) BEFORE the catalog arrives.
    await scrollMidListAndSettle(page);
    const catalogResponse = page.waitForResponse((r) => /\/rest\/v1\/bars/.test(r.url()), {
      timeout: 15_000,
    });
    release();
    // Sequencing, not sleeping (santa round-2: Codex + DeepSeek): wait for
    // the catalog response to COMPLETE, give parse + deferUntilSafe a
    // bounded beat, and only then assert the swap is still deferred — this
    // proves "fetch done, still deferred", not "fetch slow". A commit
    // scheduled on an independent timer between here and the hidden
    // dispatch cannot be fully excluded by any bounded wait; the RED proof
    // (no-op'ing the onHidden commit fails the positive assertion below)
    // is what shows the hidden path is load-bearing.
    await catalogResponse;
    await page.waitForTimeout(500);
    await expect(page.locator('html')).not.toHaveAttribute('data-catalog-swapped', '1');

    // Backgrounding is a safe point: the swap commits while hidden…
    await goHidden(page);
    await expect(page.locator('html')).toHaveAttribute('data-catalog-swapped', '1', {
      timeout: 5_000,
    });

    // …and the resumed page serves the NEW catalog.
    await goVisible(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(search).toHaveCSS('pointer-events', 'auto', { timeout: 5_000 });
    await search.fill('deferred swap sentinel');
    await expect(page.getByRole('button', { name: new RegExp(sentinelName, 'i') })).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe('installed-app resume keeps overlays idempotent', () => {
  test('repeated visibility cycles keep exactly one sign-in dialog', async ({
    page,
    context,
  }) => {
    // Fixtures keep the catalog/auth fetches loopback-clean under the
    // network fence; they do not touch the signed-out auth state under test.
    await installLoopbackFixtures(page);
    await asInstalledApp(context);
    await denyGeolocation(context);
    await page.goto('/');
    const dialogs = page.getByRole('dialog', { name: /sign in to next bar/i });
    await expect(dialogs.first()).toBeVisible({ timeout: 15_000 });
    // Baseline BEFORE the cycles, so the post-cycle count discriminates the
    // cycles' contribution (santa round-2: DeepSeek).
    await expect(dialogs).toHaveCount(1);

    await cycleVisibility(page);
    await cycleVisibility(page);

    // The resume-defect class this pins: overlays re-mounting per lifecycle
    // event. One dialog, still functional, after two full cycles — sampled
    // again after the settle window because gate re-evaluation is async.
    await expect(dialogs).toHaveCount(1);
    await page.waitForTimeout(RESUME_SETTLE_MS);
    await expect(dialogs).toHaveCount(1);
    await expect(dialogs.first().getByRole('link', { name: /sign in/i })).toBeVisible();
  });
});
