# Next Bar V8 — decision record

Date: 2026-08-23
Release: `V8`
Status: **DRAFT — not approved.** Nothing in this file authorizes implementation until the
founder approves it together with `docs/V8-PRD-DELTA-2026-08-23.md` and
`docs/V8-TRACEABILITY-LEDGER.json`.

Compiled by the attended Claude Code session from direct inspection of all 16 approved canvases
under `docs/design-reference/approved/` (read on `harness/v8-1-parallel-20260821/social`), the
frozen PRD `docs/V8-PRD-2026-08-13.md`, and the founder decisions recorded in
`D:\harness-handoffs\ATTENDED-V8-PRD-FREEZE-HANDOFF-20260823.md`.

This file separates three things that must never be mixed: **confirmed product decisions**,
**open product decisions**, and **operational authorizations**. Operational authorization is not a
product requirement and never appears in a requirement row.

---

## 1. Confirmed decisions

Each is treated as settled. `Scope` says whether the approval covers visuals, capability, or both.

| ID | Decision | Scope | Source |
|---|---|---|---|
| `D-C-01` | All 16 canvases in `docs/design-reference/approved/` are founder-approved as of 2026-08-21, subject to the caveats below. `exploratory/` is empty; there is no review-pending tier. | visual | `docs/design-reference/README.md` §"Founder approval — 2026-08-21"; founder reconfirmation 2026-08-23 |
| `D-C-02` | Onboarding and Night Out Invite Recipient are approved **visual** implementation inputs. | visual | `D-C-01`; founder 2026-08-23 |
| `D-C-03` | Apple, Google and phone authentication shown in the Onboarding canvas are **not authorized for V8**. Email/password remains the V8 auth path. Onboarding visuals are built against email/password. | capability exclusion | README caveat; PRD supersession paragraph; founder 2026-08-23 |
| `D-C-04` | The Onboarding canvas's omission of a mandatory gender field is approved as drawn. Do not add a gender field. | both | README caveat |
| `D-C-05` | Stories and Feed are in **build one**. | both | founder 2026-08-23 |
| `D-C-06` | Viewing another person's Stories requires **mutual friendship**. | capability | founder 2026-08-23 |
| `D-C-07` | A Story may target **all mutual friends** or a **custom subset** of mutual friends. | capability | founder 2026-08-23 |
| `D-C-08` | Stories are **not public**. | capability | founder 2026-08-23 |
| `D-C-09` | Map filters **commit live**. The `next-bar-map-v1` canvas's draft-until-`Show N bars` Apply gate is **superseded** by founder feedback. Do not restore the Apply step. | both | Map goal `g-17984023` body, §"Superseded Map behavior"; preserved by founder 2026-08-23 |
| `D-C-10` | Rankings suppression **Option B**: a score below 5.0 no longer suppresses a bar; low scores are negative evidence only. | capability | PRD P1, resolved 2026-08-19 |
| `D-C-11` | Map markers carry exactly two meanings — ranked bars a coral ring, everything else a muted dot — plus the blue user dot. No Loved/Liked/Pass and no suggested tier. | both | `next-bar-map-v1.png` NOTE 3; `CLAUDE.md` V8 product boundaries |

### Caveats carried by `D-C-01`

Approving the **visuals** did not approve a **capability**. Two capability caveats survive:

1. The third-party auth providers drawn in Onboarding (`D-C-03`).
2. The Onboarding gender omission is an approved omission, not an invitation to add one (`D-C-04`).

A third caveat is **newly identified by this session** and is not yet resolved — see `D-O-10`.

---

## 2. Open decisions — founder input required

Implementation of every requirement citing one of these is **blocked**. Options are mutually
exclusive and deliberately minimal.

### `D-O-01` — Feed retention and deletion lifecycle

**What the artifacts show.** `next-bar-camera-modes` "Where it goes" carries two independent
destination toggles: *24-hour story* ("Disappears tomorrow at 11:56") and *Save to my Night Out
recap* ("**Private archive** in Account → Nights Out"). `next-bar-account-a-tabs` shows Nights Out
as a memory archive of past nights with no expiry. `next-bar-social-v2-core` shows Social · Feed
as "photo memories" of friends. No canvas states a Feed retention rule.

| Option | Meaning |
|---|---|
| **A** | Feed is a *view* over posts whose audience includes the viewer; a Feed entry lives exactly as long as its underlying post (24h if story-only, indefinite if saved to a recap). No separate Feed retention rule exists. |
| **B** | Feed has its own bounded window (e.g. rolling N days) independent of the post's own lifetime. |
| **C** | Feed is deferred out of build one entirely. Contradicts `D-C-05`. |

Affected: `V8-R-FEED-001`, `V8-R-FEED-003`, `V8-R-STO-006`, `V8-R-ACC-002`. Goals: `g-f1e128da`.
Code: `src/app/friends/_components/FeedSection.tsx`, `src/components/story/storyStore.ts`.
Data: story/post rows, `supabase/migrations/0065_stories.sql`.

### `D-O-02` — Does a Public audience apply to Feed, and to which destinations?

**Material correction to the framing.** Direct inspection of all 16 canvases found **no `Public`
audience anywhere**. Every audience control in every approved composer offers exactly three
choices: *Friends* (all accepted), *named group(s)*, and *Custom / Selected people*
(`next-bar-camera-modes`, `next-bar-add-story-flow`, `next-bar-share-destinations-v2`,
`next-bar-option-b-manual-pin`). `next-bar-social-v2-core` states the Feed carries "**No public
like counts** and no follower metrics".

| Option | Meaning |
|---|---|
| **A** *(matches every approved canvas)* | There is no Public audience in V8 on any destination. Record it as an explicit exclusion. |
| **B** | Public applies to Feed only, and requires a new audience control that no approved canvas draws. |
| **C** | Public applies to Feed and Story. Directly contradicts `D-C-08`. |

Affected: `V8-R-FEED-004`, `V8-R-CMP-003`, `V8-R-STO-005`. Goals: `g-f1e128da`.

### `D-O-03` — The approved composer destination set

**Material correction to the framing.** The handoff describes the destinations as "Group Chat,
Story, and Feed". The artifacts show something different, and the two composer canvases disagree
with each other:

- `next-bar-share-destinations-v2` — three **destinations**: **Night Out** ("Saved to tonight's
  recap"), **Story** ("Visible for 24 hours", with a Story-audience subrow), and **Group**
  (expands in place; multi-select over your named groups). "One post, three destination
  indicators — the same photo does not appear three times in the feed."
- `next-bar-camera-modes` — two **destinations** (*24-hour story*, *Save to my Night Out recap*)
  with the named group appearing in the **audience** list instead.

Neither canvas contains a destination called **Feed**; Feed is a *view*, not a destination. Neither
canvas contains **Group Chat** (messaging). The PRD's exclusion — "Group chat is excluded from V8"
— is about a **chat/messaging system**, which is a different object from a **named group**. That
distinction dissolves most of the apparent conflict but not the canvas-to-canvas one.

| Option | Meaning |
|---|---|
| **A** | `share-destinations-v2` governs: three destinations (Night Out, Story, Group); `camera-modes` is superseded on this point only. |
| **B** | `camera-modes` governs: two destinations, group is an audience; the Group destination row in `share-destinations-v2` is superseded. |
| **C** | Both stand for their own entry point (global composer vs direct camera capture) and the difference is intentional. |

The PRD's Group-chat exclusion is unaffected by every option: no option introduces messaging.

Affected: `V8-R-CMP-002`, `V8-R-CMP-003`, `V8-R-GRP-002`. Goals: `g-f1e128da`. Code: no global
composer exists — `src/components/ShareButton.tsx` and `src/app/share/` are the legacy link-share
surface, not this flow.

### `D-O-04` — Named Group: scope, creation, membership, moderation, blocking, retention, build-one

**What the artifacts show.** Named groups appear on **four** approved surfaces: the Night Out
People-or-group picker with a **`Create a group`** button (`next-bar-night-out-start-flow`), the pin
audience (`next-bar-option-b-manual-pin`, "Manage groups in Social"), the Story/post audience
(`next-bar-camera-modes`, `next-bar-add-story-flow`), and the composer Group destination
(`next-bar-share-destinations-v2`). `next-bar-account-a-settings` states "**Relationship actions
live in Social**: add/invite people while creating or editing a group", "there is no Group invites
row", carries a **Blocked & muted** list under Connections, a **Group activity** notification
category, and lists **group memberships** among the data destroyed by account deletion.

| Option | Meaning |
|---|---|
| **A** | Named groups are in build one as a **first-class object** with creation/edit in Social, fixed membership, and the four consuming surfaces above. |
| **B** | Named groups are in build one as an **audience label only** — no creation UI, no membership management; the `Create a group` affordance and the Group destination are deferred. |
| **C** | Named groups are deferred out of build one entirely. Four approved surfaces then lose an approved control and must be redrawn or explicitly degraded. |

Moderation/blocking/retention must be answered under A and B. Affected: `V8-R-GRP-001` …
`V8-R-GRP-004`, `V8-R-STO-005`, `V8-R-PRE-002`, `V8-R-NO-001`, `V8-R-ACC-007`, `V8-R-ACC-008`.
Code: `src/app/friends/_components/GroupsAndPeople.tsx` (partial).

### `D-O-05` — Global going-out status vs bar-level presence pin

**What the artifacts show.** `next-bar-option-b-manual-pin` and `next-bar-social-v2-core` describe
one **composed** model, not two competing ones: a pin is manual, bar-level, has no GPS, and expires
at 4 AM; the Tonight row shows `Pinned` or `Heading to` **with the bar name**; a friend with no pin
shows their own Going Out status instead of an invented venue. The Tonight list renders four
row kinds — `Joyface · PINNED`, `Attaboy · HEADING TO`, `Going out`, `Maybe later`.

| Option | Meaning |
|---|---|
| **A** | One composed model: global status is the fallback, a pin overrides it. Exactly one row per friend. Bar-level states are `Pinned` / `Heading to`; global states are the remaining set in `D-O-06`. |
| **B** | Two independent signals, both rendered, which the approved Tonight row does not show. |

Affected: `V8-R-PRE-003`, `V8-R-PRE-004`. Code: `src/app/friends/_components/TonightPresence.tsx`,
`src/app/friends/_components/usePinnedHandles.ts`.

### `D-O-06` — The `Not tonight` collision

**What the artifacts show.** The approved invite canvas does **not** use the phrase. Pre-signup the
decline is **`Can't make it`**; the in-app invitation card uses **`Decline`**
(`next-bar-night-out-invite-recipient-v1`). Only the frozen PRD says "`Not tonight` is the
user-facing declined action". So the phrase is currently unclaimed by any approved artifact.

| Option | Meaning |
|---|---|
| **A** | `Not tonight` is a **presence status** only. Invitations decline with `Can't make it` / `Decline`, exactly as drawn. The PRD sentence is superseded. |
| **B** | `Not tonight` is the **invitation decline** only, as the PRD says. Presence uses a different third status word. |
| **C** | Both, disambiguated by context. Rejected by the design's own MECE rule; listed for completeness. |

Affected: `V8-R-NO-005`, `V8-R-NO-008`, `V8-R-PRE-004`. Goals: `g-31acf1bf`, `g-0e836120`.

### `D-O-07` — Account multi-night archive, Badges, Persona: build one or deferral

**What the artifacts show.** All three are drawn in full, not sketched:
`next-bar-account-a-tabs` specifies the Nights Out recap archive (per-night card: name, date, bar
count, photo count, opening the archived recap), the Badges tab, the Persona card ("The Low-Key
Local", derived from vibe quiz + ranked places), and earned vs locked badges each with a one-line
reason. The recap archive is also the destination named by the *Save to my Night Out recap* toggle
in `next-bar-camera-modes`, so `D-O-01` depends on this answer.

| Option | Meaning |
|---|---|
| **A** | All three in build one. |
| **B** | Recap archive in build one (it is the destination a build-one composer writes to); Badges and Persona explicitly deferred with a recorded owner and date. |
| **C** | All three explicitly deferred; the Account tabs ship with the Nights Out tab only and the segmented control is removed. |

Affected: `V8-R-ACC-002`, `V8-R-ACC-003`, `V8-R-FEED-003`. Goals: `g-56595877` (complete —
completion does not automatically satisfy a changed requirement).

### `D-O-08` — Pre-signup RSVP vs the ratified post-signup second tap

**Direct contradiction between an approved artifact and the frozen PRD.**
`next-bar-night-out-invite-recipient-v1` panel A explicitly draws it: a deep-link recipient who is
not yet a user sees the plan and **can RSVP before any signup gate** — `I'm in` / `Can't make it` on
the first screen, then "You're in for Friday night in the LES", then a **soft** signup upsell
labelled "Optional — you're already RSVP'd either way". The frozen PRD says the opposite:
"Pre-signup RSVP remains an exploratory proposal and is **not authorized** by this PRD" and
"Joining, accepting, declining … require authentication".

| Option | Meaning |
|---|---|
| **A** | Ratify the approved canvas: anonymous bearer-link RSVP is authorized, and the PRD sentence is superseded. Requires an anonymous-write trust boundary that does not exist today. |
| **B** | Ratify the PRD: RSVP requires authentication; the canvas's panel-A screens 1–2 are superseded and the signup gate moves ahead of the RSVP. |

Affected: `V8-R-NO-006`, `V8-R-NO-007`. Goals: `g-31acf1bf` ("Part A only" — the deep-link track is
exactly this surface). Code: `src/app/night-out/[token]/InvitePreview.tsx`, `src/app/join/page.tsx`.

### `D-O-09` — Correcting the Map marker derivation

The requirement is **not** in doubt (`D-C-11`). What needs a decision is the correction's timing:
the shipped marker set is derived from the legacy Loved/Liked/Pass tiers rather than from the
presence of a numeric score, on a lane already marked complete.

| Option | Meaning |
|---|---|
| **A** | Correct now, in a scoped fix on the Map lane: derive ranked-ness from a numeric score and delete the tier read. |
| **B** | Carry it into the integration lane as a named residual. |
| **C** | Explicitly defer with owner and date. Ships a marker model the V8 boundary rules disallow. |

Whatever is chosen must **carry `D-C-09` forward** — a rewrite that restores the Apply gate
re-introduces behavior the founder removed. Affected: `V8-R-MAP-002`. Goals: `g-17984023`
(complete), `g-12d33864` (blocked; its six-axis filter surface is not what `map-v1` shows and needs
rewriting rather than unblocking).

---

## 3. Newly surfaced — not in the handoff, found by direct artifact inspection

### `D-O-10` — Four approved canvases contradict their own approval in-canvas

The PNG bytes were never re-captured after the 2026-08-21 approval, so four artifacts still brand
themselves unapproved. Verified by opening each image, not by filename:

| Canvas | In-canvas banner |
|---|---|
| `next-bar-onboarding-v1.png` | "EXPLORATORY, REVIEW NEEDED … has not been reviewed or approved; it does not carry founder sign-off" |
| `next-bar-night-out-invite-recipient-v1.png` | "EXPLORATORY, REVIEW NEEDED … Not reviewed, no founder approval implied" |
| `next-bar-operational-states-v1.png` | "EXPLORATORY, REVIEW NEEDED … Not reviewed; no founder approval implied" |
| `next-bar-rankings-numeric-lists.png` | "ASSUMPTION — PENDING APPROVAL … Not an approved rule yet — this canvas exists to test it" |

`docs/design-reference/README.md` says all 16 are approved. An implementer opening the artifact sees
the opposite. The traceability contract rejects a row whose approved source is ambiguous about
whether approval covers visuals, capability, or both.

| Option | Meaning |
|---|---|
| **A** | Re-capture the four canvases without the banners. Artifact digests change; the ledger must be re-frozen. |
| **B** | Record a written supersession in `README.md` naming each file and stating the banner is stale, leaving bytes and digests untouched. |

Note `rankings`' banner is narrower and needs its own answer: it marks the **one-global-score rule**
as an untested assumption, which is a product rule, not a status label. See `D-O-11`.

### `D-O-11` — Rankings: "stored on this device" vs server-owned ratings

`next-bar-rankings-numeric-lists` prints "Your scores · stored on this device" in the footer. The
frozen PRD P0 requires "one server owner and conflict rule for ratings, numeric scores, named
lists …". These cannot both be true.

| Option | Meaning |
|---|---|
| **A** | Server-owned with a conflict rule (PRD governs); the canvas footer is superseded copy. |
| **B** | Device-local for V8, server sync deferred with a recorded owner and date. Breaks the PRD's account-continuity guarantee. |

Affected: `V8-R-RNK-001`. Goals: `g-955ee460` (complete).

### `D-O-12` — The approved package does not exist on the integration base

Measured this session, not inferred:

| Branch | `approved/` | `exploratory/` | PRD carries the 2026-08-21 supersession |
|---|---|---|---|
| `release/v8` (`df099f7`) — the intended integration base | **13** | **3** | **no** |
| `integration/v8-20260820` (`df099f7`) | 13 | 3 | no |
| `harness/v8-1-parallel-20260821/{social,account}` | 16 | 0 | yes |
| `harness/v8-visual-recovery-20260821` | 16 | 0 | yes |

The 16-canvas set is **byte-identical** across all three 08-21 branches. The amended PRD
(`44f4cca7…`) and the 16-canvas package exist **only** off the integration base. Integrating V8
against `release/v8` as it stands would integrate against the 13-canvas, unamended contract.

| Option | Meaning |
|---|---|
| **A** | Promote the amended PRD and the 16-canvas package onto the integration base as the first integration step, before any feature merge. |
| **B** | Re-base the frozen contract onto one of the 08-21 branches and change the declared integration base. |

---

## 4. Operational authorizations — **not product requirements**

Recorded separately and deliberately excluded from every requirement row.

| ID | Authorization |
|---|---|
| `OA-01` | Staging-only migration application is authorized. |
| `OA-02` | Staging RLS/Storage testing is authorized. |
| `OA-03` | Local V8 integration and local merges are authorized. |
| `OA-04` | Production writes and production tests remain **forbidden**. |
| `OA-05` | Push, PR, deploy, publication and TestFlight remain **forbidden**. |

`OA-01`/`OA-02` unblock *evidence* for `V8-R-STO-014` … `V8-R-STO-016` and the three never-executed
live suites. They do not approve any product behavior.
