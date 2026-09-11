import type { Coords } from '@/types';
import { RADIUS_CAB, SERVICE_AREA_BBOX } from '@/lib/constants';
import { haversineMiles } from '@/lib/distance';

export type TravelMode = 'walking' | 'driving';
export type TravelBand = 'walkable' | 'cab' | 'anywhere' | 'nearby';
export type RouteEstimate = { seconds: number; meters: number };
export type BarTravel = {
  id: string;
  destination: Coords;
  walking: RouteEstimate | null;
  driving: RouteEstimate | null;
};
export type TravelSearch = {
  routes: BarTravel[];
  checked: number;
  limited: boolean;
  incomplete: boolean;
};
export const WALKABLE_SECONDS = 900;
export const ROUTE_CANDIDATE_CAP = 15;
export const ROUTE_RESULT_CAP = 5;

export function isRouteEstimate(value: unknown): value is RouteEstimate {
  if (!value || typeof value !== 'object') return false;
  const r = value as RouteEstimate;
  return Number.isFinite(r.seconds) && r.seconds >= 0 && Number.isFinite(r.meters) && r.meters >= 0;
}
export function isWalkable(route: RouteEstimate | null | undefined): boolean {
  return isRouteEstimate(route) && route.seconds <= WALKABLE_SECONDS;
}
/** Unknown walking routes cannot establish membership in either inner band. */
export function matchesTravelBand(origin: Coords, destination: Coords, walking: RouteEstimate | null | undefined, band: TravelBand): boolean {
  if (band === 'nearby') return true;
  if (!(destination.lat >= SERVICE_AREA_BBOX.minLat && destination.lat <= SERVICE_AREA_BBOX.maxLat &&
        destination.lng >= SERVICE_AREA_BBOX.minLng && destination.lng <= SERVICE_AREA_BBOX.maxLng)) return false;
  const miles = haversineMiles(origin, destination);
  if (band === 'anywhere') return miles > RADIUS_CAB;
  return miles <= RADIUS_CAB && isRouteEstimate(walking) &&
    (band === 'walkable' ? isWalkable(walking) : !isWalkable(walking));
}
export function routeCopy(route: RouteEstimate | null | undefined, mode: TravelMode): string {
  const label = mode === 'walking' ? 'Walk' : 'Drive';
  if (!isRouteEstimate(route)) return `${label} time unavailable`;
  // Round up so a 901-second walk never displays as a 15-minute walk.
  return `${label} ~${Math.max(1, Math.ceil(route.seconds / 60))} min · ${(route.meters / 1609.344).toFixed(1)} mi`;
}
/** Private directions only. Public share links deliberately do not call this. */
export function directionsHref(origin: Coords | undefined, destination: Coords, mode: TravelMode): string {
  const params = new URLSearchParams({ api: '1', destination: `${destination.lat},${destination.lng}`, travelmode: mode });
  if (origin) params.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params}`;
}
