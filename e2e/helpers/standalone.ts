/**
 * standalone.ts — force the "installed app" display context for e2e.
 *
 * The installed-app surface (iOS home-screen / TestFlight shell) is detected
 * via `display-mode: standalone` and iOS Safari's non-standard
 * `navigator.standalone`. Playwright cannot launch a real standalone context,
 * so tests inject the same signals the browser would — the identical approach
 * `helpers/geo.ts` uses for geolocation, and for the same reason: relying on
 * engine defaults is not deterministic.
 */

import type { BrowserContext } from '@playwright/test';

/**
 * Simulate the REAL TestFlight/App Store shell: Capacitor native, loading a
 * remote server.url in a WKWebView. Critically it leaves the PWA signals
 * FALSE — in that shell `navigator.standalone` is a Safari-only property and
 * display-mode reports `browser`. Any test that also forces the PWA signals
 * would pass even if the Capacitor branch were deleted, which is exactly the
 * gap this helper exists to close (santa round-2, both lanes).
 */
export async function asCapacitorNativeApp(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      value: {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
      },
    });
  });
}

/** Make the page report that it is running as an installed PWA. */
export async function asInstalledApp(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const realMatchMedia = window.matchMedia.bind(window);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) =>
        /display-mode:\s*standalone/.test(query)
          ? ({
              matches: true,
              media: query,
              onchange: null,
              addEventListener: () => {},
              removeEventListener: () => {},
              addListener: () => {},
              removeListener: () => {},
              dispatchEvent: () => false,
            } as unknown as MediaQueryList)
          : realMatchMedia(query),
    });
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: true,
    });
  });
}
