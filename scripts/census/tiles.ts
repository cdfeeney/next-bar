/**
 * Coverage tiles per borough. Centroids/radii ported from the legacy
 * ingest-bars AREAS list; a tile key is `${borough}/${neighborhood}` so
 * geo providers (Google, OSM) share the same unit grain and the runner's
 * per-run dedup collapses venues that appear in both.
 */

export interface Tile {
  neighborhood: string;
  lat: number;
  lng: number;
  radius: number;
}

export const BOROUGH_TILES: Record<string, Tile[]> = {
  manhattan: [
    { neighborhood: 'LES', lat: 40.717, lng: -73.987, radius: 700 },
    { neighborhood: 'East Village', lat: 40.727, lng: -73.984, radius: 700 },
    { neighborhood: 'West Village', lat: 40.735, lng: -74.003, radius: 700 },
    { neighborhood: 'Chelsea', lat: 40.747, lng: -74.001, radius: 800 },
    { neighborhood: 'Midtown', lat: 40.755, lng: -73.984, radius: 800 },
    { neighborhood: 'FiDi', lat: 40.706, lng: -74.009, radius: 800 },
    { neighborhood: 'UWS', lat: 40.787, lng: -73.975, radius: 900 },
    { neighborhood: 'UES', lat: 40.774, lng: -73.961, radius: 900 },
  ],
  brooklyn: [
    { neighborhood: 'Williamsburg', lat: 40.714, lng: -73.957, radius: 1000 },
    { neighborhood: 'Greenpoint', lat: 40.73, lng: -73.951, radius: 900 },
    { neighborhood: 'Bushwick', lat: 40.694, lng: -73.921, radius: 1100 },
    { neighborhood: 'Park Slope', lat: 40.672, lng: -73.979, radius: 1000 },
  ],
};

export function tileUnits(borough: string): string[] {
  const tiles = BOROUGH_TILES[borough.toLowerCase()] ?? [];
  return tiles.map((t) => `${borough.toLowerCase()}/${t.neighborhood}`);
}

export function tileForUnit(unit: string): Tile | null {
  const [borough, neighborhood] = unit.split('/');
  const tiles = BOROUGH_TILES[borough?.toLowerCase() ?? ''] ?? [];
  return tiles.find((t) => t.neighborhood === neighborhood) ?? null;
}

export function neighborhoodOfUnit(unit: string): string {
  const parts = unit.split('/');
  return parts[1] ?? parts[0];
}
