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
 * Its own constant because it bounds a different wait from the script load
 * above. Note the two are still SEQUENTIAL — SDK load, then widget load — so the
 * worst case remains additive (~10s including the grace window), not 4s. An
 * earlier comment here claimed this split "fixed" the stacked worst case; it
 * does not, it only trims it, and santa-loop review rightly called that out.
 * Making the waits concurrent would be a real fix and is not attempted here.
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

/** Marks the one script tag we ever inject, so a retry can find it. */
const SCRIPT_MARKER = 'data-nextbar-maps';

/** How long past the load deadline we keep watching for a late arrival. */
export const SDK_LOAD_GRACE_MS = 1_000;

/** Poll interval while waiting for `window.google.maps` to appear. */
const POLL_MS = 100;

/**
 * Bound on `importLibrary('places')` itself, separate from waiting for the SDK
 * to appear. Without it that call can hang indefinitely (santa-loop round 3).
 */
export const IMPORT_TIMEOUT_MS = 5_000;

/**
 * The worst case for a single load attempt: wait for the SDK, plus the grace
 * window, plus the bounded library import. Exported so callers can arm their own
 * safety timer against a real number instead of guessing.
 */
export const MAX_LOAD_MS = SDK_LOAD_TIMEOUT_MS + SDK_LOAD_GRACE_MS + IMPORT_TIMEOUT_MS;

/**
 * Attempt a load. Never injects more than one script tag, ever.
 *
 * Rewritten after santa-loop round 2, where both reviewers independently found
 * the same three defects in the callback-based version:
 *
 *   - **Duplicate script injection.** Retry only checked
 *     `window.google.maps.importLibrary`, never whether a script was already
 *     in flight, so a retry during a merely-slow (not failed) load appended a
 *     second tag. Under a blocked domain these accumulated with every card.
 *   - **Cross-attempt callback coupling.** `window.__nextBarMapsReady` was
 *     overwritten on every attempt, so a late script from attempt N invoked
 *     attempt N+1's callback and cleared its timer — shared mutable state
 *     spanning independent attempts.
 *   - **Post-timeout arrival discarded.** The deadline sampled `window.google`
 *     at exactly one instant; a script landing a millisecond later was thrown
 *     away.
 *
 * Polling for the SDK removes all three: readiness is observed rather than
 * signalled, so there is no global callback to collide, and a grace window
 * catches a late arrival instead of discarding it.
 */
function buildLoad(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined' || !isPlacesUiKitConfigured()) {
      resolve(false);
      return;
    }

    let settled = false;
    let timer: number | undefined;
    let importTimer: number | undefined;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearTimeout(importTimer);
      resolve(ok);
    };

    /**
     * True once the SDK is present and the `places` import has been STARTED.
     *
     * The import is bounded. Polling only ever waited for `importLibrary` to
     * EXIST; once it did, this handed off to a promise with no timeout of its
     * own, and the poll loop returned without re-arming anything. A partial CDN
     * failure — main script served, library fetch stalls — therefore left this
     * promise permanently unsettled, and because GooglePlacePhoto arms its own
     * safety timer only AFTER awaiting us, the card sat on 'pending' forever
     * with neither photo nor fallback. Found in santa-loop round 3 and
     * reproduced with a probe that advanced 60s without the promise settling.
     */
    const useSdkIfReady = (): boolean => {
      const g = (window as unknown as { google?: MapsGlobal }).google;
      if (!g?.maps?.importLibrary) return false;

      importTimer = window.setTimeout(() => finish(false), IMPORT_TIMEOUT_MS);
      g.maps
        .importLibrary('places')
        .then(() => finish(true))
        .catch(() => finish(false));
      return true;
    };

    if (useSdkIfReady()) return;

    const deadline = Date.now() + SDK_LOAD_TIMEOUT_MS + SDK_LOAD_GRACE_MS;
    const poll = () => {
      if (settled) return;
      if (useSdkIfReady()) return;
      if (Date.now() >= deadline) {
        finish(false);
        return;
      }
      timer = window.setTimeout(poll, POLL_MS);
    };
    timer = window.setTimeout(poll, POLL_MS);

    // Exactly one script tag for the lifetime of the page. A retry after a
    // failed attempt reuses the in-flight tag and simply keeps polling.
    if (document.querySelector(`script[${SCRIPT_MARKER}]`) === null) {
      const script = document.createElement('script');
      script.async = true;
      script.setAttribute(SCRIPT_MARKER, '');
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY!)}` +
        `&libraries=places&loading=async`;

      // A hard network error is definitive — fail now rather than polling out
      // the full deadline. The tag is removed so a later retry may try again.
      script.onerror = () => {
        script.remove();
        finish(false);
      };

      document.head.appendChild(script);
    }
  });
}

/** Test seam only — lets a spec re-exercise the load path. */
export function __resetLoader(): void {
  loadPromise = null;
}
