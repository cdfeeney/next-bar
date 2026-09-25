# NextBarCore — TS/Swift test parity

Port of `src/lib/{constants,vibeAxes,quiz,tasteAffinity,matching,travelTime,distance}.ts` and
`src/types/{index,ratings}.ts` into `apple/Packages/NextBarCore`. `swift test`: **99 tests, 0
failures, 2 disabled** (see below). Every disabled case is a genuine scope exclusion (needs the
full `bars.ts`/`catalog.ts` data catalog, which is data-ingestion, not ranking logic), not a
weakened assertion — no TS expectation was changed or dropped to make anything pass.

## `src/lib/vibeAxes.test.ts` → `VibeAxesTests.swift` (4/4 ported)

| TS case | Swift test | status |
|---|---|---|
| partitions the ENTIRE vocabulary — every tag in exactly one axis | `partitionsEntireVocabulary` | ported |
| axisOf round-trips membership for every tag | `axisOfRoundTrips` | ported |
| AXIS_ORDER lists all six axes exactly once | `axisOrderListsAllSix` | ported |
| Spend is exactly the price ladder in ascending order | `spendIsThePriceLadder` | ported |

Note: TS asserts against `TAG_VOCABULARY` (from `catalog.ts`, out of scope). `VibeTag.allCases`
is verified to be the same 35-tag set `vibeAxes.ts` partitions, so the assertion is equivalent.

## `src/lib/quiz.coverage.test.ts` → `QuizTests.swift` (1/2 ported, 1 disabled)

| TS case | Swift test | status |
|---|---|---|
| every quiz-emittable tag matches at least one open bar | `everyQuizEmittableTagMatchesAnOpenBar` | disabled: requires the full `bars.ts`/`catalog.ts` catalog (data ingestion, out of scope) |
| the audit gap tags are now expressible: date, beer, pub, wine, live, post-work, romantic, garden, rooftop, splurge | `auditGapTagsAreExpressible` | ported |

## `src/lib/tasteAffinity.test.ts` → `TasteAffinityTests.swift` (13/13 ported)

| TS case | Swift test | status |
|---|---|---|
| maps 5.5 to neutral, 10.0 to +1 and 1.0 to -1 before shrinkage | `mapsScoresToWeights` | ported |
| accumulates repeated observations of the same tag | `accumulatesRepeatedObservations` | ported |
| lets low scores cancel high ones — negative evidence is real evidence | `lowScoresCancelHighOnes` | ported |
| is not fooled by rating COUNT — one loved bar is not two hundred | `notFooledByRatingCount` | ported |
| ignores unscored ratings rather than inventing a midpoint for them | `ignoresUnscoredRatings` | ported |
| skips ratings for bars outside the supplied catalog | `skipsRatingsOutsideCatalog` | ported |
| grows confidence as c = N/(N+10) | `growsConfidence` | ported |
| does not truncate evidence to the Settings top-five display cap | `doesNotTruncateEvidence` | ported |
| averages A(tag) rather than summing, so tag count is not a rank bonus | `averagesRatherThanSums` | ported |
| is 0 for an untagged bar and for empty taste | `zeroForUntaggedOrEmptyTaste` | ported |
| clamps out-of-range finite scores into the 1.0-10.0 band | `clampsOutOfRangeScores` | ported |
| never yields Infinity or NaN from extreme repeated scores | `neverYieldsInfinityOrNaN` | ported |
| keeps every affinity inside [-1, 1] whatever the input | `keepsAffinityInsideUnitRange` | ported |

## `src/lib/matching.test.ts` → `MatchingTests.swift` (63/63 ported: 50 standalone + 2 `it.each` blocks = 13 rows)

| TS case | Swift test | status |
|---|---|---|
| returns 0 when sets have empty intersection | `emptyIntersection` | ported |
| returns 1 for identical sets | `identicalSets` | ported |
| is commutative | `isCommutative` | ported |
| returns 0 when both inputs are empty (no divide-by-zero) | `bothEmpty` | ported |
| returns null for a saved quiz profile — a prior is not a selection | `nullForSavedQuizProfile` | ported |
| returns null when the flag is explicitly false | `nullWhenFlagFalse` | ported |
| returns null for a CLEARED pick — the flag with no tags | `nullForClearedPick` | ported |
| deduplicates, so a repeated pick counts once | `deduplicates` | ported |
| is null with no selection — there is no honest fraction to show | `nullWithNoSelection` | ported |
| numerator is the intersection with the SELECTED vibes | `numeratorIsIntersection` | ported |
| denominator is N even when the bar carries far more tags | `denominatorIsNWithMoreBarTags` | ported |
| denominator is N even when the bar carries fewer tags | `denominatorIsNWithFewerBarTags` | ported |
| counts a duplicated pick once, in both halves of the fraction | `duplicatedPickCountsOnce` | ported |
| gates nothing when there is no selection | `gatesNothingWithNoSelection` | ported |
| `it.each` admits %i/%i — 7 rows: (1,1) (1,2) (2,2) (3,4) (4,4) (5,6) (6,6) | `admits(_:)` parameterized via `@Test(arguments:)`, 7 cases | ported |
| `it.each` rejects %i/%i — 6 rows: (0,1) (0,2) (1,4) (2,4) (3,6) (4,6) | `rejects(_:)` parameterized via `@Test(arguments:)`, 6 cases | ported |
| deduplicates the selection before computing the threshold | `deduplicatesSelection` | ported |
| excludeIds removes the named bar | `excludeIdsRemovesTheNamedBar` | ported |
| drops bars whose lastVerified is older than the hard-filter window | `dropsStaleBars` | ported |
| preferredNeighborhoods = [] is a no-op | `emptyPreferredNeighborhoodsIsNoOp` | ported |
| preferredNeighborhoods = ["Midtown"] filters out non-Midtown bars | `filtersOutNonMidtownBars` | ported |
| maxMiles with coords filters by radius | `maxMilesFiltersByRadius` | ported |
| minMilesExclusive with coords removes nearer bars | `minMilesExclusiveRemovesNearerBars` | ported |
| maxMiles set but coords === null is a no-op (no radius filter applied) | `maxMilesWithoutCoordsIsNoOp` | ported |
| ranks stronger tag overlap above weaker, and caps the page | `ranksStrongerOverlapAboveWeaker` | ported |
| admits bars with zero tag overlap — no Jaccard admission gate | `admitsBarsWithZeroOverlap` | ported |
| a strong vibe match slightly farther outranks a weak vibe match that is closer | `strongVibeMatchFartherOutranksWeakCloser` | ported |
| among equal-vibe bars, the closer one still wins (proximity breaks the tie) | `closerBarWinsAmongEqualVibe` | ported |
| learned taste breaks ties between bars with identical quiz overlap | `learnedTasteBreaksTies` | ported |
| omitting lovedTags is a no-op (backward compatible) | `omittingLovedTagsIsNoOp` | ported |
| sorts by distance ascending when coords provided | `sortsByDistanceAscending` | ported |
| sorts by jaccard descending when coords is null | `sortsByJaccardDescending` | ported |
| regression: bars.ts PLACEHOLDER_VERIFIED dates still pass the hard filter on 2026-09-28 | `placeholderVerifiedDatesRegression` | disabled: requires the real `src/lib/bars.ts` catalog, out of scope |
| caps the result set at MAX_RESULTS (3) even when 5 bars match | `capsAtMaxResults` | ported |
| maxResults override expands the cap (quiz path uses 10) | `maxResultsOverrideExpandsCap` | ported |
| QA-6: keeps relaxing the Jaccard threshold to FILL the requested cap, not just the 3-result minimum | `qa6FillsRequestedCap` | ported |
| returns proximity-ranked bars instead of filtering everything out | `returnsProximityRankedBars` | ported |
| never suggests a CLOSED_PERMANENTLY bar even on perfect vibe match | `neverSuggestsClosedPermanentlyBar` | ported |
| at 11:30pm the club leads and the restaurant-bar trails | `clubLeadsAtLateNight` | ported |
| at 3pm identical-vibe venues stay un-biased | `unbiasedInAfternoon` | ported |
| a restaurant that is ALSO a club keeps its night credibility | `hybridKeepsNightCredibility` | ported |
| the window wraps midnight: 3:59am biased, 4:00am not — in NEW YORK | `windowWrapsMidnight` | ported |
| a broken clock gets no night bias rather than a wrong one | `brokenClockGetsNoBias` | ported |
| fills all five slots from the walk band when it can | `fillsAllFiveFromWalkBand` | ported |
| expands into the cab band ONLY when the walk band cannot fill | `expandsIntoCabBandOnlyWhenNeeded` | ported |
| expands to the outer band only after walk AND cab are exhausted | `expandsToOuterBandOnlyAfterExhaustion` | ported |
| treats the band edges as inclusive upper bounds (<= 1.5 walks, <= 4 cabs) | `treatsBandEdgesAsInclusive` | ported |
| orders WITHIN a band by learned taste, not by distance | `ordersWithinBandByLearnedTaste` | ported |
| a full nearer band EXCLUDES a much better-tasting farther bar | `fullNearerBandExcludesBetterTastingFartherBar` | ported |
| learned evidence eventually overrides a conflicting quiz prior | `learnedEvidenceOverridesQuizPrior` | ported |
| uses exact miles ONLY as the final tie-breaker | `usesExactMilesOnlyAsTieBreaker` | ported |
| falls back to a single band when there are no coords | `fallsBackToSingleBandWithNoCoords` | ported |

## `src/lib/matching.explicitVibe.test.ts` → `MatchingExplicitVibeTests.swift` (21/21 ported)

| TS case | Swift test | status |
|---|---|---|
| ranks by the normal quiz-prior cascade when no tweak has been applied | `ranksByNormalQuizPriorCascade` | ported |
| treats an explicitly false flag exactly like an absent one | `treatsExplicitlyFalseFlagLikeAbsent` | ported |
| puts the picked vibe ahead of the bar the history favours | `putsPickedVibeAhead` | ported |
| still wins at 200+ ratings, where the quiz prior is worth 4.8% | `stillWinsAtHighRatingCounts` | ported |
| orders two MATCHING bars by the 80/20 blend, not by learned taste alone | `ordersTwoMatchingBarsByBlend` | ported |
| lets learned taste order bars that match the pick equally well | `letsLearnedTasteOrderEquallyMatchingBars` | ported |
| without a tweak, the walkable band fills the page and the far bar never surfaces | `walkableBandFillsPageWithoutTweak` | ported |
| reaches the far MATCH, and never pads the page with the near nonmatches | `reachesFarMatchWithoutPadding` | ported |
| does not expand an explicit maximum for an applied vibe | `doesNotExpandExplicitMaximum` | ported |
| reaches the NEXT band only — a match past RADIUS_CAB stays out of a Walkable page | `reachesNextBandOnly` | ported |
| enforces both geographic bounds even when no vibe match remains | `enforcesBothGeographicBounds` | ported |
| changes geographic scope only — the radius never re-weights the vibe | `changesGeographicScopeOnly` | ported |
| admits 3/4 and 4/4 but not 2/4 — one miss is forgiven, two are not | `admits3And4NotForgiven2` | ported |
| returns an EMPTY list rather than padding with rejected bars | `returnsEmptyListRatherThanPadding` | ported |
| an ineligible bar cannot re-enter through the band expansion | `ineligibleBarCannotReenterThroughExpansion` | ported |
| an ineligible bar cannot re-enter to fill an under-full page | `ineligibleBarCannotReenterToFillUnderFullPage` | ported |
| deduplicates the selection before setting the threshold | `deduplicatesSelectionBeforeThreshold` | ported |
| restores normal ranking exactly when the pick is emptied | `restoresNormalRankingWhenEmptied` | ported |
| restores normal ranking when the flag is dropped again | `restoresNormalRankingWhenFlagDropped` | ported |
| weights the picked vibe 80% and learned taste 20% | `weightsPickedVibe80PercentLearnedTaste20Percent` | ported |
| is independent of confidence — the blend never shrinks with N | `independentOfConfidence` | ported |

## `src/lib/travelTime.test.ts` → `TravelTimeTests.swift` (4/4 ported)

| TS case | Swift test | status |
|---|---|---|
| uses raw seconds for Walkable and never rounds a longer walk down to 15 | `rawSecondsForWalkable` | ported |
| does not infer minutes or walkability from unknown or straight-line distances | `doesNotInferFromUnknownDistances` | ported |
| pins Maps to the same coordinates and explicit mode, without name ambiguity | `pinsMapsToSameCoordinates` | ported |
| separates the route boundary, cab edge, and unknown routes without overlapping bands (top-level, non-`describe`) | `separatesRouteBoundaryAndCabEdge` | ported |

## `src/lib/distance.ts` → `Haversine.swift` (no TS test file; extra Swift-only checks)

`distance.ts` has no dedicated test file in the TS repo (verified: no `src/lib/distance.test.ts`).
`haversineMiles` is exercised indirectly through the `matching.test.ts` distance-band fixtures
(ported into `MatchingTests.swift`). `HaversineTests.swift` adds three small standalone
self-checks (zero for identical points, the ~69-mi/degree-latitude approximation the cascade
fixtures rely on, and symmetry) — these are additions for direct coverage of the function, not
a port of an existing TS case.

## Deliberate divergences

- **`axisOf`** — TS throws `Error('vibeAxes: unhomed tag ...')` on an unhomed tag (a "total
  function over the vocabulary" that is total only by convention). Swift's `axisOf` calls
  `fatalError` instead of `throws`, since the function is genuinely total against
  `VibeTag.allCases` (verified by `VibeAxesTests`) and no caller can construct a `VibeTag` outside
  that set — there is no runtime path that should ever reach the failure branch. Behavior is
  otherwise identical.
- **`nycHour`/`isLateNight` "invalid date" fixture** — JS's `new Date('not a date')` produces an
  Invalid Date object that `Number.isNaN`-fails inside `nycHour`. Swift's `Date` has no such
  literal; the port represents the same failure mode with `Date(timeIntervalSince1970: .nan)`
  (Foundation permits a NaN-backed `Date`), and `nycHour` short-circuits on
  `timeIntervalSince1970.isNaN` before touching `Calendar`. Same fail-safe behavior, different
  construction of the invalid input.
- **ISO date parsing** — `daysAgo`/`parseISODate` implement a small formatter-based parser
  covering the two shapes the TS fixtures and `bars.ts`-style data actually use (`yyyy-MM-dd`
  and full `...Z` timestamps), rather than porting JS's much more permissive `Date` constructor
  grammar. Not exercised by any ported test outside those two shapes.
- **`SupabaseClient.swift` is not part of this push** — out of scope per the mission (needs
  network + backend), tracked separately.
- Everything else is a direct, same-shape port: same constants, same cascade order, same
  eligibility math, same weights (`EXPLICIT_VIBE_WEIGHT` = 0.8, late-night boost/penalty = 0.12,
  etc.).

## Review round 2026-09-25 (Codex xhigh: 2 MEDIUM + 2 LOW → BLOCK; Claude/FABLE: APPROVE, 4 LOW)
Fixed in the follow-up commit, each with a regression test in `ReviewRegressionTests.swift`:
- Matching.swift: negative `maxResults` clamped to 0 (JS `slice(0, negative)` = []; Swift `prefix` trapped).
- Freshness.swift: `parseISODate` now accepts any ISO-8601 offset and 1–6 fractional digits (was three fixed formats → `+infinity` → hard-filtered).
- NightClock.swift: infinite dates return `.nan` like the TS failure path; the time zone is no longer force-unwrapped.
- TravelTime.swift: `directionsHref` percent-encodes the comma in `lat,lng` like `URLSearchParams`.
- MatchingExplicitVibeTests.swift: tolerances tightened from 1e-9 to 5e-11 to match `toBeCloseTo(x, 10)`.
Not changed (Fable LOW): `%.1f` vs `toFixed(1)` half-way rounding — display copy, no fixture hits it.
