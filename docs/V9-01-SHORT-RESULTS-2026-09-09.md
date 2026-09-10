# V9-01 — why a Next Bar? search can show three, and the copy that used to narrate it

Corrected 2026-09-10 (V10-05) per the V9-01 final panel: three claims below are marked **Correction (V10-05)** with
current file:line references; product code is unchanged.

Goal g-44888d71, run nb-v9-overnight-20260908, on the Night Out candidate (`7cb8933`). The owner saw three bars under
"Near you" with the sentence "Only 3 routes confirmed in this search." This file records (1) what copy was removed and
kept, and (2) the reproducible mechanism that yields fewer than five, measured in code and pinned by a fixture — BEFORE
any change to ranking or request volume, which this goal does not make.

## 1. Copy

Removed from `src/components/ResultsView.tsx`:

- `Only {n} routes confirmed in this search.` (the live-region summary above the heading).
- `Checked {n} candidates; this is not an exhaustive search.` (inside "About travel times"). Same defect: it narrates
  the routing budget, which the user cannot act on and which reads as an apology for the product.

Kept, because each one is either attribution or something the user can act on:

- `Some route checks failed; only confirmed estimates are shown.` (a provider failure mid-search).
- `Travel times unavailable/expired. This travel band could not be confirmed.` + **Recalculate** (a failed or stale
  search, with the retry).
- `Route times unavailable. Walkable and cab results need a confirmed walking route.` (routing disabled).
- The empty states (`Not enough routes could be confirmed…` / `No bars match the vibes you picked…`) with their
  "try another band / neighborhood" line — zero results must still say why.
- The openrouteservice / OpenStreetMap attribution line.

The heading still says "Your next 3 bars" when three is the honest answer. The `limited`/`checked` fields stay in the
`TravelSearch` contract (the hook validates them); they simply no longer reach the screen.

## 2. Why three — the mechanism, in pipeline order

Default surface: Where-next with the **Walkable** band (`WhereNextFlow.tsx` `DEFAULT_RADIUS`, `RADIUS_WALK`), open-now
filtering on (`hideClosedNow`), coordinates origin ("Near you").

1. **Pool** (`ResultsView.tsx` ~line 103): every catalog bar, minus closed-now bars (`excludeClosedBars`, with the
   60-minute opens-soon window). Opening hours reduce the pool here, before anything else.
2. **Geometry** (~line 136): for Walkable and Cab the pool is cut to bars within `RADIUS_CAB` (4 mi) **straight-line**.
   Nothing here knows what a 15-minute walk is.
3. **Order** (`matching.ts` `matches`): first the hard filters inside `matches` itself — the caller's exclude ids
   (on both home surfaces `visitedIds` **plus `shownIds`**: every "Run it again" removes the previous page of five
   from the pool, `WhereNextFlow.tsx` ~296-306), `CLOSED_PERMANENTLY` bars, bars whose `lastVerified` is older than
   365 days, and the quiz's preferred neighborhoods when any are set (`matching.ts:250`). **Correction (V10-05):
   the neighborhood filter is unreachable from both home surfaces** — Near you builds `autoProfile` with
   `preferredNeighborhoods: []` (`WhereNextFlow.tsx:166`, and `:169` for the no-vibe case) and "From {bar}" builds
   `seedProfile` with `preferredNeighborhoods: []` (`WhereNextFlow.tsx:624`); the saved quiz neighborhoods reach only
   the profile state at `:103`, which neither ranking call receives. Then, with `distanceBands: false` (every band
   except Nearby), the pool is one band ordered by score with exact miles **only as the tie-breaker**. Which score
   depends on the surface:
   - **Near you** (`WhereNextFlow.tsx` `autoProfile`): the saved quiz profile is **never** passed here. With no applied
     tweak the profile has no tags, so `rankScore` reduces to learned numeric taste (`deriveLearnedTaste` from rating
     history, weight = its confidence) **plus the late-night bias**: because the home surfaces pass `hideClosedNow`,
     `biasNow` is the live clock, and from 22:00 to 03:59 New York time every club/dance bar gets +0.12 and every
     restaurant-bar −0.12 (`lateNightAdjustment`, `matching.ts:149-154`, `constants.ts` `LATE_*`). **Correction
     (V10-05): the club/dance check runs first**, so a venue tagged both `club`/`dance` and `restaurant-bar` gets the
     +0.12 and no penalty; the −0.12 applies only to restaurant-bars that are not also clubs. On an account with no ratings the pool is
     otherwise all-zero, so at bar o'clock that nudge alone ranks every club within 4 miles ahead of every nearer
     bar — the second fixture below. An account with ratings orders its 4-mile pool by taste; with neither, scores tie
     and the tie-breaker makes it nearest-first (the older `sends only the nearest 15` test).
     An **applied** Tweak-the-vibe pick switches to the explicit path (`explicitVibeScore`, with the D-C-41 gate that
     drops non-matching bars before the cut). Retaking or clearing the quiz changes nothing on this surface.
   - **"From {bar}"** (seed-bar path, `WhereNextFlow.tsx` ~336): the seed bar's tags are passed as a non-explicit
     prior, so `rankScore` blends that prior with learned taste — the branch the fixture below drives.
4. **Cut** (~line 150): the first `ROUTE_CANDIDATE_CAP` = **15** of that order are the only bars ever sent to routing.
5. **Routing** (`routeSearch.ts` `searchRoutes`): walking matrix in batches of 5, stopping early once 5 eligible
   are found. Walkable eligibility (`matchesTravelBand`, `travelTime.ts:33-41`) = the destination inside the
   service-area bounding box (`SERVICE_AREA_BBOX`, checked first for every band except Nearby; a bar outside it never
   qualifies whatever its route), then ≤ 4 mi straight-line (`RADIUS_CAB`), then a confirmed walking estimate with
   time ≤ `WALKABLE_SECONDS` (900 s ≈ 0.7 mi). Unknown routes (`null`) never qualify. At most 5 are returned; nothing
   is ever padded.
6. **Render**: `ranked` = the confirmed routes in the band, capped at 5.

So for a taste-bearing account the fifteen slots go to its best-matching bars anywhere up to four miles out, and only
those are asked for a walking route. If three of the fifteen are within a 15-minute walk, the page shows three —
while nearer bars that *would* have been walkable were never routed, because taste ranked them below the cut. The
result is correct for the pool as defined: fewer than five is eligibility exhausted **within the 15 the ranking
chose**, not a provider shortfall.

Secondary contributors, each measurable in the same code and each reducing the count, not explaining it alone:
- open-now filtering (step 1) — late in the evening the pool is smaller before ranking starts;
- the hard filters inside `matches` (step 3): tonight-exclusion and Run-it-again history, permanently closed bars,
  stale `lastVerified` (preferred neighborhoods are NOT a contributor on the home surfaces — see the correction in
  step 3). **Correction (V10-05) on Run-it-again:** `advanceShownIds` (`resultsRefresh.ts:38`) returns `[]` when the
  last page ranked fewer than `RESULTS_COUNT` bars, so after a three-result page the next Run it again does not exclude
  those three — it re-deals the same pool and can show the same three again. The history only accumulates from full
  pages of five (`WhereNextFlow.tsx:251`);
- an applied vibe (D-C-41 gate) — the pool is filtered to matching bars before the cut, so a narrow vibe plus Walkable
  can legitimately have fewer than five eligible bars in the whole area;
- a provider batch failure (`incomplete`) — visible as its own sentence, kept;
- a valid matrix answer with `null` cells (no route found for that pair): those bars are excluded from the band without
  setting `incomplete`, silently — the matrix succeeded, the pair is unroutable.

## 3. Reproducible fixture

`src/components/ResultsView.routing.test.tsx` — `V9-01: a taste-ordered walkable search can confirm only three because
the 15-candidate cut precedes routing`. Twenty bars within 4 miles: 3 cocktail bars a 5-minute walk away, 14 cocktail
bars 2–3 miles out, 3 pubs a few blocks away; a non-explicit `cocktail` prior (the seed-bar branch of `rankScore`,
which has the same score-then-miles shape as the rating-history branch Near-you uses), Walkable band. Asserts: exactly
15 candidates are routed, all cocktail, **none of the nearer pubs**; with the three near routes confirmed the page
renders three cards and "Your next 3 bars"; neither removed sentence appears; attribution does. Red on the previous
copy (verified by a snapshot/restore probe), green now. The routing hook is mocked: the fixture proves the taste-first
cut and the copy, not `searchRoutes` itself — the per-batch eligibility rules are pinned by `routeSearch.test.ts`.

Second fixture, the Near-you variant — `V9-01: at bar o'clock the late-night bias alone fills the 15 slots with far
clubs on Near you`: empty profile, no ratings, `hideClosedNow`, clock at 23:00 New York; 16 clubs 2–3 miles out and
3 pubs a few blocks away. Asserts: all 15 routed candidates are far clubs, none of the near pubs. The bias is the
only non-zero term, and it is enough.

What these fixtures do NOT prove: the owner's specific three. That needs the account's rating history (or whether a
tweak was applied), the origin, the hour (open-now) and the band at the time — none of which an unattended run may
fetch, and no live provider call is allowed here. Every path that produces "3 of 5 with 15 checked" for a coordinates origin runs through the same cut-before-routing
step; which score fills the fifteen slots (ratings, an applied tweak, the late-night bias, or a seed bar's tags) is the
part that needs the account's state to name.

## 4. Decision left for the owner (not made here)

**Open question for the owner — recommendation: pre-rank Walkable by walkability** (order the 4-mile pool so the 15
routed candidates are the ones that can plausibly be walked). Whether the Walkable band should pre-rank by walkability (e.g. order the 4-mile pool so the 15 routed candidates are
the ones that can plausibly be walked, or cut the Walkable pool at a walking-scale straight-line radius before
taste-ordering) is a ranking change — V8's cascade is "distance band → learned taste → exact miles" and today the inner
bands skip the distance-band step. Changing it alters which bars are shown, not only how many, and the queue says to
record the cause first. The fixture above is the regression to extend when that decision is taken. Raising the cap
(more provider elements per search) is the other lever and is a budget decision, also not taken here.

Deferred by the owner on 2026-09-08 and untouched: the zero-to-loaded transition.
