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

/** Make the page report that it is running as an installed app. */
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
