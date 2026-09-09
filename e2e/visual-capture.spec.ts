import { test, expect } from './helpers/test';
import path from 'node:path';

/**
 * V9-11 evidence capture (foundation B). Not an assertion suite: it writes one
 * screenshot per screen per viewport to docs/design-reference/actual-<date>/ so
 * the visual review compares ACTUAL renders against the approved references.
 * Waits for document.fonts.ready and network idle before every capture so a
 * half-loaded webfont is never mistaken for the intended face.
 *
 * Runs only when VISUAL_CAPTURE_DIR is set, so the release gate never pays for it.
 */
const OUT = process.env.VISUAL_CAPTURE_DIR;

const SCREENS: Array<{ name: string; route: string; ready: RegExp | string }> = [
  { name: 'next-bar-home', route: '/', ready: /Next Bar|Where next/i },
  { name: 'map', route: '/map', ready: /map/i },
  { name: 'rankings', route: '/rankings', ready: /Rankings/i },
  { name: 'social', route: '/friends', ready: /Friends|Social/i },
  { name: 'plan-night-out-form', route: '/friends/consensus', ready: /night out|plan/i },
  { name: 'settings', route: '/settings', ready: /Settings/i },
  { name: 'nights', route: '/nights', ready: /night/i },
];

test.describe('V9-11 visual evidence capture', () => {
  test.skip(!OUT, 'set VISUAL_CAPTURE_DIR to capture');

  for (const screen of SCREENS) {
    test(`capture ${screen.name}`, async ({ page }, testInfo) => {
      await page.goto(screen.route);
      await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      const fonts = await page.evaluate(async () => {
        await (document as Document & { fonts: FontFaceSet }).fonts.ready;
        const faces: string[] = [];
        (document as Document & { fonts: FontFaceSet }).fonts.forEach((f) => {
          if (f.status === 'loaded') faces.push(`${f.family} ${f.weight}`);
        });
        const body = getComputedStyle(document.body).fontFamily;
        const h = document.querySelector('h1, h2, h3');
        const heading = h ? getComputedStyle(h).fontFamily : '(no heading)';
        return { faces, body, heading };
      });
      testInfo.annotations.push({ type: 'fonts', description: JSON.stringify(fonts) });
      const file = path.join(OUT as string, `${screen.name}--${testInfo.project.name.replace(/\s+/g, '-')}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`[visual-capture] ${file} fonts=${JSON.stringify(fonts)}`);
    });
  }
});
