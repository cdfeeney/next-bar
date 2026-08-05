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
 * Simulate the iOS Capacitor shell. Critically it leaves the PWA signals
 * FALSE: `navigator.standalone` is Safari-only and is not set in a WKWebView,
 * and under the current internal build (architecture "A" in
 * docs/TESTFLIGHT-ARCH-DECISION-g-39169b3b — a remote `server.url` shell the
 * ADR rejects for release in favour of "C") display-mode reports `browser`.
 * Any test that also forced the PWA signals would still pass with the
 * Capacitor branch deleted, which is exactly the gap this closes (santa
 * round-2, both lanes).
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
