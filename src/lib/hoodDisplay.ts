import type { Neighborhood } from '@/types';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';

/**
 * Display names for neighborhoods (operator 2026-07-27: "spell out Lower
 * East Side, Upper West Side, Upper East Side"). Same pattern as
 * tagDisplay (E0.1): the RAW union values ('LES', 'UWS'…) stay the
 * stable data vocabulary — bars-table rows, localStorage, quiz profiles
 * and share URLs never change — and rendering goes through this one
 * lookup. tsc's Record guard proves every neighborhood has a display
 * name; the unit test proves the map tracks the service area.
 */
const HOOD_DISPLAY: Record<Neighborhood, string> = {
  FiDi: 'Financial District',
  LES: 'Lower East Side',
  SoHo: 'SoHo',
  'East Village': 'East Village',
  'West Village': 'West Village',
  Chelsea: 'Chelsea',
  Midtown: 'Midtown',
  "Hell's Kitchen": "Hell's Kitchen",
  UWS: 'Upper West Side',
  UES: 'Upper East Side',
  Harlem: 'Harlem',
  Tribeca: 'Tribeca',
  'Battery Park City': 'Battery Park City',
  'Hamilton Heights': 'Hamilton Heights',
  Flatiron: 'Flatiron',
  Williamsburg: 'Williamsburg',
  Greenpoint: 'Greenpoint',
  Bushwick: 'Bushwick',
  'Park Slope': 'Park Slope',
  'Fort Greene': 'Fort Greene',
  Astoria: 'Astoria',
  LIC: 'Long Island City',
  Ridgewood: 'Ridgewood',
};

/** The one lookup components render a neighborhood through. */
export function displayHood(neighborhood: Neighborhood): string {
  return HOOD_DISPLAY[neighborhood] ?? neighborhood;
}

/** Test seam: every service-area hood must have a display entry. */
export function hoodDisplayCoverage(): {
  missing: string[];
  extra: string[];
} {
  const service = new Set(Object.keys(NEIGHBORHOOD_CENTROIDS));
  const mapped = new Set(Object.keys(HOOD_DISPLAY));
  return {
    missing: [...service].filter((h) => !mapped.has(h)),
    extra: [...mapped].filter((h) => !service.has(h)),
  };
}
