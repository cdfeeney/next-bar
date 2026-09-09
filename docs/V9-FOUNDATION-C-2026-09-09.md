# V9 foundation C — bounded shared-code refactor (V9-08 residual)

Goal g-faaff9f1, run nb-v9-overnight-20260908, on foundation A (`21b50d9`) and foundation B (`6011ae1`). Three
dependencies named by the queue were traced end to end; two needed a behaviour-preserving change, one did not. No
feature behaviour from V9-01..07 is implemented here. Callers are listed per slice; verification is the candidate's
stored gate evidence.

## Slice 1 — one venue popup on the map (for V9-07)

**Before.** Two popup builders in `src/components/BarMap.tsx`: the React `<Popup>` inside each `<Marker>` (name +
neighbourhood) and a DOM `textContent` popup built by `FocusBar` for map search (name + neighbourhood + price tier),
opened with `map.openPopup(L.popup()…)`. Two renderers, two content variants, and V9-07 would have had to add the
"name → photos & hours" entry twice.

**After.** One `BarPopupContent` component renders the popup (name, neighbourhood · price tier). Markers register
themselves by id (`markerRefs`); `FocusBar` flies to the bar and calls `getMarker(id)?.openPopup()` — the bar's OWN
popup. The DOM builder is gone. Callers: `FocusBar` (internal), the `bars.map` marker render (internal); external
callers of `BarMap` (`src/app/map/page.tsx`, `src/app/where-next/…` via `BarMapProps`) are unchanged — the props
contract is identical.

**Behaviour.** Marker popup gains the price tier the search popup already showed; search popup content is now
identical to the marker's. `e2e/map-interaction.spec.ts` "map search flies to the picked bar and opens its popup"
asserts `.leaflet-popup` contains the bar name — still true. Removed duplication: one DOM-building effect and one
content variant (−9 lines net in `FocusBar`).

## Slice 2 — the plan-start flow's extendable parts (for V9-05)

**Before.** `src/components/StartNightOutButton.tsx` (1,138 lines) inlined the invite loop (sequential
`inviteToNightOut` per UUID, counting failures) and the post-create outcome decision (hold the plan open vs navigate)
inside the tap handler, between ownership guards.

**After.** `src/lib/nightOutStart.ts` exports `inviteAll(supabase, planId, inviteeIds) → { invited, failed }` (same
filter, same sequential order, one call per id — now returning WHICH ids failed, which V9-05's "retry only failed
operations" needs) and `startOutcome({ refusedEdits, failedInvites, nightMoved, editsTimedOut }) → 'navigate' | 'hold'`.
The component calls both; every ownership guard and every setState stays in place and in order. Unit tests in
`src/lib/nightOutStart.test.ts`. Callers: `StartNightOutButton` only.

## Slice 3 — camera ownership: traced, no change needed

`src/components/capture/useCamera.ts` is the single `getUserMedia` caller, and `oneCameraSystem.test.ts` fails if a
second one appears. `CameraStage` consumes the hook's `status` (`idle | starting | live | denied | unavailable`) and
maps it to copy. One owner, one path, already enforced. What V9-06 needs is a *finer* status — `unavailable` currently
folds "no device", "no `getUserMedia`" and "device busy" together (`useCamera.ts:28`), and `NotReadableError` /
`OverconstrainedError` / `NotFoundError` are not distinguished (`:107-113`) — plus the missing
`NSCameraUsageDescription` in `ios/App/App/Info.plist`. Those are feature changes for the V9-06 goal, not foundation.

## Carried corrections landed here

- `docs/overnight/V9-REVIEW-FOLLOWUP-2026-09-08.md`: correction appended — its tree-identity claims describe
  `e8828f7`, not the rebased `21b50d9`; the rebased slice's certification is the goal record (goal 1 panel MEDIUM).
- `e2e/night-out.spec.ts` V9-03 listing case: `assertNoUnexpectedRest` asserted inline before the known-failure marker
  (foundation B final-panel MEDIUM); audit §5 notes that an expected failure prints as passed in the list summary.

## Not done here (owned elsewhere)

Plan-details and photos/hours captures; the font-regression root-cause bisect — both V9-11. Finer camera states and the
plist — V9-06. Owner surface for created plans — Night Out goal (V9-03).
