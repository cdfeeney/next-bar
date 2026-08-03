# Design: direct numeric ranking control (g-4ed5f834)

**Status:** DESIGN ONLY — nothing here is implemented. Written 2026-08-03 in
response to operator testing feedback: *"I can add a bar but I still can't put
in the number that I want for it… I want to set scores like 9.3/9.4/1.3 per
bar and/or allow multiple 10s, not only tiers + automatic pairwise scoring."*

## 1. Current system (verified against code)

- A rating is a **tier** (`loved`/`liked`/`pass`) plus an optional **derived
  score** (`BarRating.score`, `src/types/ratings.ts`).
- Scores come ONLY from pairwise-comparison replay (`src/lib/pairwise.ts`):
  each tier owns a fixed band (Loved 8.0–10.0, Liked 5.0–8.0, Pass 0.0–5.0),
  compared bars interpolate across the band, uncompared bars sit at the band
  midpoint and render as `~9.0` (tentative).
- Consequences the operator is hitting:
  - You can never TYPE a number. The only lever is answering comparison
    prompts.
  - Interpolation makes ties effectively impossible — only the tier's top bar
    can hold 10.0, so "multiple 10s" cannot exist.
  - A score like 1.3 requires a Pass rating plus Pass-vs-Pass comparisons,
    which are deliberately never prompted (Q2 decision).
- Server: `ratings` table already stores `tier` + `score`
  (`src/lib/ratings.server.ts` upsert), synced per user. Local mode stores the
  same shape in localStorage.

## 2. Requirements (from operator feedback)

1. Set an exact score per bar, one decimal, 0.0–10.0 (e.g. 9.3, 9.4, 1.3).
2. Ties allowed — several bars may hold 10.0.
3. Entry point is /rankings (rank only from Rankings or the future
   post-night-out flow — the map/lightbox entry is gone as of 2026-08-03).
4. Don't destroy the existing flow for users who *like* tier-tap + compare:
   the comparison chain is the product's signature interaction. (Assumption —
   flagged for operator confirmation; "and/or" in the ask leaves room.)

## 3. Options considered

### Option A — manual score override on top of tiers (RECOMMENDED)

Add `manualScore?: number | null` to `BarRating` (and a `manual_score numeric`
column via a NEW migration — never 0037/0038, which stay unapplied).

- **Sorting/display:** `effectiveScore = manualScore ?? pairwiseScore ??
  tierMidpoint`. Manual scores render solid (no `~`), ties sort by most
  recently rated.
- **Setting it:** tap the score on any /rankings row → inline numeric stepper
  (0.0–10.0, one decimal, numeric keyboard on mobile). The tier sheet gains an
  optional "Set a score instead →" input under the three tier buttons.
- **Tier interplay:** typing a score outside the current tier's band re-tiers
  the bar to the band that contains the score (9.3 → Loved, 1.3 → Pass), so
  badges, Want-to-go pruning, and the map's rated ring stay consistent.
  Manual bars are EXCLUDED from pairwise interpolation replay (they no longer
  hold a slot in the tier's rank order) but can still be offered as comparison
  PEERS for automatic bars.
- **Clearing:** "Use comparisons again" affordance on a manually-scored row
  drops `manualScore` and returns the bar to the pairwise pool.
- **Pros:** additive; zero behavior change for anyone who never types; ties
  trivially allowed; local + server schema change is one optional field.
- **Cons:** two scoring sources to explain; needs a small UI cue
  distinguishing manual from derived scores (e.g. no `~`, subtle "set by you"
  sublabel).

### Option B — numeric-first (replace pairwise)

Tier sheet becomes a single numeric input; comparisons removed.

- Pros: one mental model, dead-simple.
- Cons: destroys the signature Beli-style flow and all existing transcripts;
  contradicts the standing "the ranking is the product" decision; heavy e2e
  churn. Rejected unless the operator explicitly wants pairwise gone.

### Option C — score nudge arrows (no typing)

±0.1 arrows on each row adjusting the derived score.

- Pros: tiny.
- Cons: doesn't satisfy "put in the number I want" (9.3 from 5.0 is 43 taps);
  still fights the replay model, which recomputes and would overwrite nudges.
  Rejected.

## 4. Recommended plan (Option A), phased

1. **T1 groundwork:** `manualScore` in types + localStorage schema (versioned
   upgrade), `effectiveScore` helper in `lib/pairwise.ts` with unit tests
   (override wins, band→tier mapping, exclusion from interpolation, ties
   stable-sort by recency).
2. **UI:** /rankings row score → tap-to-edit numeric input; tier sheet gains
   the optional direct-score input. e2e: set 9.3, see 9.3 solid and re-sorted;
   two bars at 10.0 both render 10.0 (tie pin); typing 1.3 re-tiers to Pass
   badge (negative pin: no comparison prompt fires for a manual score).
3. **Server sync:** new migration `00xx_manual_score.sql`
   (`ALTER TABLE ratings ADD COLUMN IF NOT EXISTS manual_score numeric`),
   `upsertServerRating` passes it through; cross-device merge rule = latest
   `updated_at` wins (same as tier today).
4. **Santa panel** per T1 (Claude+Codex+GLM+DeepSeek); staging deploy only
   with operator approval.

## 5. Open questions for the operator

1. Keep the comparison prompts as the default for tier-taps, with typing as
   an override (Option A) — or replace comparisons entirely (Option B)?
2. Should typing 9.3 on a Liked bar silently re-tier it to Loved, or ask?
3. Should manually-scored bars still be offered as comparison peers for
   automatic bars (recommended: yes), or fully leave the pairwise pool?
