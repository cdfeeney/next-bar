import type { Coords, Neighborhood } from '@/types';
import { haversineMiles } from '@/lib/distance';
import {
  SERVICE_AREA_BBOX,
  MAX_SNAP_MILES,
  NEIGHBORHOOD_CENTROIDS,
} from '@/lib/constants';

/** True when a coord falls inside the served area (Manhattan + Brooklyn). */
export function isInServiceArea(c: Coords): boolean {
  return (
    c.lat >= SERVICE_AREA_BBOX.minLat &&
    c.lat <= SERVICE_AREA_BBOX.maxLat &&
    c.lng >= SERVICE_AREA_BBOX.minLng &&
    c.lng <= SERVICE_AREA_BBOX.maxLng
  );
}

/** @deprecated Use `isInServiceArea`. */
export const isInsideManhattan = isInServiceArea;

export type CentroidSnap = {
  neighborhood: Neighborhood;
  centroid: Coords;
  miles: number;
};

export function snapToNeighborhoodCentroid(c: Coords): CentroidSnap | null {
  if (!isInServiceArea(c)) return null;

  let best: CentroidSnap | null = null;
  for (const key of Object.keys(NEIGHBORHOOD_CENTROIDS) as Neighborhood[]) {
    const centroid = NEIGHBORHOOD_CENTROIDS[key];
    const miles = haversineMiles(c, centroid);
    if (best === null || miles < best.miles) {
      best = { neighborhood: key, centroid, miles };
    }
  }

  if (best === null || best.miles > MAX_SNAP_MILES) return null;
  return best;
}
