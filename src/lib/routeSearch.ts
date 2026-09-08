import type { Coords } from '@/types';
import { SERVICE_AREA_BBOX } from '@/lib/constants';
import {
  isRouteEstimate, matchesTravelBand, ROUTE_CANDIDATE_CAP, ROUTE_RESULT_CAP,
  type BarTravel, type RouteEstimate, type TravelMode, type TravelSearch, type TravelBand,
} from '@/lib/travelTime';

export type RouteDestination = Coords & { id: string };
// NYC service area, not arbitrary worldwide routing through our account.
export function isRoutingCoords(value: unknown): value is Coords {
  if (!value || typeof value !== 'object') return false;
  const c = value as Coords;
  return Number.isFinite(c.lat) && c.lat >= SERVICE_AREA_BBOX.minLat && c.lat <= SERVICE_AREA_BBOX.maxLat &&
    Number.isFinite(c.lng) && c.lng >= SERVICE_AREA_BBOX.minLng && c.lng <= SERVICE_AREA_BBOX.maxLng;
}
export function parseMatrix(value: unknown, count: number): (RouteEstimate | null)[] {
  const data = value as { durations?: unknown[][]; distances?: unknown[][] } | null;
  if (!Array.isArray(data?.durations) || data.durations.length !== 1 ||
      !Array.isArray(data.distances) || data.distances.length !== 1 ||
      !Array.isArray(data.durations[0]) || data.durations[0].length !== count ||
      !Array.isArray(data.distances[0]) || data.distances[0].length !== count) throw new Error('invalid_matrix');
  return data.durations[0].map((seconds, i) => {
    const meters = data.distances![0][i];
    if (seconds === null && meters === null) return null;
    const route = { seconds, meters };
    if (!isRouteEstimate(route)) throw new Error('invalid_matrix');
    return route;
  });
}
async function matrix(origin: Coords, bars: RouteDestination[], mode: TravelMode, key: string, signal: AbortSignal) {
  const profile = mode === 'walking' ? 'foot-walking' : 'driving-car';
  // Fixed host, server-only key; explicit indices avoid an NxN matrix bill.
  const response = await fetch(`https://api.heigit.org/openrouteservice/v2/matrix/${profile}`, {
    method: 'POST', cache: 'no-store', signal,
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [origin, ...bars].map(c => [c.lng, c.lat]),
      sources: ['0'], destinations: bars.map((_, i) => String(i + 1)),
      metrics: ['duration', 'distance'], units: 'm',
    }),
  });
  if (!response.ok) throw new Error('routing_unavailable');
  return parseMatrix(await response.json(), bars.length);
}
/** At most 15 walking + 5 driving elements. No retries or persistent cache. */
export async function searchRoutes(
  origin: Coords, candidates: RouteDestination[], mode: TravelMode,
  walkableOnly: boolean, key: string, signal: AbortSignal,
  band: TravelBand = walkableOnly ? 'walkable' : mode === 'driving' ? 'cab' : 'anywhere',
): Promise<TravelSearch> {
  if (!isRoutingCoords(origin) || candidates.length < 1 || candidates.length > ROUTE_CANDIDATE_CAP ||
      new Set(candidates.map(b => b.id)).size !== candidates.length ||
      candidates.some(b => !isRoutingCoords(b)) || (walkableOnly && mode !== 'walking')) throw new Error('invalid_search');
  const checked: BarTravel[] = [];
  let incomplete = false;
  for (let i = 0; i < candidates.length; i += ROUTE_RESULT_CAP) {
    const batch = candidates.slice(i, i + ROUTE_RESULT_CAP);
    let routes: (RouteEstimate | null)[];
    try {
      routes = await matrix(origin, batch, 'walking', key, signal);
    } catch (error) {
      if (checked.length === 0) throw error;
      incomplete = true;
      break; // Keep earlier confirmed routes; don't retry a failing service.
    }
    checked.push(...batch.map((b, j) => ({
      id: b.id, destination: { lat: b.lat, lng: b.lng }, walking: routes[j], driving: null,
    })));
    const eligible = checked.filter(r => r.walking !== null && matchesTravelBand(origin, r.destination, r.walking, band));
    if (eligible.length >= ROUTE_RESULT_CAP) break;
  }
  // Preserve the input's vibe/taste order within the selected band; never pad.
  const available = checked.filter(r => r.walking !== null && matchesTravelBand(origin, r.destination, r.walking, band));
  const selected = available.slice(0, ROUTE_RESULT_CAP);
  if (selected.length && !incomplete) {
    try {
      const routes = await matrix(origin, selected.map(r => ({ id: r.id, ...r.destination })), 'driving', key, signal);
      selected.forEach((r, i) => { r.driving = routes[i]; });
    } catch {
      // Preserve confirmed primary routes if only the secondary lookup fails.
      incomplete = true;
    }
  }
  return { routes: selected, checked: checked.length, limited: checked.length < candidates.length || candidates.length === ROUTE_CANDIDATE_CAP, incomplete };
}
