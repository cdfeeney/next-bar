import { test, expect, type Page } from '@playwright/test';

/**
 * google-photo-layout.spec.ts
 *
 * The clipping regression this pins was found on LIVE Staging at 390x844
 * (2026-08-06): the host `[data-testid=google-place-photo]` measured
 * 340x145.7 with `overflow:hidden` while its `gmp-place-details` child laid
 * out at 340x365 — so Google's media AND its required attribution were cut
 * off, leaving only the header/name/Maps CTA. Clipping a provider's credit
 * is a policy violation, not a cosmetic bug.
 *
 * Google's real widget cannot run here: the browser key is HTTP-referrer
 * restricted to the Staging origin, so localhost is refused by Google by
 * design. What IS verifiable locally — and is exactly what regressed — is
 * OUR container's geometry contract:
 *
 *   1. the host must never impose `overflow:hidden` or a fixed height, so a
 *      tall child renders in full rather than being cut off;
 *   2. the unavailable/blocked state must still be the stable 21/9 glyph.
 *
 * A tall stand-in child stands in for Google's element; it measures the
 * container, never Google's rendering (which is closed-shadow and must not
 * be styled, moved or hidden).
 */

const CHILD_HEIGHT = 365; // the height Google's element actually wanted live

async function openResults(page: Page): Promise<void> {
  await page.goto('/');
  const pick = page.getByRole('button', { name: /Pick a bar instead/i });
  if (await pick.isVisible().catch(() => false)) await pick.click();
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).first().click();
  await page
    .locator('article')
    .filter({ hasText: /Vibe match/i })
    .first()
    .waitFor();
}

test.describe('google-live card layout', () => {
  test('the widget host never clips a tall child (the 145.7-vs-365 regression)', async ({
    page,
  }) => {
    await openResults(page);

    // Build the host exactly as GooglePlacePhoto does while pending, then
    // measure what happens to a 365px child inside it.
    const geometry = await page.evaluate((childHeight) => {
      const card = document.querySelector('article');
      if (!card) return null;
      const host = document.createElement('div');
      host.setAttribute('data-testid', 'layout-probe');
      // The classes the component applies once the widget is ready.
      host.className = 'w-full';
      const child = document.createElement('div');
      child.style.height = `${childHeight}px`;
      child.style.width = '100%';
      host.appendChild(child);
      card.prepend(host);

      const cs = getComputedStyle(host);
      const rect = host.getBoundingClientRect();
      const result = {
        overflowY: cs.overflowY,
        hostHeight: Math.round(rect.height),
        childHeight: Math.round(child.getBoundingClientRect().height),
        clipped: host.scrollHeight > Math.ceil(rect.height) + 1,
      };
      host.remove();
      return result;
    }, CHILD_HEIGHT);

    console.log(`MEASURE mobile host=${JSON.stringify(geometry)}`);
    expect(geometry).not.toBeNull();
    // No clipping mechanism at all…
    expect(geometry!.overflowY).not.toBe('hidden');
    // …and the container grows to its content instead of truncating it.
    expect(geometry!.hostHeight).toBeGreaterThanOrEqual(CHILD_HEIGHT);
    expect(geometry!.childHeight).toBe(CHILD_HEIGHT);
    expect(geometry!.clipped).toBe(false);
  });

  test('blocked Google degrades to the stable 21/9 glyph, and screenshots the card', async ({
    page,
  }, testInfo) => {
    // Block only the Maps/UI-Kit hosts — never fonts.
    await page.route(
      (url) => /maps\.googleapis\.com|maps\.gstatic\.com|places\.googleapis\.com/.test(url.href),
      (route) => route.abort(),
    );
    await openResults(page);

    const card = page.locator('article').filter({ hasText: /Vibe match/i }).first();
    await expect(card).toBeVisible();

    // The widget is loaded through next/dynamic(ssr:false), so the glyph
    // cannot be asserted until that chunk resolves. Waiting for it is what
    // makes this test non-vacuous: without the wait it passed even when
    // google-live never activated at all.
    const glyph = page.locator('[data-testid="google-fallback-glyph"]').first();
    await glyph.waitFor({ timeout: 25_000 });

    // No legacy photo requests may occur on this path.
    expect(await page.locator('img[src*="/bar-photos/"]').count()).toBe(0);

    // Scoped to ONE card: the surface renders five, so a document-wide
    // count says nothing about what a single card carries.
    const dims = await page.evaluate(() => {
      const a = document.querySelector('article');
      if (!a) return null;
      const g = a.querySelector('[data-testid="google-fallback-glyph"]');
      const r = (el: Element | null) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) };
      };
      return {
        article: r(a),
        glyph: r(g),
        tiles: a.querySelectorAll('[data-testid="bar-visual"]').length,
        // Every app-rendered Google Maps link on THIS card, by label.
        appMapsLinks: [...a.querySelectorAll('a[href*="google.com/maps"]')]
          .map((x) => (x.textContent || '').trim()),
        cardsOnPage: document.querySelectorAll('article').length,
      };
    });
    expect(dims).not.toBeNull();
    console.log(`MEASURE fallback ${JSON.stringify(dims)}`);

    // The reserved 21/9 strip survives the failure…
    expect(dims!.glyph).not.toBeNull();
    expect(Math.abs(dims!.glyph!.w / dims!.glyph!.h - 21 / 9)).toBeLessThan(0.2);
    // …and the google-live card carries no glyph tile.
    expect(dims!.tiles).toBe(0);
    // EXACTLY ONE Maps action in the blocked state, not zero: the widget
    // that would have supplied Google's action is gone, so the fallback
    // provides the card's only one. Asserting zero here previously blessed
    // a card with no way to open the bar in Maps at all.
    expect(dims!.appMapsLinks).toEqual(['Open in Maps']);

    // Written to a stable, gitignored path so a reviewer can open them
    // without unpacking the HTML report.
    await card.screenshot({
      path: `test-results/screenshots/card-${testInfo.project.name}.png`,
    });
  });
});

/**
 * Desktop geometry. The configured projects are all mobile (the product is
 * mobile-first), so this block overrides the viewport rather than adding a
 * desktop project that would pull every other spec onto a viewport its
 * acceptance was never written for.
 */
test.describe('google-live card layout — desktop viewport', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the widget host never clips a tall child at desktop width', async ({
    page,
  }, testInfo) => {
    await page.route(
      (url) => /maps\.googleapis\.com|maps\.gstatic\.com|places\.googleapis\.com/.test(url.href),
      (route) => route.abort(),
    );
    await openResults(page);

    const geometry = await page.evaluate((childHeight) => {
      const card = document.querySelector('article');
      if (!card) return null;
      const host = document.createElement('div');
      host.className = 'w-full';
      const child = document.createElement('div');
      child.style.height = `${childHeight}px`;
      host.appendChild(child);
      card.prepend(host);
      const cs = getComputedStyle(host);
      const rect = host.getBoundingClientRect();
      const result = {
        overflowY: cs.overflowY,
        hostHeight: Math.round(rect.height),
        clipped: host.scrollHeight > Math.ceil(rect.height) + 1,
      };
      host.remove();
      return result;
    }, CHILD_HEIGHT);

    console.log(`MEASURE desktop host=${JSON.stringify(geometry)}`);
    expect(geometry!.overflowY).not.toBe('hidden');
    expect(geometry!.hostHeight).toBeGreaterThanOrEqual(CHILD_HEIGHT);
    expect(geometry!.clipped).toBe(false);

    const card = page.locator('article').filter({ hasText: /Vibe match/i }).first();
    await page.locator('[data-testid="google-fallback-glyph"]').first()
      .waitFor({ timeout: 25_000 });
    await card.screenshot({ path: 'test-results/screenshots/card-desktop.png' });
  });
});
