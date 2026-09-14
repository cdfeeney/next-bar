# Social redesign — wave 1 goals (run nb-social-20260914)

Design source: `README.md` in this folder (owner's Claude Design handoff, 1c plan-led). Prototype: `SocialPhone.dc.html`
(variant `c` is the chosen direction). Locked: three sub-tabs, five-tab bottom bar, manual presence.

| Goal | Implements | Files |
|---|---|---|
| S-01 header icons + `/friends/people` | README §1.1, §10 | `friends/page.tsx` (header), `_components/GroupsAndPeople.tsx`, `friends/people/page.tsx` |
| S-02 Tonight body | README §1.2–1.4, §1.6 | `friends/page.tsx` (body), `YourPlanTonight.tsx`, `TonightPresence.tsx` (render), `story/StoriesRail.tsx` |
| S-03 Plans tab | README §2 | `PlansSection.tsx`, new `InvitedPlans.tsx`, `nights/_components/EarlierNights.tsx` |
| S-04 Feed + reply thread | README §3, Interactions › Reply thread | `FeedSection.tsx`, `FeedComments.tsx` |
| S-05 You tonight + pin sequence | README §4, §5, Interactions › Presence | `friends/tonight/page.tsx`, `PresenceControls.tsx`, `lib/presence/PinDialogs.tsx` |

Wave 2 (plan flows: create form + cover, board, recap, follower lists) and wave 3 (photo flow) follow.

## Owner decisions that supersede the README

- **2026-09-13 — no status row on Tonight.** README §1.5 describes a "Your status row" under the plan card. The owner
  decided against it: "You tonight" is reached only through the header pin icon (→ `/friends/tonight`). The prototype's
  variant `c` already renders Tonight without the row; treat §1.5 as withdrawn.
- **2026-09-13 — cover photo is in scope (wave 2, S-06b):** bundled template covers plus "choose from library"; one
  additive `night_outs.cover` column on staging.
- **2026-09-13 — pushed screens are routes** (`/friends/people`, `/friends/tonight`), not in-page sheets.
- The README's "no group thread screen" gap is wrong: `friends/_components/GroupThread.tsx` exists; unread badges route there.
