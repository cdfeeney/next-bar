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

/** How long we wait for the SDK SCRIPT before giving up and degrading to the glyph. */
export const SDK_LOAD_TIMEOUT_MS = 5_000;

/**
 * How long we wait for a mounted widget to fire `gmp-load`.
 *
 * Deliberately its own constant: this bounds a different wait from the script
 * load above, and reusing one value stacked them into a ~10s worst case before
 * the user saw a fallback.
 */
export const WIDGET_LOAD_TIMEOUT_MS = 4_000;

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

/**
 * Total widget creations — the number that actually maps to the invoice.
 *
 * Kept separate from the distinct-id count because Google bills per widget
 * creation, not per distinct place. Two cards sharing one googlePlaceId (exactly
 * the Fleming's/Dominie's collision migration 0028 resolves) bill TWICE while
 * `requested.size` counts one, so reporting only the set size would silently
 * undercount real spend.
 */
let billableEvents = 0;

export function markRequested(placeId: string): void {
  requested.add(placeId);
  billableEvents += 1;
}

export function hasRequested(placeId: string): boolean {
  return requested.has(placeId);
}

/** Distinct place_ids this session. Diagnostic — NOT the billing number. */
export function requestedCount(): number {
  return requested.size;
}

/** Widget creations this session. THIS is what the invoice will reflect. */
export function billableEventCount(): number {
  return billableEvents;
}

/**
 * Test seam only: the real retained state, so a test can assert we hold nothing
 * but place_id strings rather than inspecting a locally-built array.
 */
export function __retainedForTests(): readonly unknown[] {
  return [...requested];
}

/** Test seam only. */
export function __resetRequested(): void {
  requested.clear();
  billableEvents = 0;
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

  // A FAILED load must not be memoized.
  //
  // Found by santa-loop review: the 5s timeout and the script's success
  // callback race to settle the SAME module-level promise. If the timer won on a
  // transient slow network, `loadPromise` was permanently `false` — the script's
  // later `resolve(true)` is a silent no-op on a settled promise — so every
  // GooglePlacePhoto for the rest of the session got the stale `false` and
  // rendered a glyph forever, even though `window.google.maps` was in fact
  // available. One network blip killed Google photos for the whole session with
  // no retry path.
  //
  // Clearing the memo on failure happens in a `.then`, i.e. after the assignment
  // below, so the synchronous unconfigured path cannot null it out before it is
  // set. Two synchronous callers still share one promise (single-flight holds);
  // only a LATER call retries.
  const pending = buildLoad().then((ok) => {
    if (!ok) loadPromise = null;
    return ok;
  });
  loadPromise = pending;

  // Return the local, not the field: the `.then` above may null the field before
  // this returns, and TypeScript is right to widen it to `| null`.
  return pending;
}

function buildLoad(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
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

    // On timeout, look before giving up: the script may have landed without the
    // callback having run yet. Combined with the failure not being memoized,
    // this means a slow network degrades one card rather than the session.
    const timer = window.setTimeout(() => {
      const late = (window as unknown as { google?: MapsGlobal }).google;
      if (late?.maps?.importLibrary) {
        late.maps
          .importLibrary('places')
          .then(() => resolve(true))
          .catch(() => resolve(false));
        return;
      }
      resolve(false);
    }, SDK_LOAD_TIMEOUT_MS);

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
}

/** Test seam only — lets a spec re-exercise the load path. */
export function __resetLoader(): void {
  loadPromise = null;
}
