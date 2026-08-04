# CONTINUATION — 2026-08-04 overnight run (Next Bar) — SYSTEM OF RECORD

Supersedes `docs/CONTINUATION-2026-08-03-EVENING.md`. Reconciled against
live git, the goal store (workspace `9c928dacfabc5299`), the lease
registry, the remote-write lock, and recorded test/review evidence at
write time (2026-08-04 ~01:35 ET). Unattended six-hour overnight run,
launched 23:01 ET 2026-08-03, finished ~01:40 ET — well inside the
04:45 hard stop.

## 1. Exact final state

- Branch `feat/overnight-2026-07-30`; **local HEAD = the commit
  containing this file** (parent `79a8800`).
- **Origin tip unchanged — NOTHING was pushed.** Before tonight the
  branch was 15 ahead / 0 behind; tonight added 6 local commits
  (below + this one) → **21 outgoing**.
- Dirty/untracked paths: EXACTLY the four protected operator documents
  (`docs/MASTER-TODO-2026-07-30.md`, `docs/OPERATOR-BUGS-2026-07-28.md`
  modified; `docs/CTO-OPERATOR-PLAN-2026-07-31.md`,
  `docs/STAGING-ACCEPTANCE-NOTES-2026-08-01.md` untracked) — byte-for-
  byte preserved (see §7 incident note).
- Remote-write lock ARMED throughout and at close
  (`next-bar/.git/OVERNIGHT_REMOTE_WRITE_LOCK`). Lease registry empty at
  close. No `.claude`/worktree deletions; no branches removed.

## 2. Commits created tonight (all local-only)

| SHA | What | Files |
|---|---|---|
| `deffdd1` | feat: [T0][g-31f36bf8] live venue presence — Pin where I am | 32 files: socialNight canonical boundary (+nightKey/intent/cadence/nightPhase move 5am→6am + test updates + comment sweep incl. useIntent/matching/demo), pins.server(+test), pinSignal(+test), useSessionPin, useDialogA11y(+test), PinWhereIAm, PinConfirmDialog, ImHereButton, ResultCard, friends/page, accountCache (pin reset wiring), e2e/pin-where-i-am.spec.ts, drafts/0038_venue_pins.sql, migration0038.test.ts, MIGRATION-PLAN-RECONCILIATION doc |
| `8d66533` | chore: checkpoint (morning log only) | .loop-guard/morning.md |
| `49d9192` | feat: [T1][g-7de10fce] matcher v1.1 + dark KPI foundation | 15 files: matcherEval(+corpus gates), tasteSignals(+test), matching/constants, ResultsView, useSuggestions(+test), kpiContracts(+test), analyticsAdapters(+analytics.test), matcher-eval-report.mts, MATCHER-EVAL doc |
| `70356e3` | chore: checkpoint (morning log only) | .loop-guard/morning.md |
| `79a8800` | docs: [T2][g-7104aed0] census readiness (no activation) | CENSUS-READINESS-2026-08-04.md |
| (this commit) | docs: continuation | this file + morning log |

## 3. Goal outcomes

**COMPLETE (Santa NICE, evidence in store):**
- `g-31f36bf8-4979-4d52-88b3-a433570c717e` — T0 Pin where I am @
  `deffdd1`. Review: 3 rounds + scoped closure. R1 Fable BLOCK(2H) +
  Codex timeout(124, packet size); R2 Fable BLOCK(3H) + Codex timeout;
  R3 FULL success — Fable(1H) + Codex(proof f7e363fa; 2H/3M) +
  DeepSeek(advisory, prescribed the epoch guard); scoped closure Fable +
  Codex(proof f7e363fa→4997… see store) converged on one HIGH
  (owner-gated pins sync). Every C/H/M fixed as prescribed +
  regression-tested. Final: pin e2e 37/37 (iPhone 13 + Pixel 7),
  affected suites 81/81 → 51/51, vitest full, tsc/build/secret/diff
  clean. DeepSeek round-0 design consult: SQL authz/DST clean.
- `g-7de10fce-2f05-442c-a7d0-26adc0ad8bf9` — T1 matcher v1.1 + KPI @
  `49d9192`. Review: 2 rounds, Fable + Codex both succeeded both rounds
  (proofs 0c7c3c1e, 4997d0d1; Fable r2 VERDICT APPROVE). GLM planning
  consult caught a REAL cold-start echo-chamber (entropy 2.137→2.055,
  eval-confirmed) → MIN_LOVED_BARS_FOR_WEIGHTS=2 floor.

**Matcher metrics (32-scenario corpus over the real 403-bar bundled
catalog; engine = CI gates = report script):**
baseline → adopted(A+B): lovedAlign 0.4210→**0.4371**, avoidHit
0.0456→**0.0400**, vibe 0.3389→0.3398, hoods 1.781→1.813, miles
0.3271→0.3386 (+0.014 = tie-breaker scale), violations 0 everywhere,
repeat-hand second-hand vibe 0.470→**0.523**. Full table + weakness
audit + GLM triage: `docs/MATCHER-EVAL-g-7de10fce-2026-08-04.md`.

**SAFE PORTION DONE, RETURNED TO `planned` (attended-only):**
- `g-7104aed0-7305-491e-8297-b47729cd1496` — census activation pilot.
  Tonight: unit 60/60, fixture CLI run complete
  (run-2026-08-04T05-29-22-661Z, budget 9/50, 4 SYNTHETIC candidates,
  artifacts only under gitignored scripts/census/out/), resume/report
  idempotent, LOOP_UNATTENDED=1 --apply REFUSED as designed,
  concurrent-writer refusal verified static+unit (live two-writer proof
  needs the attended 0037 apply). Zero readiness defects.
  **NO bars added; no credentials/paid calls/Staging access/0037 apply.**
  Full record: `docs/CENSUS-READINESS-2026-08-04.md`. Attended gates
  listed there (ledger check → 0037 approval → pilot area/sources →
  cost ceiling → report → curation → sole attended apply →
  post-apply verification + rollback).

**BLOCKED / QUEUED (unchanged tonight unless noted):**
- `g-c8b26779` — social hardening Phase B: attended T0 migration
  session (apply 0015 + 0035 + author list_my_shared_nights/Close
  Friends as **0039** per docs/MIGRATION-PLAN-RECONCILIATION-2026-08-04.md).
- `g-e9d493e9` — night photos: blocked; its future migration is
  **0040** (renumbered from prose-"0038" by the reconciliation doc; no
  file ever existed). Tonight's venue-pins draft OWNS 0038 (in
  `supabase/migrations/drafts/`, runner-inert, NEVER applied).
- `g-4ed5f834` — numeric ranking: still blocked on the operator's 3
  design answers (docs/DESIGN-NUMERIC-RANKING-g-4ed5f834-2026-08-03.md).
- `g-12d33864` — Map implementation: RECONCILIATION (per operator
  mission): technically reviewed; its old Want-to-Go-writer blocker was
  RESOLVED by g-8557db39; final status still awaits **operator visual
  approval** — not granted, not invented.
- `g-35babba8` (paid photo sweep, $250 cap), /support (mailbox
  decision), Staging 411-row anomaly (attended reconciliation),
  worktree cleanup (deferred; nothing pruned) — all unchanged.
- Older blocked items (g-1cae785c, g-52470455, g-7c12a62f, g-87cf2100,
  g-91db2f50, g-a020ae84, g-dc0588b0 integration PR — which must also
  reconcile main's #86–#94, g-e6067aab) — unchanged.

## 4. Test/verification evidence at final source state (`49d9192`+docs)

- vitest **2058/2058**; `tsc --noEmit` clean; `next build` clean;
  secret scan clean (622 tracked files); `git diff --check` clean.
- Playwright (all bounded, foreground, iPhone 13 + Pixel 7 (+iPhone 17
  shards where configured)): pin suite **37/37**; ranking surfaces
  **105/105** then **85/85** at final state; social/affected suites
  **81/81** and **51/51**. ZERO new failures; the known /quiz
  cold-compile flake did not occur.

## 5. Residual risks / follow-ups (non-blocking, documented)

- Pin: BarLightbox not yet migrated onto useDialogA11y (two dialog
  lifecycles until then); per-instance night-refresh timers bounded by
  MAX_RESULTS=3; multi-tab pin divergence self-corrects on fetch; LIVE
  two-user SQL authorization + Postgres-side DST proof belong to the
  attended 0038 apply.
- Matcher: per-question quiz normalization + exploration identity salt
  deferred (documented future candidates; corpus now exists to evaluate
  them); GLM's geographic-avoid-clustering and false-avoid-regret
  metrics recorded as future eval work.
- KPI: contracts are specification-only; server-side payload support +
  call-site wiring (8 sites listed in the eval doc) await the attended
  analytics enablement decision.

## 6. Operator decisions still open (carried from 2026-08-03 §5)

1. iOS TODAY (see §8). 2. B1 production SUPABASE_SERVICE_ROLE_KEY
repair. 3. Privacy labels Q1/Q3. 4. Domain/DNS + mailbox → then six
mailto swaps. 5. /support route vs /install. 6. 1024 no-alpha icon
approval. 7. g-4ed5f834's 3 ranking answers. 8. Sign-out wipe scope;
/search reachability; cleanup packet. 9. Staging 411-row anomaly.
10. #90 wrapper adjudication items already partially executed 8/03
(PRs #91–#94) — see that doc's fourth wave for what remains.

## 7. Session-boundary confirmation + incident note

Nothing pushed, deployed, migrated, or uploaded. Production untouched;
Staging untouched (no reads either); no Apple/App Store/TestFlight/UDID
actions; DNS/credentials/email untouched; no paid API calls; PostHog +
all analytics DARK (unit-asserted); no migration applied anywhere —
0038 exists only as a runner-inert draft in `drafts/`.

**Incident (self-caught + fixed):** `loop-guard checkpoint` broad-
committed the four protected operator docs after item 1 (commit
b24206c). Undone with `git reset --mixed HEAD~1` (contents untouched;
exact dirty/untracked state verified restored); remaining checkpoints
were explicit narrow commits of the morning log only. The stray commit
object is unreachable and harmless.

**Codex lane lesson:** two 540s timeouts (exit 124, tree termination
confirmed both times) on broad review packets; narrow-scope packets
succeeded immediately (proofs f7e363fa, 0c7c3c1e, 4997d0d1). 124 was
packet weight, never an outage.

## 7b. ATTENDED SESSION 2026-08-04 EVENING — TestFlight upload SUCCEEDED

Grounding at session start matched §1 exactly (branch/HEAD/21-outgoing/
four dirty docs/no lease/lock armed); zero discrepancies.

- **UDID registered** by the operator (Apple Devices app path; first
  cable was charge-only — Windows enumerated no Apple device until the
  cable swap). UDID never printed or stored.
- **Run 4** (main @ `4b06ed6`, operator-dispatched via GitHub UI,
  server_url=https://next-bar-two.vercel.app): signing FIXED end to end
  (archive w/ dev profile, automatic-signing export, NextBar.ipa) —
  device registration was indeed the missing prerequisite. Upload failed
  on a NEW Apple gate: altool 409 — uploads must be built with the
  **iOS 26 SDK**; macos-15 caps at Xcode 16.4/iOS 18.5 SDK.
- **Fix: PR #95** (`fix/ios-testflight-macos26`, commit `15a4876`,
  squash-merged to main as **`6ec5e5d`**): one line,
  `runs-on: macos-15` → `macos-26` (+comment). T1 per tier-map
  (.github/**). Reviews: fresh Fable APPROVE (advisory M: consider
  DEVELOPER_DIR pin later; advisory L: SPM-under-Xcode-26 provable only
  live) + Codex APPROVE (no findings; recommends NO pin — image label
  already constrains the Xcode major; patch pins break on rotation —
  adopted). Direct push to main was rejected by branch protection
  (PR + 2 checks required) → PR route, auto-merge after gates 1m49s +
  Vercel green.
- **Run 5 = 30958647881** (main @ `6ec5e5d`, assistant-dispatched with
  the operator's explicit approval, same server_url): **ALL GREEN
  including upload_to_testflight.** Build 5 uploaded to ASC
  (App 6797689354). Only annotation: benign Node-20 deprecation notice
  for GitHub's own actions.
- **Lock discipline:** remote-write lock disarmed in three explicit,
  operator-authorized windows (push branch/PR #95; dispatch run 5;
  launch read-only watch) and **re-armed immediately after each** —
  armed at close. Overnight branch, nb-ios, nb-testflight-node22, and
  the four protected docs untouched. Production/Staging untouched; no
  migrations; census goal not yet started this session.
- **Phase 1 COMPLETE (operator-side):** build 5 processed ("Ready to
  Submit" = processed; nothing submitted for review), Internal Testing
  group created, operator installed the app on the registered iPhone via
  TestFlight. Cofounder Users-and-Access invites SENT; adding them as
  group testers awaits their acceptance (async, non-blocking). NO
  external group, NO App Review submission. Shell loads
  next-bar-two.vercel.app (no local Pin/matcher commits — those are the
  overnight branch).

## 8. Tomorrow's exact iOS/UDID/TestFlight steps (operator, unchanged)

1. Finish registering the iPhone UDID (Apple Devices app → copy UDID →
   developer.apple.com → Devices → +).
2. Dispatch: GitHub Actions → iOS TestFlight → Run workflow →
   `server_url=https://next-bar-two.vercel.app` (pre-DNS). Next likely
   failure surface: gym export re-sign / upload_to_testflight — paste
   the log tail to the assistant.
3. On success: ASC → TestFlight → build "Processing" 15–30 min →
   create Internal Testing group → invite the 2 cofounders via Users
   and Access (no UDIDs needed for testers).
4. Then: DNS cutover (then blank-input canonical build), Codex
   icon-artwork PR, §6 decision list.

## 9. Exact next commands

- **Attended session (recommended first):** `/code
  g-7104aed0-7305-491e-8297-b47729cd1496` — census activation pilot
  (its safe-portion evidence is already in the store; start at the
  Staging ledger check), OR the Phase B migration session for
  `g-c8b26779` (authors 0039).
- **Next unattended overnight:** no stored goal is safely runnable
  without operator input (census/Phase B/photos are attended; ranking
  needs answers; map needs visual approval). Queue new /mission items
  first.

## 10. Continuation prompt (copy-paste)

```
This is an attended Next Bar continuation.

Workspace: C:\Users\cdfee\projects\nb-overnight

Read CLAUDE.md and docs/CONTINUATION-2026-08-04.md first. Treat that
file, Git history, and the stored goal system as the system of record —
not transcript memory.

Verify before any work: branch feat/overnight-2026-07-30; only the four
protected operator documents dirty; no lease; remote-write lock armed;
origin tip unchanged (21 outgoing local commits). If anything differs,
stop and report the exact difference.

Gating reviewers: fresh Claude FABLE + Codex (T1); + risk-routed
specialist (T0). Sonnet is informational only.

Then show me: tonight's two completed goals; the census readiness
result and its attended gates; the operator decision list (§6); and the
recommended next goal. Do not push, deploy, apply migrations, create
Apple resources, or touch Production/Staging without explicit approval.
```
