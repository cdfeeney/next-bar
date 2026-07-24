import type { Bar } from '@/types';
import { coreBars } from './bars.core';
import { extraBars } from './bars.extra';
import { expansionBars } from './bars.expansion';
import { expansion2Bars } from './bars.expansion2';
import { expansion3Bars } from './bars.expansion3';
import { expansion4Bars } from './bars.expansion4';
import { expansion5Bars } from './bars.expansion5';

/**
 * Sidecar-free catalog view for EDGE bundles (the share OG card).
 *
 * The merged catalog in bars.ts applies the generated Places sidecar
 * (bars.places.ts — hours/reviews/photo metadata, ~550KB and growing with
 * every catalog pass). Edge functions have a 1MB bundle limit, and the
 * 2026-07-24 expansion pushed the share card's merged import to 1.03MB —
 * blocking ALL deploys (Vercel keeps prod on last-good). The card only
 * renders curated fields (name / neighborhood / priceTier), so it reads
 * this slim view instead.
 *
 * NEVER import bars.ts, catalog.ts, or bars.places.ts from an edge
 * module — that re-bundles the sidecar. New expansion files must be added
 * here AND in bars.ts (tsc can't catch a missing spread; the bars.test.ts
 * count guard cross-checks the two).
 */

const rawBars: Bar[] = [
  ...coreBars,
  ...extraBars,
  ...expansionBars,
  ...expansion2Bars,
  ...expansion3Bars,
  ...expansion4Bars,
  ...expansion5Bars,
];

/** Curated share-card fields for one bar, or null when the id is unknown. */
export function getBarCard(
  barId: string,
): Pick<Bar, 'name' | 'neighborhood' | 'priceTier'> | null {
  const bar = rawBars.find((b) => b.id === barId);
  if (!bar) return null;
  return {
    name: bar.name,
    neighborhood: bar.neighborhood,
    priceTier: bar.priceTier,
  };
}

/** Raw (un-overlaid) catalog size — used by bars.test.ts to guarantee the
 * slim view and bars.ts merge the same expansion files. */
export const rawBarCount = rawBars.length;
