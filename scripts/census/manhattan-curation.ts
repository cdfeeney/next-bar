import { JSDOM } from 'jsdom';
import { normalizeLegacy } from './reconcile';
import type { CuratedCandidate } from './apply';

export interface FivePmBar {
  name: string;
  neighborhood: string;
  address: string;
  category: string;
  website: string | null;
  verifiedHappyHour: boolean;
}

export interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
}

export interface StagingBar {
  id: string;
  name: string;
  neighborhood: string;
  address: string | null;
  lat: number;
  lng: number;
  place_id: string | null;
}

export interface ValidatedPlace {
  source: FivePmBar;
  place: GooglePlace;
}

export interface Rejection {
  name: string;
  address: string;
  reason: string;
}

const HOOD_MAP: Record<string, string> = {
  'Battery Park': 'Battery Park City',
  'Financial District': 'FiDi',
  'Lower East Side': 'LES',
  'Upper East Side': 'UES',
  'Upper West Side': 'UWS',
  'Herald Square': 'Midtown',
  'Hudson Yards': 'Chelsea',
  'Koreatown': 'Midtown',
  'Little Italy': 'Chinatown',
  'Meatpacking District': 'West Village',
  'Midtown East': 'Midtown',
  'Murray Hill': 'Kips Bay',
  'NoLIta': 'SoHo',
  'NoMad': 'Flatiron',
  'Times Square': 'Midtown',
  'Turtle Bay': 'Midtown',
  'Two Bridges': 'LES',
  'Union Square': 'Greenwich Village',
};
const CUSTOMER_FACING_TYPES = new Set([
  'bar', 'bar_and_grill', 'brewpub', 'cafe', 'cocktail_bar', 'coffee_shop',
  'event_venue', 'food', 'hotel', 'live_music_venue', 'lodging', 'lounge_bar',
  'night_club', 'pub', 'restaurant', 'sports_bar', 'wine_bar',
]);

export function parseFivePm(html: string): FivePmBar[] {
  const document = new JSDOM(html).window.document;
  return [...document.querySelectorAll<HTMLElement>('.nb-card')].map((card) => {
    const share = card.querySelector<HTMLButtonElement>('button[data-share]')?.dataset.share;
    if (!share) throw new Error('5PM card is missing data-share');
    const parsed = JSON.parse(share) as { name?: string; neighborhood?: string; address?: string };
    const categoryLine = card.querySelector<HTMLElement>('div[style*="margin-top:2px"]')?.textContent ?? '';
    const website = [...card.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .map((anchor) => anchor.href)
      .find((href) => href.startsWith('http') && !href.includes('google.com/maps')) ?? null;
    if (!parsed.name || !parsed.neighborhood || !parsed.address) {
      throw new Error('5PM card is missing name, neighborhood, or address');
    }
    return {
      name: parsed.name,
      neighborhood: parsed.neighborhood,
      address: parsed.address,
      category: categoryLine.split('·')[0].trim(),
      website,
      verifiedHappyHour: card.dataset.impVer === '1',
    };
  });
}

const tokens = (value: string): Set<string> => new Set(
  normalizeLegacy(value.replace(/[’']s\b/gi, ''))
    .replace(/\bnew york\b|\bnyc\b|\brestaurant\b|\bbar\b/g, '')
    .split(/\s+/)
    .filter(Boolean),
);

function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return overlap / Math.min(left.size, right.size);
}

function normalizeAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(first|1st)\b/g, '1st')
    .replace(/\b(second|2nd)\b/g, '2nd')
    .replace(/\b(third|3rd)\b/g, '3rd')
    .replace(/\b(fourth|4th)\b/g, '4th')
    .replace(/\b(fifth|5th)\b/g, '5th')
    .replace(/\b(sixth|6th)\b/g, '6th')
    .replace(/\b(seventh|7th)\b/g, '7th')
    .replace(/\b(eighth|8th)\b/g, '8th')
    .replace(/\b(ninth|9th)\b/g, '9th')
    .replace(/\b(tenth|10th)\b/g, '10th')
    .replace(/\b(eleventh|11th)\b/g, '11th')
    .replace(/\b(twelfth|12th)\b/g, '12th')
    .replace(/\bwest\b/g, 'w').replace(/\beast\b/g, 'e')
    .replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's')
    .replace(/\bavenue\b/g, 'ave').replace(/\bstreet\b/g, 'st')
    .replace(/\bboulevard\b/g, 'blvd').replace(/\broad\b/g, 'rd')
    .replace(/\blane\b/g, 'ln').replace(/\bplace\b/g, 'pl')
    .replace(/\bjunior\b/g, 'jr').replace(/\bsaint\b/g, 'st')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressMatches(source: FivePmBar, place: GooglePlace): boolean {
  const sourceStreet = normalizeAddress(source.address).split(/\bnew york\b/)[0].trim();
  if (sourceStreet && normalizeAddress(place.formattedAddress ?? '').includes(sourceStreet)) return true;
  const component = (type: string) => place.addressComponents?.find((item) => item.types?.includes(type));
  const number = component('street_number')?.longText;
  const route = component('route');
  if (!number || !route) return false;
  const sourceAddress = ` ${normalizeAddress(source.address)} `;
  const numberMatches = sourceAddress.includes(` ${normalizeAddress(number)} `);
  const routeMatches = [route.longText, route.shortText]
    .filter((value): value is string => Boolean(value))
    .some((value) => sourceAddress.includes(` ${normalizeAddress(value)} `));
  return numberMatches && routeMatches;
}

function isManhattan(place: GooglePlace): boolean {
  return place.addressComponents?.some((component) =>
    component.longText === 'New York County'
    && component.types?.includes('administrative_area_level_2'),
  ) ?? false;
}

function isCustomerFacing(source: FivePmBar, place: GooglePlace): boolean {
  return (place.types ?? []).some((type) => CUSTOMER_FACING_TYPES.has(type))
    || /bar|pub|lounge|club|brew|tavern/i.test(source.category);
}

export function selectPlace(source: FivePmBar, places: readonly GooglePlace[]):
  { place: GooglePlace | null; reason: string | null } {
  const ranked = places
    .filter((place) => place.businessStatus === 'OPERATIONAL')
    .filter(isManhattan)
    .filter((place) => isCustomerFacing(source, place))
    .map((place) => {
      const nameScore = similarity(source.name, place.displayName?.text ?? '');
      return { place, nameScore, addressMatches: addressMatches(source, place) };
    })
    .filter((match) => match.nameScore >= 0.35 && match.addressMatches)
    .sort((a, b) => b.nameScore - a.nameScore);
  if (ranked[0]) return { place: ranked[0].place, reason: null };
  if (places.length === 0) return { place: null, reason: 'Google Places returned no match' };
  if (!places.some((place) => place.businessStatus === 'OPERATIONAL')) {
    return { place: null, reason: 'Google Places does not report an operational business' };
  }
  if (!places.some(isManhattan)) return { place: null, reason: 'Google Places match is not in New York County' };
  return { place: null, reason: 'Google Places identity/type match is ambiguous' };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function tagsFor(source: FivePmBar, place: GooglePlace): string[] {
  const text = `${source.category} ${(place.types ?? []).join(' ')}`.toLowerCase();
  return [
    /pub|tavern|brewpub/.test(text) && 'pub',
    /brew|beer/.test(text) && 'beer',
    /wine/.test(text) && 'wine',
    /cocktail/.test(text) && 'cocktail',
    /night.?club|dance/.test(text) && 'dance',
    /lounge/.test(text) && 'lounge',
    /rooftop/.test(text) && 'rooftop',
    /restaurant/.test(text) && 'restaurant-bar',
  ].filter((tag): tag is string => Boolean(tag));
}

export function reconcilePlaces(input: {
  validated: readonly ValidatedPlace[];
  rejected: readonly Rejection[];
  staging: readonly StagingBar[];
  verifiedDate: string;
}): { curated: CuratedCandidate[]; unchanged: StagingBar[]; rejected: Rejection[] } {
  const stagingPlaces = new Map(input.staging.filter((row) => row.place_id).map((row) => [row.place_id!, row]));
  const seen = new Set<string>();
  const curated: CuratedCandidate[] = [];
  const unchanged: StagingBar[] = [];
  const rejected = [...input.rejected];
  for (const item of input.validated) {
    const { source, place } = item;
    if (seen.has(place.id)) {
      rejected.push({ name: source.name, address: source.address, reason: `duplicate 5PM Google place ID ${place.id}` });
      continue;
    }
    seen.add(place.id);
    const existing = stagingPlaces.get(place.id);
    if (existing) {
      unchanged.push(existing);
      continue;
    }
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    const name = place.displayName?.text;
    const address = place.formattedAddress;
    if (lat === undefined || lng === undefined || !name || !address) {
      rejected.push({ name: source.name, address: source.address, reason: 'Google Places match lacks required discovery fields' });
      continue;
    }
    const neighborhood = HOOD_MAP[source.neighborhood] ?? source.neighborhood;
    curated.push({
      id: slug(`google-${place.id}`),
      externalId: `google:${place.id}`,
      name,
      neighborhood,
      address,
      lat,
      lng,
      priceTier: 2,
      tags: tagsFor(source, place),
      blurb: `${name} is a ${source.category.toLowerCase()} in ${source.neighborhood}.`,
      lastVerified: input.verifiedDate,
      placeId: place.id,
      businessStatus: place.businessStatus ?? 'OPERATIONAL',
    });
  }
  curated.sort((a, b) => a.id.localeCompare(b.id));
  unchanged.sort((a, b) => a.id.localeCompare(b.id));
  rejected.sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
  return { curated, unchanged, rejected };
}
