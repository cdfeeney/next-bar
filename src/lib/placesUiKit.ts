/**
 * The ONLY module in this codebase that knows the Google Maps JS SDK exists.
 *
 * `mediaPolicy.resolveMedia` stays a pure function returning
 * `{ source: 'google-live', placeId }`. It never imports this file. Keeping the
 * SDK behind one seam is what lets excluded surfaces (pickers, saved lists,
 * recaps, dense maps, markers — see NO_GOOGLE_MEDIA) be guaranteed non-billing:
 * if they never render <GooglePlacePhoto>, this module is never imported, the
 * script tag is never injected, and no billable event can occur.
 *
 * Billing model (verified from Google's pricing docs, 2026-07-29): Places UI Kit
 * Query bills ONE event per component request at $1.00/1,000 with 10,000
 * events/month free, REGARDLESS of how much content the component renders.
 * Trimming a card to photos-only does not make it cheaper. Only issuing fewer
 * requests does.
 *
 * Nothing Google returns is ever stored. Google's Places policy exempts
 * `place_id` from its caching restrictions and permits essentially nothing else,
 * so the only value this module retains is `place_id` itself.
 */

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/** How long we wait for the SDK before giving up and degrading to the glyph. */
export const SDK_LOAD_TIMEOUT_MS = 5_000;

/**
 * True only when a key is actually configured.
 *
 * Fail-closed like the media flags: absent config must never attempt a billable
 * request. Without this, a deploy missing the key would inject a script tag that
 * 403s on every card.
 */
export function isPlacesUiKitConfigured(): boolean {
  return typeof API_KEY === 'string' && API_KEY.length > 0;
}

/**
 * Distinct place_ids this browsing session has already issued a request for.
 *
 * This is a METER, not a cache — and the distinction matters, because both
 * routed reviewers recommended "a cache keyed on placeId" and reading that as
 * caching image data would recreate the exact violation we are migrating away
 * from (public/bar-photos/). We record THAT we asked, never WHAT came back.
 *
 * It also does not, by itself, prevent a second bill: if a card unmounts and
 * remounts, the widget must fetch again to have anything to show. The way to
 * avoid re-billing is to not unmount (see GooglePlacePhoto's keep-mounted
 * behaviour); this set is what makes the cost observable, and what suppresses
 * React StrictMode's development double-invoke.
 */
const requested = new Set<string>();

export function markRequested(placeId: string): void {
  requested.add(placeId);
}

export function hasRequested(placeId: string): boolean {
  return requested.has(placeId);
}

/** Distinct billable place_ids this session — the number a cost meter reports. */
export function requestedCount(): number {
  return requested.size;
}

/** Test seam only. */
export function __resetRequested(): void {
  requested.clear();
}

type MapsGlobal = {
  maps?: { importLibrary?: (name: string) => Promise<unknown> };
};

let loadPromise: Promise<boolean> | null = null;

/**
 * Inject the Maps JS bootstrap once and import the `places` library.
 *
 * Resolves `false` rather than throwing on every failure path — a missing key,
 * a blocked script (ad-blockers routinely block Google domains), or a timeout.
 * Callers degrade to the glyph; a photo tile is never worth an error boundary.
 */
export function loadPlacesUiKit(): Promise<boolean> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined' || !isPlacesUiKitConfigured()) {
      resolve(false);
      return;
    }

    const existing = (window as unknown as { google?: MapsGlobal }).google;
    if (existing?.maps?.importLibrary) {
      existing.maps
        .importLibrary('places')
        .then(() => resolve(true))
        .catch(() => resolve(false));
      return;
    }

    const timer = window.setTimeout(() => resolve(false), SDK_LOAD_TIMEOUT_MS);

    const script = document.createElement('script');
    script.async = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY!)}` +
      `&libraries=places&loading=async&callback=__nextBarMapsReady`;

    (window as unknown as Record<string, unknown>).__nextBarMapsReady = () => {
      window.clearTimeout(timer);
      const g = (window as unknown as { google?: MapsGlobal }).google;
      if (!g?.maps?.importLibrary) {
        resolve(false);
        return;
      }
      g.maps
        .importLibrary('places')
        .then(() => resolve(true))
        .catch(() => resolve(false));
    };

    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}

/** Test seam only — lets a spec re-exercise the load path. */
export function __resetLoader(): void {
  loadPromise = null;
}
