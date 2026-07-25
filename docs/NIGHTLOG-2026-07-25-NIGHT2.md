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
- **N6b — Rankings show the number (operator request 2026-07-25 ~01:00).**
  /rankings displays each ranked bar's numeric score (own scores only —
  the tier-only friend boundary is untouched). Beli-style: the number is
  the point of the comparison chain; surface it. Small UI + tests.
  Auto-merge (operator explicitly requested the change).
- **N7 — Night mode: SUPERSEDED (reconciled 2026-07-25 PM, attended).**
  The loop died mid-N1; no N7 work was started. N7's full scope ("start
  your night" flow, mid-night next-bar re-search, anchors) is already
  covered by goal **g-db540bdb (v0.6 epics)** as E2 + E3 + E0.2, written
  at ~01:41 the same night. The operator's vibe-cached-for-the-night
  refinement (per-search vibe pick, cached under the night-key infra so
  same-night re-searches skip re-asking) was the only N7-unique piece —
  now folded into g-db540bdb's Locked Decision 3. Goal g-981cbdde marked
  abandoned-as-superseded. Build once, under the epic.
- **N8 — Morning summary.** Append MORNING SUMMARY here: shipped shas,
  open PRs awaiting the operator, ⏸ items, the attended to-do list
  (apply 0013, bench enrichment run, N7 phone test).

## Morning operator queue (pre-seeded)

1. ~~Phone-test N7's preview URL~~ — N7 never started; superseded by
   g-db540bdb v0.6 epics (see N7 entry). Night-mode phone tests come with
   E2/E3 PRs instead.
2. Apply migration 0013 (`npm run db:migrate`, attended) → merge N2b PR.
   (As of 2026-07-25 PM: 0013 not yet authored — loop died mid-N1.)
3. Attended bench enrichment (`refresh-places --only` on N6's list) → PR.
4. Standing items: next-bar.app domain, Brevo password rotation,
   deletion go-live.

## Tick log

- (loop start 2026-07-25 ~00:30 — no ticks yet)
- 2026-07-25 ~02:00: session died mid-N1 (e2e fixes in working tree,
  uncommitted). No N2–N8 work happened; no PRs were opened overnight.
- 2026-07-25 PM (attended): zombie `:3000` dev server from 22:06 killed +
  `.next` cleared; N7/g-981cbdde reconciled into g-db540bdb (see N7
  entry); N1 baseline re-run + commit/PR from this session.

## SESSION SUMMARY (2026-07-25 afternoon, attended — queue complete)

11 PRs merged (#16–#26), every one through gates CI + post-merge
`/api/health` sha smoke. Final prod sha at close: `b6ca2a6` (N6 doc).

**The headline: suggestions + RSVPs NEVER WORKED in prod.** The
operator's first real phone-test surfaced 42702 ("column reference
night is ambiguous") — plpgsql parses an `ON CONFLICT (col list)` as
expressions over the table, `night` was both column and parameter, and
plpgsql's lazy compile meant CREATE FUNCTION succeeded while every real
call failed. Both tables were empty since ship; the stubbed e2e suite
and existence-only migration "verify" were blind to it. Fixed via
`ON CONFLICT ON CONSTRAINT` (0011/0012 edited in place — ledger-less
runner), verified with NEW `scripts/rpc-smoke.mts` (throwaway confirmed
user, full behavioral cycle, self-cleanup). **Standing rule: any
migration touching an RPC gets an attended rpc-smoke run.**

Queue results:
- **N1** (#16): bias-smoke race + HK assertion + WebKit pan-motion skip.
  Baseline ≤3 iPhone-only fails held.
- **N2a** (#20): PR#14 LOWs — decline/outage e2e, night-scope stub
  guards, going-list "+N others" (`goingList.ts`).
- **N2b** (#18+#19): 0013 `unrsvp_bar` RPC + 0014 grant revoke, BOTH
  applied + verified — the RSVP race is closed at the DB layer.
- **N3** (#21): 6 bars → Hell's Kitchen (web-verified); Beer Authority
  HELD (usage unanimously non-HK) — operator judgment call.
- **N4** (#24): 26/27 contested closures CONFIRMED CLOSED, 1 unclear
  (chelsea-music-hall). Google businessStatus right every time; lesson:
  model-knowledge "still open" contests carry near-zero weight. Removal
  PR recommended, awaiting operator word.
- **N5** (#23): 88-row tag queue → top-20 apply / 27 discard / 41 mid.
- **N6** (#26): 33-bar staged bench, all web-verified open, conflicts
  flagged (madelines@113 Franklin vs Sereneco). Attended enrichment next.
- **N6b** (#25): every ranked bar shows its number (tentative ~midpoint
  when uncompared). LIVE.
- **N7**: superseded into g-db540bdb v0.6 epics (vibe-night-cache in
  Locked Decision 3; E1.4 refined = suggestions join the vote,
  poll-style names+counts per operator phone feedback).

Also: SUPABASE_SERVICE_ROLE_KEY in `.env.local` found INVALID (401) —
operator re-copy needed (deletion-route dependency). Operator is buying
next-bar.app. Successor leads for future passes: Sonny's Corner (staged),
Saint Vitus Bushwick (watch, fall 2026); Frank Mac's lead was stale (dead
since 2021).

**Operator queue (open):** (1) word on the 26-bar removal PR; (2) word on
the top-20 tag apply; (3) attended bench enrichment run; (4) phone-test
suggest/RSVP + rankings numbers; (5) service-role key; (6) domain DNS
when purchased; (7) Brevo password rotation; (8) deletion go-live.
