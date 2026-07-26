# Night Loop 3 â€” 2026-07-25/26 (E0 foundations, operator authorized)

Prod at loop start: sha `737a1350e93e`, 406 open bars w/ photo carousels,
suggest/vote/RSVP live, deletion live, legal copy final. Executes the E0
slice of goal **g-db540bdb (v0.6 epics)**. Operator stops the loop by
adding a line `[STOP]` at the top of this file â€” every tick re-reads it.

## Standing rules (every tick â€” night-2 rules carry over)

- **PR protocol always**: branch â†’ PR â†’ `gates` CI â†’ squash â†’ post-merge
  `/api/health` sha smoke (AUTHORITATIVE). One item per PR. Watchers need
  the `gh pr update-branch` nudge loop (up-to-date requirement).
- **Auto-merge allowed** for: pure-lib + tests, docs, and display-label
  changes the operator has LOCKED (glyph price ladder, tagDisplay
  migration). **NOT auto-merged**: any NEW user-facing surface â€” that's
  attended weekend work (E2/E3 UI, axis picker UI, home phases).
- **NEVER overnight**: `npm run db:migrate` (author-only if a migration
  were ever needed â€” E0 needs NONE); `refresh-places.mjs` in any mode
  (Google quota); `rpc-smoke.mts` (writes prod DB; attended only).
- Dev-server hygiene: kill `:3000` + `rm -rf .next` when state is
  suspect; never leave a server running after a tick.
- plpgsql/apostrophe/BAR_FILES gotchas: see night-2 log + memory.
- A tick failing twice on one blocker: mark â¸, move on. Log every tick.
- ScheduleWakeup dies with the session â€” re-arm EVERY tick; if the
  session dies, the next session resumes from this file.

## Queue (priority order)

- **M1 â€” Epic docs (T2, auto-merge).** Write `docs/EPICS-v0.6.md`
  (4 epics + E0 + E5 from goal g-db540bdb: every story user-voice, every
  sub-feature with ID/dependency/test obligation) and
  `docs/DESIGN-SYSTEM.md` (drunk-UX rules as CHECKABLE assertions: one
  decision/screen, exactly one primary CTA, â‰¥56px targets, verb-first
  labels, no dead ends, photo-first social register). Goal acceptance
  criteria 1+2.
- **M2 â€” E0.1 tagDisplay (TDD, auto-merge â€” locked decision 2).**
  `src/lib/tagDisplay.ts`: all 33 VibeTags â†’ human display strings;
  price ladder cheap/mid/pricey/splurge â†’ $/$$/$$$/$$$$. Migrate EVERY
  raw-enum render site (VibeTweak chips first). Enforcement test that
  greps components for raw tag rendering (acceptance 3). The string
  "pricey" appears NOWHERE in rendered UI (acceptance 4). Update
  affected e2e on both devices.
- **M3 â€” E0.2 vibe axes LIB (TDD, auto-merge).** `src/lib/vibeAxes.ts`:
  the 33 tags grouped into 6 named axes â€” Drink Â· Energy Â· Setting Â·
  Scene Â· Sound Â· Spend â€” total coverage (every tag in exactly one
  axis), unit-tested, with an exhaustiveness guard. LIB ONLY â€” the
  progressive-disclosure picker UI is E2.2, attended.
- **M4 â€” E0.3 nightPhase (TDD, auto-merge).** `src/lib/nightPhase.ts`:
  derive `planning | starting | out | recap` from cadence + intent +
  local time + the 5am rollover; manual override always wins; fail-safe
  default `starting` (acceptance 5). Pure + unit-tested incl. rollover
  and override paths. NO home-UI change overnight (that's E2.4/E3.4).
- **M5 â€” Full e2e pass.** Both devices after M2's render-site
  migration; expect ONLY the known iPhone-13 picker-typing pair red.
  Fix regressions, â¸ anything environmental with evidence.
- **M6 â€” Morning summary.** Append MORNING SUMMARY here: shas, PRs,
  â¸ items, the attended queue (E2 flow collapse is next; axis picker
  UI; home phases; E5.2 Capacitor after E2/E3).

## Morning operator queue (pre-seeded)

1. Phone-check: price glyphs ($$$ not "pricey") everywhere tags render.
2. Attended weekend work: E2 flow collapse (deletion-first), axis picker
   UI on the results surface, home night-phases.
3. Errands: Apple enrollment, domain purchase â†’ DNS+forwarding sitting,
   Brevo rotation.

## Tick log

- (loop start 2026-07-25 ~19:30 ET, attended session left open)
- Tick 1 (M1): EPICS-v0.6.md (E0-E5, IDs/deps/test obligations) + DESIGN-SYSTEM.md (R1-R12 checkable drunk-UX assertions) authored -> PR.
- Tick 2 (M2): tagDisplay.ts + enforcement test (RED on 4 sites -> migrated -> GREEN); pricey renders as $$ everywhere; e2e both devices. 586 vitest.
- Tick 3 (M3): vibeAxes.ts - 6-axis total partition of the 33 tags w/ exhaustiveness guard + axisOf. 590 vitest.



