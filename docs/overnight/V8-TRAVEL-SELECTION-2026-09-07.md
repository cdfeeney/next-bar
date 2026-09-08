# V8-R-NXT-008 / D-C-40 — travel selections recompute the search

Goal `g-0bf20652-35f9-4613-847d-838d954c0b4e`, T1, base `6e8fab1`.

## The defect, as reproduced

The HOME surface ranks with `autoProfile`, which carries **no tags** when the
night has no applied vibe (`WhereNextFlow.tsx`). With no tags and no rating
history, `rankScore` returns the same value for every bar, so the V8 cascade
falls straight through to its last tie-breaker — exact miles. `ResultsView`
then admitted a wider pool for Worth a cab and Anywhere but ordered it by that
same tie-breaker, so every selection re-derived the identical nearest five.

Measured before the fix, on a controlled 100-bar catalog spanning the three
existing scopes (90 inside `RADIUS_WALK`, 5 in the cab band, 5 beyond
`RADIUS_CAB`):

```
WALK shown=[near-0..near-4] mode=walking  walkOnly=true  sent=[near-0..near-14]
CAB  shown=[near-0..near-4] mode=driving  walkOnly=false sent=[near-0..near-14]
ANY  shown=[near-0..near-4] mode=walking  walkOnly=false sent=[near-0..near-14]
```

Only the travel mode differed. The bars never changed.

The seeded path (`distance-open-now.spec.ts`) never showed this: it ranks on
the seed bar's own tags, so its scores vary and its chips did re-rank. That is
why the existing suite stayed green over a chip that did nothing on `/`.

## The change

One block, in `ResultsView.tsx`: for the non-nearby selections the route
candidates are ordered **band-named-by-the-chip first**, nearer bars behind
them, taste/applied-vibe order preserved inside each part.

- Bands reuse `RADIUS_WALK` / `RADIUS_CAB`. **No new threshold.**
- Broader modes stay inclusive — nearer bars remain eligible as supplements,
  so a selection whose own band is empty still answers instead of emptying the
  page. They are not exclusive rings.
- Walkable, the caps, both travel modes, `walkableOnly`, the route display,
  the map, the Places UI and the Photos & hours button are untouched.

### Reading of D-C-40 this implements

The delta requires "changed result IDs with controlled data where the intended
pool differs". Under the PRD cascade alone that is unreachable: nested
inclusive pools plus closest-band-first must return the same five whenever the
closest band can fill the page. The delta resolves that by fiat, so the chip
has to name which band the cascade fills from first. The alternative —
exclusive rings via `minMilesExclusive` — contradicts the recorded decision
that broader modes include nearby bars, so it was not taken.

## Late prior-selection responses

`useTravelRoutes` already carried two independent guards (the per-effect
`current` flag and the `state.key === key` check). **Neither was changed.**
They are redundant — removing either alone changes nothing observable, which
is why a single-mutation probe cannot prove a test that covers them. Removing
**both** fails the new tests, which is the proof recorded below.

## Evidence

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| Vitest, targeted (3 files) | 10 passed |
| Playwright release, `distance-routes.spec.ts` | 14 passed, both viewports, 0 retries |
| Playwright release, 4 chip-related specs | 30 pre-existing passed, no regression |

Negative proofs (each snapshotted outside the repo, restored byte-for-byte,
SHA-256 verified — no `git checkout`/`restore`/`reset`/`stash` used):

- Fix reverted in `ResultsView.tsx` → the new e2e fails on **both** viewports
  with "Worth a cab" showing `1. Near 0 … 5. Near 4`, i.e. the reported bug.
- `useTravelRoutes` guards removed one at a time → tests still pass (they are
  redundant). Removed **together** → 2 tests fail, including the new one.

## Limits

- Route provider traffic is mocked in every test here; no live openrouteservice
  call was made and no provider key was used.
- The full Vitest suite result is recorded with the frozen candidate, not here.
- Badge behaviour (V8-R-NXT-009 / D-C-41) is deliberately untouched; it is the
  next ordered goal.
