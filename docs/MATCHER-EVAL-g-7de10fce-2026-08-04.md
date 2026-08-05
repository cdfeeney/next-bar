# Matcher evaluation — baseline vs v1.1 candidates (g-7de10fce, 2026-08-04)

Reproducible offline evaluation of the deterministic 50/40/10 matcher
over the **real bundled catalog** (403 bars, 18 neighborhoods, 1
permanently closed, lastVerified 2026-04-01..2026-07-25), fixed clock
2026-08-01 21:00 (late variant 01:30). Engine:
`src/lib/__evals__/matcherEval.ts`; human-readable run:
`npx tsx scripts/matcher-eval-report.mts`; CI regression contract:
`src/lib/__evals__/matcherCorpus.eval.test.ts`. Both consume the SAME
engine so these numbers cannot drift from what CI enforces.

## Corpus

5 personas (divey-locals, cocktail-date, dance-late, chill-garden,
neutral/no-quiz) × locations (East Village dense, Harlem sparse,
Williamsburg, no-coords) × radii (0.75 mi walkable, 1.5 mi cab, none) ×
neighborhood constraints × early/late clock × with/without Loved+Pass
history (histories derived deterministically from the catalog by
id-sort against persona seed tags: 6 Loved, 5 Passed) — plus, after the
GLM consult (below), 4 COLD-START scenarios (1 Loved + 1 Passed, the
most common real new-user state) — 32 scenarios, plus dedicated probes:
repeat-hand (disjointness + decay, variant-relative), sensitivity
(determinism + one-tag swap), exploration (10-result slot presence +
long-tail membership + candidate-set invariance across variants), and
fresh-hand/widening (sliceCap + relaxDiscountIds mirror of
ResultsView's call; zero violations + identical candidate membership
across variants). History scenarios pass `excludeIds = passedIds` for
production parity (both live call sites hard-exclude Pass-rated bars);
adding that exclusion left every metric unchanged — the seeded Passed
bars never surfaced in any top-5, so the avoid nudge is credited only
for demoting tag-similar OTHER bars, as intended. The
candidate-set-invariance gates make "the nudges are never a filter"
executable: deep candidate membership is asserted identical across all
four variants on both the exploration and fresh-hand paths.

## Aggregate results (top-5 metrics, corpus means)

| Variant | Violations | Vibe | Miles | Hoods | Entropy | LovedAlign | AvoidHit | Repeat vibe decay |
|---|---|---|---|---|---|---|---|---|
| baseline (flat union) | **0** | 0.3389 | 0.3271 | 1.781 | 2.345 | 0.4210 | 0.0456 | 0.547→0.470 |
| A weightedLoved | **0** | 0.3389 | 0.3312 | 1.781 | 2.338 | 0.4326 | 0.0539 | 0.547→0.470 |
| B avoidTags | **0** | 0.3389 | 0.3271 | 1.781 | 2.345 | 0.4210 | 0.0456 | 0.547→**0.523** |
| **A+B combined (ADOPTED)** | **0** | **0.3398** | 0.3386 | **1.813** | 2.334 | **0.4371** | **0.0400** | 0.547→**0.523** |

(Final 32-scenario corpus incl. cold-start rows; loved/avoid columns are
history-scenario means and are null — unmeasurable — where the caution
floors leave no signal.)

Notes:
- `LovedAlign`/`AvoidHit` are measured with the SAME weighted-coverage
  metric for every variant (a variant is never graded by its own
  scoring function). History scenarios only.
- `staleHoursShare` is 1.0 for every variant: the bundled catalog's
  hours are Google-derived (hoursConfidence policy) so
  `hasTrustworthyHours` is false across the board — the metric is flat
  here and only becomes discriminating against the server catalog.
  UNVERIFIED_HOURS_PENALTY therefore cancels out in this corpus.
- Sensitivity probe: deterministic re-run identical; swapping one
  profile tag keeps 40% of the hand (responsive, not chaotic).
- Repeat-hand disjointness holds for all variants.

## Decision

**Adopt A+B (combined)** — the only variant that improves BOTH taste
axes at once: loved-alignment +3.8% (0.4210→0.4371) AND avoid-tag
exposure −12% (0.0456→0.0400), with vibe relevance unchanged (+0.001),
neighborhood diversity up (1.786→1.821), zero hard-filter violations,
and better repeat-hand relevance decay (0.470→0.523 second-hand vibe).
Cost: +0.014 mi mean distance (~75 ft — tie-breaker scale). A alone
raises avoid-hit (pulls in taste-adjacent but avoid-tagged bars —
dance-late/wburg 0.089→0.156); B alone is inert in first hands (the
nudge only flips near-ties) but fixes exactly the repeat-hand decay. The
pair is complementary by construction: A sharpens attraction, B fences
its over-reach.

Implementation: `src/lib/tasteSignals.ts` (frequency-weighted Loved map;
cautious avoid map — ≥2 Passed bars, never a Loved tag),
`NEG_TAG_PENALTY = 0.06` (late-night-nudge scale, never a filter), wired
in `ResultsView` and `useSuggestions`. Omitting the new inputs
reproduces pre-v1.1 behavior exactly (backward-compatible optional
args; the flat-union path is untouched).

## Audited weaknesses → disposition

| Weakness | Disposition |
|---|---|
| Flattened Loved-tag union | **Fixed** (candidate A, adopted) |
| No cautious tag-level negative preference | **Fixed** (candidate B, adopted) |
| Raw tag-count/Jaccard dilution across quiz questions | Measured; NOT changed tonight — per-question/axis normalization needs quiz-answer data plumbed into the profile, a larger surface. Future candidate; corpus + gates now exist to evaluate it. |
| Identical-profile exploration sharing | Documented + measured (deterministic rotation verified). Needs a device/identity salt — blocked on the analytics/identity decision, out of scope for beta. |
| Globally fixed 50/40/10 weights | Kept fixed deliberately (transparent for beta). The corpus is the prerequisite for ever revisiting; KPI events below are the second prerequisite. |

## GLM consult (implementation-planning lane, 2026-08-04) — triage

GLM-5.2 reviewed the corpus design (packet + full reply in the routed
ledger). Disposition of its findings against the actual repository:

| Finding | Verdict | Action |
|---|---|---|
| Cold-start (1 Loved) missing from corpus; single-bar weights echo-chamber | **CONFIRMED empirically** — adding the scenarios measured a real top-5 entropy drop (2.137→2.055) under candidate A | **Fixed**: `MIN_LOVED_BARS_FOR_WEIGHTS = 2` caution floor; below it the flat-union fallback keeps exact pre-v1.1 behavior. Cold-start scenarios + gates now in CI. |
| Gates rot against catalog growth (pinned absolutes) | Incorrect as stated — every gate is variant-relative and recomputed per run on the current catalog; nothing is pinned to 403 bars | No change; rationale documented here |
| Repeat-disjoint alone insufficient | Already covered — the suite gates second-hand vibe ≥ 80% of first | No change |
| Avoid nudge starves the exploration slot / makes it mainstream | The reasoning-level rebuttal (slot picks `tail[seed % len]`, nudge is additive) is now backed by EXECUTABLE gates after the Santa round-1 Fable finding that no corpus scenario tripped the ≥10-result branch: `explorationProbe` + `freshHandProbe` assert slot presence, long-tail membership, and candidate-set invariance across variants | **Gated in CI** |
| Avoid + late-night cancellation (±0.06 net zero) | True arithmetic, accepted by design — both are tie-breaker nudges of equal, deliberate magnitude | Documented |
| Geographic clustering of Passed bars → neighborhood skew; false-avoid regret metric; catalog-subset variance gates | Plausible, unproven, larger builds | Recorded as future eval work below |

## KPI measurement foundation (dark, spec-only)

`src/lib/kpiContracts.ts` + tests: eight product KPIs (impression,
bar_detail_view, search_selection, save_want_to_go, share,
directions_opened, pin_checkin, post_night_rating) mapped onto the
analytics facade's name allowlist (5 new NAMES added dark; envelope
remains `{v, name}` — no payload channel exists). Payload contracts are
a fenced specification: per-event field allowlists with structural
validators (catalog slug shape, night key, small enums), forbidden-key
belt (`lat|lng|accuracy|query|handle|user|friend|…`), fail-closed
validation (unknown key rejects the event — never strip-and-send; the
forbidden-key belt runs UNCONDITIONALLY before the allowlist lookup, so
even a carelessly-extended field table cannot admit a forbidden-shaped
key — Santa round-1 Fable finding, regression-tested). No
call site dispatches the new names tonight; PostHog and every external
sink remain disabled; `isAnalyticsEnabled()`/`isPostHogEnabled()` both
false (unit-asserted). `/map` parity (Santa round-1, Codex + Fable
converged): taste signals always derive from the FULL catalog
(`signalBars`), never the filtered ranking pool, so panning/filtering
the map can no longer silently drop a user below the caution floors. Planned future call sites: ResultsView (deal
impression), BarLightbox (detail view), BarPicker (search selection),
WantToGoToggle, ShareButton, ResultCard Maps link, PinConfirmDialog
confirm, rating actions.

## Boundaries confirmation

No production/staging writes, no migrations, no paid calls, no
analytics enablement, no ML dependency. The evaluation runs entirely on
the bundled catalog offline.
