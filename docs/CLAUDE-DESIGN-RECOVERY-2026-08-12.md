# Claude Design recovery — 2026-08-12

## Source

- Project: [Next Bar Social UX project](https://claude.ai/design/p/e0e31f0b-bdc1-4029-9e4c-666be9ea95cc)
- Project ID: `e0e31f0b-bdc1-4029-9e4c-666be9ea95cc`
- Evidence: connected Claude Design MCP `list_projects`, `get_project`, `list_files`, `list_comments`, and `read_file` responses.
- Inventory: 25 files, no comments, and no file or project named V8/version 8. The recovered work uses V1 and feature names.
- Local visual index: `docs/design-reference/README.md`; 13 approved/canonical screenshots are preserved under `docs/design-reference/approved/`.

## Locked system

- Navigation: exactly `Map / Rankings / Next Bar? / Social / Account`; no sixth tab.
- Next Bar?: `next-bar-five-bars-typography-refinement.dc.html`; exactly five ranked photo-led bars, `Your next 5 bars`, `Tweak my vibe`, and the `Walkable / Worth a cab / Anywhere` rail.
- Map: `next-bar-map-v1.dc.html`; full dark map, compact overlays, blue user dot, coral outline ranked markers, grey other markers, and Apply-gated filters.
- Rankings: `next-bar-rankings-numeric-lists.dc.html`; one 1.0–10.0 score, aggregate Best Bars, reusable custom lists, and no public counts.
- Shared lightbox: `next-bar-lightbox-refinement.dc.html`.
- Social and Nights Out: `next-bar-social-v2-core.dc.html`, `next-bar-night-out-start-flow.dc.html`, `next-bar-option-b-manual-pin.dc.html`, and `next-bar-add-story-flow.dc.html`.
- Share and camera: `next-bar-share-destinations-v2.dc.html`, `next-bar-story-tag-placement.dc.html`, and `next-bar-camera-modes.dc.html`.
- Account: `next-bar-account-a-tabs.dc.html` and `next-bar-account-a-settings.dc.html`.
- Visual tokens: `#0A0A0A` background, `#141414` surfaces, `#2A2A2A` borders, `#FF5B3A` coral, `#F5F5F0` text, `#8A8A85` muted; rounded Poppins-like sans, outline icons, 44–48px minimum targets, 390x844 safe-area frames, and state never conveyed by color alone.

## Rejected or deferred

- `next-bar-decision-a-plus-flow.dc.html` is rejected/discarded.
- `next-bar-social-v2-flows.dc.html` contains partially superseded historical work.
- `Night editor` and `Route after dark` are audit hypotheses, not canonical Claude Design directions.
- Deferred: friend-likes-this-bar proof, cross-tab journeys, complete empty/error/permission/moderation/lifecycle states, and final accessibility/consistency review.
- Signup/onboarding has no approved canvas in the recovered project and remains new design work.

## Execution result

A read-only Claude session recovered the project and decisions. A bounded follow-up attempted to create only `next-bar-five-bars-states-v1.dc.html` and render it. The first request was malformed; the corrected request was rejected because Claude Design requires a `plan_token` from `finalize_plan`. No design file, preview, application code, or deployment changed.

## Next action

Use a native Claude Design plan/finalize/write cycle to create one exploratory canvas for Next Bar? loading, zero-results, and location-permission-denied states from the approved Home. Render it, then run the five-second usability pass without reopening the locked navigation or visual system.
