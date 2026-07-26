# Night Loop 4 — 2026-07-26 (finish E2 + E3 surfaces; operator asleep)

Prod at queue-write: sha `3913efb4974e`. E0 foundations + E2.1/E2.2 LIVE
(one-tap results, axis vibe surface, night-cached vibe). Executes the
remaining E2/E3 slice of goal g-db540bdb. Operator stops the loop by
adding `[STOP]` at the top of this file — every tick re-reads it.

## Standing rules (every tick — nights 2+3 rules carry over)

- **PR protocol always**: branch → PR → `gates` CI → squash-or-open →
  post-merge `/api/health` sha smoke (AUTHORITATIVE); `gh pr
  update-branch` nudge loops on watchers. One item per PR.
- **USER-FACING SURFACES: PR left OPEN, never auto-merged overnight.**
  The operator merges in the morning (attended-prod preference: merge
  then phone-test on prod — no preview-URL typing). Auto-merge stays
  allowed for pure-lib/tests/docs and review-fix follow-ups only.
- **WORKTREE-ONLY building**: another session may hold the main
  checkout. `git worktree add` + node_modules JUNCTION
  (`New-Item -ItemType Junction`). Anchor reviews to git refs. The
  worktree at scratchpad `wt-e21fix` is reusable (junction in place).
- **NEVER overnight**: db:migrate (E2/E3 need NO migrations),
  refresh-places (quota), rpc-smoke (prod writes).
- Port 3000: if occupied by the other session, do NOT kill it — e2e in
  the worktree only when the port is free, else defer e2e to a later
  tick and note it.
- Fresh-reviewer pass on every substantial diff; fix HIGH/MED forward.
- Two failures on one blocker → ⏸ + note, move on. Tick-log everything.
- ScheduleWakeup dies with the session — re-arm every tick.

## Queue (priority order)

- **P1 — E2.3 photo-first result card (PR OPEN for operator).** ResultCard
  leads with full-bleed photo (barImageUrls; glyph-tile fallback stays for
  photo-less bars), name/neighborhood/price overlay or directly beneath,
  R7 social register, R4 ≥56px touch targets on the card CTA. Both-device
  e2e incl. photo-fallback negative. DESIGN-SYSTEM pass/fail table (R1-R12)
  in the PR body for the touched screen.
- **P2 — E2.4+E3.4 phase-adaptive HOME (PR OPEN).** Header phase chip on /
  (nightPhase lib): shows derived phase, ONE tap cycles/switches (R10 e2e:
  every phase reachable ≤2 taps). Phase changes the home content per
  EPICS: `planning` → tonight's plan/suggestions surface entry, `starting`
  → current locate-first flow (unchanged default), `out` → one-tap "next
  bar from here" (re-search entry with night-vibe pre-fill), `recap` →
  placeholder card pointing at rankings (full recap is E4). wasOutLastNight
  derives from the previous night's intent for now. Keep the 5-tab nav
  untouched (locked decision 1). Manual override persists nightKey-scoped
  (R11) — reuse the vibeNightCache pattern, separate key.
- **P3 — E3.2 distance chips + E3.3 open-now hard filter (PR OPEN).**
  Replace RadiusSlider on manual results with two chips: "Walkable" /
  "Worth a cab" (constants: walking 1.5mi / cab ~4mi; keep an "Anywhere"
  escape per R5). Open-now becomes a HARD filter on manual results
  (openNow.ts; bars with hours data only — no-hours bars stay, never
  false-negative a bar out of existence). e2e: closed-bar negative
  assertion with a fixed clock.
- **P4 — full e2e sweep + spec debt (auto-merge).** Both devices when
  port 3000 free; expected environmental set: suggestions picker pair,
  rating-and-nav timeout shapes under load, /map cold-compile race.
- **P5 — MORNING SUMMARY appended here**: shas, the OPEN PRs list for
  the operator's merge-and-phone-test morning, ⏸ items, next attended
  targets (E4 Night object + recap; E1.4 persistent votes; E5.2 after
  E2/E3 merge).

## Morning operator queue (pre-seeded)

1. Merge the open P1/P2/P3 PRs one at a time; phone-test each on prod
   (smoke runs post-merge automatically per protocol).
2. Errands: Apple enrollment, next-bar.app purchase → DNS + hi@
   forwarding sitting, Brevo rotation.
3. Say "start E4" when ready — the Night object + auto-recap is the
   K-factor surface and the next big build.

## Tick log

- (queued 2026-07-26 ~00:15 ET; loop starts when the continuation
  session binds goal + arms ScheduleWakeup)
- ~00:40 continuation session bound goal g-818a108c (lease held), built in
  isolated worktree wt-night4 (junction node_modules). Also fixed
  ~/.claude/bin/harness-state.mjs (backtick-in-template syntax error had
  bricked the goal CLI).
- ~00:58 P1 done → PR #48 OPEN. ~01:20 P2 done → PR #49 OPEN. ~02:00 P3
  done → PR #50 OPEN. Each: fresh Opus review, HIGH/MEDs fixed forward,
  gates green.
- ~02:10-02:50 P4 sweep saga: two background runs killed by the
  environment; then a run silently REUSED the other session's :3000 dev
  server (next-bar-share worktree, started 01:58) → bogus mass failures.
  Per the port rule it was left alone; sweep re-ran on an UNTRACKED
  port-3013 playwright config (playwright.night4.config.ts, do not
  commit). Also: worktree needed .env.local copied in (gitignored) — 14
  auth-surface specs fail without Supabase env (useAuth 'unavailable').

## MORNING SUMMARY (written ~03:00 ET)

**Queue result: P1-P5 complete. 3 feature PRs OPEN for your
merge-and-phone-test — no auto-merges overnight, per protocol.**

Merge these one at a time (post-merge /api/health sha smoke each; a
`gh pr update-branch` nudge may be needed after each merge since
protect-main requires up-to-date branches):

1. **PR #48 — E2.3 photo-first result card.** Full-bleed 16/10 hero,
   name/hood/price on gradient overlay, photo-count chip, tap → lightbox;
   glyph-tile fallback for photo-less bars and live 404s (multi-photo
   advance before giving up). Rank-1 hero eager (LCP). CTAs ≥56px.
2. **PR #49 — E2.4+E3.4 phase-adaptive home.** Header phase chip
   (planning/starting/out/recap), any phase in ≤2 taps, night-scoped
   override (rollover forgets); planning/recap lead cards ABOVE the flow
   (misdetection never strands); starting/out = the flow. DST bug in
   wasOutLastNight found by reviewer + fixed with regression test.
3. **PR #50 — E3.2+E3.3 distance chips + open-now hard filter.**
   Walkable (1.5mi) / Worth a cab (4mi) / Anywhere; RadiusSlider deleted.
   KNOWN-closed bars hard-filtered from live surfaces (no-hours bars
   protected; quiz untouched). WALK_BOUNDARY_MI now derives from
   RADIUS_WALK (review HIGH: lead copy contradicted the Walkable chip).
   **Phone-test note: daytime testing will show fewer/zero home-flow
   results — that's the feature.**

**Gates at close:** per-PR tsc 0 / vitest green (#48: 595, #49: 608,
#50: 599) / build clean / gates CI SUCCESS on all three. Full sweep
(port-3013): **Pixel 7 117/117; iPhone 13 112/117** — all 5 in the
documented environmental set (suggestions picker pair ⏸; bias-smoke +
account-delete pass warm in isolation; rating-and-nav deep-link =
documented navigation-interrupted cold-compile race).

**⏸ / notes:**
- Concurrent session (CEO orchestrator, goal g-00210951) is ACTIVE in
  projects/next-bar-share and holds :3000 — untouched per rule. Its
  feat/share-loop-week1 branch is its own business.
- wt-night4's playwright.night4.config.ts + .env.local are untracked
  local artifacts; delete with the worktree when done.
- E2 + E3 are now COMPLETE in g-db540bdb once #48-#50 merge.

**Next attended targets:** E4 Night object + auto-recap (say "start E4"
— the K-factor surface), E1.4 persistent votes, E5.2 App Store wrap
after E2/E3 merge. Operator errands unchanged: Apple enrollment,
next-bar.app DNS + hi@ forwarding, Brevo rotation.
