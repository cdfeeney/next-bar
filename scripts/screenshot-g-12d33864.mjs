/**
 * Visual-acceptance screenshot packet for goal g-12d33864 (Map + Discover).
 *
 * Standalone rather than a Playwright spec on purpose: these are evidence for
 * the operator, not assertions, and adding a screenshot-only spec to the suite
 * would make every future run pay for them. Run it against an already-running
 * server:
 *
 *   npm run build && npm run start          # in one shell
 *   node scripts/screenshot-g-12d33864.mjs  # in another
 *
 * Viewport is pinned to 402x681 — the shortest configured device (the
 * "iPhone 17" project in playwright.config.ts), which is where a sheet whose
 * action row is its last child fails first.
 */

import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000';
const OUT = path.join(process.cwd(), 'docs', 'screenshots', 'g-12d33864');
const VIEWPORT = { width: 402, height: 681 };

/** Same fixed clock the home specs use — live surfaces hard-filter closed bars. */
const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', path.relative(process.cwd(), file));
}

async function settle(page, ms = 1500) {
  await page.waitForTimeout(ms);
}

const main = async () => {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['iPhone 15 Pro'],
    viewport: VIEWPORT,
    permissions: [],
  });
  // The 21+ age gate would otherwise cover every shot.
  await context.addInitScript(() => {
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
  await context.setGeolocation(undefined);

  const page = await context.newPage();

  // --- 1. Map default ------------------------------------------------------
  await page.goto(`${BASE}/map`);
  await page.getByRole('heading', { name: /^Find Bar$/ }).waitFor();
  await page.locator('.leaflet-marker-icon').first().waitFor({ timeout: 20_000 });
  await settle(page, 2500);
  await shot(page, '1-map-default');

  // --- 2. Tweak CLOSED -----------------------------------------------------
  // Same page state, framed on the collapsed control so the "Anything" summary
  // and the absence of any rail are both legible.
  const disclosure = page.getByRole('button', { name: /Tweak the vibe/i });
  await disclosure.scrollIntoViewIfNeeded();
  await settle(page, 500);
  await shot(page, '2-tweak-closed');

  // --- 3. Tweak OPEN -------------------------------------------------------
  await disclosure.click();
  await page.getByTestId('findbar-filters').waitFor();
  await settle(page, 600);
  await shot(page, '3-tweak-open');

  // --- 4. Club selected AND applied ---------------------------------------
  const sheet = page.getByTestId('findbar-filters');
  await sheet.getByRole('button', { name: /^Setting\b/ }).click();
  await settle(page, 300);
  await sheet.getByRole('button', { name: /^Club/ }).click();
  await settle(page, 300);
  await shot(page, '4a-club-selected');
  await sheet.getByRole('button', { name: /^Apply$/ }).click();
  await settle(page, 2500);
  await shot(page, '4b-club-applied');

  // --- 5. Marker details (the shared BarLightbox) --------------------------
  await page.goto(`${BASE}/map`);
  await page.locator('.leaflet-marker-icon').first().waitFor({ timeout: 20_000 });
  await settle(page, 2500);
  // Same approach the passing map-lightbox spec uses: search a known bar so the
  // fly puts its marker at the map centre, then click the marker element
  // nearest that centre. Clicking blind at the centre point lands on the tile
  // layer, because the icon is anchored above its coordinate.
  await page.getByRole('searchbox', { name: /Search bars/i }).fill('Attaboy');
  await page
    .getByRole('list', { name: /Matching bars/i })
    .getByRole('button', { name: /Attaboy/i })
    .click();
  await settle(page, 1400);
  const idx = await page.evaluate(() => {
    const container = document.querySelector('.leaflet-container');
    if (!container) return -1;
    const c = container.getBoundingClientRect();
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    const icons = Array.from(document.querySelectorAll('.leaflet-marker-icon'));
    let best = -1;
    let bestD = Infinity;
    icons.forEach((el, i) => {
      const b = el.getBoundingClientRect();
      const d = Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  });
  if (idx < 0) throw new Error('no marker found near the map centre');
  await page.locator('.leaflet-marker-icon').nth(idx).click();
  await page.getByRole('dialog').waitFor({ timeout: 10_000 });
  await settle(page, 1200);
  await shot(page, '5-marker-details');

  // --- 6. Bottom of Next Bar?'s Tweak screen ------------------------------
  // The Apply/Cancel row clearing the fixed bottom nav is the whole point of
  // this shot, so scroll to the very bottom before capturing.
  const page2 = await context.newPage();
  await page2.clock.setFixedTime(FRIDAY_NIGHT);
  await page2.goto(`${BASE}/`);
  await page2.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page2.getByRole('button', { name: /Attaboy/ }).click();
  await page2.getByRole('button', { name: /Tweak the vibe/i }).click();
  await page2.getByRole('button', { name: /^Apply$/i }).waitFor();
  await page2.evaluate(() => {
    const scroller =
      Array.from(document.querySelectorAll('*')).find(
        (el) => el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 200,
      ) ?? document.scrollingElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
  await settle(page2, 800);
  await shot(page2, '6-nextbar-tweak-bottom');

  await browser.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
