/**
 * geo.ts — deterministic geolocation control for e2e.
 *
 * The home screen ("/") is location-first: it auto-locates on open and only
 * falls back to the manual "pick a bar" flow when it CAN'T locate the user.
 * Tests that exercise the manual flow must therefore force a denial rather than
 * rely on headless-browser default behavior (which varies by engine/timing).
 */

import type { BrowserContext } from '@playwright/test';

/**
 * Force navigator.geolocation to immediately report PERMISSION_DENIED and
 * the Permissions API to report 'denied' — matching real Safari AFTER a
 * user has tapped "Don't Allow" (the permission-primed home flow routes
 * denied straight to the manual picker, no primer).
 */
export async function denyGeolocation(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const permissions = navigator.permissions;
    if (permissions && typeof permissions.query === 'function') {
      const originalQuery = permissions.query.bind(permissions);
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: {
          query: (descriptor: PermissionDescriptor) =>
            descriptor?.name === 'geolocation'
              ? Promise.resolve({
                  state: 'denied',
                  addEventListener: () => {},
                  removeEventListener: () => {},
                } as unknown as PermissionStatus)
              : originalQuery(descriptor),
        },
      });
    }
    const fail = (_ok: PositionCallback, err?: PositionErrorCallback) => {
      err?.({
        code: 1,
        message: 'User denied Geolocation',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: fail,
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    });
  });
}

/** Grant + set a precise fix so the location-first flow auto-suggests. */
export async function grantGeolocation(
  context: BrowserContext,
  coords: { latitude: number; longitude: number; accuracy?: number },
): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ accuracy: 20, ...coords });
}
