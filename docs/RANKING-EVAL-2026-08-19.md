# Ranking release evaluation — V8 D2 cascade vs. the weighted-sum ranker

**Date:** 2026-08-19 · **Lane:** rank-eval (evidence only — no ranker behavior was changed)

## What was measured, and against what

Two different revisions matter here and the table keeps them apart. The
**measured ranker revision** is the frozen `matching.ts` / `tasteAffinity.ts`
these numbers describe. The **evaluator revision** is the harness that produced
them — which is this document's own commit, because the report and the four
files under `src/lib/__evals__/` ship together and none of them existed at the
measured ranker revision. Running the reproduce command *at* `d1739488` is
therefore impossible; run it at the evaluator revision, where `matching.ts` and
`tasteAffinity.ts` are still the frozen blobs named below.

| | |
|---|---|
| Measured ranker revision | `d17394886310041d6240e6ecf3465a85a11bcf19` |
| Evaluator revision (harness + this report) | this document's own commit — `git log --oneline -- docs/RANKING-EVAL-2026-08-19.md src/lib/__evals__/` |
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

**Timeouts are budgeted explicitly.** vitest's defaults are a 10s hook timeout
and a 5s test timeout, and `vitest.config.ts` overrides neither. The 900-user
hook measures ~3s and the single-segment reproducibility case ~1-2s here, which
is comfortable but unbudgeted — so the spec passes 120s and 60s explicitly. A
slower machine now produces a slow run rather than a red `npm test` that looks
like a ranker regression and is not one.

**This spec is part of `npm test`.** `src/lib/__evals__/**` matches the vitest
config's include glob, so the 900-user replay runs in the ordinary suite (~13s
here, of which ~3s is the replay itself and the rest is jsdom setup and module
load). The heavy work is in `beforeAll`, not in the `describe` body: in the body
it ran at COLLECTION time, which meant every `npm test` paid for it whatever was
selected, `-t` could not skip it, and a failure surfaced as a suite collection
error instead of a failing test. If the replay ever needs to leave the default
gate, that is a change to `vitest.config.ts` and belongs to a goal that owns
that file — not to this one.

**Scope of that guarantee.** The `is reproducible` case re-runs in the same
process, so it proves the replay is a pure function of the seed but cannot by
itself prove the seeded draw *sequence* is engine-independent. That property is
held by construction instead: every random draw is one call to the LCG in
`makeRng`, and no draw happens inside a sort comparator, so the number of draws
does not depend on V8's comparison schedule. An earlier version of this harness
violated that — the quiz-tag sort called `rng()` twice per comparison — which
made the comparator intransitive and the whole downstream stream
engine-defined. It was found in review and fixed before these numbers were
taken; **the table below is from the fixed harness** and differs from the first
draft's numbers for that reason.

## Results

| segment | users (n) | median ratings | held-out pool | cascade NDCG@5 | prev NDCG@5 | NDCG delta (95% CI) | random-arm NDCG@5 (floor) | cascade median mi | prev median mi | miles delta |
|---|---|---|---|---|---|---|---|---|---|---|
| 0-4 ratings | 300 | 2 | 400 | 0.7994 | 0.8334 | **-0.0340** ± 0.0086 | 0.6615 | 0.683 | 1.521 | -0.837 |
| 5-20 ratings | 300 | 12 | 390 | 0.8091 | 0.8172 | **-0.0080** ± 0.0095 | 0.6540 | 0.811 | 1.598 | -0.787 |
| 100+ ratings | 300 | 125 | 278 | 0.8503 | 0.8276 | **+0.0228** ± 0.0108 | 0.6635 | 0.805 | 1.687 | -0.883 |

Every segment carries n = 300 users, comfortably above the 30-user floor the
spec would have flagged as not meaningful; no segment is reported as an
average over too few users. "Held-out pool" is the median number of catalog
bars left after removing that user's rated bars — the set both rankers chose
their five from.

**Read the NDCG column against the floor, not against 0.** Gain is affine in
utility, and an unrelated bar has utility ≈ 0 and therefore gain ≈ 0.5, so
NDCG@5 here does not bottom out at zero. The `random-arm` column measures where
it does bottom out: five bars drawn at random from the same held-out pool score
**0.654–0.664**. The usable range is therefore about **0.34 wide, not 1.0**, and
the cold-start regression of 0.0340 is roughly **10% of achievable headroom** —
not the 3.4% a 0-to-1 reading suggests. The floor arm is driven by its own
generator seeded per user, so it perturbs nothing else in the table.

The NDCG delta is **paired per user** (both rankers saw the identical user,
identical pool) and its interval is a 95% normal CI on that paired difference.
The 0-4 and 100+ intervals exclude zero; **the 5-20 interval does not**
(-0.0080 ± 0.0095), so that segment shows no separation between the two
rankers at n = 300 and must not be quoted as a regression.

## 1. Median distance of the five recommendations

Cascade: **0.683 / 0.811 / 0.805 miles** across the three segments.
Previous: **1.521 / 1.598 / 1.687 miles**.

The cascade roughly **halves** the median distance of a page in every segment.
This is the band-first step working exactly as specified, and it is the
cascade's largest measured effect by a wide margin.

## 2. Held-out NDCG@5

Cascade: **0.7994 / 0.8091 / 0.8503**. Previous: **0.8334 / 0.8172 / 0.8276**.

Relevance ground truth is the synthetic user's latent per-tag utility; gain is
linear in utility and the ideal DCG is taken from the best five bars actually
present in that user's held-out pool, so 1.0 means "picked the five best that
existed", not an unreachable ceiling.

## 3. Segmentation by rating history

Reported in the table above at 0-4, 5-20 and 100+ ratings.

## 4. Comparison against the previous ranker — **where the cascade is worse**

Stated plainly, because this is the part of the report that is worth having:

- **The cascade is WORSE on taste relevance at cold start.** At 0-4 ratings it
  loses 0.0340 NDCG@5 (CI ±0.0086) to the ranker it replaced. That is the
  largest regression in the table and it lands on exactly the users who have
  given the product the least — new ones.
- **It is still WORSE at 5-20 ratings**, by 0.0080 (CI ±0.0095). Note this
  interval **does not exclude zero**: at 5-20 ratings the two rankers are not
  separated at n = 300. Read it as "no measured taste advantage either way",
  not as a confirmed loss.
- **It only wins on taste at 100+ ratings**, by 0.0228 (CI ±0.0108).

This is the shape `c = N/(N+10)` predicts: with N = 2 the learned term carries
c ≈ 0.17 and the page is ordered almost entirely by the quiz prior *within a
distance band*, whereas the old ranker let vibe Jaccard drive the whole pool at
weight 0.5. Taste evidence has to accumulate before band-first ordering pays
for the freedom it gives up.

**What the trade actually is:** roughly 0.034 NDCG at cold start, passing
through no measurable difference at 5-20, to a 0.023 gain by 100+ ratings,
bought with ~0.8 miles off the median page everywhere. Whether that is a good trade is a **product** decision and this
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
- **Exact-miles-final-tie-break** — 0 violations **at bit-exact score
  equality**, which is the only condition the ranker's own comparator fires on
  (`b.score - a.score || a.miles - b.miles`). Read that qualifier as load-bearing
  and read **F1 below with it**: under a float-tolerant definition of "tie" the
  same run found **6 counterexamples**, including a 1.49-mile bar placed above a
  0.24-mile one. The invariant as the ranker defines it holds; the ranker's
  definition of a tie is itself the open question. Not vacuously, either: the
  run recorded **1,012 bit-exact score ties** where the tie-break actually had
  something to decide. Zero violations of a check that never fires would be
  worth nothing, so the checker counts its own exercise (`exactTiesExercised`)
  and the spec prints a VACUOUS warning if that count is ever 0. Both the
  adjacent-pair case and the page-boundary case are covered — a tied-but-nearer
  bar left in the pool while a farther tied bar was taken is a violation even
  at cap 1, where no adjacent pair exists.

**The checker is itself tested.** `rankingReplay.eval.test.ts` plants two pages
that a naive checker accepts — a page whose per-band quotas are right but whose
band ORDER is wrong, and a cap-1 page that skips a tied-but-nearer bar — and
requires the checker to flag both. Without those cases "0 violations across 900
pages" could not be distinguished from a checker that cannot fail. Both cases
were in fact accepted by the first draft of `cascadeInvariants.ts`, which
partitioned the page by band before counting (discarding order) and compared
miles only between adjacent selected results.

## Follow-ups (recorded, not fixed here)

**F1 — near-tie ordering is decided by float noise, not by miles (LOW).**
6 adjacent PAIRS, on 6 distinct pages of 900, had results whose `rankScore` differed by
≤ 1e-12 — observed deltas were 2.8e-17 to 5.6e-17, i.e. bars that are
mathematically tied — yet were ordered **farther-first**. The cause is that
`matches()` breaks ties with `b.score - a.score || a.miles - b.miles`, which
falls through to miles only on *bit-exact* equality; `learnedTasteScore` sums a
bar's tags in catalog order, so two bars with the same tag set summed in a
different order land a few ULPs apart. Worst observed case: a 1.49-mile bar
placed above a 0.24-mile bar. The pair count and the page count are reported
separately because one page can contribute more than one pair; here they happen
to coincide at 6, which the spec now measures rather than assumes. Real but
small (0.7% of pages, and the affected
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
3. **The 100+ segment is unrealistic at this catalog size.** A median of 125
   ratings against 403 bars means the user has rated 31% of the catalog and the
   held-out pool has shrunk to 278. The direction of that result is trustworthy;
   the magnitude is not directly transferable to a larger catalog.
4. **`lovedTags` for the baseline is reconstructed**, not replayed: score ≥ 8.0
   stands in for a legacy Loved. The old ranker weighted that term at 0.1, so
   the reconstruction has limited leverage on the comparison.
5. **The baseline was diffed against git, not reconstructed from memory.**
   `previousRanker.ts` was checked character-for-character against
   `git show 2221cbf:src/lib/matching.ts` and `2221cbf:src/lib/constants.ts` —
   the three weights, `DIST_DECAY_MILES`, the four Jaccard constants,
   `scoreBar`'s body, `relaxTarget = Math.max(MIN_CANDIDATES, cap)`, and the
   fact that a threshold walk which reaches `JACCARD_FLOOR` without meeting
   `relaxTarget` keeps the SHORT candidate list rather than falling back to the
   full pool. Note `JACCARD_FLOOR` is still exported from the live
   `constants.ts` at the same value; the local copy is a deliberate duplicate so
   a future retune of the live constant cannot silently move the baseline. This
   is the assumption every comparison number rests on, so it is stated as a
   check that was performed, not as an intention.
6. **The baseline omits the shared filters** (excludeIds, CLOSED_PERMANENTLY,
   lastVerified, neighborhood, radius) because both rankers are handed the same
   already-filtered pool — the comparison isolates ranking, not filtering. It
   also omits the exploration slot, which fired only at cap ≥ 10 and never on a
   5-slot page.
7. **Late-night bias is off** (`biasNow` omitted), so these numbers describe the
   planning surface, not a 1am live page.
8. **The quiz prior is a modelled noisy self-report, and the cold-start result
   is sensitive to how noisy.** Each tag's latent value gets one draw of
   U(-0.2, +0.2) (sd 0.115) before the top 3 are taken, against a mean gap of
   about 0.056 between adjacent top latent values — so the quiz is deliberately
   an imperfect readout of taste. At 0-4 ratings `c = N/(N+10)` is ≈ 0.17, so
   roughly 83% of the cascade's within-band score IS that quiz prior, and the
   baseline both gates admission and weights vibe at 0.5 on the same tags.
   The -0.0340 cold-start regression is therefore the number in this report
   most sensitive to this modelling choice; a cleaner or noisier quiz would
   move it. The choice is stated rather than tuned, because tuning it to a
   preferred answer is exactly what this lane must not do.
