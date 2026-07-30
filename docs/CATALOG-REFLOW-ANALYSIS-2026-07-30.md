# `/` async catalog reflow — refined analysis and the decision it needs

Written 2026-07-30 during the overnight run for goal `g-90f908bc`. **No code changed.**
This item is blocked on a product decision, per the run's rule against guessing one.

## Correction to the recorded fix direction

`docs/CONTINUATION-2026-07-30.md` suggests the fix is to "preserve scroll anchoring across
the catalog swap, or settle the catalog before first paint". Having read the spec, the first
of those **cannot make this test pass**, and implementing it would burn a cycle for nothing.

`e2e/mobile-controls.spec.ts` pass 2 does this:

```js
for (const el of scrollables) el.scrollTop = el.scrollHeight;
window.scrollTo(0, document.body.scrollHeight);
await page.waitForTimeout(500);
// then: assert no control is covered by the fixed BottomNav
```

It drives the scroller to `scrollHeight` and asserts **at that resting position**. Scroll
anchoring preserves the user's position *relative to content* while content is inserted. That
is exactly the wrong property here: the container keeps growing, so a scroller that was at
the bottom is, after anchoring, no longer at the bottom — a mid-list row ends up under the
nav and the assertion still fails. Anchoring fixes the *feel* of the bug without fixing the
*test*, and the test is measuring something real.

The only thing that makes pass 2 pass is that **the catalog stops growing before pass 2
scrolls**.

## Why it grows

- `src/components/CatalogRefresh.tsx` fetches `bars` **after hydration** (deliberately — a
  pre-hydration swap makes SSR/browser snapshots mismatch), paginating at 1,000 rows because
  PostgREST silently caps responses.
- It then calls `replaceCatalog`, which notifies every `useBars` subscriber via
  `useSyncExternalStore`.
- `src/components/BarPicker.tsx` groups by a fixed `NEIGHBORHOOD_ORDER` and sorts
  alphabetically *within* each group, so new bars are inserted **throughout** the list rather
  than appended.
- The spec waits 1,000 ms before pass 1 and 500 ms after the pass-2 scroll. In a dev-server
  cold compile the paginated fetch routinely finishes outside that window.

## The three candidate fixes, and why each is a decision rather than a detail

| # | Fix | Makes pass 2 pass | Cost |
|---|---|---|---|
| A | Block the list render until the fetch resolves (settle before paint) | yes | Introduces a loading state on the app's primary surface. `src/lib/useBars.ts` documents "no loading flash today" as a deliberate property. |
| B | Server-render the catalog (RSC fetch) so there is no client swap at all | yes | Architecturally the cleanest — removes the reflow entirely rather than hiding it — but it is a real refactor of `/` and changes caching/perf characteristics. |
| C | Apply `replaceCatalog` only when the scroller is at rest at the top; otherwise defer until it returns to the top | yes, in both timing orders | Smallest diff and it fixes the actual user-facing defect (content never moves under a scrolling finger). But it means a user who is mid-scroll sees a stale catalog until they scroll back up — a freshness/UX tradeoff. |

**C is my recommendation.** It is the only option that fixes the user-visible bug *as
described* — rows changing identity under the finger — rather than fixing the symptom the
test measures. It also passes regardless of whether the fetch resolves before or after the
spec's scroll, because in the "after" case the swap is simply deferred while scrolled. A
follows the letter of the diagnosis but degrades first paint on the main surface; B is right
long-term but is not an overnight-safe refactor of the app's primary route.

## Why this is blocked rather than implemented

All three change product behaviour on `/`:

- A adds a loading state where the code deliberately has none.
- B changes the rendering model of the primary surface.
- C changes when users see fresh catalog data.

The overnight protocol forbids guessing a product decision, so the item stops here with the
question stated. A fourth option — relaxing the spec so its bottom-scroll settles before
asserting — is explicitly gated on operator approval by the goal spec and was not taken.

## The question for the operator

> Catalog freshness versus scroll stability on `/`: may the server-catalog swap be deferred
> while the user is scrolled (option C), accepting that a mid-scroll user keeps the static
> bundle catalog until they return to the top?

Answer that and the implementation is small and testable: a scroll-position check in
`CatalogRefresh` before `replaceCatalog`, plus a listener that applies the pending swap on
return to top, with a focused unit test in the existing `CatalogRefresh.test.tsx`.

## Status of the three failures

Still failing, unchanged, on iPhone 13 / Pixel 7 / iPhone 17. Nothing in this run touched
`e2e/` or the render path. The bug remains user-visible and is the only item in this queue
with a user-facing defect attached.
