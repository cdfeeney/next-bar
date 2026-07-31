# Continuation prompts — after 2026-07-30

Two unattended runs completed nine queue items across twelve local commits on
`feat/phase1-compliance-media` (`b4efabe` → `83d2977`). Nothing pushed, no
migration applied.

Each prompt below is **self-contained** — paste one into a fresh session. The
verified facts are inlined deliberately so a new agent does not re-derive them
(several were derived *wrongly* the first time; the corrections are noted).

---

## 0. Session primer — paste first if the agent has no context

```
Read docs/CONTINUATION-2026-07-30.md and .loop-guard/morning.md before doing
anything. Branch feat/phase1-compliance-media, HEAD 83d2977, tree clean, nothing
pushed. Twelve local commits from two overnight runs.

Ground truth you should NOT re-derive:
- supabase/migrations/0033_vibe_profiles.sql is AUTHORED and NOT APPLIED. The
  schema_migrations ledger's last entry is 0032.
- @playwright/test was upgraded 1.60.0 -> 1.62.0 to fix a WebKit-on-Windows
  worker-teardown hang. npm run test:e2e:teardown-guard is the regression check.
- The full Playwright matrix now completes naturally: ~340 passed / 5 failed in
  ~4.5m. All 5 failures are pre-existing and documented in .loop-guard/morning.md.
- Enumerating the DB surface requires reading BOTH supabase/migrations/*.sql AND
  supabase/schema.sql (public.waitlist lives only in the latter), and reasoning
  about the FINAL schema after migrations apply in order, not per-file statement
  counts. Both mistakes were made and corrected; see docs/C3-RLS-AUDIT-2026-07-30.md.

Do not push, deploy, or apply a migration unless I explicitly say so.
```

---

## 1. Apply migration 0033 and prove G1 actually works — **ATTENDED ONLY**

This is the one item that needs live database access. It is a real schema change,
so treat it as T0 and do not run it unattended.

```
/mission Apply supabase/migrations/0033_vibe_profiles.sql to the Supabase project
and verify the G1 vibe-profile sync works end to end against the real database.

Context:
- 0033 is authored and reviewed but NEVER applied. schema_migrations ends at 0032.
- The client code shipped in commits be45c58 and b19c0e8 and is fully unit-tested
  (src/lib/vibeProfileSync.test.ts), but has never run against a real table.
- Until 0033 applies, vibe profiles are localStorage-only, and the Settings
  "Clear your saved vibe profile" button relies on deleteServerVibeProfile
  forgiving a MISSING TABLE (42P01/PGRST205) — that forgiveness becomes dead code
  once the table exists, and its tests should keep passing either way.

This is T0: record the revert SHA first, apply, then run the authoritative
post-apply smoke — sign in on two browsers, complete the quiz on one, confirm the
other hydrates it, confirm signing into a second account never shows the first
account's profile, and confirm Settings "Clear" removes the server row and does
not resurrect on reload.

Do not proceed unattended. Stop and report if the apply fails.
```

---

## 2. Implement the C2 + C3 security remediations

Both audits produced prioritised lists and deliberately implemented nothing.
This turns them into code.

```
/mission Implement the prioritised remediations from docs/C2-RATE-LIMIT-AUDIT-2026-07-30.md
and docs/C3-RLS-AUDIT-2026-07-30.md as an ordered queue, one goal per item.

From C2, in this order:
1. F1 + F3 (HIGH): src/app/api/account/delete/route.ts runs its rate limiter at
   line 50 but does not verify the Bearer token until line 67. Anonymous POSTs
   therefore burn the victim's 5/hour IP budget while returning 401, locking a
   real user out of deleting their own account — worse behind NAT, reachable
   cross-origin without preflight. Move the real quota AFTER verification and key
   it on the verified user.id; keep a coarse pre-auth IP bound.
2. F6: src/app/api/waitlist/route.ts and src/app/api/event/route.ts have NO test
   of any kind. Add route tests asserting the 429 path, event's same-origin
   check, and the ANALYTICS_ENABLED gate.
3. F7: src/app/api/health/route.ts caches its Supabase probe but assigns
   cachedProbe only AFTER the await, so concurrent requests each fetch. Make it
   single-flight (cache the in-flight promise).

From C3:
4. F5 (MEDIUM, real product bug): 0015 added profiles.shares_list_publicly, but
   0006:83 grants update only on (display_name, is_private). Users therefore
   CANNOT enable their own public-shared-list and get_public_ratings is
   permanently empty. Extend the grant or add a security-definer RPC that checks
   auth.uid().
5. F3: ratings, pairwise_comparisons, vibe_profiles and profiles skip the
   project's own revoke-first pattern stated at 0019:80. Add
   `revoke all ... from public, anon, authenticated` plus minimal explicit grants.
   Note vibe_profiles is in the unapplied 0033, so amend that file rather than
   adding a new migration.

Migrations may be authored but NOT applied. No pushes.
```

---

## 3. Audit the 28 browser-callable security-definer functions

`docs/C3-RLS-AUDIT-2026-07-30.md` calls this "the highest-value security item
remaining" and explicitly admits it only spot-read them.

```
/mission Audit every browser-callable security-definer function as authorization
code. docs/C3-RLS-AUDIT-2026-07-30.md F2 flags this as the highest-value security
work remaining and admits the audit only spot-read them.

Verified starting facts:
- 29 security-definer functions survive in the final schema; 28 are callable via
  PostgREST (handle_new_user is trigger-only). All 29 pin search_path = public.
- Because they run as definer, RLS does NOT constrain them. Each function body IS
  the entire access-control boundary for the rows it touches.
- They span migrations 0001, 0006-0013, 0015-0017, 0020-0021.

For EACH function ask, and answer with the function body as evidence:
- Does it derive identity from auth.uid(), or does it accept a user id as a
  PARAMETER? A parameter-driven identity is an authorization bypass — this is the
  single most important thing to look for.
- Does it return more columns or rows than its name and docs claim?
- Is it rate-capped where it enumerates or writes? (search_handles caps at
  500/day and follow attempts are capped; check the rest.)
- Can it be called with arguments that make it act on another user's rows?

Produce a per-function matrix with severity and a concrete exploit scenario for
each finding. Audit only — no migrations applied.
```

---

## 4. Fix the `/` route's async catalog reflow

The last 3 failing Playwright tests, and a real (if narrow) user-facing bug.

```
/mission Fix the async catalog reflow on `/` that makes mobile-controls.spec.ts
fail its pass-2 coverage check on all three viewports.

Verified diagnosis (do not redo it):
- `/` renders the full ~975-bar catalog through BarPicker.
- BarPicker groups by a FIXED NEIGHBORHOOD_ORDER and sorts alphabetically WITHIN
  each group, so when CatalogRefresh's post-hydration fetch calls replaceCatalog,
  new bars are inserted THROUGHOUT the list, not appended.
- Browsers do not adjust scroll position for content inserted above the viewport.
  So a user resting at the apparent bottom during that fetch window can have the
  row under their finger change identity, and only the NEW true-last row is
  protected by the pb-24 clearance added in commit 8a46aee.
- The spec's pass 2 scrolls to the bottom, waits a fixed 500ms, then judges
  coverage at rest — it lands ~399px short of the true end because the list is
  still growing, so a MID-LIST row sits under the fixed BottomNav.

This is an async-race-plus-reflow defect, NOT a CSS sizing problem — padding only
protects the last row. Fix the reflow (e.g. preserve scroll anchoring across the
catalog swap, or settle the catalog before first paint), not the spec's
thresholds. If you conclude the spec's bottom-scroll needs to settle before
asserting, say so explicitly and get my approval before editing e2e/.
```

---

## 5. Close the remaining test debt

```
/mission Close the test gaps recorded during the 2026-07-30 runs, as one ordered
queue.

1. scripts/prune-orphan-photos.mjs DELETES FILES and its actual delete call has
   ZERO coverage — only the classification logic (partitionPhotoFiles) is tested.
   Extract the delete step so it can be tested, then prove against a real temp
   directory that it removes exactly the orphans and leaves reachable files,
   non-images, and directories untouched. (Raised by GLM during the G6 review.)
2. isReachable's maxIndex carousel boundary is untested — nothing pins that a
   `<known-id>-<n>` above the cap is rejected. (Raised by DeepSeek, same review.)
3. e2e/bias-smoke.spec.ts fails under full-suite parallel load but passes alone
   at --workers=1 in 14s. Its own header calls this "CONTENTION, not a defect".
   Now that the teardown hang is fixed, decide whether to make it robust under
   load or mark it explicitly serial — do NOT weaken its assertions.

Run focused tests through bounded-run.mjs. npm run test:e2e:teardown-guard must
still pass.
```

---

## 6. Reconcile the documentation

Cheap, and several docs now contradict shipped code.

```
/mission Reconcile the stale documentation against what shipped on 2026-07-30.

1. docs/MASTER-TODO-2026-07-30.md and docs/UX-BACKLOG-2026-07-30.md still list S1
   ("Hood Hopper" rename) as open — it shipped in f7550db as "Borough Crawler".
   Mark done rather than deleting the history.
2. docs/MASTER-TODO-2026-07-30.md:146 claims only account/delete and waitlist have
   rate limiters. Wrong — api/event has a 60/minute limiter. Corrected in
   docs/C2-RATE-LIMIT-AUDIT-2026-07-30.md.
3. docs/MASTER-TODO-2026-07-30.md:147 says "24 policies". The final schema has 25
   across 12 tables. Corrected in docs/C3-RLS-AUDIT-2026-07-30.md.
4. docs/OVERNIGHT-BRIEF-2026-07-30.md:48 and MASTER-TODO:35 say the Playwright
   hang "only reproduces in the multi-project run". REFUTED — it reproduced on
   single-project runs and is fixed in e812cf3.
5. docs/APP-STORE-PLAN.md predates docs/APP-PRIVACY-LABELS-2026-07-30.md; point
   it at that document rather than restating the inventory in two places.

Docs only. No code changes.
```

---

## Open questions that block nothing but need your answer

**Moved.** The seven questions now live in one place:
**`docs/STATE-2026-07-30-EVENING.md` §"The seven operator questions"**, which carries
the full wording (env-var names and A7/C2 section refs included) plus the App Privacy
blocker marking.

The table that used to be duplicated here has been removed rather than left behind as
an editable second copy — a fillable duplicate under a "don't edit me" note is still a
fillable duplicate, and that is how two documents drift apart. Record answers there.

## Deliberately excluded (your earlier calls, unchanged)

- **R7** — removing the Rankings row would strand the Want-to-go view before the
  Lists replacement lands.
- **N5** — close-friends audience control is a future feature; there is nothing
  implemented to test.
