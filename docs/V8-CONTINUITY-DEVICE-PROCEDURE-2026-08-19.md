# V7 → V8 continuity: coverage map and attended device procedure

Date: 2026-08-19. Scope: the P0 "account and release continuity" section of
`docs/V8-PRD-2026-08-13.md`, which names six items of required retained state —
**authentication, Bar 54, named lists, numeric scores including ties, night
history, and shared-night state.**

This document answers two questions the PRD leaves open: which of the six a test
actually proves, and — for the part no offline fixture can reach — exactly what
the operator does on a real device instead. It does not restate the storage
inventory or the server ownership rules; those live in
`docs/V8-DATA-CONTINUITY-2026-08-14.md` and remain the contract of record.

## Baseline before this pass

`e2e/v7-continuity.spec.ts` already existed with three tests. Run verbatim on
this branch, in release mode, before any change:

```
$ npm run test:e2e -- e2e/v7-continuity.spec.ts
[e2e] PLAYWRIGHT_RELEASE=1 PLAYWRIGHT_PORT=58986 playwright test e2e/v7-continuity.spec.ts
Running 6 tests using 3 workers
  ok 1 [iPhone 13] › every V7 key survives a force-close and reopen; the session-scoped flag does not (2.8s)
  ok 3 [iPhone 13] › V7 Bar 54, tied scores, lists, vibe profile, and night history survive navigation and reload (3.2s)
  ok 5 [Pixel 7] › every V7 key survives a force-close and reopen; the session-scoped flag does not (1.1s)
  ok 4 [Pixel 7] › V7 Bar 54, tied scores, lists, vibe profile, and night history survive navigation and reload (1.7s)
  ok 2 [iPhone 13] › the shared-night surface never writes to V7 local storage (7.9s)
  ok 6 [Pixel 7] › the shared-night surface never writes to V7 local storage (6.2s)
  6 passed (1.2m)
```

Green, and green for a narrower property than the PRD asks for. The three tests
assert on **storage**: that every inventoried `next-bar:` key is byte-identical
after navigation, reload and a force-close/reopen. That is a real and valuable
property, but "the key still holds `bar-54`" is not "the user still sees Bar 54",
and the distance between those two is where this pass found its work.

## The gap the baseline could not see

`/rankings` renders a rated bar only when `getBarById` resolves it, and the
runtime catalog is the Supabase `bars` table fetched after hydration by
`CatalogRefresh`. The bundled fallback is the ~39-bar emergency core, which does
**not** contain Bar 54. The baseline spec configures no catalog stub, so it ran
against whatever catalog the environment happened to supply, and its only Bar 54
assertion read `localStorage` directly — the one assertion that cannot fail for a
rendering reason.

The new tests pin the catalog (`e2e/helpers/catalogTest`) so a Bar 54 assertion
can only fail for a continuity reason, never because a remote table was slow or
short. The first run of that assertion failed — and the cause was a product
defect, not the test.

## The defects this found, and the fixes

Both are the same root cause on two different surfaces: a component reads the
bar catalog through `getBarById`, which returns the module-level catalog that
`CatalogRefresh` replaces *after* hydration — and the component does not
recompute when that swap lands. Every rated or shared bar outside the ~39-bar
emergency fallback then renders as absent. The rating and the row were never
lost; only the render was, which is exactly why storage-only assertions could
not see it, and why the user-visible symptom is indistinguishable from data loss.

Both are load-order dependent, so both presented as browser differences: measured
on this branch, WebKit (iPhone 13) sometimes swapped early enough to hide them,
Chromium (Pixel 7) did not.

### 1. Rankings dropped Bar 54 — `src/app/rankings/page.tsx`

The ranked list was built in a `useMemo` keyed on
`[ratings]`. The page *did* subscribe (`useBars()`), so the swap re-rendered it —
but with `[ratings]` as the only dependency the memo never recomputed, and the
list stayed frozen against the emergency fallback.

Consequence on the exact path this goal protects: after a V7→V8 upgrade, every
rated bar outside the emergency core — **Bar 54 among them, which the PRD names
as required retained state** — silently disappeared from Rankings whenever the
catalog swap landed after the ratings hydrate. Reproduced 3/3 on Pixel 7 with the
catalog response served and valid.

Fix: capture the subscription value and add it to the memo's dependencies
(`}, [ratings, catalog]`). Two lines, no behavior added.

### 2. A shared night dropped stops — `src/app/u/[handle]/night/[shareId]/page.tsx`

The route and the loved bar are resolved with `getBarById` in the render body,
and this page called **no** `useBars()` at all, so the catalog swap did not
re-render it. A shared night containing any bar outside the emergency core
rendered with those stops missing and, if the loved bar was one of them, with no
loved bar. Observed: a three-stop V7 night rendered as `@conor_f · 2 stops`, Bar
54 absent, on both viewports.

Shared-night state is one of the six PRD required-retained items, so this is on
the continuity path, not adjacent to it.

Fix: one `useBars()` subscription. `bars` and `loved` are already computed in the
render body, so a re-render is all that was missing.

### Same shape, not fixed here

`src/app/friends/consensus/page.tsx` calls `useBars()` without capturing it and
derives `groupFavorites` in a `useMemo` from `barById(...)`. That is the rankings
defect's shape. Group Favorites is not on the continuity path and belongs to
another lane, so this change does not touch it — but whoever owns that surface
should check it.

## Coverage map — one row per PRD item

| PRD required retained state | Proven? | Test |
| --- | --- | --- |
| **Authentication** | Yes, for the device half | `e2e/v7-continuity.spec.ts` → *signing back in to the SAME V7 account keeps every V7 key and everything it renders*. The install-over does not end signed-out; it ends with the user signing back in, and that path runs `guardAgainstForeignCache`, `writeCacheOwner` and the ratings import — each able to delete local rows. The session is a stubbed `sb-<ref>-auth-token` cookie carrying the fixture's own user id, so what is under test is the device's behavior on sign-in. **Not proven:** that a real V7 refresh token still authenticates against the live project — server-side, attended (procedure below, steps 2 and 4). |
| **Bar 54** | Yes | `e2e/v7-continuity.spec.ts` → *Bar 54 renders by name with its own score…* (rendered, not merely stored), and the same signed in via the authentication test above. Storage-level survival additionally by the pre-existing *V7 Bar 54, tied scores…* test. |
| **Named lists** | Yes | `e2e/v7-continuity.spec.ts` → *V7 Bar 54, tied scores, lists…* (navigation + reload) and *every V7 key survives a force-close and reopen* (reopened tab), both asserting the list renders as `V7 favorites 3 bars`; signed in, by the authentication test above. |
| **Numeric scores including ties** | Yes | `e2e/v7-continuity.spec.ts` → *Bar 54 renders by name with its own score, and the tied pair keeps its order across a reload*. The pre-existing tests assert `toHaveCount(2)` on the 8.8 label, which passes just as happily if the two tied bars swap places on every reload, or if one is dropped and a different 8.8 bar takes its place. The new test captures the whole ordered list — position, name and score per row — and requires it to be **identical** after a reload. Local↔server tie preservation is separately proven by `src/lib/tiePreservation.test.ts`. |
| **Night history** | Yes | `e2e/v7-continuity.spec.ts` → *night history keeps every V7 stop, Bar 54 included*. Asserts the stop **count** (3) as well as the names; the pre-existing recap assertion named two of the three bars, so a dropped visit could not fail it. |
| **Shared-night state** | Partly | Negative half (pre-existing): *the shared-night surface never writes to V7 local storage*. Positive half (new): *a V7 shared night still renders after the upgrade, and viewing it changes no V7 key* — the `get_shared_night` RPC is stubbed, as in `e2e/night-page.spec.ts`, because the row and its bearer token are server state. **Not proven:** that the user's real pre-upgrade `shared_nights` row and token still resolve against the live project — attended (procedure below, step 6). |

Two rows end in "not proven", and both for the same reason: they are server
state, and a fixture that stubs the server proves the client's half only. Neither
is automatable here without pointing a test at a live project holding a real
pre-upgrade account, which is a release action, not a test.

## Attended device procedure — the V7 → V8 install-over

The part that is not automated, written out so it can be executed rather than
approximated. It elaborates the checklist line "Force-close/reopen and confirm
sign-in, Bar 54, lists, and numeric scores" in
`docs/V7-FINAL-BASELINE-2026-08-13.md`. Tester 1 / Conor Feeney, on a device that
already runs V7 with real data. Do **not** clear site data, reinstall from
scratch, or use a fresh profile at any point — an install-over that begins on a
clean device proves nothing.

**Step 0 — record the "before", or the rest of this is unfalsifiable.**
On the V7 install, before touching anything, capture:

- a screenshot of `/rankings` scrolled to show Bar 54, its numeric score, and the
  bars immediately above and below it;
- a screenshot of `/lists` showing every named list with its bar count;
- a screenshot of the morning-after recap on `/` showing the stop count and the
  bars in order;
- the share URL of one shared night (`/u/<handle>/night/<token>`), copied out;
- the signed-in email shown on `/settings`.

Write the observed values down as text as well. A screenshot proves what was on
screen; the written list is what step 5 compares against without re-reading
pixels.

**Step 1 — install V8 over V7.** Update in place. Do not uninstall first.

**Step 2 — first open, still signed in.** Open the app. Do not sign out.
Expected: it opens signed in as the same account, and `/settings` shows the same
email as step 0. A sign-in screen here is a **FAIL** — record it and stop, because
everything after it would be testing a fresh account rather than an upgrade.

**Step 3 — force-close and reopen.** Fully close the app (swipe it out of the task
switcher, not merely background it) and reopen. Expected: still signed in, and
`/rankings` still lists the same bars.

**Step 4 — authentication, the half no fixture can prove.** Sign out
deliberately, then sign back in with the same email and password. Expected:
sign-in succeeds, and `/rankings`, `/lists` and the recap show the SAME values as
step 0. Data disappearing here means the sign-in guard read the device as
belonging to a different account — record which surfaces emptied.

**Step 5 — compare against step 0, item by item.** Take the same five captures
and diff them against the written list:

- Bar 54 present, with the **same numeric score**, in the same position;
- every named list present, same name, same bar count;
- the tied pair (any two bars sharing a score) still tied, and still in the same
  order relative to each other;
- the recap stop count and bar order unchanged.

A changed *order* with unchanged values is still a FAIL for the tie item. It is
the specific defect the automated tie test exists to catch, and the device run is
the only place the user's real ranking is exercised.

**Step 6 — shared-night state.** Open the share URL copied in step 0 in a browser
that is **not** signed in (a private window). Expected: the night still renders
with the same handle, date, stop count and bars — the upgrade did not invalidate
the token. Then return to the app and confirm the local night history from step 5
is still the device's own night, unchanged by the visit.

**Step 7 — record the result.** Note the build/commit tested, the device and OS
version, and a pass/fail per item against the six PRD names. A run that does not
say which of the six it checked is not a continuity run.

## What this document deliberately does not claim

- It does not claim the automated tests exercise a real Supabase project. Every
  server call in `e2e/v7-continuity.spec.ts` is stubbed at the browser boundary.
- It does not claim the physical install-over has been performed. Steps 0–7 are
  the procedure; executing them is attended work outside this change.
- It does not re-derive the storage inventory or the ownership and conflict
  rules. `docs/V8-DATA-CONTINUITY-2026-08-14.md` owns those.
