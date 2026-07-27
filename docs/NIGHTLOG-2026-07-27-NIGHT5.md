# Night Loop 5 — 2026-07-27 (post-fleet consolidation; operator asleep)

Operator stops the loop by adding `[STOP]` at the top of this file — every
tick re-reads it. PRECONDITION: the `feat/qa-round-integration` pipeline
(Codex adversarial review → fixes → PR → merge → /api/health sha smoke)
must COMPLETE before N1 starts — everything below builds on merged main.

## Standing rules (nights 2–4 rules carry over verbatim)

- PR protocol: branch → PR → gates CI → post-merge sha smoke authoritative.
- **USER-FACING SURFACES: PRs left OPEN overnight** — operator merges in
  the morning. Auto-merge only for pure-lib/tests/docs.
- WORKTREE-ONLY building (wt-night4 or a fresh worktree + junction);
  port-isolated playwright override (3013 or fresh); NEVER touch :3000.
- **NEVER overnight: db:migrate / apply-one-migration, refresh-places,
  rpc-smoke, nights-smoke** — UX-E's migration may be AUTHORED tonight,
  never applied.
- Fresh reviewer per substantive diff; fix HIGH/MED forward. Two failures
  on one blocker → ⏸ + note, move on. Re-arm ScheduleWakeup every tick.

## Queue (priority order)

- **N1 — QA-6: the ONE Next Bar results view (operator final spec, PR
  OPEN).** Vibe tweak (keep) · distance chips (keep) · NEW optional
  neighborhood picker on results · **5 suggestions everywhere** (manual
  results 3→5) · NEW refresh/"run it again" affordance. Entry steps
  (locate/ask/pick) stay; results is the single destination. E2e both
  devices.
- **N2 — UX-E vibe vote: AUTHOR ONLY.** Design doc + migration
  0017_vibe_votes.sql AUTHORED (0016 house style: p_ params, ON
  CONSTRAINT, revoke-first, definer + materialized fence, night-keyed one
  vote/user/night) + routed DeepSeek adversarial review of the SQL +
  client lib + UI behind the unapplied-migration dark pattern (feature
  no-ops until applied — 0008 precedent). **DO NOT APPLY.** Morning:
  attended apply-one-migration ×2 + behavioral cycle.
- **N3 — prod read-only smoke suite.** New e2e/prod-smoke.spec.ts + tiny
  playwright.prod.config.ts (baseURL = the live URL, NO webServer,
  read-only assertions only: /, /map, /join, /privacy, /friends render;
  OG endpoints 200 png; NO writes, NO auth). Auto-merge OK (tests/config
  only). Document the one-command run for post-deploy use.
- **N4 — analytics layer DESIGN + skeleton.** Privacy-light event counts
  (searches, shares, saves, visits) — decide Vercel Analytics vs
  self-rolled /api/event + table (table = migration → AUTHOR only).
  Skeleton behind a flag; doc for morning review.
- **N5 — full e2e sweep + spec debt** (both devices; known iPhone
  environmental set exempt; warm new routes first).
- **N6 — MORNING SUMMARY appended here**: shas, OPEN PRs list, ⏸ items,
  the apply-0017 + analytics decisions for the operator.

## Morning operator queue (pre-seeded)

1. Merge open PRs one at a time; phone-test on prod.
2. Attended: apply 0017 (if authored) + nights-smoke-style cycle; decide
   analytics approach.
3. Errands: Apple Developer enrollment, next-bar.app purchase + DNS,
   Brevo rotation, follow @sam_tests back.

## Tick log

- (queued 2026-07-27; loop starts when the integration pipeline completes
  and the session arms ScheduleWakeup)
- ~22:30 session 7cb32e1b bound g-e88444ae in wt-night4 (pipeline was
  already complete: PR #67 merged + smoked, g-42e1b52d closed).
- ~22:30-23:10 N1 QA-6 → PR #68. Review 3 HIGH + 2 MED fixed forward
  (relax-to-cap matcher fill — found via e2e; auto surface enters
  Anywhere; hood pick widens radius; empty-rank wrap backstop;
  fixed-clock e2e). Gates: 900 vitest, e2e 19/19 ×2 devices.
- ~23:10-00:05 N2 UX-E → PR #69 (0017 AUTHORED, NOT applied; DeepSeek
  4-applied/1-refuted; Opus 2 HIGH fixed: sign-out darkens poll,
  per-partition boost). N3 → PR #70 auto-merged + sha-smoked
  (b8cc21016ea2). N4 → PR #71 (0018 AUTHORED; security review H1 →
  COUNTER MODEL rewrite, Origin check, transport catch). N7 agent pass
  → PR #73 (3 dead exports). N8 SCALE-PLAN.md → PR #72.
- ~00:05-00:40 N5 sweep on feat/ux-e-vibe-vote-authored (main+vibe):
  Pixel 146/147 with the 1 fail (rating-and-nav 5-tabs) warm-green in
  isolation — documented cold-compile family. iPhone ran in FOREGROUND
  HALVES (env kills long background tasks): half-1 86/86; half-2 below.
- GOTCHAS re-confirmed: (1) stale :3013 dev server across five branch
  switches served old modules → mass consensus-page failures; kill PID +
  rm -rf .next fixed (same class as the :3000 zombie rule). (2) parallel
  auto-merge PRs strand each other BEHIND — `gh pr update-branch` nudge
  required (#72/#73). (3) untracked playwright.night4.config.ts got
  deleted by a cleanup agent — regenerate from playwright.config.ts with
  :3013 + `npx next dev -p 3013`.

## MORNING SUMMARY (written ~00:45 ET)

**Queue result: N1-N8 ALL COMPLETE. 3 feature PRs OPEN for your
merge-and-phone-test; 3 auto-merged (docs/tests/chore).**

Merge these one at a time (post-merge /api/health sha smoke each; nudge
`gh pr update-branch` after each — protect-main strands parallel PRs):

1. **PR #68 — QA-6 the ONE results view.** 5 bars on BOTH home paths
   (matcher now fills the requested page), optional neighborhood chips
   (picking one widens radius to Anywhere — "In Harlem" means the whole
   hood), "↻ Run it again" deals the next batch and wraps, auto surface
   enters on Anywhere (first load is never blanked by a walking cap).
   Phone-test: home → 5 bars; hood chip; run-again; pick-a-bar → 5.
2. **PR #69 — UX-E vibe vote. ⚠ APPLY 0017 FIRST** (checklist in
   docs/UXE-VIBE-VOTE-DESIGN.md: apply-one-migration ×2 → rpc-smoke-style
   cast/move/rescind cycle → merge → smoke). Poll on Plan Night Out;
   winner seeds Group Favorites per-partition; feature is DARK until the
   migration applies, so merging before applying is safe but pointless.
3. **PR #71 — analytics skeleton (DARK).** Decision doc
   docs/ANALYTICS-DESIGN.md. To light up: apply 0018 (counter model —
   bounded 4 rows/night, no retention job needed) + set ANALYTICS_ENABLED=1
   and NEXT_PUBLIC_ANALYTICS=1 in Vercel + add the /privacy one-liner.
   Call sites wired in a follow-up PR after you approve the design.

**Auto-merged:** #70 prod smoke suite (run `npx playwright test --config
playwright.prod.config.ts` after any deploy — validated 9/9 vs live) ·
#72 docs/SCALE-PLAN.md · #73 quality pass (3 dead exports).

**READ SCALE-PLAN.md §7 Tier-1 before App Store submission** — headline:
Vercel Pro + Supabase Pro ($45/mo) are DAY-0 launch prerequisites
(commercial ToS + backups, not capacity); then 3 index fixes + an EXPLAIN
session, SWR cache over circle RPCs, bounded get_friend_ratings, photo
thumbnails. The doc corroborated the analytics H1 independently.

**Gates at close:** per-PR tsc 0 / vitest green (#68: 900, #69: 899,
#71: 911 in combined tree) / build clean / gates CI on all. Full sweep
(main+vibe branch): **Pixel 146/147** (the 1 = rating-and-nav 5-tabs,
warm-green in isolation — documented cold-compile family); **iPhone
145/147** (half-1 86/86 + half-2 59/61, BOTH fails = the standing
suggestions picker pair on WebKit — the documented environmental set,
nothing new).

**⏸ / notes:** 0015 (CEO stream) still unapplied, untouched. Worktrees
nb-qa1..5* from the fleet round are now mergeable-cleanup candidates
(attended). @sam_tests follow-back still pending. Operator errands
unchanged: Apple enrollment, next-bar.app + DNS + hi@, Brevo rotation.
