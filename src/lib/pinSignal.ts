'use client';

/**
 * pinSignal — session-scoped shared truth for "which bar is MY pin at"
 * (g-31f36bf8 round-1 review HIGH, Fable lane): multiple ImHereButtons
 * render at once (one per result card), and per-button local state let
 * two cards both read "Pinned" even though the server enforces one pin
 * per user/night. Every pin surface writes this store; every button
 * subscribes, so the session-wide UI always agrees with the last known
 * server truth.
 *
 * Deliberately NOT persisted: server reads re-seed it, and a stale
 * cross-tab value would be worse than an empty one.
 *
 * LIFECYCLE (round-2 review HIGHs, Fable lane): the store is wiped by
 * resetSessionPin(), which accountCache's clearAccountCache /
 * clearResidualAccountCache call on sign-out and account switch — a
 * module-level variable outliving the account that wrote it is exactly
 * the cross-account leak class accountCache.ts exists to prevent. And
 * it is SEEDED from server truth by useSessionPinSeed (mounted by
 * ImHereButton), not only by /friends happening to mount first.
 */

type Listener = () => void;

let pinnedBarId: string | null = null;
/** De-dup key for the once-per-(user, epoch, night) server seed. */
let seededForKey: string | null = null;
/** Bumped on every actual store change: an async writer captures it
 * before its await and refuses to clobber anything newer (round-3
 * review, Codex lane: a delayed seed snapshot must not overwrite a pin
 * the user just moved). */
let revision = 0;
const listeners = new Set<Listener>();

export function getSessionPinnedBarId(): string | null {
  return pinnedBarId;
}

/** Server snapshot for SSR/hydration — no pin known before a fetch. */
export function getServerPinnedBarId(): string | null {
  return null;
}

export function setSessionPinnedBarId(barId: string | null): void {
  // EVERY authoritative write advances the revision — even a same-value
  // one (round-3 scoped review, Codex lane: the user re-pinning the bar
  // the store already shows is still a user action, and a delayed seed
  // snapshot must not outrank it). Listeners are only notified on an
  // actual change, so render churn stays zero.
  revision += 1;
  if (pinnedBarId === barId) return;
  pinnedBarId = barId;
  for (const listener of listeners) listener();
}

/** Monotonic change counter — see the `revision` comment above. */
export function getSessionPinRevision(): number {
  return revision;
}

export function subscribeSessionPin(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Full wipe: forget the pinned bar AND the seed latch. Called from
 * accountCache on sign-out/account-switch so the next session re-seeds
 * from ITS OWN server truth.
 */
export function resetSessionPin(): void {
  seededForKey = null;
  setSessionPinnedBarId(null);
}

/** Claim the seed slot for a (user, epoch, night) key. Returns false when
 * that exact key already seeded (or is in flight). */
export function claimSessionPinSeed(key: string): boolean {
  if (seededForKey === key) return false;
  seededForKey = key;
  return true;
}

/** Release a claimed seed slot after a FAILED fetch so a later mount can
 * retry; no-op if another claim superseded this one. */
export function releaseSessionPinSeed(key: string): void {
  if (seededForKey === key) seededForKey = null;
}

/** True when `key` still owns the seed slot (no reset/supersede since). */
export function isSessionPinSeedCurrent(key: string): boolean {
  return seededForKey === key;
}
