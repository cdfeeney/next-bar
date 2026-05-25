# Next Bar — v0.2 PRD

**Status:** v4 final, green-lit for execution
**Author:** Connor (with Claude Code)
**Revision log:**
- v1: 4 decisions, recommended path
- v2: scope cut, distance math fix, copy de-biasing, funnel cuts, legal/staleness
- v3: replaced blended score with filter-then-sort (second council)
- v4: Manhattan-only scope + Where-next mode + neighborhood-preference quiz step. Beli-style ranking deferred to v0.3.
- v5 (this): Beli-style restructure — Where-next is the home route `/`; quiz moves to `/quiz` and saves profile to localStorage on completion; friendlier quiz copy ("$22 cocktails" → "A hidden cocktail spot"); spending question reframed as vibe ("$10–14" → "Cheap and cheerful"); BarMap popup uses walk-time instead of raw feet; explicit "View on Maps →" affordance on result cards (in-app photos remain v0.3).

---

## 1. Problem statement

v0.1 has three real problems:

1. **Location-blind matching.** Scores by tag overlap only — user location is never an input. Bar dataset hardcoded to 16 bars across 3 NYC neighborhoods. `matchScore` denominator is `profile.tags.length` (densely-tagged bars dominate). Geographic bias also ships in result COPY via `deriveArchetype()` regardless of any data fix.

2. **Desktop-shaped UI for phone-first behavior.** 11pm, on a phone, one-handed. iPhone Safari is the test device.

3. **Funnel too long.** 10 quiz questions before any result, plus a waitlist gate before the matcher.

**Plus, the killer feature was missing entirely:** the product is named "Next Bar" but offers no "I'm here, where next?" flow — the exact moment when the user actually opens the app.

## 2. Goals (must achieve in v0.2)

- **G1:** Bar ranking is location-aware. Midtown user does not get a Williamsburg bar as #1 — and Williamsburg won't even be in the dataset.
- **G2:** Works on iPhone Safari (iPhone 13 / 15 viewport, portrait) — no horizontal scroll, tap targets ≥ 44pt, map pannable + pinchable.
- **G3:** **~40 curated Manhattan bars across 8 neighborhoods** (FiDi, LES, East Village, West Village, Chelsea, Midtown, UWS, UES), each with `lastVerified` date.
- **G4:** Quiz cut from 10 → ~6 questions (5 vibe + 1 neighborhood-preference multi-select).
- **G5:** Every result leads with walk-time / Uber-time; no apology empty-state.
- **G6:** Copy is neighborhood-neutral in archetypes.
- **G7 (NEW):** "Where next?" mode — user is AT a bar, picks it from the curated list (GPS confirms within ~200m), then sees suggested next bars within their chosen travel radius.

## 3. Non-goals (out of scope for v0.2)

- Native iOS app, user accounts/auth, real-time crowd data, multi-language, push notifications, coverage outside Manhattan, backend rewrite.
- Live Foursquare/Google/Yelp integration.
- Real walk-time / Uber-time from routing APIs (use mile-based estimates for v0.2).
- **Beli-style ranking + social discovery layer.** Deferred to v0.3. Needs identity, schema, moderation — too big to bolt on.
- Free-text bar search (only curated picks for "Where next?" in v0.2).

## 4. Decisions (final)

### D1 — Bar data source: ~40 curated Manhattan bars, 8 neighborhoods

- Static `src/lib/bars.ts` (Supabase table is v0.3 when Beli layer arrives).
- Target neighborhoods (Manhattan-only): **FiDi, LES, East Village, West Village, Chelsea, Midtown, UWS, UES**.
- `Bar` type extensions:
  ```ts
  type Bar = {
    // existing fields
    neighborhood: ManhattanNeighborhood;  // narrowed string union
    lastVerified: string;                  // ISO date
  };
  ```

### D2 — Geolocation UX: prompt at result time + neighborhood-picker fallback + coarse-accuracy snap

- Quiz first. On results screen: `[ Use my location ] | [ Or pick a neighborhood ]`.
- **Coarse-accuracy guard:** if `position.coords.accuracy > 200m`, snap to nearest curated neighborhood centroid before scoring (iPhone Safari indoor accuracy is routinely 100-500m off).
- Permission denied / VPN / out-of-NYC → neighborhood picker. Never empty screen.

### D3 — Matching: filter-then-sort with neighborhood preference

```ts
function matches(
  profile: VibeProfile,
  coords: Coords | null,
  preferredNeighborhoods: ManhattanNeighborhood[],  // empty = no preference
  maxMiles: number | null,                            // null = no radius cap
  bars: Bar[]
): Bar[] {
  let pool = bars.filter(b => daysAgo(b.lastVerified) <= 180);

  if (preferredNeighborhoods.length > 0) {
    pool = pool.filter(b => preferredNeighborhoods.includes(b.neighborhood));
  }
  if (coords && maxMiles !== null) {
    pool = pool.filter(b => milesFromCoords(b, coords) <= maxMiles);
  }

  let threshold = 0.25;
  let candidates: Bar[] = [];
  while (threshold >= 0.10 && candidates.length < 3) {
    candidates = pool.filter(b => jaccard(profile.tags, b.tags) >= threshold);
    if (candidates.length < 3) threshold -= 0.05;
  }

  if (coords) {
    candidates.sort((a, b) => milesFromCoords(a, coords) - milesFromCoords(b, coords));
  } else {
    candidates.sort((a, b) => jaccard(profile.tags, b.tags) - jaccard(profile.tags, a.tags));
  }

  return candidates.slice(0, 3);
}
```

- **No blended score.** Filter by freshness → neighborhood preference → radius → tag fit (relaxing), then sort by distance, take 3.
- Display badge: `intersection / min(|user|, |bar|)` as "Vibe match: 4 of 5".
- Walk-time lead label: `~X min walk` for ≤ 1 mi, `~Y min by Uber` for > 1 mi (mile-based estimate; routing API is v0.3).

### D4 — Mobile build: tactical mobile-first pass + dedicated Leaflet-on-iOS session

- Mobile-first Tailwind on Hero, VibeQuiz, ResultCard, BarMap.
- Tap targets ≥ 44pt, `touch-action: manipulation`, 375px-first defaults.
- **Separate work item — Leaflet-on-iOS hardening:** pinch-zoom vs page-scroll, tap-vs-drag, tile fallback.

### D5 — Copy de-biasing (P0)

- Rewrite `deriveArchetype()` neighborhood-neutral. `'Williamsburg new-wave'` → `'Trendy new-wave'`, `'East Village dive devotee'` → `'Dive devotee'`, etc.

### D6 — Funnel cuts + neighborhood-preference question

- Quiz: 10 → **6 questions**. 5 vibe questions (de-dupe overlapping tag signal from current 10) + 1 multi-select neighborhood preference ("anywhere" valid default).
- Waitlist gate dropped from default flow; preserved at `/join` route.

### D7 (NEW) — Where-next mode

The named feature. User is AT a bar, wants the next one.

**Entry:**
- New CTA on home screen: `Where next?` (alongside `Start quiz`).
- Pick current bar from curated list (search + tap). GPS confirms within ~200m of the picked bar's coords — if mismatch, show "we're showing bars near {picked bar} — looks like you're elsewhere?" and let user override or correct.
- Radius slider: **Walking (≤ 1 mi)** | **Short Uber (1-3 mi)** | **Anywhere in Manhattan**.

**Seed:**
- Current bar's `tags` become the user's `VibeProfile.tags`. No quiz needed.
- Optional: `Tweak vibe` button → opens a one-screen tag editor to add/remove tags from the seed.

**Match:**
- Same `matches()` function as quiz path. `preferredNeighborhoods = []` by default; user can constrain.
- `maxMiles` = 1 / 3 / null from radius slider.
- Exclude the current bar from results.

**UI:**
- Result cards show walk-time for ≤ 1 mi, Uber estimate for > 1 mi.

## 5. Success criteria

- `npm run typecheck` passes.
- Unit tests: Jaccard, filter-then-sort with threshold relaxation, neighborhood preference filter, radius filter, coarse-coord snap, `lastVerified` window, neighborhood-neutral archetypes, walk-vs-Uber copy threshold.
- E2E (Playwright iPhone 13 viewport):
  - **Quiz path:** complete 6-question quiz → grant location → 3 results with walk/Uber-time lead.
  - **Where-next path:** tap "Where next?" → pick a curated bar → choose Walking radius → see 3 nearby bars excluding the picked one.
- Manual iPhone Safari smoke: no horizontal scroll, tap targets ≥ 44pt, map pannable + pinchable, results readable in outdoor light.
- **Bias smoke test:** Midtown coord + "cocktail / polished" tags → top result is the closest tag-passing Manhattan bar with honest walk/Uber time.
- **Where-next smoke test:** User at Attaboy (LES) → Walking radius → top result is a tag-compatible bar within 1 mi, Attaboy excluded.

## 6. Implementation outline

1. **Architecture (architect agent):** Bar type narrowing to Manhattan neighborhoods, `useGeolocation` hook with accuracy guard, `matches()` signature with preference + radius args, neighborhood centroid table, Where-next route + state machine, file-level diff plan.
2. **Test-first:** failing tests for every D3/D7 branch + a11y tap-target sizes.
3. **Implementation:**
   - Expand `bars.ts` to ~40 Manhattan bars across 8 neighborhoods + `lastVerified`.
   - Rewrite `matching.ts` (filter-then-sort with preference + radius).
   - Add `useGeolocation` hook + coarse-accuracy snap.
   - Rewrite `deriveArchetype()` neighborhood-neutral.
   - Cut quiz to 5 vibe questions + add 1 neighborhood-preference multi-select.
   - Drop waitlist from default flow → `/join` route.
   - **Build Where-next mode:** new route, bar-picker component, radius slider, results view shared with quiz path.
   - Mobile-first Tailwind pass on Hero, VibeQuiz, ResultCard, BarMap, plus new Where-next components.
4. **Leaflet-on-iOS hardening (separate session).**
5. **Review:** typescript-reviewer + security-reviewer (geolocation privacy: don't log/persist coords).
6. **E2E:** Playwright iPhone 13 + Pixel 7, both paths.
7. **Manual iPhone Safari smoke test.**

## 7. Risks

- **R1:** Curating 40 Manhattan bars takes longer than one evening. Mitigation: ship with 24 bars across 6 neighborhoods if needed.
- **R2:** Geolocation denial → matcher feels broken. Mitigation: neighborhood-picker fallback always present.
- **R3:** Where-next bar-picker is a search UX problem with 40 entries — manageable. At 200+ bars (v0.3) it becomes a real search-index problem.
- **R4:** Stale-data legal exposure on factual blurbs. Mitigation: `lastVerified` ≤ 180 days (filter), ≤ 90 days (un-flagged); visible disclaimer; mailto takedown contact.
- **R5:** Leaflet on iOS Safari is the long pole. Mitigation: dedicated hardening session.
- **R6 (NEW):** Where-next mode adds two new routes, a new state machine, and a new entry path — bigger surface than v0.2 originally scoped. ~3 extra days vs v3. Mitigation: share matcher + result components across both paths; don't duplicate.

## 8. v0.3 preview (out of scope but informs v0.2 design)

- **Beli-style ranking + social.** Users rank bars they've been to ("Loved / Liked / Meh"); see top-ranked in their neighborhood. Needs anon identity (phone-based or magic-link), `ratings` Supabase table, moderation surface.
- **In-app bar photos.** Google Places API integration (or Foursquare) to show 2-4 photos on tap. Requires API key + attribution UI. Current v0.2 workaround: result card opens Google Maps where photos exist.
- **Real walk-time + Uber estimates** from routing API (Mapbox / OSRM).
- **Free-text bar search** for non-curated venues in Where-next mode.
- **Live data integration** (Foursquare / Google Places) as fallback when curated coverage is thin.
- **Outer-borough expansion** (Williamsburg, LIC, Astoria, Bushwick, Greenpoint).
- **Bottom nav tabs** (Beli pattern): [Where next] [Quiz] [Saved] persistent across all screens.

---

*v4 PRD locked. Dispatching architect agent next.*
