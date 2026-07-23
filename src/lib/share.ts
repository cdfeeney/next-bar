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
 * True when a navigator.share rejection means the user dismissed the sheet
 * (AbortError). Dismiss ≠ consent — callers must NOT fall back to the
 * clipboard on a dismissal, only on genuine share failures.
 *
 * Duck-typed on `name` rather than `instanceof Error`: DOMException doesn't
 * reliably sit on the realm's Error prototype chain (jsdom, cross-realm).
 */
export function isShareAbort(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'AbortError'
  );
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
