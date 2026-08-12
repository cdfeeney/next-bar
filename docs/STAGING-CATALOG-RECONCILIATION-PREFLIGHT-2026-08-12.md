# Staging catalog reconciliation preflight — 2026-08-12

Goal `g-25eaf18d-2d9d-4aa0-b9b3-e79e36234765`. Offline, deterministic, read-only. **No live
apply, no network, no Staging/Production/Supabase/Vercel contact.** This is a preflight
*report* on the frozen census candidate set — it changes nothing in any database.

## What ran

```
npx tsx scripts/census/reconcile-preflight.mts --run run-2026-08-05T00-25-06-752Z
```

Wrote `scripts/census/out/run-2026-08-05T00-25-06-752Z/reconcile.json` and
`reconcile.md` into that run's own directory (additive files only; the frozen
`report.json`, its sidecar, checkpoints, and units were not touched). Exit 0.

## Real numbers (verbatim from the run)

| Metric | Value |
|---|---|
| Report | `run-2026-08-05T00-25-06-752Z`, codeSha `9480fb1463f052a5626609afc876cfe0b24653ae` |
| Baseline source | `src/lib/bars.ts` (static in-repo catalog) |
| Baseline count | 403 |
| Candidates evaluated | 1,382 |
| New inserts (would apply) | 422 |
| Id collisions | 0 |
| Name+neighborhood collisions | 95 |
| Validation rejects | 865 |
| **Projected total** (baseline + new inserts) | **825** |
| **Reaches 1,200?** | **NO** |
| Key divergence (census `dedupeKey` vs apply `normalizeLegacy` disagree) | 7 |

**Santa round-1 correction:** the divergence check originally compared each candidate only against
the *baseline*'s keys, missing pairs that diverge against each other within the same batch. The
frozen report contains both "The Houndstooth Pub" (`osm:node/2709479288`) and "Houndstooth Pub"
(`osm:node/5087643578`), both Midtown, neither in baseline: their census keys differ (`the` kept)
but their apply keys collide (`the` stripped), so the second is silently rejected by the real
apply-side fold — a genuine divergence the baseline-only check never saw. `reconcile()` now
computes divergence against the same growing sets the accept/reject fold uses, catching intra-batch
cases; the count moved from the originally reported 6 to the correct 7. See
`scripts/census/reconcile.ts` and its regression test for the mechanism.

## Baseline honesty gate

The offline baseline is the static catalog (**403 rows**), not the recorded Staging
count (**412 rows**, `docs/STAGING-ACCEPTANCE-2026-08-05.md:36`). The delta is **9
rows**, and this preflight cannot say whether those 9 rows are curated additions,
census rows already applied to Staging, or something else — that is a named unknown.
Closing it requires an attended read of the live Staging `bars` table; nothing in this
repository can resolve it offline. Do not assume the static catalog and Staging hold
the same set.

## Why the target is not reached, and the real cause (not estimated)

Projected total 825 is **375 short** of 1,200. The three loss buckets, by candidate count:

- **865 validation rejects** — by far the largest loss. Traced to source data, not a
  bug in this preflight's shaping logic: **all 865** carry `neighborhood: "manhattan"`
  (a generic borough label) instead of a real neighborhood name from
  `NEIGHBORHOOD_CENTROIDS` (`Chelsea`, `LES`, `FiDi`, …), and `rowToBar`
  (`src/lib/catalogServer.ts:60`) requires `KNOWN_HOODS.has(row.neighborhood)`. Every
  one of these 865 comes from the `sla` provider (SLA liquor-license records, which
  report the *borough*, not the neighborhood). This is a real, borough-coverage gap in
  the SLA adapter's neighborhood assignment — not something this preflight invented and
  not something in scope to fix here.
- **95 name+neighborhood collisions** — candidates whose apply-side key
  (`normalizeLegacy(name)|neighborhood`, raw/case-sensitive neighborhood) already
  matches a baseline row. Real duplicate risk against the static catalog.
- **0 id collisions** — the derived ids (slugified `externalId`) never collide with the
  baseline in this run.

Net: of 1,382 candidates, only 422 are both boundary-valid and non-duplicate against
the offline baseline. **This is a valid, complete result for this goal** — the shortfall
is real and its cause is named, not a failure to fix here.

## Key divergence — quantified, not fixed

`scripts/census/dedupe.ts`'s `dedupeKey` (lowercases the name, NFKD-strips diacritics,
strips punctuation; neighborhood trimmed+lowercased) and `scripts/census/apply.ts`'s
`normalizeLegacy` (lowercases, strips `'’.&`, removes the whole words "and"/"the";
neighborhood compared **raw**, no trim/lowercase) are two different functions guarding
the same table. **7 of 1,382** candidates in this run are classified differently —
fresh under one key, a duplicate under the other:

| Name | Neighborhood | census-fresh | apply-fresh |
|---|---|---|---|
| Tía Pol | Chelsea | no | yes |
| Stout NYC - FiDi | FiDi | no | yes |
| Full Shilling | FiDi | yes | no |
| Ten Bells | LES | yes | no |
| Rum House | Midtown | yes | no |
| Houndstooth Pub | Midtown | yes | no |
| Hoptimist | UWS | yes | no |

The 7th row ("Houndstooth Pub") is an **intra-batch** divergence: it and "The Houndstooth
Pub" (also Midtown, neither in baseline) collide under the apply-side key but not the
census-side key. A baseline-only comparison cannot see this — `reconcile()` now compares
divergence against the same sets the accept/reject fold grows as it runs, so a same-batch
pair is caught the moment the second one would be folded in as a duplicate.

The dry-run `fresh: 1382` / `alreadyInCatalog: 0` in the frozen report (structural — it
compared against `catalog: []`, `scripts/census/run-census.mts:105`) never predicted
this: it is the first reconciliation this candidate set has ever undergone against any
baseline. Fixing the divergence between the two normalizers is explicitly **out of
scope** for this goal — quantifying it (7 candidates, both directions represented, plus
one intra-batch case) is the deliverable.

## Attended gates still outstanding before any apply

1. Read the live Staging `bars` table to close the 9-row baseline delta (403 vs 412).
2. Attended curation: assign real price tiers, blurbs, addresses, and `lastVerified`
   dates to the 422 new-insert candidates. This preflight used a neutral price-tier
   placeholder (`2`) purely so boundary validation could run on fields census data
   cannot supply — see the `ponytail:` comment in `scripts/census/reconcile.ts`.
3. Decide whether to fix the SLA adapter's borough-vs-neighborhood gap (the 865
   validation rejects) before a real apply, since that is the dominant loss.
4. Reconcile or explicitly accept the 7-candidate key divergence before trusting a real
   apply's fresh/existing split.
5. Explicit operator authorization to run `--apply` against Staging, per the
   sidecar/provenance gate in `scripts/census/apply.ts`.
6. Whether to pursue further coverage (more boroughs/sources, possible paid Google
   spend) to close the remaining gap to 1,200 is an operator decision outside this goal.

## What this goal did not do

- No write to any bars table, anywhere. No client constructed, no socket opened
  (`grep -n "createClient|@supabase|fetch(" scripts/census/reconcile.ts
  scripts/census/reconcile-preflight.mts` — no matches, comment mentions only).
- No migration run or added.
- `scripts/census/apply.ts` and `scripts/census/dedupe.ts` dedupe semantics unchanged —
  `normalizeLegacy` is reproduced (duplicated, not imported) in `reconcile.ts` because
  it is unexported and this goal may not edit `apply.ts`.
- The frozen report, its sidecar, checkpoints, and units are untouched; the only new
  files are additive (`reconcile.json`, `reconcile.md`) inside the run's own directory,
  plus the three files this goal adds to the repo.

## Verification run

- `npx vitest run scripts/census src/lib/catalogServer` — **65 passed** (3 files),
  including 11 `scripts/census/reconcile.test.ts` cases (id collision, name+neighborhood
  collision, boundary-validation reject, projected-total arithmetic, empty baseline, two
  independent baseline-vs-candidate key-divergence cases — word-stripping and diacritics —
  an intra-batch divergence regression pinning the Santa round-1 fix, and a
  `normalizeLegacy` characterization test guarding against drift from `apply.ts`'s copy).
- `npx tsc --noEmit` — exit 0.
- `npx tsx scripts/census/reconcile-preflight.mts --run run-2026-08-05T00-25-06-752Z` —
  exit 0, wrote `reconcile.json` + `reconcile.md`; numbers above are that run's verbatim
  output (`reconcile.json` now also includes the full `newInserts` array and
  `maxPossibleTotal`).
- Fail-closed CLI paths verified: `--run nonexistent-run-id` → exit 1; `--run
  "../../../etc"` → exit 1 (rejected as an unsafe run directory name); `--run` with no
  following value → exit 1 (previously silently fell back to the default run).
