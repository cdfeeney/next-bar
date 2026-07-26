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
