# Integration audit — `feat/overnight-2026-07-30` → `origin/main`

**Goal:** `g-e7b46925-c10a-4e18-8cd8-2dab2f486dc5` · **Date:** 2026-07-31 · **Read-only.**
Nothing was merged, pushed, deployed, or applied. `git fetch origin --prune` only.

> **Measured at `960c52f`** (which is this report's own commit). Counts below are as-of that SHA.
> An audit committed into the branch it audits shifts its own numbers by one; that is stated rather
> than left for a reader to trip over.

> **Revision note.** A four-lane review panel (Claude/Sonnet, Codex `gpt-5.6-sol`, GLM, DeepSeek)
> found defects in the first draft of this report. One was material: it asserted a migration risk
> that this repository's own code disproves. Section 7 records what changed and why.

---

## 0. Verdict — and what it is a verdict *about*

Two separate questions get two separate answers. Collapsing them into one word was the first draft's
mistake.

| Question | Verdict |
|---|---|
| **Is this branch safe to push to `origin` and open as a PR?** (what goal 3 does) | ✅ **GREEN** |
| **Is it safe to promote to production?** (goal 7) | ⛔ **NOT GO** — four gates below |

The PR gate and the deployment gate are different gates. **Merging this PR applies no migration and
touches no database**; the schema changes are a separate, later, attended step with their own gates.
Blocking the PR would also leave 129 commits sitting on one laptop with no upstream — the single
largest risk this audit found. Pushing is *risk-reducing*.

Every re-run gate passes. **No commit or file was identified as unshippable.**

### Gates on production promotion (NOT on the PR)

| # | Gate | Why it, specifically | Owner |
|---|---|---|---|
| **G1** | **Exercise a restore.** Never once done. | Migrations have no down-path. Without a proven undo, every other failure escalates from incident to unrecoverable. This is the one gate that makes the others survivable. | operator + goal 4 |
| **G2** | **Run the Supabase e2e half against a real database.** | It is currently *entirely* dark (see §3) — and the dark part is exactly the RLS / migration-ordering / column-contract surface. Untested is not the same as safe. | operator + goal 4 |
| **G3** | **Inventory the 24 RLS statements** in `0020`/`0021`/`0033` with per-statement justification. | An uninventoried policy is an unreviewed permission, and silent over-exposure is the hardest failure to notice after the fact. `0033`'s 9 statements are **unapplied**, so they are still reviewable before they are real. | goal 4 |
| **G4** | **Verify Vercel's actual Production branch** from the dashboard. | Believed `main`. Never confirmed. Everything downstream assumes it. | operator |

### Operator decisions (not blockers, but they ship either way)

- **`NEXT_PUBLIC_LEGACY_PHOTOS=1` is uncommented in `.env.example`** — the default serves ~3.4k
  re-hosted Google Place photos that its own comment calls a policy liability. Flip it or accept it
  deliberately.
- **Want-to-go has no writer** (goal 1): archiving `/discover` removed the app's only
  `addWantToGo` call site.
- **`/discover` is removed as a user-facing surface** — see §2.

---

## 1. Fetch and divergence — recomputed, not assumed

```
git fetch origin --prune            # working tree unchanged, proven in §6
merge-base origin/main overnight  → 8ac648ce52a7ba0f400f233413e08404fc90edaa
origin/main HEAD                  → 8ac648c  fix: [T0] PostgREST 1,000-row cap … (#89)
```

| Branch | Behind | Ahead | Mission-time claim | Holds? |
|---|---|---|---|---|
| `feat/overnight-2026-07-30` | **0** | **130** at `960c52f` | 124 | ✅ (+5 goal-1 work, +1 this report) |
| `feat/phase1-compliance-media` | **0** | **83** | 83 | ✅ exactly |

**The merge-base *is* `origin/main`'s HEAD** — zero divergence, and the merge is a fast-forward.

**Containment confirmed:** `git log --oneline feat/phase1-compliance-media ^feat/overnight-2026-07-30`
is **empty**. No orphans.

---

## 2. Change inventory

`271 files changed, +29,623 / −2,164` across 130 commits
(56 `fix`, 34 `docs`, 28 `feat`, 6 `test`, 2 `refactor`, 2 `chore`, 1 `overnight`, 1 audit).

### Tier

```
git diff --name-only origin/main...HEAD | tier-classify.mjs
→ tier: T0   t0FileCount: 23   escalated: true   tierMapSource: project
```

**The aggregate change is T0.** The 23 T0 files: 16 migrations (`0020`–`0035`);
`scripts/apply-migrations.ts`, `scripts/prune-orphan-photos.mjs`, `scripts/lib/photoFiles.mjs`;
`src/app/api/account/delete/route.ts` (+ test); `src/app/api/event/route.ts`; `src/middleware.ts`.

⚠️ **Auditability gap:** 69 of 130 commits carry a tier tag (52 `[T1]`, 17 `[T2]`) and **none is
tagged `[T0]`**. Mitigating: `.claude/tier-map.json` was created *during* this work, so earlier
commits could not have been classified against it. Say this in the PR rather than let the record
imply routine T1 work.

### Migrations — 16 added; most are believed already live

| Files | State |
|---|---|
| `0020`–`0032` (13) | **Believed already applied to Production.** |
| `0033`, `0034`, `0035` | **Authored, reviewed, applied nowhere.** `0035`'s own header says so. |

> ⚠️ **This claim is not verified in this session.** "The live ledger ends at `0032`" comes from a
> prior session's read-only introspection (`docs/CONTINUATION-2026-07-30.md`); an earlier memory note
> only confirmed through `0027`. **This session has no database access at all** (§3). It is stated
> here because it is load-bearing for "merging changes no schema" — and flagged because goal 4 must
> reconfirm it against the real ledger before treating `0020`–`0032` as no-ops. Same hedge as G4.

The runner is checksum-ledgered, so already-applied files are skipped rather than replayed —
*provided contents still match what was applied*; otherwise it reports drift. Goal 4 owns that check.

### RLS — 24 statements, and the first draft missed them entirely

| Migration | `create/alter/drop policy` + `enable row level security` | Applied? |
|---|---|---|
| `0020_provenance_and_media.sql` | **12** | believed yes |
| `0021_provenance_hardening.sql` | **3** | believed yes |
| `0033_vibe_profiles.sql` | **9** | **no** |

RLS is a *different surface* from the grants in `0034`, and the first draft covered only grants.
`0033`'s 9 statements are still unapplied and therefore still cheap to review — hence **G3**.

### Dependencies — clean

`package.json` and `package-lock.json` both change, and the result is reassuring:
**no new runtime dependencies.** The only dependency edit is a devDependency bump,
`@playwright/test ^1.60.0 → ^1.62.0`. The lockfile adds no packages. Minimal supply-chain surface.

Two script changes are release-relevant:

- **`build` is now `node scripts/check-env.mjs && next build`** — a bad environment now fails the
  build rather than shipping. Good, but it is a new build-time failure mode: on Vercel,
  `VERCEL_ENV` makes `check-env` enforce production rules.
- `tier-validate` invokes `~/.claude/bin/tier-classify.mjs` — **a path outside the repository**, in
  a developer's home directory. It works here and would fail on any other machine or in CI. Harmless
  today (nothing calls it in CI); worth not being surprised by.

### Environment

| Variable | State | Assessment |
|---|---|---|
| `NEXT_PUBLIC_LEGACY_PHOTOS` | **`=1`, uncommented** | ⚠️ Serves ~3.4k re-hosted Google photos its own comment calls a liability. |
| `NEXT_PUBLIC_GOOGLE_MEDIA` | commented out | ✅ Fail-closed. Every render would be billable. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | commented out | ✅ Fail-closed; absent ⇒ zero requests. |

**All cost-bearing media is disabled** — the evidence goal 6 row 12 needs.
New `process.env` references vs `main`: `ALLOW_GOOGLE_PHOTO_INGEST`, `ALLOW_GOOGLE_REVIEW_INGEST`
(ingest guards, default-off), `G4_DUMP`, `SCREENSHOT_BASE_URL` (tooling), `VERCEL_ENV`.

### PWA service worker — verified clean

`public/sw.js` is in the diff (+25/−2) and the cache is **correctly versioned**:
`CACHE_NAME = 'next-bar-shell-v2'`, with `activate` deleting every cache whose key is not
`CACHE_NAME`, plus a `NEVER_CACHE = /^\/bar-photos\//` rule. The stale-shell-after-deploy failure
mode is handled in code, not left to chance.

### User-facing surface removals

**`/discover` is gone.** The 289-line swipe/save surface is deleted; `GET /discover` now answers a
`307` to `/map` from `next.config.js`, and every in-app entry point (the map link, the Want-to-go
empty-state CTA) is removed. Deliberate and operator-directed (goal 1) — recorded here because it is
a user-facing feature removal and a reader of this inventory alone would otherwise not learn of it.

### Workflows

`.github/workflows/ci.yml` — **strengthened**: adds `Secret scan` and `Env-var safety check` steps
before type-check. Removes no gate.

### Generated / committed artifacts

Largest additions are goal 1's seven 402×681 PNGs (`docs/screenshots/g-12d33864/`, ~3.0 MB) —
intentional visual-acceptance evidence, and permanent git weight.
**`.loop-guard/morning.md` (~49 KB) is an added log file** — this run's own execution log, tracked in
git. (The first draft claimed "no logs" while elsewhere calling it "this run's own log"; that
contradiction is corrected here.) No build output, no `node_modules`, no stray binaries.

`public/bar-photos/`: **3,386 on the branch vs 3,435 on `origin/main`** — 49 pruned.

### Release-sensitive behavior

| Change | Assessment |
|---|---|
| `src/middleware.ts` matcher: `/api/:path*` **removed** | ✅ Deliberate hardening (C2 audit F1b), documented in-file, with `src/middleware.test.ts` asserting no `src/app/api` file imports a cookie-backed client. Measured: a forged cookie cost 1 outbound `getUser()` per `/api/*` request, and middleware runs before route handlers so no per-route limiter could gate it. The file honestly records that this *reduces* rather than removes the lever. |
| `src/app/api/account/delete/route.ts` (+91) | T0, substantial rework, covered by an expanded route test (+97). |
| `src/app/api/event/route.ts` | T0. Second service-role route; unauthenticated POST, event-name allowlist its only control. |
| `src/lib/waitlistGuard.ts` (+132) | Rate limiting for every public route. |

---

## 3. Re-run gates

| # | Gate | Result |
|---|---|---|
| 1 | `npm run secret-scan` | ✅ **clean (500 tracked files)** |
| 2 | `tier-classify --validate` | ✅ `ok: true`, **0 dead rules**, 0 warnings |
| 3 | `npx tsc --noEmit` | ✅ exit 0 |
| 4 | `npx vitest run` | ✅ **1566 passed / 102 files** |
| 5 | `npm run build` | ✅ Compiled successfully |
| 6 | Bounded Playwright | ⚠️ **environment-limited — see below** |

**Gate 6.** `account-delete`, `phase1-compliance`, `share-card`, `night-page`, `app-shell-smoke`
across 3 viewports: **64 passed, 7 failed, 6 skipped**. Goal 1's sweep over `map-interaction`,
`map-lightbox`, `discover`, `want-to-go`, `vibe-tweak-reachable`, `one-results-view`,
`where-next-path`: **120 passed, 3 failed**.

**All 7 failures share one root cause — this worktree has no `.env.local`** (worktrees do not share
untracked files). Verified per failure, not assumed:

| Spec | Observed | Why |
|---|---|---|
| `app-shell-smoke` `/settings` ×3 | renders "Sign-in is unavailable on this build — Supabase env vars are missing" | no Supabase config |
| `phase1-compliance` catalog cap ×2 | `catalog page sizes seen: []` — 0 paged requests, expected > 1000 | no PostgREST to page against |
| `night-page` anonymous visitor ×2 | shared-night heading never renders | night data is DB-backed |

I did **not** copy the operator's production `.env.local` into this worktree to make them pass:
spreading production credentials across worktrees is an operator decision, and Preview/Local
credential separation is goal 4's actual subject. **This is G2.**

Pre-existing failures proven **by comparison against baseline `9dfe8f2`**, not asserted:
`map-lightbox` RATED-marker fails **5/9 at baseline** vs 7/9 with the change (same mode — an
arbitrary `nth` marker lands under the fixed bottom nav); `mobile-controls` `/` matches the
already-recorded blocked goal `g-90f908bc`.

---

## 4. The nine big-change factors

**1. Blast radius — HIGH.** 271 files, 23 T0 files, three independent high-radius surfaces:
16 migrations, two service-role routes that bypass RLS, and middleware that runs before every matched
handler. `0034` is the widest single statement in the set.

**2. Detection — GOOD for code, ABSENT for the database.** CI runs secret-scan, env-check,
type-check and unit tests; `/api/health` exists. But there is **no error tracking, no uptime
monitoring and no named alert owner**. A wrong grant or an over-permissive RLS policy would surface
as users silently seeing the wrong data — which nothing currently detects.

**3. Recovery — UNVERIFIED, and this is the sharpest risk (G1).** Code rollback is easy: the merge is
a fast-forward, so revert is clean and the previous deployment is redeployable. **Migrations are not
revertible** — `0033`–`0035` have no down-path, so recovery means restore-from-backup, the one
capability never exercised. A documented backup policy is not a restore.

**4. Data — MIXED, with one defect that is real but DORMANT.** No destructive migration among
`0033`–`0035`. The `photo_permissions` conflict is genuine — `granted_by_user_id` is
`references public.profiles(id) on delete set null`, and that SET NULL fires an **UPDATE** into a
`before update or delete` trigger that raises unconditionally, aborting the whole account deletion.
**But it is currently unreachable:** `grep -rn "photo_permissions" src/ scripts/` returns **zero**
hits, so nothing in the application ever writes that table. It is a landmine, not a live incident.
`0036` is planned (goal 4) and not yet written. The branch also carries `prune-orphan-photos.mjs`
(deletes files; 49 already pruned).

**5. Access — IMPROVED, with an unreviewed corner.** Middleware amplification lever narrowed;
revoke-first grants authored; waitlist rate limiting expanded. Residual: `POST /api/event` is
unauthenticated with an allowlist as its only control, `0034` is unapplied so its hardening is not yet
real, and **24 RLS statements have not been inventoried** (G3).

**6. Cost — CONTAINED, with one default and one known defect.** `NEXT_PUBLIC_GOOGLE_MEDIA` and the
Maps key are both commented out ⇒ all cost-bearing media disabled. `NEXT_PUBLIC_LEGACY_PHOTOS=1` is
on by default (compliance, not spend). The tier map records that `scripts/refresh-places.mjs`
**issues billable API requests before its `--apply` guard, so a dry run still spends** — present in
this branch, unfixed.

**7. Compatibility — better than the first draft claimed.** *Corrected:* an earlier version of this
section asserted that `0034`'s revoke→grant could leave live users without access mid-window. **That
was wrong.** `scripts/apply-migrations.ts` wraps each migration file in `begin` / `commit` /
`rollback` (lines 200–214), so the revoke and grant commit atomically; under MVCC a concurrent reader
sees the pre- or post-commit state, never a partial one. `docs/MIGRATION-0033-0034-RUNBOOK.md` — in
this same branch — had already established this, and the first draft failed to cross-check it. The
real residual risks are narrower: lock contention during traffic (a latency/availability concern, not
a correctness one), and `0035`'s new ±2-day bound, which an old client could violate on write.
Ordering `0033 → 0034 → 0035` remains unproven until goal 4 rehearses it. **Merging changes no
schema**, so the deployed client is unaffected by the PR itself.

**8. Ownership — SINGLE POINT OF FAILURE.** 130 commits exist in exactly one place: this worktree, on
one laptop, on a branch with **no upstream**. This is the strongest argument for running goal 3
promptly, and the reason the PR verdict is GREEN. No named owner exists for alerts, backups, or the
Google budget.

**9. Business value — HIGH and gated.** Compliance work (Google media policy, provenance,
revoke-first grants), the account-deletion path, the operator's map/vibe UX, and 247+ catalog
additions. None of it reaches users until the PR merges *and* the migrations apply — and the
compliance value specifically is only realised once `0034` is live.

---

## 5. Should-not-ship list

**No commit or file was identified as unshippable.**

Checked: every added file over 20 KB; all 16 migrations *including their 24 RLS statements*;
`package.json` + lockfile; `.env.example` and every new `process.env` reference; the CI workflow;
`public/sw.js`; all 23 T0 paths; the added-file type census (49 `.ts`, 33 `.md`, 16 `.sql`, 9 `.tsx`,
8 `.mjs`, 7 `.png`, 5 `.mts`, 2 `.json`, 1 `.html`); and `git diff --check`. Secret scan clean over
500 tracked files.

Four things ship that deserve naming rather than discovery:

1. **`NEXT_PUBLIC_LEGACY_PHOTOS=1` uncommented** — change the default or accept it deliberately.
2. **~3.0 MB of PNG evidence** — intentional, but permanent git weight.
3. **The `photo_permissions` / account-deletion landmine** — dormant (zero writers), fix planned as
   `0036`. Named here because "no file is unshippable" is only accurate with this footnote.
4. **`docs/MASTER-TODO-2026-07-30.md`** was a pre-existing uncommitted edit in this worktree that the
   loop-guard checkpoint (`4e6bb7b`) swept in alongside this run's log. Legitimate content, but not
   authored by this run.

---

## 6. Evidence that nothing was mutated

- `git status --porcelain` identical before and after the fetch.
- `git reflog` shows only commits and one checkout (a baseline comparison that returned) — no
  `merge`, `rebase`, `reset`, or `push`.
- No database was contacted at any point. That is also why §2's ledger claim is hedged.

---

## 7. What the review panel changed

Four lanes reviewed the first draft: Claude/Sonnet, Codex `gpt-5.6-sol`, GLM, DeepSeek.

| Lane | Finding | Resolution |
|---|---|---|
| **Claude** | Factor 7 asserted a `0034` mid-window access risk that `scripts/apply-migrations.ts` disproves, and that a runbook in the same branch had already closed. | **Corrected.** Verified the `begin`/`commit` wrapping myself. This was the material error. |
| **Claude** | The `photo_permissions` defect was stated without its dormancy caveat and omitted from the summary surfaces. | Caveat added (zero writers, verified); surfaced in §5. |
| **Claude** | "Ledger ends at 0032" stated as fact in a session with no DB access. | Hedged, with provenance, and made a goal-4 reconfirmation item. |
| **Codex** | Counts stale by one (self-inclusion); "no logs added" false — `morning.md` *is* an added log. | Both corrected; an "as-of SHA" header added. |
| **Codex** | The `/discover` user-facing surface removal was never inventoried. | Added to §2. |
| **GLM** | RLS policies never audited as a category distinct from grants; dependency/lockfile never audited; service worker never inventoried. | All three added. RLS found **24 statements** — the most valuable catch. Dependencies came back clean; the SW came back correctly versioned. |
| **GLM** | "GREEN with four blockers" is self-contradictory; argued for AMBER. | **Partly adopted.** The label was ambiguous, not merely worded badly — split into two scoped verdicts (§0). |
| **DeepSeek** | Adjudicated GREEN: the PR gate and the deployment gate are different, merging applies no migration, and blocking the push would strand 130 commits on one laptop. Ranked restore-never-exercised as the single hard gate. | Adopted; drove the §0 split and the G1–G4 ordering. |
