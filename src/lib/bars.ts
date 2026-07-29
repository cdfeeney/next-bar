import type { Bar, PlacePatch } from '@/types';
import { coreBars } from './bars.core';
import { extraBars } from './bars.extra';
import { expansionBars } from './bars.expansion';
import { expansion2Bars } from './bars.expansion2';
import { expansion3Bars } from './bars.expansion3';
import { expansion4Bars } from './bars.expansion4';
import { expansion5Bars } from './bars.expansion5';
import { expansion6Bars } from './bars.expansion6';
import { placesData } from './bars.places';

// IMPORTANT: lastVerified dates below are PLACEHOLDERS so all bars pass the
// 180-day hard filter and the app remains functional. Hours/specials/blurbs
// have NOT been personally verified within the v0.2 schema. Real curation
// (call/visit/site-check each bar) is tracked as PRD risk R4 and must happen
// before any public launch where the app makes factual claims about named
// businesses. Update lastVerified per-bar as each is verified.


// Core Manhattan set + the curated Manhattan-depth/Brooklyn expansion.
// Overlay the Google Places refresh data (coords / hours / status) onto the
// curated catalog by id.
//
// WRONG-VENUE GUARD — MOVED TO GENERATION TIME, 2026-07-29.
//
// The 2026-07-23 refresh matched a same-named bar in Nassau County and dragged
// its coords in. The guard here rejected any patch whose coordinates landed
// outside the service area, on the reasoning that a wrong-venue match poisons
// everything in the patch — hours and photos belong to that other place too.
//
// The patch no longer carries coordinates, so the check cannot run here. Google
// permits caching lat/lng for at most 30 consecutive days, and this sidecar is a
// generated file committed to git and shipped to every client, so storing them
// was non-compliant by construction; coordinates now come from OpenStreetMap
// (migrations 0029-0032) via the curated catalog below.
//
// The check moved to scripts/refresh-places.mjs, where an out-of-area match is
// discarded BEFORE being written. That is strictly stronger than filtering on
// read: the bad data never ships at all. Verified safe to remove — at the time
// of the change 0 of 433 sidecar entries were outside the service area, so the
// runtime guard was rejecting nothing and no patch newly applies as a result.
//
// SERVICE_AREA_BBOX is mirrored into that script (it is plain .mjs and cannot
// import TypeScript); bars.test.ts asserts the two copies agree.

// Exported for bars.test.ts.
export function applyPlaces(
  list: Bar[],
  patches: Record<string, PlacePatch> = placesData,
): Bar[] {
  return list.map((b) => {
    const p = patches[b.id];
    if (!p) return b;
    return {
      ...b,
      googlePlaceId: p.googlePlaceId ?? b.googlePlaceId,
      businessStatus: p.businessStatus ?? b.businessStatus,
      hours: p.hours ?? b.hours,
      // Photo data rides the same patch. It used to be dropped together with
      // out-of-area coordinates by the runtime guard; that rejection now happens
      // at generation time, so a patch reaching here is already trusted.
      photoRef: p.photoRef ?? b.photoRef,
      photoAttribution: p.photoAttribution ?? b.photoAttribution,
      photoCount: p.photoCount ?? b.photoCount,
      photoAttributions: p.photoAttributions ?? b.photoAttributions,
      // `reviews` is deliberately NOT merged. Google review text and author
      // names are not ours to store, and this merge was the route by which
      // sidecar reviews reached BarLightbox even after the DB column was
      // purged. Removed 2026-07-28 along with the data itself.
    };
  });
}

export const bars: Bar[] = applyPlaces([
  ...coreBars,
  ...extraBars,
  ...expansionBars,
  ...expansion2Bars,
  ...expansion3Bars,
  ...expansion4Bars,
  ...expansion5Bars,
  ...expansion6Bars,
]);
