# Night Loop 2 — 2026-07-25 (queued 00:30, operator asleep)

Prod at loop start: sha `f86b45e9f08a` (PR #14 RSVP), 374 open bars, 18
hoods, suggestions+RSVP live. Operator can stop the loop by adding a line
`[STOP]` at the top of this file — every tick re-reads it first.

## Standing rules (every tick)

- **PR protocol always**: branch → PR → `gates` CI → squash → post-merge
  `/api/health` sha-match smoke (the AUTHORITATIVE check). One item per PR.
- **Auto-merge allowed** for: tests/infra, docs, adversarially-verified
  catalog data, review-fix follow-ups. **NOT auto-merged** (PR left open
  for the operator's morning phone-test): new user-facing feature surfaces
  (N7). Author-only for migrations — **never run `db:migrate` overnight**
  (0008 precedent: author at night, operator applies in the morning).
- **Never spend Google quota**: no `refresh-places.mjs` in any mode. Set
  `LOOP_UNATTENDED=1` when running any script wired to loop-guard.
- **Dev-server hygiene**: kill any `:3000` listener + `rm -rf .next`
  before e2e if state is suspect; never leave a dev server running after
  a tick (the build-stomps-dev `.next` hazard).
- Substantial changes get a fresh-reviewer pass before merge; fix
  HIGH/MED. Routed consultants only if genuinely material (DeepSeek was
  down earlier tonight — treat empty/timeout as DOWN, never as approval).
- A tick that fails twice on the same blocker: mark ⏸ with a note, move
  on. Never force-push, never bypass gates, never touch main directly.
- Log every tick below (## Tick log) with commit/PR/sha + one-line result.

## Queue (priority order)

- **N1 — iPhone-13 WebKit e2e drift (root-cause the family).** Failing
  iPhone-only: bias-smoke (both device consistency says logic, not flake),
  map-interaction pan, rating-and-nav nav-tabs flake, suggestions picker-
  typing ×2. Diagnose properly (traces/error-context), fix what's real
  (app bug vs test harness vs WebKit quirk), document what's genuinely
  environmental. Auto-merge (test/infra).
- **N2 — PR #14 review LOWs.** (a) e2e gaps: rsvp-decline path notice,
  get_circle_rsvps null degradation, DELETE-stub night-scoping, li-locator
  hardening, going-list "+N others" past 3 names (replace truncate-clipped
  grammar). Auto-merge. (b) Author migration 0013 `unrsvp_bar` RPC
  (advisory-lock serialized "I'm out" closing the cross-tab race) + lib
  swap — **author-only branch, PR open unmerged**, morning note to apply
  0013 then merge.
- **N3 — Hell's Kitchen re-neighborhooding.** Midtown-tagged bars
  physically in HK (W34-59, west of 8th Ave): compute candidates from
  coords, adversarial-verify each (address-based, web where available),
  move confirmed ones `Midtown` → `Hell's Kitchen` in catalog files.
  bars.test + quiz coverage guards. Auto-merge (verified data).
- **N4 — 27 contested closures re-verification.** Web-verify each bar in
  docs/CATALOG-CLEANUP-2026-07-25.md's contested list (agents, zero
  Google cost): OPEN / CLOSED / UNCLEAR with evidence + date. Output doc
  shrinks the operator queue to genuine judgment calls. Docs PR,
  auto-merge. NO catalog edits.
- **N5 — 88-row tag-queue triage.** Rank docs/REVIEW-MINING-2026-07-24.md
  operator-queue rows by evidence strength; emit top-20 recommend-apply /
  bottom-N recommend-discard shortlist doc. Docs PR, auto-merge. NO
  catalog edits.
- **N6 — bench prep (33 bars).** Merge expansion-4 (24) + expansion-5 (9)
  benches, re-verify open-status web-side, dedupe vs current catalog,
  emit a ready-to-enrich staging list (ids + entries) in a doc. NO
  enrichment, NO catalog merge — morning: attended `--only` run lands it.
- **N7 — Night mode (goal g-981cbdde).** "Start your night" flow: home
  entry → neighborhood-or-near-me anchor → results; mid-night "next bar"
  re-search keeping or switching the anchor. Matcher already supports
  both anchors — this is flow/UI. Feature branch, fresh-review pass,
  **PR OPEN, NOT merged** — operator phone-tests in the morning.
- **N8 — Morning summary.** Append MORNING SUMMARY here: shipped shas,
  open PRs awaiting the operator, ⏸ items, the attended to-do list
  (apply 0013, bench enrichment run, N7 phone test).

## Morning operator queue (pre-seeded)

1. Phone-test N7's preview URL; merge if good.
2. Apply migration 0013 (`npm run db:migrate`, attended) → merge N2b PR.
3. Attended bench enrichment (`refresh-places --only` on N6's list) → PR.
4. Standing items: next-bar.app domain, Brevo password rotation,
   deletion go-live.

## Tick log

- (loop start 2026-07-25 ~00:30 — no ticks yet)
