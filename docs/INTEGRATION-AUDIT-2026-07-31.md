# Integration audit — `feat/overnight-2026-07-30` → `origin/main`

**Goal:** `g-e7b46925-c10a-4e18-8cd8-2dab2f486dc5` · **Date:** 2026-07-31 · **Read-only.**
Nothing was merged, pushed, deployed, or applied. `git fetch origin --prune` only.

---

## 0. Verdict

**AUDIT GREEN, with four things the operator must decide before the PR is promotable.**

Every re-run gate passes. No commit or file was identified as unshippable. The blockers below are
*decisions and missing environments*, not defects in the change set.

| # | Blocker | Owner |
|---|---|---|
| B1 | **Vercel's real Production branch is unverified.** Believed `main`; must be read from the dashboard before any promotion. | operator |
| B2 | **This worktree has no `.env.local`,** so every Supabase-dependent e2e cannot run here (7 failures across 3 specs, all one cause). The branch cannot be *fully* behaviorally verified locally. | operator |
| B3 | **`.env.example` ships `NEXT_PUBLIC_LEGACY_PHOTOS=1` uncommented** — the default enables ~3.4k re-hosted Google Place photos that its own comment calls a policy liability. | operator |
| B4 | **Want-to-go has no writer** (from goal 1). Not introduced by the rest of the branch, but it ships with it. | operator |

---

## 1. Fetch and divergence — recomputed, not assumed

```
git fetch origin --prune            # working tree unchanged, proven below
merge-base origin/main overnight  → 8ac648ce52a7ba0f400f233413e08404fc90edaa
origin/main HEAD                  → 8ac648c  fix: [T0] PostgREST 1,000-row cap … (#89)
```

`git status --porcelain` before the fetch and after it were **identical** (` M .loop-guard/morning.md`,
this run's own log). No working file was modified.

| Branch | Behind `origin/main` | Ahead | Mission-time claim | Holds? |
|---|---|---|---|---|
| `feat/overnight-2026-07-30` | **0** | **129** | 124 | ✅ (+5 = goal 1's 4 commits + 1 loop-guard checkpoint) |
| `feat/phase1-compliance-media` | **0** | **83** | 83 | ✅ exactly |

**The merge-base *is* `origin/main`'s HEAD**, so there is still **zero divergence** — `main` is a
strict ancestor of both branches and the merge is a fast-forward.

**Containment confirmed:** `git log --oneline feat/phase1-compliance-media ^feat/overnight-2026-07-30`
is **empty** — the overnight branch contains every phase1 commit. No orphans.

---

## 2. Change inventory

`270 files changed, 29,323 insertions(+), 2,164 deletions(-)` across 129 commits
(56 `fix`, 34 `docs`, 28 `feat`, 6 `test`, 2 `refactor`, 2 `chore`, 1 `overnight`).

### Tier — the headline fact

```
git diff --name-only origin/main...HEAD | tier-classify.mjs
→ tier: T0   t0FileCount: 23   escalated: true   tierMapSource: project
```

**The aggregate change is T0.** The 23 T0 files:

| Group | Files |
|---|---|
| Migrations | `0020`–`0035` (16 files) |
| Destructive/privileged scripts | `scripts/apply-migrations.ts`, `scripts/prune-orphan-photos.mjs`, `scripts/lib/photoFiles.mjs` |
| Service-role routes | `src/app/api/account/delete/route.ts` (+ its test), `src/app/api/event/route.ts` |
| Un-gateable | `src/middleware.ts` |

⚠️ **Auditability gap:** of 129 commits, 68 carry a tier tag (52 `[T1]`, 16 `[T2]`) and **none is
tagged `[T0]`** — yet the change set is T0. Mitigating: `.claude/tier-map.json` was itself created
during this work (its own comment records `escalate_min_t0_files` changing from 5 to 1 on
2026-07-31), so earlier commits could not have been classified against it. Worth stating in the PR
rather than leaving the record implying this was routine T1 work.

### Migrations — 16 added, and most are already live

| Files | State |
|---|---|
| `0020`–`0032` (13) | **Already applied to Production.** The live `schema_migrations` ledger ends at **0032**. These files are new *to git* but not to the database. |
| `0033_vibe_profiles`, `0034_revoke_first_grants`, `0035_share_night_date_bound` | **Authored, reviewed, applied nowhere.** `0035`'s own header says so. |

Consequence for the PR: **merging changes no schema.** The runner is checksum-ledgered, so `0020`–
`0032` are skipped as already-applied — *provided their file contents still match what was applied*.
If any drifted after application, `scripts/apply-migrations.ts` reports drift rather than replaying.
That check belongs in goal 4's rehearsal, not here.

### Environment

`.env.example` gains four documented variables. Fail-closed posture is good **except one default**:

| Variable | State in `.env.example` | Assessment |
|---|---|---|
| `NEXT_PUBLIC_LEGACY_PHOTOS` | **`=1`, uncommented** | ⚠️ **B3.** Serves ~3.4k re-hosted Google Place photos. Its own comment: Google's policy "does NOT permit re-hosting photo content… a known liability". Not API spend (self-hosted), but a compliance exposure enabled by default. |
| `NEXT_PUBLIC_GOOGLE_MEDIA` | commented out | ✅ Fail-closed. Every render would be billable. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | commented out | ✅ Fail-closed; absent ⇒ zero requests. |

New `process.env` references vs `main`: `ALLOW_GOOGLE_PHOTO_INGEST`, `ALLOW_GOOGLE_REVIEW_INGEST`,
`G4_DUMP`, `SCREENSHOT_BASE_URL`, `VERCEL_ENV`, plus the three above. The two `ALLOW_GOOGLE_*_INGEST`
flags are ingest guards (default-off); `SCREENSHOT_BASE_URL` and `G4_DUMP` are tooling only.

### Workflows

`.github/workflows/ci.yml` — **strengthened, not weakened**: adds a `Secret scan` step and an
`Env-var safety check` step *before* type-check. This is the change class the tier map explicitly
raised to T1 ("a workflow edit can delete the secret-scan step"); here it does the opposite.

### Generated / committed artifacts

Largest additions are the seven 402×681 PNGs from goal 1 (`docs/screenshots/g-12d33864/`, ~3.0 MB) —
intentional visual-acceptance evidence. No build output, no `node_modules`, no logs, no stray
binaries. `.loop-guard/morning.md` (48 KB) is this run's own log and is tracked.

`public/bar-photos/`: **3,386 files on the branch vs 3,435 on `origin/main`** — the branch **deletes
49** re-hosted photos (the orphan-prune path). Directionally correct for B3.

### Release-sensitive behavior

| Change | Assessment |
|---|---|
| `src/middleware.ts` matcher narrowed: `/api/:path*` **removed** | ✅ Deliberate hardening (C2 audit F1b), thoroughly documented in-file, with `src/middleware.test.ts` asserting no `src/app/api` file imports a cookie-backed client. Measured: a forged cookie caused 1 outbound `getUser()` per `/api/*` request; middleware runs before route handlers so no per-route limiter could gate it. The file honestly records that this **reduces** the amplification surface without removing it, and names the real fix (local JWT verification) as follow-up. |
| `src/app/api/account/delete/route.ts` (+91/−…) | T0. Substantial rework; covered by an expanded route test (+97). |
| `src/app/api/event/route.ts` | T0, small change. Second service-role route; unauthenticated POST with an event-name allowlist as its only control. |
| `src/lib/waitlistGuard.ts` (+132) | Rate limiting for every public route. |

---

## 3. Re-run gates

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | Secret scan | `npm run secret-scan` | ✅ **clean (500 tracked files)** |
| 2 | Tier-map validation | `git ls-files \| tier-classify.mjs --validate` | ✅ `ok: true`, **0 dead rules**, 0 warnings |
| 3 | Type-check | `npx tsc --noEmit` | ✅ exit 0 |
| 4 | Unit tests | `npx vitest run` | ✅ **1566 passed / 102 files** |
| 5 | Production build | `npm run build` | ✅ Compiled successfully |
| 6 | Bounded Playwright | see below | ⚠️ **environment-limited** |

**Gate 6 detail.** Across `account-delete`, `phase1-compliance`, `share-card`, `night-page`,
`app-shell-smoke` (3 viewports): **64 passed, 7 failed, 6 skipped**. Plus goal 1's sweep over
`map-interaction`, `map-lightbox`, `discover`, `want-to-go`, `vibe-tweak-reachable`,
`one-results-view`, `where-next-path`: **120 passed, 3 failed**.

**All 7 failures share one root cause — no `.env.local` in this worktree** (worktrees do not share
untracked files). Verified per failure, not assumed:

| Spec | Observed error | Why |
|---|---|---|
| `app-shell-smoke` `/settings` ×3 | page renders "Sign-in is unavailable on this build — Supabase env vars are missing" | no Supabase config |
| `phase1-compliance` catalog cap ×2 | `catalog page sizes seen: []` — 0 paged requests, expected > 1000 | no PostgREST to page against |
| `night-page` anonymous visitor ×2 | shared-night heading never renders | night data is DB-backed |

**This is blocker B2**: the Supabase-dependent half of the suite is unverifiable here. I did **not**
copy the operator's production `.env.local` into this worktree — spreading production credentials
across worktrees is an operator decision, and Preview/Local credential separation is itself goal 4's
subject.

Pre-existing failures, proven **by comparison against baseline `9dfe8f2`** rather than asserted:
`map-lightbox` RATED-marker fails **5/9 at baseline** vs 7/9 with the change (same mode: an
arbitrary `nth` marker lands under the fixed bottom nav); `mobile-controls` `/` matches the
already-recorded blocked goal `g-90f908bc`.

---

## 4. The nine big-change factors

**1. Blast radius — HIGH.** 270 files, 29.3k insertions, 23 T0 files. Three independent
high-radius surfaces: 16 migrations (13 already live, 3 unapplied), two service-role routes that
bypass RLS, and middleware that runs before every matched handler. `0034_revoke_first_grants` is the
single widest statement in the set — a wrong grant locks every user out of their own rows.

**2. Detection — WEAK on the parts that matter.** CI now runs secret-scan, env-check, type-check
and unit tests, and the app exposes `/api/health`. But there is **no error tracking, no uptime
monitoring and no named alert owner** on record (goal 6 rows 9). A bad `0034` grant would surface as
users silently seeing empty data, which none of the current gates detect. Detection for the *code* is
good; detection for the *database* is absent.

**3. Recovery — UNVERIFIED, and this is the sharpest risk.** Restore capability has never been
exercised. Code rollback is easy (fast-forward merge ⇒ revert is clean; previous deployment
redeployable). **Migrations are not revertible** — `0033`–`0035` have no down-path, and recovery
means restore-from-backup, which is exactly the capability nobody has tested. Goal 4 must not treat a
documented backup policy as a restore.

**4. Data — MIXED.** No destructive migration among `0033`–`0035`: `0033` adds a table, `0034`
changes grants, `0035` adds a date bound. But the branch also carries `prune-orphan-photos.mjs`
(deletes files; 49 already pruned) and the account-deletion path, and the **`photo_permissions`
append-only trigger vs. account deletion conflict is still unfixed** (goal 4 owns `0036`). Account
deletion currently fails for any user who ever granted a photo permission.

**5. Access — IMPROVED.** Middleware amplification lever narrowed; revoke-first grants authored;
waitlist rate limiting expanded. Residual: `POST /api/event` remains unauthenticated with an
allowlist as its only control, and `0034` is unapplied so its hardening is not yet real.

**6. Cost — CONTAINED, with one default to change.** `NEXT_PUBLIC_GOOGLE_MEDIA` and the Maps key are
both commented out ⇒ **all cost-bearing media is disabled**, which is exactly the evidence goal 6
row 12 needs. Two caveats: `NEXT_PUBLIC_LEGACY_PHOTOS=1` is on by default (B3 — compliance, not
spend), and the tier map records that `scripts/refresh-places.mjs` **issues billable API requests
before its `--apply` guard, so a dry run still spends**. That defect is present in this branch.

**7. Compatibility — the deployed client is fine; the schema is the question.** Merging changes no
schema, so the currently-deployed build keeps working. When `0033`–`0035` *are* applied (goal 7),
`0034`'s revoke→grant window is the compatibility risk: applied outside a single transaction or
during traffic, live requests can land mid-window with no access. `0035` adds a ±2-day bound that an
old client could violate on write. Ordering `0033 → 0034 → 0035` is unproven until goal 4 rehearses it.

**8. Ownership — SINGLE POINT OF FAILURE.** 129 commits exist in exactly one place: this worktree on
one laptop, on a branch with **no upstream**. That is the strongest argument for goal 3 running
promptly. No named owner exists for alerts, backups or the Google budget.

**9. Business value — HIGH and gated.** Compliance work (Google media policy, provenance, revoke-first
grants), the account-deletion path, the map/vibe UX the operator asked for, and 247+ catalog
additions. None of it reaches users until the PR merges and the migrations apply — and the value of
the *compliance* work specifically is only realised once `0034` is live.

---

## 5. Should-not-ship list

**No commit or file was identified as unshippable.**

What was checked: every added file over 20 KB; all 16 migrations; `.env.example` and every new
`process.env` reference; the CI workflow; all 23 T0 paths; the full added-file type census (49 `.ts`,
33 `.md`, 16 `.sql`, 9 `.tsx`, 8 `.mjs`, 7 `.png`, 5 `.mts`, 2 `.json`, 1 `.html`); and
`git diff --check`. Secret scan is clean over 500 tracked files.

Three things ship that are worth naming explicitly rather than discovering later:

1. **`NEXT_PUBLIC_LEGACY_PHOTOS=1` as an uncommented default** (B3). Change the default or accept it deliberately.
2. **~3.0 MB of PNG evidence** in `docs/screenshots/g-12d33864/`. Intentional, but it is permanent git weight; drop it if the operator prefers reviewing locally.
3. **`docs/MASTER-TODO-2026-07-30.md`** was an uncommitted pre-existing edit in this worktree that the loop-guard checkpoint (`4e6bb7b`) swept in alongside this run's log. Content is a legitimate release-environments checklist, but it was not authored by this run — flagged so the PR does not imply otherwise.

---

## 6. Evidence that nothing was mutated

- `git status --porcelain` identical before and after the fetch.
- No `merge`, `rebase`, `reset` or `push` was run; the only write was `git fetch origin --prune`.
- No database was contacted at any point.
