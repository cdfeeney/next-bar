/**
 * Strict runtime schema for the `vibe_profile` jsonb column (Item 9).
 *
 * The previous guard only measured SERIALIZED SIZE: anything under 2,000
 * characters that was `typeof === 'object'` was written to Postgres verbatim.
 * A 2 KB budget is plenty for arbitrary key names and deep nesting, so an
 * anonymous caller could choose the SHAPE of a jsonb column — bloating any
 * index over it and feeding unexpected keys to anything that later iterates
 * the object with `jsonb_each` / `jsonb_object_keys`.
 *
 * A size cap alone cannot fix that, and neither can a depth or key-count cap:
 * both still permit arbitrary key NAMES and arbitrary value TYPES where the
 * consumer expects a known one. The only fix that closes it is an allowlist
 * of the exact shape, which is what this module is. The value written to the
 * database is REBUILT from validated fields — the caller's object is never
 * passed through, so nothing unvalidated can ride along.
 *
 * The allowlists are derived from `Record<VibeTag, true>` / `Record<
 * Neighborhood, true>` rather than hand-written arrays, so adding a member to
 * either union is a COMPILE ERROR here until the runtime list is updated. A
 * plain `string[]` would silently drift out of date and start rejecting valid
 * profiles. (`src/lib/quiz.ts` also carries neighborhood options, but that is
 * a UI service-area SUBSET — deliberately not reused as an authorization
 * allowlist, since the two lists answer different questions.)
 */

import type { Neighborhood, VibeProfile, VibeTag } from '@/types';

const VIBE_TAG_SET: Record<VibeTag, true> = {
  dive: true, cocktail: true, wine: true, beer: true, dance: true,
  lounge: true, speakeasy: true, pub: true, rooftop: true, garden: true,
  club: true, 'restaurant-bar': true,
  chill: true, buzzy: true, loud: true,
  locals: true, 'post-work': true, date: true, tourist: true, industry: true,
  rough: true, polished: true, romantic: true, instagrammable: true,
  'old-nyc': true, trendy: true,
  indie: true, hiphop: true, house: true, jazz: true, live: true,
  cheap: true, mid: true, pricey: true, splurge: true,
};

const NEIGHBORHOOD_SET: Record<Neighborhood, true> = {
  FiDi: true, LES: true, 'East Village': true, 'West Village': true,
  SoHo: true, Chelsea: true, Midtown: true, "Hell's Kitchen": true,
  UWS: true, UES: true, Harlem: true,
  Tribeca: true, 'Battery Park City': true, 'Hamilton Heights': true,
  Flatiron: true, 'Greenwich Village': true, NoHo: true,
  'Hudson Square': true, Gramercy: true, 'Kips Bay': true,
  'East Harlem': true, 'Morningside Heights': true,
  'Washington Heights': true, Inwood: true, Chinatown: true,
  Williamsburg: true, Greenpoint: true, Bushwick: true, 'Park Slope': true,
  'Fort Greene': true, Gowanus: true,
  Astoria: true, LIC: true, Ridgewood: true,
};

export const VIBE_TAGS = Object.keys(VIBE_TAG_SET) as VibeTag[];
export const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_SET) as Neighborhood[];

/** An archetype is app-GENERATED prose (`deriveArchetype`), not an enum, so
 *  it gets a length bound rather than a membership test. */
const ARCHETYPE_MAX_LENGTH = 80;

/**
 * `savedAt` is listed but NOT stored. It is not an unknown key — it is the
 * app's own transport shape: `StoredProfile = VibeProfile & { savedAt: string }`
 * in `@/lib/storedProfile`, and it is what `loadProfile()` returns. A
 * `StoredProfile` is structurally assignable to `VibeProfile`, so the obvious
 * future wiring of the quiz result into `WaitlistForm` would compile cleanly,
 * post `savedAt`, and — under a strict unknown-key rejection — silently drop
 * EVERY quiz-taker's profile to null with no error and no log. Review caught
 * this before it shipped. Tolerating and stripping the one known transport key
 * costs nothing and removes a silent-data-loss trap; genuinely unknown keys
 * still reject.
 */
const IGNORED_TRANSPORT_KEYS = new Set(['savedAt']);

const ALLOWED_KEYS = new Set([
  'tags',
  'archetype',
  'preferredNeighborhoods',
  ...IGNORED_TRANSPORT_KEYS,
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

function parseMembers<T extends string>(
  value: unknown,
  allowed: Record<T, true>,
  maxLength: number,
): T[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > maxLength) return null;
  const out: T[] = [];
  for (const member of value) {
    if (typeof member !== 'string') return null;
    if (!Object.prototype.hasOwnProperty.call(allowed, member)) return null;
    out.push(member as T);
  }
  return out;
}

/**
 * Returns a NEWLY BUILT profile when `value` matches the allowlisted shape
 * exactly, else null. Null means "store nothing" — not an error: the profile
 * is optional enrichment on a signup form, and failing a whole signup because
 * an optional field was malformed would trade a security fix for a funnel
 * regression. The security property that matters is that nothing unvalidated
 * is ever persisted, and returning null satisfies it.
 *
 * Unknown keys REJECT the whole object rather than being silently stripped:
 * a caller sending keys we do not recognize is not speaking our protocol, and
 * quietly keeping the half we understood would hide that. The one exception
 * is `IGNORED_TRANSPORT_KEYS` above.
 *
 * NAMED `parseWaitlistVibeProfile`, not `parseVibeProfile`, deliberately.
 * `@/lib/storedProfile` already exports a `parseVibeProfile` with much laxer
 * rules (it accepts ANY `string[]` as tags). Two same-named exports with
 * different security postures is an import-autocomplete away from silently
 * reopening this boundary, with no type error to catch it — two review lanes
 * flagged it independently.
 */
export function parseWaitlistVibeProfile(value: unknown): VibeProfile | null {
  if (!isPlainObject(value)) return null;

  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) return null;
  }

  const tags = parseMembers<VibeTag>(value.tags, VIBE_TAG_SET, VIBE_TAGS.length);
  if (tags === null) return null;

  const preferredNeighborhoods = parseMembers<Neighborhood>(
    value.preferredNeighborhoods,
    NEIGHBORHOOD_SET,
    NEIGHBORHOODS.length,
  );
  if (preferredNeighborhoods === null) return null;

  if (typeof value.archetype !== 'string') return null;
  const archetype = value.archetype.trim();
  if (archetype.length === 0 || archetype.length > ARCHETYPE_MAX_LENGTH) {
    return null;
  }

  return { tags, archetype, preferredNeighborhoods };
}
