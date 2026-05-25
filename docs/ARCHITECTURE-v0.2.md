# ARCHITECTURE-v0.2.md — Next Bar

**Status:** Implementation blueprint for v0.2 (Manhattan-only + Where-next mode)
**Source PRD:** `docs/PRD.md` (v4)

---

## 1. Type system

Final TypeScript signatures. All in `src/types/index.ts` unless noted.

```ts
// ---- Geography ----
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

// ---- Vibe / matching ----
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
  preferredNeighborhoods: ManhattanNeighborhood[]; // empty = "anywhere"
};

// ---- Bar (CHANGED) ----
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
  lastVerified: string; // ISO date
};

// ---- Where-next / radius ----
export type Radius =
  | { kind: 'walking';     maxMiles: 1 }
  | { kind: 'shortUber';   maxMiles: 3 }
  | { kind: 'anywhere';    maxMiles: null };

export type SearchMode = 'quiz' | 'whereNext';

// ---- Geolocation ----
export type AccuracyBand = 'precise' | 'coarse' | 'snapped' | 'unknown';

export type GeoState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'granted_precise';  coords: Coords; accuracyMeters: number }
  | { status: 'granted_coarse';   coords: Coords; accuracyMeters: number }
  | { status: 'granted_snapped';  coords: Coords; accuracyMeters: number; snappedTo: ManhattanNeighborhood }
  | { status: 'denied' }
  | { status: 'unavailable' };
```

## 2. Module structure

```
src/
  app/
    page.tsx                    # CHANGED: mode picker (Start quiz | Where next?)
    where-next/page.tsx         # NEW
    join/page.tsx               # NEW: waitlist moved out of default flow
    api/waitlist/route.ts       # unchanged
  components/
    Hero.tsx                    # CHANGED: two CTAs, mobile-first
    VibeQuiz.tsx                # CHANGED: 6 Qs, branches on multi-select Q6
    QuizMultiSelect.tsx         # NEW: chip-grid sub-component
    ResultsView.tsx             # NEW: shared 3-card results + map + location prompt
    ResultCard.tsx              # CHANGED: per-bar card, redesigned
    BarMap.tsx                  # CHANGED: receives pre-ranked candidates
    LocationPrompt.tsx          # NEW: "Use my location | Pick a neighborhood"
    NeighborhoodPicker.tsx      # NEW: 8-chip grid
    WhereNextFlow.tsx           # NEW: state-machine container
    BarPicker.tsx               # NEW: search + grouped list
    RadiusSlider.tsx            # NEW: 3-segment control
    GpsConfirm.tsx              # NEW: 200m confirm screen
    VibeTweak.tsx               # NEW: optional add/remove tags from seed
    WaitlistForm.tsx            # stays (only /join uses it)
  lib/
    bars.ts                     # CHANGED: ~40 Manhattan bars + lastVerified
    matching.ts                 # CHANGED: jaccard + matches + vibeMatchBadge
    quiz.ts                     # CHANGED: 5 vibe + 1 neighborhood; rewritten archetypes
    distance.ts                 # stays
    geo.ts                      # NEW: snapToNeighborhoodCentroid, isInsideManhattan
    travelTime.ts               # NEW: walkMinutes, uberMinutes, leadCopy
    constants.ts                # NEW: all magic numbers + centroid table
    freshness.ts                # NEW: daysAgo + isFresh
  hooks/
    useGeolocation.ts           # NEW
  types/
    index.ts                    # CHANGED: per section 1
```

## 3. `matches()` signature + flow

```ts
// src/lib/matching.ts
import type { Bar, Coords, ManhattanNeighborhood, VibeProfile, VibeTag } from '@/types';

export function jaccard(a: VibeTag[], b: VibeTag[]): number;
export function vibeMatchBadge(a: VibeTag[], b: VibeTag[]): { num: number; den: number };

export type MatchesArgs = {
  profile: VibeProfile;
  coords: Coords | null;
  preferredNeighborhoods: ManhattanNeighborhood[]; // empty = no preference
  maxMiles: number | null;                         // null = no radius cap
  bars: Bar[];
  excludeIds?: string[];                           // where-next excludes seed bar
  now?: Date;                                      // injectable for tests
};

export function matches(args: MatchesArgs): Bar[];
```

Body (pseudocode):

```
1. let pool = bars
     .filter(b => !excludeIds?.includes(b.id))
     .filter(b => daysAgo(b.lastVerified, now) <= LAST_VERIFIED_HARD_FILTER_DAYS)  // 180
2. if (preferredNeighborhoods.length > 0)
     pool = pool.filter(b => preferredNeighborhoods.includes(b.neighborhood))
3. if (coords && maxMiles !== null)
     pool = pool.filter(b => haversineMiles(coords, b) <= maxMiles)
4. // Threshold relaxation
   let threshold = JACCARD_START   // 0.25
   let candidates = []
   while (threshold >= JACCARD_FLOOR && candidates.length < MIN_CANDIDATES):
     candidates = pool.filter(b => jaccard(profile.tags, b.tags) >= threshold)
     if (candidates.length < MIN_CANDIDATES) threshold -= JACCARD_STEP  // 0.05
5. // Sort
   if (coords) candidates.sort(asc by haversineMiles(coords, b))
   else        candidates.sort(desc by jaccard(profile.tags, b.tags))
6. return candidates.slice(0, MAX_RESULTS)  // 3
```

`vibeMatchBadge` returns `{ num: |intersection|, den: min(|user|, |bar|) }` for the UI badge "Vibe match · 4 of 5".

## 4. `useGeolocation` hook

```ts
// src/hooks/useGeolocation.ts
export type UseGeolocationReturn = {
  state: GeoState;
  request: () => void;
  reset: () => void;
  // derived ergonomic view:
  coords: Coords | null;            // effective coord (post-snap)
  accuracyBand: AccuracyBand;
  snappedNeighborhood: ManhattanNeighborhood | null;
};

export function useGeolocation(): UseGeolocationReturn;
```

State transitions:

```
idle ──request()──► requesting
   success ──► granted_precise   (accuracy ≤ 200m)
            ─► granted_snapped   (accuracy > 200m, nearest centroid ≤ 2mi, inside Manhattan BBox)
            ─► granted_coarse    (else — treated like denied for ranking; show picker)
   error   ──► denied
   no API  ──► unavailable
```

Privacy: never persisted, never logged, never sent to a server.

## 5. Neighborhood centroid table

Starting values — **TODO: verify on map before locking**.

| Neighborhood | lat | lng |
|---|---|---|
| FiDi | 40.7060 | -74.0090 |
| LES | 40.7170 | -73.9870 |
| East Village | 40.7270 | -73.9840 |
| West Village | 40.7350 | -74.0030 |
| Chelsea | 40.7470 | -74.0010 |
| Midtown | 40.7550 | -73.9840 |
| UWS | 40.7870 | -73.9750 |
| UES | 40.7740 | -73.9610 |

Manhattan BBox for outside-island detection: `lat ∈ [40.700, 40.880]`, `lng ∈ [-74.030, -73.910]`.

## 6. Where-next flow

Route: `/where-next` (new). State machine in `WhereNextFlow.tsx`:

```
pickBar ──► confirmGps ──► pickRadius ──► (optional tweakVibe) ──► results
```

```ts
type WhereNextStep =
  | { step: 'pickBar' }
  | { step: 'confirmGps';  seedBar: Bar }
  | { step: 'pickRadius';  seedBar: Bar }
  | { step: 'tweakVibe';   seedBar: Bar; radius: Radius }
  | { step: 'results';     seedBar: Bar; radius: Radius; tags: VibeTag[] };
```

URL params for shareability: `/where-next?bar=attaboy&radius=walking`.

GPS confirm rules:
- Precise + > 0.124mi (~200m) from seed bar → "Looks like you're elsewhere?" with Proceed / Pick different.
- Snapped / coarse → skip mismatch check (we don't trust the fix).
- Denied / unavailable → skip confirm, proceed from seed bar with one-button advance.

BarPicker UI: search box (sticky) + grouped-by-neighborhood list below. 56px row height.

## 7. Routing

Dedicated `/where-next` route (rejected: mode enum on home page — phase enum balloons, back button breaks, deep links impossible).

- `/` — Hero + CTAs + quiz + results
- `/where-next` — bar picker → confirm → radius → results
- `/join` — waitlist
- `/api/waitlist` — unchanged

## 8. Quiz reshape

5 vibe Qs (pulled from existing 10 for tag-signal independence):

| New | Old idx | Prompt |
|---|---|---|
| Q1 | 0 | Friday 11pm dive vs speakeasy |
| Q2 | 1 | How loud should it be |
| Q3 | 6 | Music (4 options) |
| Q4 | 7 | Crowd you want (3 options) |
| Q5 | 8 | Drink budget per round |

Dropped: best part, lights, how you arrive, worst thing, dealbreaker (all duplicate signal).

Q6 — neighborhood multi-select:
```
Prompt: "Anywhere you'd rather be? (pick any — or none for anywhere)"
Options: 8 chips, grid-cols-2 mobile / grid-cols-4 md+
Buttons: [Skip — anywhere is fine] | [Done] (after ≥1 chip)
```

## 9. Result card redesign

Information shown:
- Rank · Name (font-display, large)
- Neighborhood · price tier
- Lead label: `~12 min walk` or `~6 min by Uber` (boundary at 1mi)
- Vibe match badge: `Vibe match · 4 of 5`
- Blurb (italic, 2-line clamp)
- Verified {Mon YYYY} (with "older info" flag if > 90 days)

Tailwind layout (mobile-first):

```jsx
<article class="bg-surface border border-border rounded-3xl p-5 flex flex-col gap-3
                active:scale-[0.99] transition-transform">
  <div class="flex items-baseline justify-between gap-3">
    <h3 class="font-display text-2xl leading-tight">{rank}. {name}</h3>
    <span class="text-muted text-xs shrink-0">{$$$}</span>
  </div>
  <p class="text-muted text-xs uppercase tracking-wider">{neighborhood}</p>
  <p class="font-display text-accent text-3xl">{leadLabel}</p>
  <p class="text-sm text-muted">Vibe match · {num} of {den}</p>
  <p class="text-sm italic line-clamp-2">{blurb}</p>
  <p class="text-xs text-muted">Verified {monthYear}{olderFlag}</p>
</article>
```

Whole card → external map link. Min-height ensures ≥ 44pt tap target.

Walk-vs-Uber:
- `miles ≤ 1` → `~{round(miles × 20)} min walk`
- `miles > 1` → `~{round(miles × 6)} min by Uber`
- `coords` null → `In {neighborhood}` (no time lead)

## 10. Component diff (one-liner table)

| Path | Action | Diff |
|---|---|---|
| `src/types/index.ts` | change | New types, narrow `Bar.neighborhood`, add `Bar.lastVerified`, add `VibeProfile.preferredNeighborhoods` |
| `src/lib/bars.ts` | change | ~40 Manhattan bars across 8 neighborhoods + lastVerified |
| `src/lib/matching.ts` | change | Delete matchScore; add jaccard + matches + vibeMatchBadge |
| `src/lib/quiz.ts` | change | 5 vibe Qs + 1 multi-select; rewrite deriveArchetype neighborhood-neutral |
| `src/lib/geo.ts` | new | snapToNeighborhoodCentroid, isInsideManhattan |
| `src/lib/travelTime.ts` | new | walkMinutes, uberMinutes, leadCopy |
| `src/lib/freshness.ts` | new | daysAgo, isFresh |
| `src/lib/constants.ts` | new | All magic numbers + centroids + BBox |
| `src/hooks/useGeolocation.ts` | new | State machine per §4 |
| `src/app/page.tsx` | change | Two CTAs; ResultsView replaces inline cards |
| `src/app/where-next/page.tsx` | new | Renders WhereNextFlow |
| `src/app/join/page.tsx` | new | Renders WaitlistForm |
| `src/components/Hero.tsx` | change | Two CTAs, mobile-first |
| `src/components/VibeQuiz.tsx` | change | 6 Qs, branches on Q6 multi-select |
| `src/components/QuizMultiSelect.tsx` | new | Chip-grid for Q6 |
| `src/components/ResultsView.tsx` | new | Owns LocationPrompt + matches() + map + 3 cards |
| `src/components/LocationPrompt.tsx` | new | Use location / Pick neighborhood |
| `src/components/NeighborhoodPicker.tsx` | new | 8-chip grid |
| `src/components/ResultCard.tsx` | change | Per-bar card per §9 |
| `src/components/BarMap.tsx` | change | Receives pre-ranked bars; mobile sizing |
| `src/components/WhereNextFlow.tsx` | new | State machine container |
| `src/components/BarPicker.tsx` | new | Search + grouped list |
| `src/components/RadiusSlider.tsx` | new | 3-segment control |
| `src/components/GpsConfirm.tsx` | new | 200m confirm |
| `src/components/VibeTweak.tsx` | new | Add/remove tags from seed |
| `src/components/WaitlistForm.tsx` | stays | Only /join now |

## 11. Test surface

Unit (Jest or Vitest):

`matching.ts`:
- excludeIds filter
- lastVerified > 180 days filter
- preferredNeighborhoods = [] is no-op
- preferredNeighborhoods filter excludes others
- maxMiles + coords filters by radius
- maxMiles + null coords is no-op
- Threshold relaxation 0.25 → 0.10 by 0.05 steps
- Floor: returns whatever exists at threshold 0.10
- Sort by distance when coords present
- Sort by jaccard desc when coords null
- slice(0, 3)

`jaccard`: empty = 0; identical = 1; commutative.
`vibeMatchBadge`: denominator = min(|user|, |bar|).
`geo.snapToNeighborhoodCentroid`: nearest inside Manhattan; null > MAX_SNAP_MILES; null outside BBox.
`travelTime.leadCopy`: 0.5 → walk; 1.0 → walk; 1.01 → Uber; 3.0 → Uber.
`freshness`: daysAgo with injected now; isFresh at 90-day boundary.
`quiz.deriveArchetype`: regex assertion — never contains any neighborhood name.

Hook tests (mock navigator.geolocation): cover all 7 GeoState variants.

E2E (Playwright iPhone 13 + Pixel 7):
- Quiz path end-to-end
- Where-next path end-to-end (Attaboy → Walking → 3 results excluding Attaboy)
- Bias smoke: stub Midtown coords → top result is Midtown/Chelsea
- Permission denied → NeighborhoodPicker fallback
- Tap-target audit ≥ 44pt
- No horizontal scroll at 375px

## 12. Constants module

```ts
// src/lib/constants.ts
import type { Coords, ManhattanNeighborhood } from '@/types';

// Matching
export const JACCARD_START = 0.25;
export const JACCARD_FLOOR = 0.10;
export const JACCARD_STEP = 0.05;
export const MIN_CANDIDATES = 3;
export const MAX_RESULTS = 3;

// Freshness windows
export const LAST_VERIFIED_HARD_FILTER_DAYS = 180;
export const LAST_VERIFIED_FRESH_DAYS = 90;

// Geolocation
export const COARSE_ACCURACY_M = 200;
export const MAX_SNAP_MILES = 2;
export const GPS_CONFIRM_MILES = 0.124;

// Where-next radii
export const RADIUS_WALK = 1;
export const RADIUS_SHORT_UBER = 3;
export const RADIUS_ANYWHERE = null;

// Travel time
export const WALK_BOUNDARY_MI = 1;
export const WALK_MIN_PER_MILE = 20;
export const UBER_MIN_PER_MILE = 6;

// Geography
export const NEIGHBORHOOD_CENTROIDS: Record<ManhattanNeighborhood, Coords> = {
  'FiDi':         { lat: 40.7060, lng: -74.0090 }, // TODO verify
  'LES':          { lat: 40.7170, lng: -73.9870 }, // TODO verify
  'East Village': { lat: 40.7270, lng: -73.9840 }, // TODO verify
  'West Village': { lat: 40.7350, lng: -74.0030 }, // TODO verify
  'Chelsea':      { lat: 40.7470, lng: -74.0010 }, // TODO verify
  'Midtown':      { lat: 40.7550, lng: -73.9840 }, // TODO verify
  'UWS':          { lat: 40.7870, lng: -73.9750 }, // TODO verify
  'UES':          { lat: 40.7740, lng: -73.9610 }, // TODO verify
};

export const MANHATTAN_BBOX = {
  minLat: 40.700, maxLat: 40.880,
  minLng: -74.030, maxLng: -73.910,
};
```

## 13. Risks flagged

1. Centroid-snap at neighborhood borders may mislabel (mitigation: visible "approximate" + Pick exactly override).
2. `lastVerified` is real curation work — hours per bar to verify hours/specials, not a 1-line type change.
3. Where-next GPS denial dead-end — browser caches denial; can't force re-prompt. Mitigation: copy + one-button advance.
4. Seven-state hook is more than most consumers need — mitigation: derived `{ coords, accuracyBand }` view.
5. Quiz multi-select breaks existing single-pick accumulator — branch on Q6 for v0.2; generalize later.
6. iPhone Safari indoor GPS is bad (100-500m); snap-to-centroid is mitigation but border zones may snap wrong.
7. Threshold relaxation can return 0 candidates if pool is over-filtered — UI must handle 0 with "No matches — widen radius?" CTA.
8. Leaflet-on-iOS deferred to separate session.
9. Where-next deep links need hand-written query validation (no Zod for v0.2).

---

*Source: architect agent output, 2026-05-16. Pre-implementation reference.*
