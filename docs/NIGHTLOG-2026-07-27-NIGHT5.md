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
