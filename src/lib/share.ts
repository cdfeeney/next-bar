/**
 * Shareable pick cards — blueprint B3 (K-factor loop).
 *
 * A decided group vote (or any bar) gets a share link to /share/[barId]:
 * the recipient sees the pick card + a "get the app" CTA, and the route's
 * own OG image makes the link unfurl as a branded card in iMessage/Slack/X.
 * Real invite attribution lands with D1 — these helpers stay pure.
 */

import type { Bar } from '@/types';

export function buildPickPath(barId: string): string {
  return `/share/${encodeURIComponent(barId)}`;
}

/** Share-sheet text — reads like a friend texting the plan, not an ad. */
export function sharePickText(bar: Bar): string {
  return `Tonight's pick: ${bar.name} (${bar.neighborhood}). Settled on Next Bar.`;
}

/**
 * Profile share path — the ranked list is the loop-STARTING artifact.
 *
 * A pick card ("we're going here") only travels between people already
 * coordinating; a ranked list travels to anyone, because it carries a
 * person's taste rather than one night's logistics. This is the surface
 * a recipient can browse cold.
 */
export function buildProfilePath(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`;
}

/**
 * Share-sheet text for a profile. Leads with the person, not the product —
 * the thing worth opening is whose taste it is.
 */
export function shareProfileText(
  handle: string,
  displayName?: string | null,
): string {
  const who = displayName?.trim() ? displayName.trim() : `@${handle}`;
  return `${who}'s bar list, ranked. On Next Bar.`;
}

/**
 * E4.4: the shared-night link. The shareId is the bearer token minted by
 * share_night — the handle in the path is identity/display, the token is
 * the authorization (DeepSeek review: never make handle+date the key).
 */
export function buildNightPath(handle: string, shareId: string): string {
  return `/u/${encodeURIComponent(handle)}/night/${encodeURIComponent(shareId)}`;
}

/** Share-sheet text for a night. Leads with the night, names the person. */
export function shareNightText(
  handle: string,
  displayName: string | null | undefined,
  stops: number,
): string {
  const who = displayName?.trim() ? displayName.trim() : `@${handle}`;
  const route = stops === 1 ? 'one stop' : `${stops} stops`;
  return `${who}'s night out — ${route}. On Next Bar.`;
}

/**
 * True when a navigator.share rejection means we must NOT fall back to the
 * clipboard. Dismiss ≠ consent: silently writing a link to someone's
 * clipboard after they backed out of the share sheet is a privacy surprise,
 * and this app has already shipped that bug once (audit MED-16).
 *
 * The spec says dismissal is `AbortError`, but browsers deviate and the
 * failure mode of guessing wrong is asymmetric — guess "dismissed" and the
 * user sees nothing happen; guess "failed" and we touch their clipboard
 * uninvited. So `NotAllowedError` counts too:
 *   - Firefox Android has reported cancel as NotAllowedError;
 *   - Chrome throws NotAllowedError when transient user activation is
 *     absent or expired, in which case the clipboard write would very
 *     likely be blocked anyway.
 * Anything else is a genuine share failure and DOES fall through.
 *
 * Duck-typed on `name` rather than `instanceof Error`: DOMException doesn't
 * reliably sit on the realm's Error prototype chain (jsdom, cross-realm).
 */
export function isShareAbort(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('name' in err)) return false;
  const name = (err as { name: unknown }).name;
  return name === 'AbortError' || name === 'NotAllowedError';
}

/**
 * Google Maps search link for a bar — same query shape as ResultCard's
 * mapsHref, so shared-pick recipients land on the exact place card.
 */
export function buildMapsHref(bar: Pick<Bar, 'name' | 'address'>): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${bar.name} ${bar.address}`,
  )}`;
}

/**
 * Text-only share payload for a device-local bar list (g-ac3a291c crit
 * 7/8): a numbered, human-readable list for the native share sheet or
 * clipboard. DELIBERATELY contains no URL of any kind — lists live only
 * on this device, and a link would be a promise the server cannot keep.
 * If public list pages ever ship (server work), the URL joins then.
 */
export function buildListShareText(
  listName: string,
  bars: ReadonlyArray<{ name: string; neighborhood: string }>,
): string {
  const header = `${listName} — my NYC bar list:`;
  if (bars.length === 0) return `${header} (empty so far)`;
  const lines = bars.map(
    (bar, i) => `${i + 1}. ${bar.name} (${bar.neighborhood})`,
  );
  return [header, ...lines].join('\n');
}
