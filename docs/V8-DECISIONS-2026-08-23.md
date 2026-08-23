# Next Bar V8 — decision record

Date: 2026-08-23
Release: `V8`
Revision: 3 (supersedes revisions 1 and 2 of the same date)
Status: **DRAFT** pending final founder approval of the exact digests emitted by the validator.

**There are no unresolved product decisions.** Every question this record has ever carried is
answered. Nothing here authorizes implementation until the founder approves the digests.

Three things are kept apart and never mixed: **confirmed product decisions**, **deferrals**, and
**operational authorizations**. Operational authorization is not a product requirement and never
appears in a requirement row.

Requirement rows live in `docs/V8-TRACEABILITY-LEDGER.json`. Counts are **not** restated in prose
anywhere — they are computed from the ledger by `scripts/check-release-contract.mjs`, so they
cannot drift.

---

## 1. Confirmed decisions

### 1.1 Carried forward

| ID | Decision | Scope |
|---|---|---|
| `D-C-01` | All 16 canvases in `docs/design-reference/approved/` are founder-approved as of 2026-08-21. There is no review-pending tier. | visual |
| `D-C-02` | Onboarding and Night Out Invite Recipient are approved visual implementation inputs. | visual |
| `D-C-03` | Apple, Google and phone authentication are **not authorized for V8**. Email/password remains the V8 auth path. | capability exclusion |
| `D-C-04` | The Onboarding canvas's omission of a mandatory gender field is approved as drawn. | both |
| `D-C-05` | Stories and Feed are in **build one**. | both |
| `D-C-09` | Map filters **commit live**. The `next-bar-map-v1` draft-until-`Show N bars` Apply gate is superseded. | both |
| `D-C-10` | Rankings suppression **Option B**: a score below 5.0 is negative evidence only. | capability |
| `D-C-11` | Map markers carry exactly two meanings — ranked ring, other dot — plus the user dot. | both |
| `D-C-12` | Feed is **both** a Social view **and** an explicit global-composer destination. | both |
| `D-C-13` | The composer destinations are **Feed, Story, Night Out, and Group**. | both |
| `D-C-14` | Story alone does **not** publish to Feed. Feed **and** Story publish **the same media object** to both, **without duplicating the media**. | capability |
| `D-C-15` | Feed posts remain until **their author deletes them**, and support **visible comments**. | capability |
| `D-C-16` | Stories expire after **24 hours** and have **no public comment thread**. | capability |
| `D-C-17` | Story audiences are **mutual friends**, a **named mutual-friend group**, or a **custom mutual-friend subset**. Never public. | capability |
| `D-C-18` | Night Out media has a **24-hour window measured from the scheduled Night Out start**. A **signed-in participant** may **privately archive** it to **Saved Nights Out**. | capability |
| `D-C-20` | **Group** means a **persistent named group chat** — text and photos, reusable to invite the same people to future Night Outs. Its full policy is `D-C-31`. | capability |
| `D-C-21` | Presence choices are **Going out**, **Maybe later**, **Not going out**. Superseded on the pin relationship by `D-C-36`. | capability |
| `D-C-22` | Night Out RSVP choices are **Going**, **Maybe**, **Can't make it**. | capability |
| `D-C-23` | A **token-scoped recipient without the app** may **view the Night Out and submit an RSVP without signing up**. They may **not** vote, suggest bars, or browse private application data until authenticated. | capability |
| `D-C-24` | Account includes **Saved Nights Out** and the **vibe quiz** in V8. **Badges and Persona are deferred to V9.** | both |
| `D-C-25` | Map markers use the **approved numeric score** rather than legacy tiers. **Preserve the approved live filters.** | both |
| `D-C-26` | Rankings are **server-owned**, with **last server-committed write** as the conflict rule. | capability |
| `D-C-27` | The stale "exploratory / pending approval" labels inside four canvases are **superseded by the written approval record**. **Image recapture is not required.** | visual |
| `D-C-28` | Third-party onboarding authentication remains **outside V8**. | capability exclusion |

### 1.2 Revised

| ID | Revision |
|---|---|
| `D-C-19` | **Revised 2026-08-23.** Previously "deferred to V9 **if it would materially expand V8**". The conditional is removed: exporting or saving a photo from Next Bar into the phone's **native Photos library is entirely deferred to V9**. **There is no native Photos-library export in V8.** Saved Nights Out remains in V8 as a private **in-app** archive and is **not** the phone's Photos library. |

### 1.3 Founder decisions of 2026-08-23 resolving the eight pending questions

| ID | Decision | Replaces |
|---|---|---|
| `D-C-29` | **Feed visibility.** Feed is **never public**. Its audience is one of: **all mutual friends**; a **named mutual-friend group**; a **custom mutual-friend subset**. | `D-P-01` |
| `D-C-30` | **Feed comments and moderation.** Anyone authorized to view a Feed post may comment. A commenter may delete their own comment. The post author may remove comments from their post. Blocking prevents visibility and interaction between the affected users. Reporting immediately hides the reported content for the reporter and creates a **server-owned** report for operator review. **No new moderation dashboard is required in V8** — existing administrative tooling is sufficient. Report records remain until operator removal or account deletion. **Deleting the Feed post removes its visible comments.** | `D-P-02` |
| `D-C-31` | **Persistent group chat.** The creator is the **initial administrator**. Administrators may **rename** the group and **add or remove mutual friends**. **Any member may leave.** Members may send **text and photos**. **Any member** may reuse the current group membership to invite the group to a Night Out. **Senders may delete their own messages for everyone**; **administrators may remove messages** from the group. Messages **persist until removed or the group is deleted**. Blocking prevents new direct interaction, invitations, or addition to new shared groups. Reporting hides the reported content for the reporter and creates a server-owned operator-review record. **V8 provides in-app unread state and Night Out invitation notifications. V8 does not send a push notification for every ordinary Group message** — this is the previously omitted notification-volume prerequisite. | `D-P-03` |
| `D-C-32` | **Captions.** The **global composer** provides an optional caption with a **maximum of 140 characters**. The **quick Add-to-Story path remains caption-free** so that it stays fast. A Story created **through the global composer** may carry its optional caption. | `D-P-04` |
| `D-C-33` | **Multi-destination deletion.** One media object may have multiple destination references. **"Remove from this destination"** removes only that destination. **"Delete everywhere"** removes every destination. Removing one destination **does not destroy** the remaining destinations. **Physical media bytes are deleted only when no destination and no Saved Nights Out archive references them.** Removing the Feed destination also removes that Feed post's visible comments. | `D-P-05` |
| `D-C-34` | **Success receipts.** Feed only: **"Posted to Feed"**, with **View post** and **Undo**. Story only: **"Added to your story"**, with **View story** and **Undo**. Multiple destinations: **"Shared to N places"**, with destination indicators, **Done** and **Undo**. | `D-P-06` |
| `D-C-35` | **Ranking events.** Ranking actions **do not automatically generate Feed entries in V8**. Automatic ranking-event Feed rows are **deferred to V9**. | `D-P-07` |
| `D-C-36` | **Presence and pin.** There is **no automatic GPS/location tracking**. Presence is **manually controlled**. The choices are **Going out**, **Maybe later**, **Not going out**. Selecting **Pin/Heading-to is an explicit user action that sets Going out and the selected bar until 4:00 AM**. Selecting **Maybe later or Not going out clears the active pin**. **Presence and the active pin expire at 4:00 AM.** **Night Out RSVP does not silently control global presence.** This **replaces the ambiguous phrase "overrides automatic presence."** | `D-P-08` |

---

## 2. History — the eight pending decisions, and how they were resolved

Preserved so the record of what was once open is not lost. **None of these remains open**, and no
ledger row may cite a `D-P-` id as its authority.

| Pending ID | Question as it stood | Resolved by | On |
|---|---|---|---|
| `D-P-01` | Feed visibility: mutual friends / named groups / custom only, and no public Feed audience | `D-C-29` | 2026-08-23 |
| `D-P-02` | Feed comment permissions, comment deletion, blocking and reporting | `D-C-30` | 2026-08-23 |
| `D-P-03` | Group administration, member add/remove, leaving, blocking/reporting, message retention and message deletion | `D-C-31` | 2026-08-23 |
| `D-P-04` | Optional captions: global composer versus quick Add to Story | `D-C-32` | 2026-08-23 |
| `D-P-05` | Multi-destination deletion: removing one destination versus Delete everywhere | `D-C-33` | 2026-08-23 |
| `D-P-06` | Success-receipt wording for Feed-only, Story-only and multi-destination publishing | `D-C-34` | 2026-08-23 |
| `D-P-07` | Whether ranking events ever generate Feed entries in V8 | `D-C-35` | 2026-08-23 |
| `D-P-08` | What "automatic presence" is, given the pin canvas promises no automatic tracking | `D-C-36` | 2026-08-23 |

The revision-1 open decisions `D-O-01` … `D-O-12` were resolved earlier the same day; that table
is preserved in revision 2 of this file in git history.

---

## 3. What these decisions supersede in the frozen PRD

Each is carried as a `superseded` row in the ledger, named in the delta, and marked by an
amendment section in the PRD itself.

| Frozen PRD text | Superseded by |
|---|---|
| "Group chat is excluded from V8; moderation, blocking, retention, abuse, and notification-volume policy must exist before chat is considered." | `D-C-20` for the exclusion, and `D-C-31` **supplies the required policy set** — including the notification-volume rule. The precondition is met, not waived. |
| "`Not tonight` is the user-facing declined action rather than a second duplicate database state." | `D-C-22`. Presence keeps **Not going out** (`D-C-36`); RSVP uses **Can't make it**. |
| "Pre-signup RSVP remains an exploratory proposal and is not authorized by this PRD." | `D-C-23`, for RSVP only. |
| "Joining, accepting, declining, suggesting, and voting require authentication." | `D-C-23`, narrowed: RSVP no longer requires authentication; joining, suggesting and voting still do. |
| Ratings ownership left as "one server owner and conflict rule" without naming the rule. | `D-C-26`: last server-committed write. |
| Rankings canvas footer "Your scores · stored on this device". | `D-C-26`. |
| `next-bar-map-v1` Apply-gated `Show N bars` filter commit, and the six-axis Tweak-the-vibe Map surface. | `D-C-09`, reaffirmed by `D-C-25`. Recorded as `V8-R-MAP-007`. |
| In-canvas "EXPLORATORY — REVIEW NEEDED" / "ASSUMPTION — PENDING APPROVAL" banners on four canvases. | `D-C-27`. |

---

## 4. Deferrals to V9

Every deferral carries an approving person and a date, as the traceability contract requires.

| Deferred | Decision | Approver / date |
|---|---|---|
| Badges | `D-C-24` | founder, 2026-08-23 |
| Persona card | `D-C-24` | founder, 2026-08-23 |
| Native Photos-library export or save (**unconditional**) | `D-C-19` | founder, 2026-08-23 |
| Automatic ranking-event Feed rows | `D-C-35` | founder, 2026-08-23 |

---

## 5. Approved requirements with missing implementation

These are **not** blocked and **not** deferred. They are approved security requirements whose
implementation does not yet exist, and they read `status: approved`, `coverage: missing`.

| ID | Work |
|---|---|
| `V8-R-STO-014` | Server-side media re-encode so EXIF/GPS metadata cannot survive, with content type verified by inspection. Mandatory. |
| `V8-R-STO-015` | Server-enforced signed-URL lifetime, so a minted URL cannot outlive the media's window or survive deletion. Mandatory. |

Missing implementation alone must **never** make an approved requirement `blocked`. The validator
enforces this: a `blocked` row must cite a **currently open** product-decision id, and there are
none.

---

## 6. Operational authorizations — **not product requirements**

| ID | Authorization |
|---|---|
| `OA-01` | Staging-only migration application is authorized. |
| `OA-02` | Staging RLS/Storage testing is authorized. |
| `OA-03` | Local V8 integration and local merges are authorized. |
| `OA-04` | Production writes and production tests remain **forbidden**. |
| `OA-05` | Push, PR, deploy, publication and TestFlight remain **forbidden**. |

---

## 7. Freezing

The ledger binds the PRD, this decision record, the delta, the design-reference README and all 16
approved canvases by SHA-256. The ledger's own digest is emitted by the validator on every run;
record that value with the approval so the whole contract is frozen by digest.

```
node scripts/check-release-contract.mjs docs/V8-TRACEABILITY-LEDGER.json
```
