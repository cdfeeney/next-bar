# Next Bar approved design reference

Source of truth: Claude Design project [`Next Bar Social UX project`](https://claude.ai/design/p/e0e31f0b-bdc1-4029-9e4c-666be9ea95cc), classified by `next-bar-approved-decisions.md` on 2026-08-12.

## Approved/canonical screenshots

All captures are in [`approved/`](approved/):

- `next-bar-five-bars-typography-refinement.png` — Next Bar? Home
- `next-bar-map-v1.png` — Map
- `next-bar-rankings-numeric-lists.png` — Rankings
- `next-bar-lightbox-refinement.png` — shared bar lightbox
- `next-bar-social-v2-core.png` — Social core
- `next-bar-night-out-start-flow.png` — start a Night Out
- `next-bar-option-b-manual-pin.png` — manual venue pin
- `next-bar-add-story-flow.png` — add Story
- `next-bar-story-tag-placement.png` — Story tags
- `next-bar-share-destinations-v2.png` — share destinations
- `next-bar-account-a-tabs.png` — Account tabs
- `next-bar-account-a-settings.png` — Account settings
- `next-bar-camera-modes.png` — camera modes
- `next-bar-onboarding-v1.png` — signup / onboarding
- `next-bar-night-out-invite-recipient-v1.png` — Night Out invite recipient
- `next-bar-operational-states-v1.png` — operational states

## Do not use as approved input

- Rejected: `next-bar-decision-a-plus-flow.dc.html`.
- Superseded/partial: `next-bar-social-v2-flows.dc.html` and `next-bar-share-destinations.dc.html`.
- Direction studies only: `next-bar-mobile-directions*`, `next-bar-social-mece.dc.html`, `next-bar-account-directions.dc.html`, and `next-bar-decision-directions.dc.html`.
- The missing-states draft was never written to Claude Design and is not approved. It is NOT the operational-states canvas, which was written to Claude Design and was approved on 2026-08-21.

## Design gaps

- Remaining deferred work: cross-tab journeys, social proof decision, and final accessibility/consistency review.

## Founder approval — 2026-08-21

The three formerly-exploratory canvases were **approved by the founder on
2026-08-21** and moved from `exploratory/` into `approved/`. They are now
canonical implementation input on the same footing as the original thirteen.
`exploratory/` is empty; there is no longer a review-pending tier.

- [Onboarding canvas](https://claude.ai/design/p/e0e31f0b-bdc1-4029-9e4c-666be9ea95cc?file=next-bar-onboarding-v1.dc.html) — capture: [`approved/next-bar-onboarding-v1.png`](approved/next-bar-onboarding-v1.png)
- [Night Out invite-recipient canvas](https://claude.ai/design/p/e0e31f0b-bdc1-4029-9e4c-666be9ea95cc?file=next-bar-night-out-invite-recipient-v1.dc.html) — capture: [`approved/next-bar-night-out-invite-recipient-v1.png`](approved/next-bar-night-out-invite-recipient-v1.png)
- [Operational-states canvas](https://claude.ai/design/p/e0e31f0b-bdc1-4029-9e4c-666be9ea95cc?file=next-bar-operational-states-v1.dc.html) — capture: [`approved/next-bar-operational-states-v1.png`](approved/next-bar-operational-states-v1.png)

Two carried caveats survive the approval — approving the **visuals** did not
approve a capability:

- The onboarding canvas intentionally omits mandatory gender. That omission is
  approved; do not add a gender field back.
- Apple, Google, and phone authentication appear as target capabilities. They
  are **not** approved for implementation in V8 — the repository implements
  email/password only, and that remains the V8 auth path. Build the approved
  onboarding visuals against email/password; do not add a third-party auth
  provider on the strength of this screenshot.
