# Next Bar V8 — decision record

Date: 2026-08-23
Release: `V8`
Revision: 2 (supersedes revision 1 of the same date)
Status: **DRAFT — not approved.** Nothing here authorizes implementation until the founder
approves this file together with `docs/V8-PRD-DELTA-2026-08-23.md` and
`docs/V8-TRACEABILITY-LEDGER.json`.

Compiled by the attended Claude Code session from direct inspection of all 16 approved canvases
under `docs/design-reference/approved/`, the frozen PRD `docs/V8-PRD-2026-08-13.md` as amended
2026-08-21, and the founder's decisions of 2026-08-23.

Three things are kept apart and never mixed: **confirmed product decisions**, **decisions still
awaiting founder approval**, and **operational authorizations**. Operational authorization is not
a product requirement and never appears in a requirement row.

Requirement rows, with every field the traceability contract demands, live in
`docs/V8-TRACEABILITY-LEDGER.json`. Requirement counts are **not** restated in prose anywhere:
they are computed from the ledger by `scripts/check-release-contract.mjs`, so they cannot drift.

---

## 1. Confirmed decisions

`Scope` says whether the approval covers visuals, capability, or both.

### 1.1 Carried forward from revision 1

| ID | Decision | Scope |
|---|---|---|
| `D-C-01` | All 16 canvases in `docs/design-reference/approved/` are founder-approved as of 2026-08-21. `exploratory/` no longer exists; there is no review-pending tier. | visual |
| `D-C-02` | Onboarding and Night Out Invite Recipient are approved visual implementation inputs. | visual |
| `D-C-03` | Apple, Google and phone authentication are **not authorized for V8**. Email/password remains the V8 auth path. Reaffirmed 2026-08-23 (founder decision 17). | capability exclusion |
| `D-C-04` | The Onboarding canvas's omission of a mandatory gender field is approved as drawn. Do not add one. | both |
| `D-C-05` | Stories and Feed are in **build one**. | both |
| `D-C-09` | Map filters **commit live**. The `next-bar-map-v1` draft-until-`Show N bars` Apply gate is superseded. Reaffirmed 2026-08-23 (founder decision 14). | both |
| `D-C-10` | Rankings suppression **Option B**: a score below 5.0 is negative evidence only and does not suppress a bar. | capability |
| `D-C-11` | Map markers carry exactly two meanings — ranked ring, other dot — plus the user dot. No Loved/Liked/Pass, no suggested tier. | both |

### 1.2 Founder decisions of 2026-08-23

Recorded exactly as given. The numbers in brackets are the founder's own numbering.

| ID | Decision | Scope |
|---|---|---|
| `D-C-12` | **[1]** Feed is **both** a Social view **and** an explicit global-composer destination. | both |
| `D-C-13` | **[2]** The composer destinations are **Feed, Story, Night Out, and Group** — four. | both |
| `D-C-14` | **[3]** Selecting Story alone does **not** automatically publish to Feed. Selecting Feed **and** Story publishes **the same media object** to both destinations **without duplicating the media**. | capability |
| `D-C-15` | **[4]** Feed posts remain until **their author deletes them**, and support **visible comments**. | capability |
| `D-C-16` | **[5]** Stories expire after **24 hours** and have **no public comment thread**. | capability |
| `D-C-17` | **[6]** Story audiences are **mutual friends**, a **named mutual-friend group**, or a **custom mutual-friend subset**. Stories are **never public**. | capability |
| `D-C-18` | **[7]** Night Out media has a **24-hour window measured from the scheduled Night Out start**. A **signed-in participant** may **privately archive** it to **Saved Nights Out**. | capability |
| `D-C-19` | **[8]** Saving media to the phone's **local photo library is deferred to V9** if it would materially expand V8. | deferral (conditional) |
| `D-C-20` | **[9]** **Group** means a **persistent named group chat**: people can exchange **text and photos**, and the group is **reusable to invite the same people to future Night Outs**. | capability |
| `D-C-21` | **[10]** Presence choices are **Going out**, **Maybe later**, and **Not going out**. A **manual Pin / Heading-to selection overrides automatic presence until 4:00 AM**. | capability |
| `D-C-22` | **[11]** Night Out RSVP choices are **Going**, **Maybe**, and **Can't make it**. | capability |
| `D-C-23` | **[12]** A **token-scoped recipient without the app** may **view the associated Night Out and submit an RSVP without signing up**. They may **not** vote, suggest bars, or browse private application data until authenticated. | capability |
| `D-C-24` | **[13]** Account includes **Saved Nights Out** and the **vibe quiz** in V8. **Badges and Persona are deferred to V9.** | both |
| `D-C-25` | **[14]** Map markers use the **approved numeric score** rather than legacy tiers. **Preserve the approved live filters.** | both |
| `D-C-26` | **[15]** Rankings are **server-owned**, with **last server-committed write** as the conflict rule. | capability |
| `D-C-27` | **[16]** The stale "exploratory / pending approval" labels inside four canvases are **superseded by the written approval record**. **Image recapture is not required.** | visual |
| `D-C-28` | **[17]** Third-party onboarding authentication remains **outside V8**. | capability exclusion |

### 1.3 What these decisions supersede in the frozen PRD

Each is carried as a `superseded` row in the ledger and named in the delta.

| Frozen PRD text | Superseded by |
|---|---|
| "Group chat is excluded from V8; moderation, blocking, retention, abuse, and notification-volume policy must exist before chat is considered." | `D-C-20`. **The precondition is not waived** — it is exactly what `D-P-03` still asks the founder to settle. |
| "`Not tonight` is the user-facing declined action rather than a second duplicate database state." | `D-C-22`. The phrase leaves the invitation surface entirely; presence keeps **Not going out** (`D-C-21`). |
| "Pre-signup RSVP remains an exploratory proposal and is not authorized by this PRD." | `D-C-23`, **for RSVP only**. Joining, voting and suggesting still require authentication. |
| "Joining, accepting, declining, suggesting, and voting require authentication." | `D-C-23`, **narrowed**: accepting/declining (RSVP) no longer require authentication; joining, suggesting and voting still do. |
| Ratings ownership left to "one server owner and conflict rule" without naming the rule. | `D-C-26` names it: last server-committed write. |
| Rankings canvas footer "Your scores · stored on this device". | `D-C-26`. |
| `next-bar-map-v1` Apply-gated `Show N bars` filter commit. | `D-C-09`, reaffirmed by `D-C-25`. |
| In-canvas "EXPLORATORY — REVIEW NEEDED" / "ASSUMPTION — PENDING APPROVAL" banners on four canvases. | `D-C-27`. |

### 1.4 A reading that this compilation did not make

`D-C-21` says a manual Pin / Heading-to selection "overrides **automatic presence**". No approved
canvas defines an automatic presence signal — `next-bar-option-b-manual-pin` states the opposite
of automation for the **pin** ("You choose the bar. Next Bar never tracks you automatically",
"Manual · bar-level only · expires at 4 AM").

This compilation has **not** resolved what "automatic presence" refers to. It is carried as
`D-P-08` below rather than guessed at, and `V8-R-PRE-004` stays blocked.

---

## 2. FOUNDER APPROVAL REQUIRED — unresolved behavior

**These are not decided. Nothing in this table may be implemented.** Every ledger row citing one
of these IDs carries `status: "blocked"`, and the validator rejects any such row that reads as
approved.

| ID | Question | What is already fixed | What is open |
|---|---|---|---|
| `D-P-01` | **Feed visibility.** | `D-C-13` makes Feed a destination; `D-C-17` fixes Story audiences as mutual-friend-only and never public. No approved canvas contains a `Public` audience anywhere. | Confirm the Feed audience is **mutual friends / named mutual-friend group / custom mutual-friend subset only**, and that there is **no public Feed audience**. Until confirmed, Feed audience is undefined — it does **not** inherit the Story rule by default. |
| `D-P-02` | **Feed comments.** | `D-C-15` makes Feed comments visible and Feed posts author-deletable. `D-C-16` gives Stories no public comment thread. | Who may comment (audience members only, or a narrower set); whether an author may delete another person's comment; whether a commenter may delete their own; blocking; reporting. |
| `D-P-03` | **Group administration.** | `D-C-20` makes Group a persistent named group chat carrying text and photos, reusable for Night Out invitations. | Administration model; who may add and remove members; leaving; blocking and reporting; message retention; message deletion. The frozen PRD required exactly this policy set to exist before chat is considered, so `D-C-20` cannot be built until this is answered. |
| `D-P-04` | **Optional captions.** | `next-bar-camera-modes` draws an optional caption (`25/140`) on the global review step. `next-bar-add-story-flow` draws **no** caption field on the quick Add-to-Story path. | Whether the quick Add-to-Story path gains a caption, or the difference between the two entry points is deliberate. |
| `D-P-05` | **Multi-destination deletion.** | `D-C-14` makes Feed + Story one media object with two destinations. `D-C-15` makes a Feed post author-deletable. | Whether deleting removes **one destination** while the others survive, or is **Delete everywhere**; and what the control says. This governs whether `D-C-14`'s single media object may be unreferenced by one destination and still live under another. |
| `D-P-06` | **Success-receipt wording.** | `next-bar-share-destinations-v2` draws "Shared to 3 places" with per-destination indicators; `next-bar-add-story-flow` draws "Added to your story". | The exact receipt wording for **Feed-only**, **Story-only**, and **multi-destination** publishing, now that Feed is a fourth destination and the drawn receipts predate it. |
| `D-P-07` | **Ranking events in Feed.** | `next-bar-social-v2-core` draws a ranking event as a compact secondary row inside the Feed. | Whether a ranking event ever generates a Feed entry **in V8**, or the drawn row is deferred. |
| `D-P-08` | **"Automatic presence".** *(Surfaced by this compilation; not in the founder's list — strike it if it is already settled.)* | `D-C-21` fixes the three presence choices and the 4:00 AM override boundary. | What "automatic presence" is, given that the approved pin canvas promises no automatic tracking. Either it names automatic derivation of the three-state status from some signal, or the word is loose and presence is wholly manual. |

---

## 3. Resolution of the revision-1 open decisions

Kept so the history is legible. None of these remains open.

| Revision-1 ID | Outcome |
|---|---|
| `D-O-01` Feed retention/deletion | **RESOLVED** by `D-C-15`: Feed posts persist until the author deletes them. Deletion semantics across destinations remain open as `D-P-05`. |
| `D-O-02` Public audience | **RESOLVED for Story** by `D-C-17` (never public). **Open for Feed** as `D-P-01`. |
| `D-O-03` Composer destination set | **RESOLVED** by `D-C-13`: Feed, Story, Night Out, Group. The revision-1 canvas-vs-canvas conflict is settled in favour of a four-destination model that neither canvas draws in full. |
| `D-O-04` Named Group | **RESOLVED in kind** by `D-C-20` (persistent named group chat). Administration, membership, blocking, reporting and retention remain open as `D-P-03`. |
| `D-O-05` Status vs pin | **RESOLVED** by `D-C-21`. |
| `D-O-06` `Not tonight` collision | **RESOLVED** by `D-C-21` + `D-C-22`: presence keeps **Not going out**; RSVP uses **Can't make it**. The phrase `Not tonight` is used by neither. |
| `D-O-07` Archive / Badges / Persona | **RESOLVED** by `D-C-24`: Saved Nights Out and the vibe quiz are in V8; Badges and Persona are deferred to V9. |
| `D-O-08` Pre-signup RSVP | **RESOLVED** by `D-C-23`: view and RSVP without signup; no voting, no suggesting, no private data. |
| `D-O-09` Map marker derivation | **RESOLVED** by `D-C-25`: numeric score, live filters preserved. |
| `D-O-10` Stale in-canvas banners | **RESOLVED** by `D-C-27`: the written approval record supersedes them; no recapture. |
| `D-O-11` Rankings ownership | **RESOLVED** by `D-C-26`: server-owned, last server-committed write wins. |
| `D-O-12` Package absent from the integration base | **RESOLVED by construction.** The amended PRD, the 16-canvas package, the README approval record, this decision record, the delta, the ledger and the validator now all exist on the same branch, and the validator passes with **no external artifact root**. |

---

## 4. Operational authorizations — **not product requirements**

| ID | Authorization |
|---|---|
| `OA-01` | Staging-only migration application is authorized. |
| `OA-02` | Staging RLS/Storage testing is authorized. |
| `OA-03` | Local V8 integration and local merges are authorized. |
| `OA-04` | Production writes and production tests remain **forbidden**. |
| `OA-05` | Push, PR, deploy, publication and TestFlight remain **forbidden**. |

---

## 5. Freezing

The ledger binds the PRD, this decision record, the delta, the design-reference README and all 16
approved canvases by SHA-256. The ledger's own digest is emitted by the validator on every run;
record that value with the approval so the whole contract is frozen by digest.

```
node scripts/check-release-contract.mjs docs/V8-TRACEABILITY-LEDGER.json
```
