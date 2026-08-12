# Staging catalog expansion packet — offline neighborhood correction (2026-08-12)

Goal `g-779223ab-a469-4fc8-bad7-6623c186db67`. Roadmap **O8** (staging QA/migrations/smoke/
rollback) + **D8** (full-catalog delivery). Builds directly on the reconciliation preflight
`g-25eaf18d-2d9d-4aa0-b9b3-e79e36234765`
(`docs/STAGING-CATALOG-RECONCILIATION-PREFLIGHT-2026-08-12.md`) — extending it, not contradicting it.

**Read-only and offline.** No write to any bars table in any environment, no network call of any
kind, no migration, no deployment, no push, no staging or production contact.

---

## 1. What the preflight left open

The preflight reconciled the frozen 1,382-candidate census report against the offline in-repo
baseline and projected **825** rows — `reaches1200: false`. It named the dominant loss precisely:

> 865 of 1,382 candidates (every SLA-provider row, 63%) fail boundary validation for one reason —
> they carry the **borough** label `"manhattan"` in `neighborhood`, which `rowToBar` rejects because
> it is not a key of `NEIGHBORHOOD_CENTROIDS`.

All 865 carry real `lat`/`lng`. `src/lib/geo.ts` already ships
`snapToNeighborhoodCentroid` — a pure, offline, tested nearest-centroid classifier. This goal applies
it and re-reconciles, entirely offline.

## 2. Verbatim run output

```
$ npx tsx scripts/expansion-packet-cli.mts --run run-2026-08-05T00-25-06-752Z
expansion-packet run-2026-08-05T00-25-06-752Z: baseline=403 candidates=1382 corrected=864 snapFailed=1
newInserts=1286 projectedTotal=1689 (prior 825) reaches1200=true shortfall=0 accountedFor=1382
wrote scripts\census\out\run-2026-08-05T00-25-06-752Z\expansion-packet.json and
      scripts\census\out\run-2026-08-05T00-25-06-752Z\expansion-packet.md
```

(exit 0)

| Metric | Preflight | This packet |
|---|---|---|
| Baseline (offline, `src/lib/bars.ts`) | 403 | 403 |
| Candidates evaluated | 1,382 | 1,382 |
| Neighborhoods corrected offline | — | **864** |
| Snap failures (needed correction, uncorrectable) | — | **1** |
| New inserts (would apply) | 422 | **1,286** |
| Id collisions | 0 | 0 |
| Name+neighborhood collisions | 95 | 95 |
| Validation rejects | 865 | **1** |
| Accounted for (must equal candidates) | — | **1,382** |
| **Projected total** | 825 | **1,689** |
| **Reaches 1,200?** | **NO** | **YES** |
| Key divergence (`dedupeKey` vs `normalizeLegacy`) | 7 | 7 |

**The 1,200 target is reached: projected total 1,689, surplus 489.** Codebase provenance is
unchanged — the packet binds to the same frozen report (`codeSha
9480fb1463f052a5626609afc876cfe0b24653ae`, generated `2026-08-05T00:29:55.406Z`).

### Where the recovered rows went

864 corrections, mean snap distance **0.359 mi**, max **1.589 mi** (`MAX_SNAP_MILES = 2`). Largest
destinations: Midtown 233, Hell's Kitchen 91, Chelsea 66, Flatiron 59, UES 53, FiDi 41, LES 41,
SoHo 35, NoHo 34, Kips Bay 28. Full distribution in `expansion-packet.json`.

The 422 OSM new inserts are **bit-for-bit the same set the preflight produced** — those candidates
already carried in-vocabulary neighborhoods and correction deliberately leaves them untouched. The
entire +864 delta is SLA rows recovered from the borough-label reject bucket.

## 3. Every still-outstanding named reject

96 of 1,382 candidates do not become new inserts. None is silently dropped; the CLI refuses to emit a
packet unless `newInserts + idCollisions + nameHoodCollisions + validationRejects` equals the
candidate count (it does: 1,286 + 0 + 95 + 1 = 1,382).

**Snap failures — 1**

| externalId | name | lat, lng | reason |
|---|---|---|---|
| `sla:0267-24-123566-02` | Belgo CRT LLC | 40.59288, -74.10192 | outside service area (Staten Island — outside `SERVICE_AREA_BBOX`) |

**Validation rejects — 1**: the same `sla:0267-24-123566-02`, failed check
`coordinates outside the service-area bbox`. A snap-failed candidate is not dropped — it continues
through reconciliation with its original label and lands here.

**Name+neighborhood collisions — 95**: unchanged from the preflight, and **all 95 are `osm:`-prefixed**
(verified by provider prefix over `expansion-packet.json`). Correction introduced **zero** new
collisions: SLA rows are liquor-license legal-entity names (`"Belgo CRT LLC"`) that collide with
neither the baseline nor each other (0 intra-set `normalizeLegacy(name)|neighborhood` duplicates
among the 864). The complete list of all 95 is in `expansion-packet.json`; the first 25 are inlined
in `expansion-packet.md`.

**Id collisions — 0**.

## 4. Honest caveats — what "1,689" does and does not mean

Reaching the target is a **mechanical projection**, not a shipped catalog. Four things it does not
establish, each of which is an attended gate below:

1. **The centroid snap is an approximation, not ground truth.** Nearest-centroid assignment placed
   rows up to 1.589 mi from the centroid they were assigned. Those neighborhoods would become an
   attribute of inserted rows. They need spot-checking before any apply.
2. **SLA candidates are liquor-license holders, not verified bars.** All 1,382 candidates carry
   `verification: 'unverified'`; nothing in the census pipeline may promote them. `"Belgo CRT LLC"`
   is a legal entity name, not a venue name a user would recognize.
3. **The baseline is the offline 403, not live Staging.** The recorded Staging count is 412 — a
   9-row delta that remains a **named unknown**. Only an attended Staging read closes it. This packet
   does not read Staging and does not assume the delta away.
4. **The 7-candidate key divergence is unchanged and unresolved.** `dedupe.ts`'s `dedupeKey` and
   `apply.ts`'s `normalizeLegacy` still classify 7 candidates differently; quantifying it — not
   fixing it — remains the scope.

## 5. Dry-run / apply plan

### (a) What this goal produced, offline

The packet: a corrected candidate set, its reconciliation buckets, every named reject with its
specific failed check, and the projected total against 1,200. Written artifacts are two additive
files inside the run's own output directory (`expansion-packet.json`, `expansion-packet.md`; that
directory is gitignored, so they are local regenerable output — this document is the durable record)
plus the new script/test files. No table, in any environment, was read or written.

### (b) What remains for an ATTENDED session — named here, performed nowhere

1. Read the live Staging `bars` table to close the 9-row baseline delta (403 vs 412).
2. Attended curation of the 1,286 new-insert candidates: real price tier, blurb, address, and
   `lastVerified`. The packet used a neutral price-tier placeholder purely so boundary validation was
   not rejecting on a field real curation would fill in.
3. Human review of the 864 centroid-snapped neighborhoods (caveat 1 above), and of whether SLA
   license entities are acceptable catalog rows at all (caveat 2).
4. Reconcile or explicitly accept the 7-candidate key divergence before trusting a real apply's
   fresh/existing split.
5. Explicit operator authorization, then the actual `--apply` invocation against Staging, per the
   sidecar/provenance gate in `scripts/census/apply.ts`. **Out of scope here; named only.**

### (c) Automation boundary

**No step in (b) may be automated by this goal or by any future unattended run.** Each requires a
live read, a human curation judgment, or an explicit operator authorization. An unattended agent
must stop at the packet.

## 6. What this goal did NOT do

- No write to any bars table, in any environment. No `--apply`. No staging or production contact.
- No network call of any kind: no Supabase, Vercel, Staging, Production, Google Places, OpenRouter,
  or geocoding API. Verified: the CLI's entire transitive import graph
  (`bars.ts`, `geo.ts`, `constants.ts`, `catalogServer.ts`, `catalog.ts`, `distance.ts`,
  `reconcile.ts`, `dedupe.ts`, `types.ts`, `runArgs.ts`) contains no `createClient`, no `@supabase/*`
  import, no `fetch(`, no `node:http`/`node:net`.
- No migration written, applied, or edited; no `supabase/migrations/**` file touched.
- No modification of the frozen census report, its sidecar, checkpoints, units, or the prior goal's
  `reconcile.json`/`reconcile.md` — the preflight was re-run after refactoring and its two artifacts
  came back **byte-identical** (`diff` clean).
- No change to the semantics of `reconcile.ts`, `apply.ts`, `dedupe.ts`, or `src/lib/geo.ts` — all
  four are composed, none is edited.
- No credential use, no deployment, no push.

## 7. Files

| Path | What |
|---|---|
| `scripts/census/expansion-packet.ts` | Pure packet builder — correction + composed reconcile. No I/O. |
| `scripts/census/expansion-packet.test.ts` | 12 Vitest cases (AAA). |
| `scripts/census/runArgs.ts` | Fail-closed CLI hardening, extracted verbatim from `reconcile-preflight.mts` so both CLIs share the reviewed parser. |
| `scripts/expansion-packet-cli.mts` | Read-only CLI. Writes only the two additive run-dir artifacts. |
| `scripts/census/reconcile-preflight.mts` | Refactored onto `runArgs.ts`. Behavior-preserving — proven by identical re-run output. |

## 8. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run scripts/census src/lib/catalogServer src/lib/geo` | 5 files, **87 tests passed** |
| `npx vitest run scripts/census/expansion-packet.test.ts` | **12 passed** |
| Behavioral: CLI on the frozen run | exit 0, numbers in §2 |
| Fail-closed: `--run nonexistent-run-id` / `../etc` / `nul` / no value / duplicate `--run` | all **exit 1**, each with a distinct `expansion-packet REFUSED:` message |
| `reconcile-preflight.mts` re-run after refactor | exit 0; `reconcile.json` and `reconcile.md` byte-identical |
| Tier (`tier-classify.mjs`, `tierMapSource: "project"`) | **T1**, `t0FileCount: 0`, `escalated: false`, `skippable: false` |
