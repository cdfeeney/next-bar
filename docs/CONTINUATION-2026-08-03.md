# CONTINUATION — 2026-08-03 attended session (Next Bar)

System of record for the next session. Every statement below was
reconciled against live git state, the harness goal store
(`workspace 9c928dacfabc5299`), the lease registry, and recorded
test/review evidence at write time (2026-08-03, ~18:45 ET). Source
narrative: `.loop-guard/attended-2026-08-03.md`; where they disagree,
THIS file is the reconciled truth.

## 1. Completed goals this session (store status `complete`, verified)

| Goal | Title | Commits |
|---|---|---|
| g-497e7228-3fc8-4852-9fd6-3b317cf0ce20 | RETRO record: operator 8/3 staging fixes (Bar Rankings header + inline search-to-rank, add-only empty state, ranking removed from Maps/lightbox) | `cb5041c` |
| g-919dae84-6141-4aa1-9646-a939096da395 | Friends/Nights Out: night archive (ratings snapshot), /nights history + share/unshare, anon-page route map, concurrency coverage | `d6fbf27`, `5e16575`, `b9be70a`, `5f50610` |
| g-b83d1c77-2175-4f78-bddf-b48b535ca0d6 | Design/site/domain audit: NYC truth fixes, R2/R4/R5/R7, per-route metadata+OG, siteIdentity + fail-closed robots/sitemap, App Store draft | `37b34dc`, `19f4e4c`, `44c4527`, `db2fd6a`, `3a285f1` |
| g-3e05ebf1-1a94-4ed8-b26b-203be92ea3ef | Parked advisories: /search ?q= deep link, text share on /lists cards, 2 stale spec repairs | `61e0bd7`, `edd9d8f` |
| g-6f47a102-1fdd-46c3-8bc3-eb89cccc18ea | /rankings ?add strip preserves history.state (deferred sibling of the /search fix) | `a5ad62b` |

(Also blocked→resolved this session: g-4ed5f834's DESIGN deliverable
shipped inside `cb5041c`; the goal itself stays `blocked` — see §5.)

## 2. Exact SHAs

- **Branch:** `feat/overnight-2026-07-30`
- **Local HEAD:** `a5ad62bd292eef4f2d080c0be5783fa4eb512988` (`a5ad62b`)
- **Upstream:** `origin/feat/overnight-2026-07-30` — local is **[ahead 1]**
- **Deployed (pushed) tip:** `edd9d8f28a31be9dad5a7853423fd50b8ac9c269`
- **Local-only (reviewed, NOT deployed):** `a5ad62b` — ships only with
  explicit operator approval.

## 3. Current Staging identity

- Deployment `next-bar-staging-5vv0oz6ox-cdfeeneys-projects.vercel.app`
  — `/api/health` verified 2026-08-03T18:15:59Z:
  `{ok:true, supabase:"ok", environment:"staging", sha:"edd9d8f28a31"}`.
- Rollback ladder (all untouched): `…1jspo34q6…` (`5f50610`) →
  `…1wtafj4wo…` (`d6fbf27`) → `…e1037uvwn…` (`cb5041c`, operator-accepted).
- Project `next-bar-staging` (prj_QFndfJa0Q1NNM09yqWYt66KgAEp0); envs
  live on Preview; `NEXT_PUBLIC_BUILD_SHA` currently = `edd9d8f…` full sha.
- Production ref `nuhqlvneokucxomguxhi` must NEVER appear in staging config.

## 4. Tests and reviewer verdicts (evidence recorded per goal in the store)

- **Baseline at `a5ad62b`:** `tsc --noEmit` clean; vitest **1923/1923**
  (122 files); Playwright **175/177** across the session's affected specs
  (2 chromium-only clipboard skips; iPhone 13 / Pixel 7 / iPhone 17).
  The known `/` mobile-controls trio (g-90f908bc) remains red by design.
- **Gating policy (operator-set 2026-08-03):** fresh Claude **Opus** +
  **Codex** (`~/.claude/bin/codex-review.mjs`, schema-validated,
  fail-closed). Sonnet lanes are informational/NON-gating.
- Verdicts: g-b83d1c77 — 4 rounds; final Opus approve @ `b762c591`,
  Codex trailing MEDs fixed; operator adjudicated round-4 (privacy line,
  mapped-IPv6 fail-closed accepted). g-919dae84 — 4 rounds; Opus approve
  @ `ab2a9fe6` (independently reproduced the pre-fix swap discrimination
  check), Codex clean. g-3e05ebf1 — 2 rounds; Opus approve @ `a59eac42`
  and @ `866a0aff`, Codex clean. g-6f47a102 — bounded round; Opus approve
  @ `e232e0d2`, Codex clean. cb5041c — pre-policy panel (Codex/GLM/
  DeepSeek/Sonnet + verifier) + operator staging acceptance recorded as
  completion authority.

## 5. Open items — status and EXACT next action

**Operator decisions (no work possible until answered):**
1. **g-4ed5f834** (`blocked`) numeric ranking — answer the 3 questions in
   `docs/DESIGN-NUMERIC-RANKING-g-4ed5f834-2026-08-03.md` (override vs
   replace comparisons; silent re-tier vs ask; manual bars as peers).
   Next action: operator answers → `/code g-4ed5f834-…` implements Option
   A phases 1–2 (T1, TDD).
2. **Domain packet** `docs/DOMAIN-PREP-DECISIONS-g-b83d1c77-2026-08-03.md`
   — decide: hi@ mailbox (then swap the six `hi@next-bar.app` refs),
   legacy-photos liability (flag off / fund compliant path / accept),
   "iOS app" PWA framing, DNS cutover + `NEXT_PUBLIC_SITE_URL`, Supabase
   auth-redirect matrix. Next action per item is written in the packet.
3. **Sign-out wipe scope** — widen to live night log + Want-to-go, or
   keep the current (accurately-documented) split. Next action: operator
   verdict → one-line ALL_KEYS change + settings copy + tests.
4. **/search reachability** — parked 6th-tab advisory; only entry today
   is the Want-to-go empty state. Operator product call.
5. **Cleanup packet** (audit doc §6 + accumulated): superseded
   deployments `…e1037uvwn…`, `…1wtafj4wo…`, `…1jspo34q6…`, the errored
   record, `…qs80z6v8h…`, and the 8 "Synthetic staging fixture" bars
   rows. Next action: operator keep-vs-delete per item BEFORE any run.

**Blocked goals needing attended/T0 sessions:**
6. **g-31f36bf8** Pin-where-I-am (T0-auth) — lead a fresh overnight at
   queue head; re-verify the armed lock first.
7. **g-e9d493e9** night photos (T0; migration 0038 draft NEVER applied) —
   attended migration session only.
8. **g-35babba8** photo sweep — ATTENDED ONLY: real Places spend,
   $250 HARD cap, staging DB writes; scripts on the goal.
9. **`list_my_shared_nights` RPC** (required — recorded in
   `docs/NIGHTS-OUT-NOTES-g-919dae84-2026-08-03.md`): bundle with Close
   Friends schema work in the next attended migration session (next
   migration number after 0037; staging ledger applied through 0036).
10. **g-90f908bc** — the three genuine `/` mobile-controls e2e failures
    (async catalog reflow). Next action: dedicated fix session; do not
    weaken the spec.
11. Carried-over blocked goals from earlier missions (unchanged today):
    g-12d33864 (map tweak follow-ups), g-1cae785c (0036 rehearsal),
    g-52470455 (production release — needs GO), g-7c12a62f (env design),
    g-87cf2100 (go/no-go packet), g-91db2f50 (0033/0034 readiness),
    g-a020ae84 (staging-deploy goal — likely satisfied by today's
    deploys; next session should reconcile/supersede rather than rerun),
    g-dc0588b0 (integration PR — needs push authorization),
    g-e6067aab (worktree inventory; 3 dead worktrees already pruned
    2026-08-03, 17 remain registered).
12. **Push/deploy `a5ad62b`** — reviewed, local-only. Next action:
    explicit operator approval → disarm lock, push, deploy, smoke,
    re-arm (procedure proven 3× today).

## 6. Protected operator documents — NEVER edit, stage, or revert

- `docs/MASTER-TODO-2026-07-30.md` (dirty, by design)
- `docs/OPERATOR-BUGS-2026-07-28.md` (dirty, by design)
- `docs/CTO-OPERATOR-PLAN-2026-07-31.md` (untracked, by design)
- `docs/STAGING-ACCEPTANCE-NOTES-2026-08-01.md` (untracked, by design)

These four are the ONLY dirty/untracked paths in the worktree.

## 7. Hard boundaries (safety — not tiered, never waived)

- **Production:** untouched, always; ref `nuhqlvneokucxomguxhi` never in
  staging config; any production action is attended + explicit GO.
- **Migrations:** staging DB applied through **0036**; **0037
  attended-only**; **0038 never applied** (draft not in repo). New DDL
  only in attended sessions with T0 review.
- **App Store / Apple:** local drafts only
  (`docs/APP-STORE-METADATA-DRAFT-2026-08-03.md`); no App Store Connect
  resources/certs/profiles/identifiers/TestFlight; never invent Team or
  bundle IDs.
- **Analytics:** dark/OFF everywhere; enabling is an operator decision
  (ip:0/geoip-discard advisory applies when PostHog is ever enabled).
- **Photos:** ~3,435 re-hosted Google Place photos ship behind
  `NEXT_PUBLIC_LEGACY_PHOTOS` — acknowledged policy liability, operator
  decision pending (packet item 2); `NEXT_PUBLIC_GOOGLE_MEDIA` off
  pending spend-cap review; no venue-site images; recaps exclude Google
  media.
- **Remote writes:** OVERNIGHT_REMOTE_WRITE_LOCK is **armed**
  (`C:\Users\cdfee\projects\next-bar\.git\OVERNIGHT_REMOTE_WRITE_LOCK`).
  Its hook pattern-matches trigger words inside command text — write
  payloads to files first. Disarm only for an operator-approved remote
  action, re-arm immediately after.

## 8. Rule: no work lives only in transcripts or dirty files

Every piece of unfinished work MUST exist as (a) a stored goal with
status + evidence in the harness store, or (b) a committed doc (like
this one) — never only in conversation transcripts, memory, or
uncommitted files. This session's audit trail: all five completed goals
carry recorded evidence; the one intentionally-blocked goal carries its
blocking reason; the four protected docs are the only uncommitted state
and they are operator-owned.

## 9. Continuation prompt for the next session (copy-paste)

```
This is an attended Next Bar continuation.

Workspace:
C:\Users\cdfee\projects\nb-overnight

Read CLAUDE.md and docs/CONTINUATION-2026-08-03.md first. Treat that
committed continuation file, Git history, and the stored goal system as
the system of record — not transcript memory.

Before doing any work, verify:
- branch and HEAD match the continuation;
- upstream relationship matches;
- only the four protected operator documents are dirty;
- no foreign lease exists;
- remote-write lock is armed;
- current Staging SHA matches the record.

If anything differs, stop and report the exact difference.

Then show me:
1. completed goals;
2. blocked and unfinished goals;
3. operator decisions needed;
4. the recommended next goal.

Do not create duplicate goals. Do not push, deploy, configure
credentials, apply migrations, or touch Production without explicit
approval.
```
