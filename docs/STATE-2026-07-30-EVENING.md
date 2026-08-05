# Current state — 2026-07-30, evening

Single reconciled view after the 2026-07-30 sessions. Where this disagrees with an older
document, **this one is right** and the older one has been corrected in place.

## Where the code is

| | |
|---|---|
| Primary checkout | `C:\Users\cdfee\projects\next-bar` on `feat/phase1-compliance-media`, HEAD `c02baf9` |
| Overnight worktree | `C:\Users\cdfee\projects\nb-overnight` on `feat/overnight-2026-07-30`, branched from `c02baf9` |
| Pushed? | **No.** Neither branch has an upstream. Every commit exists only on this machine. |
| Migration ledger | ends at **0032**. `0033`, `0034`, `0035` are authored and **NOT applied**. |
| Unit baseline @ `c02baf9` | **1,459 passing / 96 files**, typecheck clean — tool-result recorded at mission time |
| Unit baseline @ `46aded6` (overnight HEAD) | **1,514 passing / 99 files** — measured 2026-07-31T01:2xZ, `npx vitest run` |
| Playwright @ `c02baf9` | 338 passing; **3 genuine failures** (`mobile-controls` on `/`, all three viewports); `bias-smoke` contention-sensitive with `retries: 1` and passing on retry |

<!-- Counts are point-in-time and MUST name the SHA they were measured at.
     Two ways this has already gone wrong here:
       1. MASTER-TODO / OVERNIGHT-BRIEF advertised "1,302 unit tests" at a HEAD
          that no longer existed.
       2. An earlier draft of THIS table claimed "1,489 / 98 measured at c02baf9".
          That pairing was false: be43821, 96386c8 and 9bd3a29 all add tests
          AFTER c02baf9, so the count at c02baf9 cannot be the later figure.
          Caught by the Codex review lane, 2026-07-31.
     If you cannot name the SHA a number came from, re-measure instead of
     guessing. -->


## Commits

On `feat/phase1-compliance-media`:

| SHA | What |
|---|---|
| `4472f23` | C2 F1+F3 — two-stage account-deletion quota keyed on the verified user id |
| `f9ac038` | C2 F6+F7 — public API route tests; health probe single-flight |
| `926f498` | C3 F3+F5 — revoke-first grants; `shares_list_publicly` reachable |
| `458b994` | production-readiness mission, security-test ROE, CTO learning artifacts |
| `c02baf9` | C4 — security-definer function audit (29 functions) |

On `feat/overnight-2026-07-30` (this run):

| SHA | What |
|---|---|
| `3d59207` | attended runbook for applying 0033 → 0034 |
| `bc846d9` | `/` catalog reflow — corrected diagnosis, blocked on a product call |
| `be43821` | pruner delete-path coverage; carousel bound pinned |
| `96386c8` | `0035` — `share_night` ±2-day bound (C4 F1), unapplied |
| `9bd3a29` | middleware amplification lever closed; rest of C2/C3 disposed |

## Corrections applied to older documents

| Document | Was | Now |
|---|---|---|
| `MASTER-TODO:35`, `OVERNIGHT-BRIEF:48` | Playwright hang "only reproduces in the multi-project run" | **REFUTED** — reproduced on single-project runs; fixed in `e812cf3` by upgrading to Playwright 1.62 |
| `MASTER-TODO:146` | "only `account/delete` and `waitlist`" are rate-limited | **WRONG** — `api/event` has a 60/minute limiter |
| `MASTER-TODO:147` | "24 policies" | **25 policies across 12 tables** |
| `MASTER-TODO:120,255`, `UX-BACKLOG:92,154` | S1 Hood Hopper rename open | **DONE** in `f7550db` as "Borough Crawler" |
| `APP-STORE-PLAN:36` | restated the privacy inventory inline | now points at `APP-PRIVACY-LABELS-2026-07-30.md` as authoritative |

Two further corrections were made *during* this run and are recorded where they were found:

- The catalog-reflow fix direction in `CONTINUATION-2026-07-30.md` ("preserve scroll
  anchoring") **cannot make the failing spec pass**. See
  `CATALOG-REFLOW-ANALYSIS-2026-07-30.md`.
- The recorded `isReachable` test gap ("above the cap is untested") was **already covered**;
  the real gap was the inclusive bound at `n === maxIndex`. Now pinned and mutation-verified.

## The seven operator questions

**This table is the single live checklist.** It absorbed the fuller wording that used
to live in `docs/CONTINUATION-2026-07-30.md`; that section is now a pointer here, so
there is exactly one place to record an answer. Do not re-create a second copy — that
is precisely how `APP-STORE-PLAN.md` and `APP-PRIVACY-LABELS-2026-07-30.md` drifted.

None is answered.

| # | Question | Blocks |
|---|---|---|
| 1 | `public.waitlist` has **no deletion path** — add one, or state a retention policy? | **App Privacy submission** (A7 §3.0) |
| 2 | `photo_permissions.granted_by_user_id` is `on delete set null`, so the row survives account deletion. Intentional licence audit trail? | privacy answer completeness (A7 §2) |
| 3 | Are `NEXT_PUBLIC_ANALYTICS` / `ANALYTICS_ENABLED` actually on in production? | **App Privacy submission** (A7 §6) — if off, "Usage Data collected" is the wrong answer |
| 4 | **B8** — still unanswered; gates geo-tagged night-out photos. What storage/retention policy applies? | B8, photo retention (A7 §5) |
| 5 | Keep `@playwright/test` at 1.62? | nothing — it works; confirmation only (G4 / `e812cf3`) |
| 6 | G1 deletion does not propagate device-to-device (needs a tombstone). Ship without it? | G1 residual risk |
| 7 | Is the origin reachable directly, bypassing the Vercel edge? | **C2 F2** (C2 §6) — returns to HIGH if yes |

**Q1 and Q3 are the App Privacy blockers.** Q7 gates the durable fix for the XFF trust
boundary.

## What is open

- **Attended:** apply `0033` → `0034` (runbook: `MIGRATION-0033-0034-RUNBOOK.md`); decide
  whether `0035` joins that window.
- **Blocked on a product call:** the `/` catalog reflow — three real E2E failures and a
  user-visible defect.
- **Blocked on a prerequisite:** no Postgres engine locally, so the clean-database migration
  rehearsal cannot run. Docker Desktop or the Supabase CLI unblocks it.
- **Not started:** goals 7–15 of the production-readiness program (architecture inventory,
  environment design, secret classification, CI gates + the missing `.claude/tier-map.json`,
  observability, privacy/App Store, release rehearsal, adversarial assessment prep, final
  launch-gate report).
- **Review debt:** items 3, 4 and 5 of this run sit at `ready_for_review`. No Codex, GLM,
  DeepSeek or Kimi lane has seen any of this code.
