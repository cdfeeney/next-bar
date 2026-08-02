/**
 * manifest-icons.spec.ts (goal g-fb7b9f28)
 *
 * The manifest previously declared a 192x192 entry that served a 512x512
 * image (TESTFLIGHT-READINESS-2026-08-02 item 2 FAIL sub-item). These
 * tests fetch the REAL bytes behind every declared icon and decode them:
 * a declaration may only exist if the returned file genuinely has the
 * declared dimensions. Brand appearance (near-black ground, brand-orange
 * glyph) and the App Store no-alpha rule for the apple touch icon are
 * pinned on decoded pixels, not on route source.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  decodePng,
  pixelAt,
  countPixelsNear,
  isFullyOpaque,
} from './helpers/png';

const BRAND_ORANGE = { r: 0xff, g: 0x5b, b: 0x3a }; // #ff5b3a glyph
const BRAND_GROUND = { r: 0x0a, g: 0x0a, b: 0x0a }; // #0a0a0a background
const COLOR_TOLERANCE = 8; // anti-aliased edges excluded; interiors exact

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

async function fetchManifestIcons(
  request: APIRequestContext,
): Promise<ManifestIcon[]> {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as { icons?: ManifestIcon[] };
  expect(Array.isArray(manifest.icons)).toBe(true);
  return manifest.icons ?? [];
}

async function fetchDecodedIcon(request: APIRequestContext, src: string) {
  const res = await request.get(src);
  expect(res.ok(), `icon src ${src} must serve 200`).toBe(true);
  expect(res.headers()['content-type']).toContain('image/png');
  return decodePng(await res.body());
}

test.describe('manifest icons are genuine (g-fb7b9f28)', () => {
  test('every declared icon serves a PNG with exactly the declared dimensions', async ({
    request,
  }) => {
    const icons = await fetchManifestIcons(request);

    // Both PWA sizes must stay declared — dropping the 192 entry would
    // "fix" the mismatch by deleting the requirement instead of meeting it.
    const declaredSizes = icons.map((i) => i.sizes);
    expect(declaredSizes).toContain('192x192');
    expect(declaredSizes).toContain('512x512');

    for (const icon of icons) {
      const match = /^(\d+)x(\d+)$/.exec(icon.sizes);
      expect(match, `sizes "${icon.sizes}" must be WxH`).not.toBeNull();
      const [, declaredWidth, declaredHeight] = match!;
      const png = await fetchDecodedIcon(request, icon.src);
      expect(
        { src: icon.src, width: png.width, height: png.height },
        `${icon.src} must really be ${icon.sizes}`,
      ).toEqual({
        src: icon.src,
        width: Number(declaredWidth),
        height: Number(declaredHeight),
      });
    }
  });

  test('both PWA icons keep the brand appearance at their real size', async ({
    request,
  }) => {
    for (const src of ['/icon/192', '/icon/512']) {
      const png = await fetchDecodedIcon(request, src);

      // Ground: the top-edge midpoint sits inside the rounded square.
      const ground = pixelAt(png, Math.floor(png.width / 2), 2);
      expect(ground.a, `${src} ground must be opaque`).toBe(255);
      expect(Math.abs(ground.r - BRAND_GROUND.r)).toBeLessThanOrEqual(
        COLOR_TOLERANCE,
      );
      expect(Math.abs(ground.g - BRAND_GROUND.g)).toBeLessThanOrEqual(
        COLOR_TOLERANCE,
      );
      expect(Math.abs(ground.b - BRAND_GROUND.b)).toBeLessThanOrEqual(
        COLOR_TOLERANCE,
      );

      // Glyph: the brand-orange N occupies a real share of the canvas at
      // EVERY size — a blank or wrong-color render fails, and a 192 entry
      // that secretly serves a scaled-crop or empty image cannot pass.
      const orangePixels = countPixelsNear(png, BRAND_ORANGE, COLOR_TOLERANCE);
      const canvas = png.width * png.height;
      expect(
        orangePixels / canvas,
        `${src} must contain the brand-orange glyph`,
      ).toBeGreaterThan(0.02);
    }
  });

  test('unlisted icon ids fail closed with 404 (santa: Claude — untrusted route input)', async ({
    request,
  }) => {
    for (const src of ['/icon/999999', '/icon/abc', '/icon/191']) {
      const res = await request.get(src);
      expect(res.status(), `${src} must be rejected, not rendered`).toBe(404);
    }
  });

  test('apple touch icon is 180x180, fully opaque (App Store no-alpha rule)', async ({
    request,
  }) => {
    const png = await fetchDecodedIcon(request, '/apple-icon');
    expect({ width: png.width, height: png.height }).toEqual({
      width: 180,
      height: 180,
    });
    // Apple rejects icons with an alpha channel in use: full-bleed square,
    // no rounded-corner transparency (iOS applies its own mask).
    expect(isFullyOpaque(png)).toBe(true);
    expect(
      countPixelsNear(png, BRAND_ORANGE, COLOR_TOLERANCE) / (180 * 180),
    ).toBeGreaterThan(0.02);
  });
});
