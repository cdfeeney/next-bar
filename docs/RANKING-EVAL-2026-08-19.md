# Ranking release evaluation — V8 D2 cascade vs. the weighted-sum ranker

**Date:** 2026-08-19 · **Lane:** rank-eval (evidence only — no ranker behavior was changed)

## What was measured, and against what

| | |
|---|---|
| Measured commit | `d17394886310041d6240e6ecf3465a85a11bcf19` |
| `src/lib/matching.ts` blob | `1a6929a9b2abeddf49c2a3a8d43c3089ca5df039` |
| `src/lib/tasteAffinity.ts` blob | `38249a3d77529627f8aec5ff51e55ffb7e85e8e8` |
| Baseline ("previous ranker") | weighted sum VIBE 0.5 / DIST 0.4 / RATING 0.1 with adaptive-Jaccard admission, recovered from `2221cbf` (the parent of `233009a`) |
| Seed | `20260819` |
| Catalog | 403 bars, 35 distinct vibe tags (the real `src/lib/bars.ts`) |
| Page size | `RESULTS_COUNT` = 5 |
| Users per segment | 300 |

The baseline lives at `src/lib/__evals__/previousRanker.ts`. It is a measurement
artifact and is imported by nothing outside `__evals__`; its deleted constants
are re-declared locally rather than restored to `constants.ts`.

Reproduce:

```
npx vitest run src/lib/__evals__/rankingReplay.eval.test.ts --disable-console-intercept --reporter=verbose
```

Same seed, same commit, same numbers — asserted by the spec's
`is reproducible` case, which re-runs a whole segment and requires byte-equal
results.

## Results

| segment | users (n) | median ratings | held-out pool | cascade NDCG@5 | prev NDCG@5 | NDCG delta (95% CI) | cascade median mi | prev median mi | miles delta |
|---|---|---|---|---|---|---|---|---|---|
| 0-4 ratings | 300 | 2 | 400 | 0.7957 | 0.8255 | **-0.0298** ± 0.0082 | 0.707 | 1.374 | -0.667 |
| 5-20 ratings | 300 | 13 | 389 | 0.8026 | 0.8155 | **-0.0129** ± 0.0094 | 0.795 | 1.516 | -0.721 |
| 100+ ratings | 300 | 124 | 278 | 0.8497 | 0.8282 | **+0.0215** ± 0.0105 | 0.841 | 1.547 | -0.706 |

Every segment carries n = 300 users, comfortably above the 30-user floor the
spec would have flagged as not meaningful; no segment is reported as an
average over too few users. "Held-out pool" is the median number of catalog
bars left after removing that user's rated bars — the set both rankers chose
their five from.

The NDCG delta is **paired per user** (both rankers saw the identical user,
identical pool) and its interval is a 95% normal CI on that paired difference.
All three intervals exclude zero, so all three differences are real at this
sample size, not noise.

## 1. Median distance of the five recommendations

Cascade: **0.707 / 0.795 / 0.841 miles** across the three segments.
Previous: **1.374 / 1.516 / 1.547 miles**.

The cascade roughly **halves** the median distance of a page in every segment.
This is the band-first step working exactly as specified, and it is the
cascade's largest measured effect by a wide margin.

## 2. Held-out NDCG@5

Cascade: **0.7957 / 0.8026 / 0.8497**. Previous: **0.8255 / 0.8155 / 0.8282**.

Relevance ground truth is the synthetic user's latent per-tag utility; gain is
linear in utility and the ideal DCG is taken from the best five bars actually
present in that user's held-out pool, so 1.0 means "picked the five best that
existed", not an unreachable ceiling.

## 3. Segmentation by rating history

Reported in the table above at 0-4, 5-20 and 100+ ratings.

## 4. Comparison against the previous ranker — **where the cascade is worse**

Stated plainly, because this is the part of the report that is worth having:

- **The cascade is WORSE on taste relevance at cold start.** At 0-4 ratings it
  loses 0.0298 NDCG@5 (CI ±0.0082) to the ranker it replaced. That is the
  largest regression in the table and it lands on exactly the users who have
  given the product the least — new ones.
- **It is still WORSE at 5-20 ratings**, by 0.0129 (CI ±0.0094). Smaller, and
  the interval only just clears zero, but it is a loss and it is real.
- **It only wins on taste at 100+ ratings**, by 0.0215 (CI ±0.0105).

This is the shape `c = N/(N+10)` predicts: with N = 2 the learned term carries
c ≈ 0.17 and the page is ordered almost entirely by the quiz prior *within a
distance band*, whereas the old ranker let vibe Jaccard drive the whole pool at
weight 0.5. Taste evidence has to accumulate before band-first ordering pays
for the freedom it gives up.

**What the trade actually is:** roughly 0.03 NDCG at cold start, decaying to a
0.02 gain by 100+ ratings, bought with ~0.7 miles off the median page
everywhere. Whether that is a good trade is a **product** decision and this
report does not make it. No oracle here weighs a mile against a unit of taste
relevance; inventing one would have meant inventing the answer. The two numbers
are reported side by side on purpose.

Note also that taste-NDCG structurally disadvantages a band-first ranker: the
cascade is *not permitted* to reach into a farther band for a better-matching
bar while a nearer band can still fill the page. The regression at 0-4 is
therefore a measurement of the design, not evidence of a defect in it.

## 5. Cascade invariants — all three hold

Checked on **every one of the 900 pages**, against the same post-filter pool
`matches()` itself ranked (`src/lib/__evals__/cascadeInvariants.ts`):

- **Closest-band-first** — 0 violations. Each band contributed exactly
  `min(slots remaining, bars available in that band)`, band 0 before band 1
  before band 2.
- **Learned-taste-within-band** — 0 violations. The bars taken from a band were
  its top scorers by `rankScore`, in non-increasing score order, with no
  higher-scoring bar in that band skipped.
- **Exact-miles-final-tie-break** — 0 violations. Where two adjacent results
  had bit-exact equal scores, the nearer came first, and miles never decided a
  non-tie.

## Follow-ups (recorded, not fixed here)

**F1 — near-tie ordering is decided by float noise, not by miles (LOW).**
7 of 900 pages contained adjacent results whose `rankScore` differed by
≤ 1e-12 — observed deltas were 8.7e-19 to 2.8e-17, i.e. bars that are
mathematically tied — yet were ordered **farther-first**. The cause is that
`matches()` breaks ties with `b.score - a.score || a.miles - b.miles`, which
falls through to miles only on *bit-exact* equality; `learnedTasteScore` sums a
bar's tags in catalog order, so two bars with the same tag set summed in a
different order land a few ULPs apart. Worst observed case: a 0.48-mile bar
placed above a 0.01-mile bar. Real but small (0.8% of pages, and the affected
pairs are genuinely equal in taste). The fix is a comparator epsilon, which is
a ranker behavior change and therefore belongs to its own goal — this lane must
not make it.

## Threats to validity — read before quoting these numbers

1. **The users are synthetic.** There is no logged rating history to replay, so
   users are generated from a latent per-tag utility vector and their scores are
   derived from it (`5.5 + 4.5·utility + N(0, 0.75)`, clamped to 1–10). The
   ground truth is therefore exact, at the cost of assuming taste is *linear and
   additive over tags* — which is also the shape `tasteAffinity.ts` assumes.
   That shared assumption flatters the cascade's learned term and is the single
   biggest reason to treat the 100+ result as an upper bound.
2. **Rated bars are drawn uniformly from the catalog**, not weighted toward the
   user's home or taste. A real history is biased on both axes. Uniform is the
   choice least likely to hand the cascade its own distance prior back as
   evidence, but it is still a choice.
3. **The 100+ segment is unrealistic at this catalog size.** A median of 124
   ratings against 403 bars means the user has rated 31% of the catalog and the
   held-out pool has shrunk to 278. The direction of that result is trustworthy;
   the magnitude is not directly transferable to a larger catalog.
4. **`lovedTags` for the baseline is reconstructed**, not replayed: score ≥ 8.0
   stands in for a legacy Loved. The old ranker weighted that term at 0.1, so
   the reconstruction has limited leverage on the comparison.
5. **The baseline omits the shared filters** (excludeIds, CLOSED_PERMANENTLY,
   lastVerified, neighborhood, radius) because both rankers are handed the same
   already-filtered pool — the comparison isolates ranking, not filtering. It
   also omits the exploration slot, which fired only at cap ≥ 10 and never on a
   5-slot page.
6. **Late-night bias is off** (`biasNow` omitted), so these numbers describe the
   planning surface, not a 1am live page.
