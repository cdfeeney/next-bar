/**
 * typography-contract.spec.ts — V9-11
 *
 * The approved pair (owner, 2026-09-08): Playfair Display for display /
 * headings, Nunito Sans for body. V10-01 (owner, 2026-09-09): small uppercase
 * labels — the bottom nav, section labels, chips — are a LABEL role on the
 * body face (`font-label`, Nunito Sans 600), never the serif. This pins what a screenshot cannot: which
 * faces are actually LOADED, which family each role resolves to, and that no
 * rendered weight is synthesised (every computed weight is one the face ships).
 * See docs/V9-TYPOGRAPHY-CONTRACT-2026-09-09.md for the tokens and mapping.
 *
 * next/font self-hosts both faces under mangled family names
 * (`__Playfair_Display_<hash>`), so families are matched by prefix.
 */
import { test, expect } from './helpers/catalogTest';
import { denyGeolocation } from './helpers/geo';

type LoadedFace = { family: string; weight: string; status: string };

// V10-07 (owner, 2026-09-11): the V8 Poppins kit for every role. One family;
// the role tokens differ only in weight.
const DISPLAY = /^__Poppins/;
const BODY = /^__Poppins/;
const NAV = /^__Poppins/;
const NAV_WEIGHTS = ['700'];
const DISPLAY_WEIGHTS = ['700'];
const BODY_WEIGHTS = ['400', '500', '600', '700'];

async function loadedFaces(page: import('@playwright/test').Page): Promise<LoadedFace[]> {
  return page.evaluate(async () => {
    const fonts = (document as Document & { fonts: FontFaceSet }).fonts;
    await fonts.ready;
    const out: LoadedFace[] = [];
    fonts.forEach((f) => out.push({ family: f.family.replace(/"/g, ''), weight: f.weight, status: f.status }));
    return out;
  });
}

/** Every visible text element's resolved family + weight, deduplicated. */
async function renderedTypography(page: import('@playwright/test').Page): Promise<Array<{ family: string; weight: string; sample: string }>> {
  return page.evaluate(() => {
    const seen = new Map<string, string>();
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const text = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0);
      if (!text) continue;
      // Third-party map chrome (Leaflet attribution/controls) sets its own
      // family; it is not app typography and is left to the map contract.
      if (el.closest('.leaflet-container')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const family = cs.fontFamily.split(',')[0].replace(/"/g, '').trim();
      const key = `${family}|${cs.fontWeight}`;
      if (!seen.has(key)) seen.set(key, (el.textContent ?? '').trim().slice(0, 40));
    }
    return Array.from(seen, ([key, sample]) => {
      const [family, weight] = key.split('|');
      return { family, weight, sample };
    });
  });
}

for (const route of ['/', '/rankings', '/map']) {
  test(`typography contract on ${route}: approved faces loaded, roles resolve, no synthetic weights`, async ({ page }) => {
    await denyGeolocation(page.context());
    await page.goto(route);
    await expect(page.getByText(/Loading the Manhattan catalog/)).toHaveCount(0);

    const faces = await loadedFaces(page);
    // The approved pair is DECLARED at exactly the weights the layout ships, and
    // Poppins is gone. Declared, not loaded: Chromium fetches a face only when
    // rendered text needs it, so an unused weight legitimately stays `unloaded`
    // (measured on Pixel 7 — Playfair 700 is declared but nothing on these
    // screens renders it). What must be LOADED is every face that is in use —
    // asserted per rendered (family, weight) below, which is also the synthetic
    // weight check: a rendered weight with no loaded face of that weight is
    // being faked by the engine.
    for (const w of BODY_WEIGHTS) expect(faces.some((f) => BODY.test(f.family) && f.weight === w), `Poppins ${w} declared`).toBe(true);
    expect(faces.filter((f) => /Playfair|Nunito/i.test(f.family))).toHaveLength(0);
    for (const w of NAV_WEIGHTS) expect(faces.some((f) => NAV.test(f.family) && f.weight === w), `Poppins ${w} declared`).toBe(true);
    // (V9-11 asserted Poppins gone; V10-06 brings it back for the nav only.)
    const loaded = faces.filter((f) => f.status === 'loaded');
    expect(loaded.some((f) => BODY.test(f.family)), 'a Poppins face is loaded').toBe(true);

    // Roles: body and display are both Poppins; display resolves to 700.
    const body = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(body).toMatch(BODY);
    const display = page.locator('.font-display').first();
    await expect(display).toBeVisible();
    expect(await display.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(DISPLAY);
    expect(await display.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700');
    // V10-06: the bottom nav is the V8 face, Poppins Bold uppercase (owner,
    // build 11); every nav tab carries font-nav.
    const tabs = page.getByRole('navigation', { name: /primary/i }).getByRole('link');
    expect(await tabs.count()).toBe(5);
    for (let i = 0; i < 5; i++) {
      const tab = tabs.nth(i);
      expect(await tab.evaluate((el) => el.classList.contains('font-nav')), `nav tab ${i} carries font-nav`).toBe(true);
      const cs = await tab.evaluate((el) => {
        const c = getComputedStyle(el);
        return { family: c.fontFamily, weight: c.fontWeight, transform: c.textTransform };
      });
      expect(cs.family, `nav tab ${i} family`).toMatch(NAV);
      expect(cs.weight, `nav tab ${i} weight`).toBe('700');
      expect(cs.transform, `nav tab ${i} transform`).toBe('uppercase');
    }
    // Every small uppercase label resolves to Poppins (no fallback face).
    const smallSerif = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0);
        if (!hasText || el.closest('.leaflet-container')) continue;
        const c = getComputedStyle(el);
        if (c.display === 'none' || c.visibility === 'hidden') continue;
        if (c.textTransform === 'uppercase' && parseFloat(c.fontSize) <= 12 && !/^"?__Poppins/.test(c.fontFamily)) {
          out.push(`${el.tagName.toLowerCase()} ${c.fontSize} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
        }
      }
      return out;
    });
    expect(smallSerif, JSON.stringify(smallSerif)).toEqual([]);

    // No synthetic weights: every rendered (family, weight) is a face that is
    // declared at that weight AND loaded.
    const rendered = await renderedTypography(page);
    const offenders = rendered.filter((r) =>
      (DISPLAY.test(r.family) || BODY.test(r.family) || NAV.test(r.family)) &&
      !loaded.some((f) => f.family === r.family && f.weight === r.weight));
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
    // And nothing on the page fell through to a system face.
    const foreign = rendered.filter((r) => !DISPLAY.test(r.family) && !BODY.test(r.family) && !NAV.test(r.family));
    expect(foreign, JSON.stringify(foreign)).toEqual([]);
  });
}
