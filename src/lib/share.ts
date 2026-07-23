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
