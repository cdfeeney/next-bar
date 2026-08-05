# CONTINUATION — 2026-08-05 (Next Bar) — SYSTEM OF RECORD

Supersedes `docs/CONTINUATION-2026-08-04.md`. Reconciled at write time against
live Git, the goal store (workspace `9c928dacfabc5299`), the lease registry,
the remote-write lock, Vercel, and both databases. Where this file and memory
disagree, **this file, Git, and the goal store win.**

Session shape: one unattended overnight verification loop, then a long
attended block (census closeout → reconciliation → Staging restore → login
feature → Beta 1 RC).

## 1. Exact final state

- Branch `feat/overnight-2026-07-30`, local HEAD **`3aa64ee`**.
- **NOTHING PUSHED.** 61 commits outgoing vs `origin/feat/overnight-2026-07-30`;
  31 of them created this session.
- `origin/main` = **`6ec5e5d`** (fetched this session; the previously-cached
  `4b06ed6` was stale, exactly as predicted).
- Dirty/untracked: the four protected operator docs **only**, byte-for-byte
  preserved — plus two operator-authored files this session did not touch
  (`docs/PORTFOLIO-AND-COMPANY-AGENT-AUDIT-2026-08-05.md`,
  `docs/THURSDAY-BETA-RELEASE-PLAN-2026-08-05.md`).
- Remote-write lock **ARMED**; lease registry **empty** (`live:false`).
- Worktrees: 20. Two created this session — `nb-beta1-rc` (the RC) and
  `nb-staging-deploy` (detached @ `6ec5e5d`, kept for redeploys). Nothing
  pruned; `nb-testflight-node22` and `nb-ios` untouched.

## 2. Beta 1 RC — the current deliverable

- Worktree `C:\Users\cdfee\projects\nb-beta1-rc`, branch `release/beta1-rc`,
  **RC SHA `415a486`**, working tree clean, never pushed.
- Composition: `origin/main@6ec5e5d` → migration branch
  `release/prod-migrations-0033-0036@6e553fa` → overnight tip `3aa64ee`
  merged `--no-commit` and scrubbed before committing → residue correction.
- **Migrations: 37 files, `0000`–`0036`, contiguous.**
- **Excluded:** census executable (`scripts/census`, 19 files), migrations
  `0037`/`0041`, venue pins + draft `0038` (all components/hooks/libs/tests),
  and the pin commit's **6am night-boundary change** — reverted to pre-`deffdd1`
  for nightKey/intent/cadence/nightPhase/useIntent/demo-intents and their
  tests, `socialNight.ts` deleted. Personal features roll over at **5am local**
  again; `nightKey` stays 6am NY as before the pin commit.
- **Preserved:** matcher v1.1, the full login feature, e2e fence + loopback
  fixtures, migrations `0020`–`0036`.
- **Conflicts: exactly two** — `package.json`, `package-lock.json`. Resolved by
  keeping BOTH sides (`@capacitor/assets` 3.0.5 + `@capacitor/cli` 8.5.0 from
  main; `@playwright/test` 1.62.0 + `motion` 12.43.0 from overnight), then
  regenerating the lock with `npm install --package-lock-only`.
- `git diff --check 6ec5e5d..HEAD` **exit 0**.
- Evidence (own real `npm ci`, 459 pkgs, no linked node_modules): tsc 0; unit
  **129 files / 1968 tests**; `next build` clean, 30 static pages.

### RC e2e result — read this before trusting it

| Project | Passed | Skipped | Failed |
|---|---|---|---|
| iPhone 13 | 157 | 54 | 1 (+1 self-retried flaky) |
| Pixel 7 | 169 | 53 | 2 |
| iPhone 17 | 54 | — | 3 |
| Desktop marketing | 20 | — | 1 |

**Every failure and skip has ONE cause: the RC worktree has no `.env.local`.**
Verified, not assumed — the identical specs pass in `nb-overnight`, which
differs only by that file. Mechanically: `CatalogRefresh` early-returns when
`getBrowserSupabase()` is null, so `data-catalogSwapped` never sets and the
tests polling it read `undefined`; and `useAuth` reports `unavailable` rather
than `signed-out`, so `/settings` never renders its "Sign in" link. The 53–54
skips are the 17 spec files that self-skip without Supabase config.
`want-to-go-writers` passes 3/3 isolated (contention under a throttled
background run). **Not fixed deliberately** — closing it means putting
credentials in the RC worktree, which was outside the authorization.
Fence audit for the RC runs: carto tiles + canary + Google Fonts only,
**zero Supabase egress**.

## 3. Completed this session

| Goal | Result |
|---|---|
| `g-7104aed0` census pilot | **complete** — 0041 applied+verified on protected Staging, Lucinda's inserted, bars **412** |
| `g-31c59158` login window | **complete** — SignInGate, 5 santa rounds, quorum met @ `3aa64ee` |
| `g-5dd241b6` loopback e2e | **complete** — catalog/tile fixtures; full matrix trustworthy |
| `g-1cae785c` Staging environment | **complete** — Staging restored and serving |

Overnight loop (Gates 1–7) report: `docs/OVERNIGHT-TEST-REPORT-2026-08-05.md`.

## 4. Live environment facts (measured 2026-08-05)

- **Production** (`next-bar`, Supabase `nuhqlvneokucxomguxhi`): deployment
  `dpl_4kHrzs54Cm5j1Z1KdRaHGbTBngeR` serving `6ec5e5d7ad1d`; health ok;
  **bars 1,256** (curated 401 / import 855). **Ledger ends at `0032` (33 rows)**
  — the sim packet's assumed 0036 baseline was wrong by four.
  Rollback target: `dpl_HtdttFsECRehCmoVGBcZz8EpcpyP`.
- **Staging** (`next-bar-staging`, Supabase `wqxovhiovgcijmfzxgby`): restored
  and serving at `next-bar-staging.vercel.app`, deployment
  `next-bar-staging-o2sekb0yw` @ `6ec5e5d`; **bars 412**; ledger `0000`–`0037`
  + `0041`. Its Production-target env now carries all 10 vars;
  `DATABASE_URL`/service-role were moved off Preview scope.
- **Checksum drift: ZERO** on both ledgers (33/33 and 39/39 vs local files).
- **CRITICAL, still open — P1:** `schema_migrations` is **anon-readable in
  Production** because `0036` is one of the missing migrations. That is how
  this session read the Production ledger. Applying `0033`–`0036` closes it.

## 5. Blockers and open decisions

1. **Production migration window** — packet
   `docs/PROD-MIGRATION-PACKET-0033-0036-2026-08-05.md` @ `702e3ac`, branch
   `release/prod-migrations-0033-0036@6e553fa`. Review goal `g-697b00ec`
   remains **blocked** (3-round cap; the final fix commits await one verdict).
   Not applied anywhere.
2. **`g-87cf2100` go/no-go: NOT GO.** See
   `docs/RELEASE-RECONCILIATION-2026-08-05.md` @ `8e3a3e5`.
3. **RC e2e env decision** (§2) — credentials in the RC worktree, or accept
   partial coverage.
4. **Write-path Staging acceptance never run** — sign-in, ratings, follows,
   shares, Nights Out all mutate protected Staging and were not attempted.
   Read-only pass: `docs/STAGING-ACCEPTANCE-2026-08-05.md` @ `1188a49`.
5. **Invited-Crew flow remains INCOMPLETE** — `get_circle_suggestions` is
   followed-circle, not invite-scoped. Not substituted for.
6. Queued/planned: `g-b07c73bc` mobile-shell regression, `g-8354588a`
   tier-validate Windows fix, `g-6b9f79ec` product packets, `g-9b97c22d`
   platform packets, `g-c8b26779` Phase B. Unchanged blocked: `g-52470455`,
   `g-e9d493e9`, `g-4ed5f834`, `g-12d33864`, `g-dc0588b0`, `g-a020ae84`.

## 6. TestFlight observes PRODUCTION — correction to earlier framing

Build 5 wraps `next-bar-two.vercel.app`, which **is Production**. Therefore:

- The login window **cannot be device-tested today at all** — Production serves
  `6ec5e5d`, which does not contain it. Device confirmation is blocked on the
  code reaching a surface the shell points at, not on Apple.
- Any acceptance testing done on that build **writes to Production**.
- The mobile-shell items you reported (background, safe-area, scrolling) were
  observed against **Production**, not Staging.
- This is precisely the defect the ADR predicted: architecture **A** has "no
  per-binary env isolation"; **C** (adopted target) exists to give a staging
  binary a staging origin, fail-closed.

## 7. Incidents — self-caused, self-repaired, recorded

- **`node_modules` destroyed TWICE.** A temp worktree was given `node_modules`
  via a Windows **junction**, and deleting the worktree traversed the junction
  and gutted the target (204 → 183 → 94 packages, `.bin` gone). Symptom is
  deceptive: `npm run typecheck` silently falls through to a **global**
  TypeScript 7 and fails on `baseUrl has been removed`. Both repaired with
  `npm ci` after verifying `package-lock.json` was clean. **Two earlier
  "transient, non-reproducing" unit failures were this damage in progress —
  the flake explanation was wrong.** Second occurrence came from a review
  subagent following my own instruction to verify by mutation. Rule now:
  never junction `node_modules`; forbid it in reviewer prompts.
- **PowerShell corrupted files twice** — `Get-Content`/`Set-Content` round-trips
  mojibaked UTF-8 (`â€"`), `-replace` is case-insensitive by default, and
  `Set-Content -Encoding utf8` added a **BOM** to four SQL migrations staged for
  a Production apply (caught only by `git hash-object`). Use the Edit tool for
  tracked files; use `git checkout <sha> --` to move file content.
- **Vercel CLI side effects:** `vercel link` rewrites `.gitignore` and
  `.env.local` on every project switch; `vercel env pull --environment=production`
  **redacts user values** (all length 0) and is NOT a valid way to verify what
  is stored — a preview pull does emit them.
- **Env values must not be piped in PowerShell:** piping into `vercel env add`
  appended a newline and produced a Staging deployment reporting
  `supabase:"unreachable"` against a healthy backend. Re-added with bash
  `printf '%s'` and redeployed.

## 8. Review-process notes worth keeping

Five santa rounds on the login window and four on the migration packet found
real defects in my own work — the pattern that repeatedly paid off was
**deleting a branch and checking whether tests still pass**. Findings the
reviewers caught that I had missed: the gate could never have fired in the
Capacitor shell; the packet's own runner was ledger-less; rollback left ledger
rows behind so a later run would silently skip; and the pre-apply gate lived in
a **gitignored** directory while reading the ledger through the very hole it
was verifying. Codex once blocked purely because its read-only sandbox could
not run Vitest — a lane that cannot verify is not a lane that approved; it
approved on re-run with temp writes.

## 9. Exact next commands

- **Finish the login review loop:** nothing required — `g-31c59158` is complete.
- **Migration packet verdict:** `/santa-loop g-697b00ec-6d70-4c5e-bde5-402c4caa1bb6`
  (review-only; no external actions).
- **Then, attended and separately approved, in order:** decide the RC e2e env
  question → write-path Staging acceptance → rollback rehearsal on Staging →
  apply `0033`–`0036` to Production via the packet (closes P1) → promote the RC.
- **Never** `npm run db:migrate` from this branch against Production: its
  would-apply set is six, silently including `0037`/`0041`.

## 10. Continuation prompt (copy-paste)

```
This is an attended Next Bar continuation.

Workspace: C:\Users\cdfee\projects\nb-overnight

Read CLAUDE.md and docs/CONTINUATION-2026-08-05.md first. Treat that file,
live Git, and the stored goal system as the system of record — not transcript
memory.

Verify before any work: branch feat/overnight-2026-07-30 at 3aa64ee; only the
four protected operator documents dirty (plus two operator-authored docs this
session did not touch); no lease; remote-write lock armed; origin/main at
6ec5e5d; Beta 1 RC at 415a486 on release/beta1-rc in ../nb-beta1-rc. If
anything differs, stop and report the exact difference.

Gating reviewers: fresh Claude FABLE + Codex (T1); + risk-routed specialist
(T0). Never junction node_modules, in your own work or a subagent's.

Then show me: the open blockers in §5, the Production ledger gap and the P1
exposure, and the RC e2e environment decision. Do not push, deploy, apply
migrations, or touch Production/Staging without explicit approval for that
exact action.
```
