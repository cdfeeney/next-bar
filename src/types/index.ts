export type Coords = { lat: number; lng: number };

export type ManhattanNeighborhood =
  | 'FiDi'
  | 'LES'
  | 'East Village'
  | 'West Village'
  | 'Chelsea'
  | 'Midtown'
  | 'UWS'
  | 'UES';

export type VibeTag =
  | 'dive' | 'cocktail' | 'wine' | 'beer' | 'dance' | 'lounge' | 'speakeasy' | 'pub' | 'rooftop' | 'garden'
  | 'chill' | 'buzzy' | 'loud'
  | 'locals' | 'post-work' | 'date' | 'tourist' | 'industry'
  | 'rough' | 'polished' | 'romantic' | 'instagrammable' | 'old-nyc' | 'trendy'
  | 'indie' | 'hiphop' | 'house' | 'jazz' | 'live'
  | 'cheap' | 'mid' | 'pricey' | 'splurge';

export type VibeProfile = {
  tags: VibeTag[];
  archetype: string;
  preferredNeighborhoods: ManhattanNeighborhood[];
};

export type Bar = {
  id: string;
  name: string;
  neighborhood: ManhattanNeighborhood;
  address: string;
  lat: number;
  lng: number;
  priceTier: 1 | 2 | 3 | 4;
  tags: VibeTag[];
  blurb: string;
  igHandle?: string;
  lastVerified: string;
};

export type Radius =
  | { kind: 'walking';   maxMiles: 1 }
  | { kind: 'shortUber'; maxMiles: 3 }
  | { kind: 'anywhere';  maxMiles: null };

export type SearchMode = 'quiz' | 'whereNext';

export type AccuracyBand = 'precise' | 'coarse' | 'snapped' | 'unknown';

export type GeoState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'granted_precise';  coords: Coords; accuracyMeters: number }
  | { status: 'granted_coarse';   coords: Coords; accuracyMeters: number }
  | { status: 'granted_snapped';  coords: Coords; accuracyMeters: number; snappedTo: ManhattanNeighborhood }
  | { status: 'denied' }
  | { status: 'unavailable' };
