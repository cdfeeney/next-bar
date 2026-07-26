# EPICS v0.6 — the four phases of a night out

Source of truth: goal g-db540bdb (2026-07-25) + operator refinements.
Core UX thesis: **the user is drunk.** One decision per screen, one
primary action, verb-first copy, no dead ends. Register: Instagram /
TikTok / Partiful / X. Companion rules: `DESIGN-SYSTEM.md`.

Locked decisions: (1) night phase is an adaptive HOME, not a nav
replacement — the 5-tab nav stays, a header chip shows/switches the
phase; (2) price display = glyph ladder only ($–$$$$), the word
"pricey" disappears from UI while the 33-tag data vocabulary stays
untouched; (3) vibe belongs to the search and the pick is cached for
the night (nightKey, pre-fills never locks).

## E0 — Foundations (cross-cutting; unblocks all four)

| ID | Sub-feature | Depends on | Test obligation |
|---|---|---|---|
| E0.1 | `src/lib/tagDisplay.ts` — the ONLY place a VibeTag becomes user-visible text; price ladder → $/$$/$$$/$$$$ | — | Unit tests per tag; enforcement test greps components for raw tag rendering; e2e asserts "pricey" renders nowhere |
| E0.2 | `src/lib/vibeAxes.ts` — 33 tags → 6 axes: Drink · Energy · Setting · Scene · Sound · Spend | E0.1 | Unit: every tag in exactly one axis (exhaustiveness guard) |
| E0.3 | `src/lib/nightPhase.ts` — derive `planning\|starting\|out\|recap` from cadence + intent + local time + 5am rollover; manual override always wins; fail-safe `starting` | — | Unit: rollover boundaries, override precedence, fail-safe on garbage input |
| E0.4 | `DESIGN-SYSTEM.md` drunk-UX rule set | — | Rules written as checkable assertions (see file) |

## E1 — Plan a night out with friends (ahead of time) — register: Partiful

Stories (user voice): *"I make a night — date and who's coming."* ·
*"I send one link; my friends see it without an account."* · *"Friends
tap I'm in."* · *"We pitch bars and vote."* · *"We land on one plan."* ·
*"On the night, the plan is just there."*

| ID | Sub-feature | Depends on | Test obligation |
|---|---|---|---|
| E1.1 | Night object create (date + invitees) | E4.1 shape | Unit on the object; e2e create flow |
| E1.2 | Invite link + OG unfurl, no account to view | E1.1 | e2e anonymous view; OG snapshot |
| E1.3 | RSVP "I'm in" | SHIPPED (#14/#18/#19) | rpc-smoke attended; e2e stateful stubs |
| E1.4 | nominate → vote → lock. **Refined 2026-07-25:** suggestions ARE votable (shipped #28) — remaining: PERSISTENT server-side votes friends cast asynchronously, poll register (count + voter names per option, iPhone-Messages style — chips shipped #28), and a LOCK step that turns the winner into the plan | E1.1 | Migration author-only; adversarial review (definer RPCs); e2e vote persistence |
| E1.5 | Plan card as the `planning` home phase | E0.3, E1.1 | e2e phase render + chip override |

## E2 — Start the night (find the first bar)

Stories: *"I open the app and get one answer on one screen."* · *"I can
shift the vibe in two taps."* · *"Go."*

**Deletions, not restyles:** `confirmGps` — DELETE (silent resolve;
failure falls back to `pickBar` unnarrated; closes audit HIGH-10).
`pickRadius` — DELETE as a step (default 1.5mi; fine-tune lives on
results). `freeTextSeed` — MERGE into the vibe surface. Resulting flow:
`locating → results`.

| ID | Sub-feature | Depends on | Test obligation |
|---|---|---|---|
| E2.1 | WhereNextFlow collapse (deletion-first) | — | e2e: flow completes WITHOUT the deleted screens + negative assertion they never render |
| E2.2 | Inline axis adjuster on results (vibe pick cached for the night via nightKey; pre-fills, never locks) | E0.2 | Unit on cache key/rollover; e2e re-search skips re-asking same night |
| E2.3 | Photo-first result card | photos (shipped #34) | e2e card renders photo; a11y pass |
| E2.4 | `starting` home phase | E0.3 | e2e phase render |

## E3 — Already out (find the next bar)

Stories: *"Next bar from where I'm standing."* · *"Not the places I've
already been tonight."* · *"Walk time, not radius."* · *"If it's
closed, don't show it."*

| ID | Sub-feature | Depends on | Test obligation |
|---|---|---|---|
| E3.1 | Tonight-exclusion set | E4.1 (Night object) | Unit; e2e excluded bar absent + negative |
| E3.2 | Distance as two chips — "walkable" / "worth a cab" — replaces RadiusSlider | E2.1 | e2e chip behavior both devices |
| E3.3 | Open-now HARD filter (openNow.ts exists) | — | Unit boundary cases (overnight hours); e2e closed bar absent |
| E3.4 | `out` home phase with one-tap "next" | E0.3, E3.1 | e2e phase + vibe-cache reuse |

## E4 — Commemorate the night (greenfield; the K-factor surface)

Night object (minimum): `{ nightKey, date, friends: handle[], bars:
[{ barId, intent, arrivedAt?, leftAt? }], ratings[], groupVotes }`.
No photo-upload infrastructure — the captured data IS the artifact.

| ID | Sub-feature | Depends on | Test obligation |
|---|---|---|---|
| E4.1 | Night object + persistence (Q1: local-first vs server — server required before E4.4) | — | Unit; migration (if server) author-only + adversarial review |
| E4.2 | Auto-generated recap card at 5am rollover, zero input (bars in order, the Loved one, who was there, pin route) | E4.1 | Unit on composition; snapshot |
| E4.3 | OG share image (reuse share/[barId] pipeline — SLIM catalog only, edge 1MB rule) | E4.2 | Bundle-size guard; OG snapshot |
| E4.4 | `/u/[handle]/night/[nightKey]` public night page, follow/join CTA | E4.1 server-side | e2e anonymous view; privacy: friends-only unless shared (Q2 default private) |
| E4.5 | `recap` home phase | E0.3, E4.2 | e2e phase render |

## E5 — App Store launch (added 2026-07-25; plan: `APP-STORE-PLAN.md`)

| ID | Sub-feature | Depends on | Status |
|---|---|---|---|
| E5.1 | Prerequisites: enrollment · service key ✓ · deletion live ✓ · legal copy ✓ · domain DNS + hi@ forwarding · Brevo rotation | operator | 3 of 6 done 2026-07-25 |
| E5.2 | Capacitor scaffold + Codemagic pipeline → TestFlight | E2+E3 shipped | not started |
| E5.3 | TestFlight dogfood | E5.2 | — |
| E5.4 | Listing: privacy labels, icon, screenshots, review notes + seeded account | E5.3 | — |

## Sequencing

`E0 → E2 + E3 → E4 → rest of E1`, with E5.1 parallel from day one and
E5.2+ after E2/E3. Falsifiable ordering signal: instrument same-session
second-result taps; if <~15% of sessions after two weeks, the mid-night
moment isn't real and E4/E1 should have led.
