# Plan — Mass Bar Import + Sentiment Tagging

**Branch:** `feat/bar-mass-import` · **Worktree:** `C:\Users\cdfee\projects\nb-import`
**Created:** 2026-07-26 · **Tier:** T1 (substantial) — no live-revenue surface, but it rewrites the catalog the whole product ranks on.

---

## 1. Why this is a blocker

`matching.ts` ranks every result as:

```
score = VIBE_WEIGHT·jaccard(userTags, bar.tags)
      + DIST_WEIGHT·proximity
      + RATING_WEIGHT·jaccard(bar.tags, lovedTags)
```

Two of the three terms are **pure functions of `bar.tags`**. Distance is the only term that doesn't depend on tag quality. So the tag vocabulary applied to each bar *is* the recommendation engine — the quiz, the pairwise scoring, `tasteProfile.ts`, and the loved-affinity nudge all collapse to set intersection over `VibeTag[]`.

Right now tags come from `heuristicTags()` in `scripts/ingest-bars.ts`: a regex over the **bar's name** plus a small OSM/Google `types` map, with `if (tags.size === 0) tags.add('cocktail')` as the fallback. That means a bar called "The Otheroom" gets tagged `cocktail` because nothing matched. Name-regex cannot distinguish a dive from a date spot, and that is exactly the distinction the product sells.

Second blocker, quieter: `LAST_VERIFIED_HARD_FILTER_DAYS = 365` in `constants.ts` **hard-filters bars out of results** once `lastVerified` is over a year old. Any mass import must stamp `lastVerified` and needs a re-verification story, or the catalog silently shrinks on a rolling basis.

## 2. Scope decision (settled 2026-07-26)

**Product scope = all of Manhattan.** Not one neighborhood. Users cross neighborhoods on a single night; a neighborhood-scoped bar app breaks at the boundary. Marketing concentration and product scope are separate axes — concentrate the *push*, not the *coverage*.

Current state, counted from `src/lib/bars*.ts` (384 bars, 17 neighborhoods):

| Manhattan | n | Outer boroughs | n |
|---|---|---|---|
| Chelsea | 28 | Greenpoint | 28 |
| East Village | 27 | Bushwick | 26 |
| FiDi | 27 | Williamsburg | 22 |
| UWS | 27 | Park Slope | 21 |
| UES | 27 | Astoria | 21 |
| LES | 23 | LIC | 18 |
| West Village | 21 | Fort Greene | 14 |
| Midtown | 20 | | |
| SoHo | 18 | | |
| Harlem | 16 | | |
| **Hell's Kitchen** | **0** | | |
| **~234** | | **~150** | |

Two gaps fall out:

1. **Hell's Kitchen is in the `Neighborhood` union with zero bars.** One of the densest bar corridors in Manhattan, entirely missing.
2. **`scripts/ingest-bars.ts` `AREAS` is wrong for this goal** — it omits Hell's Kitchen, Harlem, and SoHo, and spends four of its twelve entries on Brooklyn.

**Target: ~60 bars per Manhattan neighborhood × 11 = ~650 Manhattan bars.** Outer-borough bars stay in the repo (no deletion) but move behind a `city`/`borough` scope flag so they can be re-enabled when Brooklyn is a deliberate launch rather than drift.

## 3. Pipeline

```
 [0] scope        AREAS → 11 Manhattan neighborhoods w/ real centroids + radii
       ↓
 [1] discover     Places searchText (paged) + OSM fallback → candidates.json
       ↓          dedupe vs existing catalog by name + place_id + geo proximity
 [2] enrich       Places Details → coords, address, hours, businessStatus,
       ↓          priceLevel, rating, photos (N), reviews (≤5)
 [3] infer        LLM: reviews + signals → VibeTag[] + priceTier + blurb
       ↓          CLOSED vocabulary, schema-validated, confidence-scored
 [4] validate     schema + tag-vocab + bbox guard + dupe + distribution sanity
       ↓
 [5] emit         src/lib/bars.manhattan-<batch>.ts + sidecar patch → PR
```

Stages 1 and 2 mostly **exist already** — `scripts/ingest-bars.ts` (discovery) and `scripts/refresh-places.mjs` (details/photos/reviews, with `--photos`, `--photos-multi`, `--reviews` modes, FieldMask-scoped, sidecar-patch architecture with a wrong-venue bbox guard). Do not rewrite these. Extend them.

**Stage 3 is the net-new work and the whole point of the project.**

### Stage 3 design — sentiment → tags

**Input per bar** (all already available post-stage-2):
- name, formatted address, neighborhood
- Google `types[]` / OSM signals
- `priceLevel` (1–4) and `rating`
- up to 5 review snippets (author, rating, text)
- editorial summary if the SKU returns one

**Output — strict JSON, validated before it touches the catalog:**

```jsonc
{
  "tags": ["dive", "cheap", "locals", "old-nyc"],  // ⊆ the 33-value VibeTag union
  "priceTier": 1,                                   // 1|2|3|4
  "blurb": "…",                                     // ≤120 chars, plain, no ad-copy
  "confidence": 0.0                                 // 0–1; low → manual review queue
}
```

**Hard rules:**
- `tags` must be a subset of the `VibeTag` union in `src/types/index.ts` (33 values across 6 facets: type / energy / crowd / texture / music / price). **Reject and retry** on any out-of-vocab tag — never coerce, never silently drop.
- Exactly one price tag (`cheap`/`mid`/`pricey`/`splurge`) and it must agree with `priceTier`.
- Target 4–7 tags. Jaccard punishes both extremes: too few starves the intersection, too many inflates the union denominator and flattens the score.
- `confidence < 0.6` or fewer than 2 reviews → **manual review queue**, not the catalog.

**Model:** `gemini-2.5-flash` (same tier already proven on Conor's Cards recognition; lite is too weak for nuance). Batch ~20 bars per call, one retry on schema failure, then queue.

### Known limitation — flag before building

Google Places returns **≤5 reviews, and `refresh-places.mjs` already truncates text to ≤200 chars**. That is a thin signal for vibe inference. Three honest options:

- **(a) Accept it.** ~1000 chars/bar is enough for coarse facets (dive vs cocktail, cheap vs splurge) and unreliable for subtle ones (`industry`, `old-nyc`, `romantic`). Cheapest, ships now.
- **(b) Widen the source.** More reviews per bar from another provider. Raises cost and ToS exposure — see §6.
- **(c) Hybrid.** Ship (a), then let real user pairwise data correct tags over time. `pairwise.ts` already produces a 0–10 score; the same signal can back-propagate to tags once there's volume.

**Recommend (a) now, (c) as the arc.** Do not build (b) without an explicit decision — it's where the legal risk lives.

## 4. Build order

| # | Step | Output | Gate |
|---|---|---|---|
| 1 | Rewrite `AREAS` → 11 Manhattan neighborhoods, correct centroids/radii | `ingest-bars.ts` | HK/Harlem/SoHo present |
| 2 | Add `--city`/`--borough` scope flag; tag outer-borough bars, don't delete | `types`, `bars.ts` loader | outer bars excluded from default results, tests green |
| 3 | Paged discovery run, Manhattan only | `scripts/data/candidates.json` | ≥400 net-new deduped candidates |
| 4 | Stage-2 enrichment over candidates | sidecar patch + photos | ≥90% resolve inside bbox |
| 5 | **Build `scripts/infer-vibes.ts`** — the sentiment stage | tags/priceTier/blurb per bar | schema-valid, 0 out-of-vocab |
| 6 | Validation pass + distribution report | `scripts/data/import-report.json` | no tag >60% frequency; no bar <3 tags |
| 7 | Golden-set eval: 30 bars you personally know, hand-tag, score vs model | eval report | ≥70% tag agreement (Jaccard) |
| 8 | Emit + PR | `bars.manhattan-*.ts` | `gates` CI green |

**Step 7 is the real gate.** Without a hand-labeled golden set there is no way to know whether the sentiment stage improved anything or just replaced one kind of wrong tag with another. Do it before the big spend, on a 30-bar sample.

## 5. Testing (T1 substantial)

- Unit: `heuristicTags` replacement, vocab validator, price/tag agreement, dedupe by name + geo, bbox guard.
- Integration: fixture-driven run of stages 3→5 with recorded API payloads — **no live API calls in CI.**
- Regression: `matching.ts` result quality on the golden set before vs after. This is the one that says whether the project worked.
- The existing `LOOP_UNATTENDED=1` guard in `ingest-bars.ts` must also cover the new inference script — LLM spend during an unattended overnight loop is the same failure mode as Places spend.

## 6. Cost + ToS — resolve before the big run

- **Verify current Google Places SKU pricing before batch-running.** Details-with-`reviews` is the **Enterprise** field tier (the script's own comment flags this) and is materially more expensive than the basic tier. Do not assume old numbers; price a 50-bar run first and extrapolate.
- **Reviews carry a caching restriction.** Google's terms limit how long Places content may be stored, and require visible attribution for photos and reviews (already honored via `photoAttribution`). Storing review *text* permanently in a git repo is a real question — the safer shape is: fetch reviews → derive tags → **persist the derived tags, discard the raw text.** That also shrinks the bundle. Decide this explicitly.
- Gemini Flash cost for ~650 bars batched at 20/call is negligible relative to Places.
- Set a hard spend ceiling on the run and log actual spend to `import-report.json`.

## 7. Non-goals

- No Brooklyn/Queens expansion — scope flag only.
- No schema migration to a `city` table yet. Note it as a follow-up: `Neighborhood` is a hardcoded string union with `ManhattanNeighborhood` as a deprecated alias, and there is **no `city` column in migrations 0000–0016**. That must become first-class before a second city, but it is not this PR.
- No monetization surface, no venue-claim work.
- No writes to `main` — PR only, `gates` CI required, squash merge.
