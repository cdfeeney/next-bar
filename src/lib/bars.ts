import type { Bar, PlacePatch } from '@/types';
import { SERVICE_AREA_BBOX } from './constants';
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
// WRONG-VENUE GUARD: the 2026-07-23 refresh matched a same-named bar in
// Nassau County and dragged its coords in (caught by bars.test.ts's bbox
// integrity check). A patch whose coords land OUTSIDE the service area was
// resolved against the wrong venue, so NOTHING in it can be trusted —
// hours and status belong to that other place too. Skip the whole patch
// and keep the curated data; the B5c identity pass re-resolves these.
function isInsideServiceArea(lat: number, lng: number): boolean {
  const box = SERVICE_AREA_BBOX;
  return (
    lat >= box.minLat && lat <= box.maxLat &&
    lng >= box.minLng && lng <= box.maxLng
  );
}

// Exported for bars.test.ts — the guard's all-or-nothing contract (photo +
// review fields must be dropped together with rejected coords) is unit-tested
// with injected patches; production always uses the placesData default.
export function applyPlaces(
  list: Bar[],
  patches: Record<string, PlacePatch> = placesData,
): Bar[] {
  return list.map((b) => {
    const p = patches[b.id];
    if (!p) return b;
    if (p.lat != null && p.lng != null && !isInsideServiceArea(p.lat, p.lng)) {
      return b; // wrong-venue match — reject the entire patch
    }
    return {
      ...b,
      ...(p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : {}),
      googlePlaceId: p.googlePlaceId ?? b.googlePlaceId,
      businessStatus: p.businessStatus ?? b.businessStatus,
      hours: p.hours ?? b.hours,
      // Photo + review data rides the same patch so the wrong-venue guard
      // above drops it together with the untrusted coords/hours.
      photoRef: p.photoRef ?? b.photoRef,
      photoAttribution: p.photoAttribution ?? b.photoAttribution,
      photoCount: p.photoCount ?? b.photoCount,
      photoAttributions: p.photoAttributions ?? b.photoAttributions,
      reviews: p.reviews ?? b.reviews,
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
