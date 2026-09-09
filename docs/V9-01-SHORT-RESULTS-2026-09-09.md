# V9-01 — why a Next Bar? search can show three, and the copy that used to narrate it

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
   60-minute opens-soon window) and minus the caller's exclude ids (tonight-exclusion). Opening hours reduce the pool
   here, before anything else.
2. **Geometry** (~line 136): for Walkable and Cab the pool is cut to bars within `RADIUS_CAB` (4 mi) **straight-line**.
   Nothing here knows what a 15-minute walk is.
3. **Order** (`matching.ts` `matches`): with `distanceBands: false` (every band except Nearby) the pool is one band,
   ordered by taste — `rankScore` = learned numeric taste blended with the quiz prior by confidence — with exact miles
   **only as the tie-breaker**. An account with quiz tags or rating history therefore orders its 4-mile pool by taste,
   not by distance. (An account with neither has all-equal scores, so the tie-breaker makes it "nearest first" — which is
   what the older `sends only the nearest 15` test exercises.)
4. **Cut** (~line 150): the first `ROUTE_CANDIDATE_CAP` = **15** of that order are the only bars ever sent to routing.
5. **Routing** (`routeSearch.ts` `searchRoutes`): walking matrix in batches of 5, stopping early once 5 eligible
   are found. Walkable eligibility = walking time ≤ `WALKABLE_SECONDS` (900 s ≈ 0.7 mi) and ≤ 4 mi straight-line
   (`matchesTravelBand`). Unknown routes (`null`) never qualify. At most 5 are returned; nothing is ever padded.
6. **Render**: `ranked` = the confirmed routes in the band, capped at 5.

So for a taste-bearing account the fifteen slots go to its best-matching bars anywhere up to four miles out, and only
those are asked for a walking route. If three of the fifteen are within a 15-minute walk, the page shows three —
while nearer bars that *would* have been walkable were never routed, because taste ranked them below the cut. The
result is correct for the pool as defined: fewer than five is eligibility exhausted **within the 15 the ranking
chose**, not a provider shortfall.

Secondary contributors, each measurable in the same code and each reducing the count, not explaining it alone:
- open-now filtering (step 1) — late in the evening the pool is smaller before ranking starts;
- tonight-exclusion ids (step 1);
- a selected vibe (D-C-41 gate) — the pool is filtered to matching bars before the cut, so a narrow vibe plus Walkable
  can legitimately have fewer than five eligible bars in the whole area;
- a provider batch failure (`incomplete`) — visible as its own sentence, kept.

## 3. Reproducible fixture

`src/components/ResultsView.routing.test.tsx` — `V9-01: a taste-ordered walkable search can confirm only three because
the 15-candidate cut precedes routing`. Twenty bars within 4 miles: 3 cocktail bars a 5-minute walk away, 14 cocktail
bars 2–3 miles out, 3 pubs a few blocks away; quiz prior `cocktail`, Walkable band. Asserts: exactly 15 candidates are
routed, all cocktail, **none of the nearer pubs**; with the three near routes confirmed the page renders three cards
and "Your next 3 bars"; neither removed sentence appears; attribution does. Red on the previous copy (verified by a
snapshot/restore probe), green now. It pins the mechanism so the ranking decision below is made on evidence.

What this fixture does NOT prove: the owner's specific three. That needs the account's ratings/quiz, the origin, the
hour (open-now) and the band at the time — none of which an unattended run may fetch, and no live provider call is
allowed here. The mechanism above is the only code path that produces "3 of 5 with 15 checked" for a coordinates
origin, which is what the screenshot's copy said.

## 4. Decision left for the owner (not made here)

Whether the Walkable band should pre-rank by walkability (e.g. order the 4-mile pool so the 15 routed candidates are
the ones that can plausibly be walked, or cut the Walkable pool at a walking-scale straight-line radius before
taste-ordering) is a ranking change — V8's cascade is "distance band → learned taste → exact miles" and today the inner
bands skip the distance-band step. Changing it alters which bars are shown, not only how many, and the queue says to
record the cause first. The fixture above is the regression to extend when that decision is taken. Raising the cap
(more provider elements per search) is the other lever and is a budget decision, also not taken here.

Deferred by the owner on 2026-09-08 and untouched: the zero-to-loaded transition.
