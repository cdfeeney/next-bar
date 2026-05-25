import type { Coords, ManhattanNeighborhood } from '@/types';
import { haversineMiles } from '@/lib/distance';
import {
  MANHATTAN_BBOX,
  MAX_SNAP_MILES,
  NEIGHBORHOOD_CENTROIDS,
} from '@/lib/constants';

export function isInsideManhattan(c: Coords): boolean {
  return (
    c.lat >= MANHATTAN_BBOX.minLat &&
    c.lat <= MANHATTAN_BBOX.maxLat &&
    c.lng >= MANHATTAN_BBOX.minLng &&
    c.lng <= MANHATTAN_BBOX.maxLng
  );
}

export type CentroidSnap = {
  neighborhood: ManhattanNeighborhood;
  centroid: Coords;
  miles: number;
};

export function snapToNeighborhoodCentroid(c: Coords): CentroidSnap | null {
  if (!isInsideManhattan(c)) return null;

  let best: CentroidSnap | null = null;
  for (const key of Object.keys(NEIGHBORHOOD_CENTROIDS) as ManhattanNeighborhood[]) {
    const centroid = NEIGHBORHOOD_CENTROIDS[key];
    const miles = haversineMiles(c, centroid);
    if (best === null || miles < best.miles) {
      best = { neighborhood: key, centroid, miles };
    }
  }

  if (best === null || best.miles > MAX_SNAP_MILES) return null;
  return best;
}
