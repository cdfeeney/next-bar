# Staging acceptance — 2026-08-05

Run against the restored Staging surface `https://next-bar-staging.vercel.app`
(deployment `next-bar-staging-o2sekb0yw`, source `origin/main@6ec5e5d`,
database `wqxovhiovgcijmfzxgby`).

**Read-only pass. No writes were made to protected Staging** — no sign-in, no
rating, no follow, no share, no account creation. Everything below is
navigation and observation only.

## The headline result for the migration packet

Staging already has **0033–0036 applied**, and it runs **`6ec5e5d` — the exact
code Production serves**. So this pass answers the compatibility question the
packet needed: **the four migrations do not break the currently deployed
client.** Catalog, map, auth surface, rankings and friends all render normally
against a database carrying them.

What it does **not** do is rehearse the *transition*. Staging was already past
0032 before this run, so nothing here exercises the apply itself.

## Route sweep (19 routes)

17 × HTTP 200. Two 404s, both **expected and verified**, not defects:
`/search` and `/nights` do not exist at `6ec5e5d` (`git cat-file -e` confirms
absent at that commit, present on the overnight branch). Everything else —
`/`, `/install`, `/auth`, `/map`, `/rankings`, `/friends` and its three
sub-routes, `/settings`, `/join`, `/privacy`, `/terms`, `/quiz`, `/lists`,
`/discover`, `/u/[handle]` — returned 200.

## Behavioral checks (real browsers, both configured mobile viewports)

| Check | iPhone 13 (WebKit) | Pixel 7 (Chromium) |
|---|---|---|
| `/api/health` | `ok:true, supabase:"ok"` | same |
| Database identity from served bundle | `wqxovhiovgcijmfzxgby`, **412 bars** | same |
| Home, geolocation **denied** | `"Where are you?"` picker, 416 controls, catalog names visible | same |
| Home, geolocation **granted** (Midtown) | recommendation UI renders | same |
| `/map` Leaflet | boots, **412 markers** | boots, 412 markers |
| `/auth` email + password form | renders | renders |
| Age gate on first open | present | present |
| `/rankings`, `/friends` signed out | render | render |
| Console purity | 1 transient `ChunkLoadError` immediately post-deploy; **0/3 on re-test** | clean |

The 412 markers and 412 bars independently confirm this surface talks to
Staging, not Production's 1,256.

## Confirmed defect

**Unauthenticated app open shows no login window — reproduced on both
viewports.** This is the operator-reported item (a) from
`docs/CONTINUATION-2026-08-04.md` §7c, now confirmed against a live surface
rather than only reported. Tracked as goal `g-31c59158`.

## Two failures that were MY test artifacts, not product defects

Recorded so they are not mistaken for regressions later:

1. *"0 article elements on /"* — the home surface renders the picker as
   buttons, not `<article>`; my selector was wrong. With the repo's own
   `denyGeolocation` injection both engines show the picker with 416 controls
   and visible catalog names.
2. *WebKit reaching a different home state* — caused by using
   `grantPermissions([])` instead of the repo's forced-denial init script.
   `e2e/helpers/geo.ts` documents exactly this: headless denial behavior
   "varies by engine/timing" and must be forced. With the real helper, both
   engines behave identically.

## Not covered by this pass — and why

Everything below requires **writes to protected Staging** or real accounts, and
was deliberately not attempted:

- authentication actually completing a sign-in;
- ratings, follows/follow-requests, consensus/suggestions, shared-night links
  and revocation, Nights Out history;
- account deletion and account-switch isolation.

**Invited-Crew flow: INCOMPLETE, not tested — and not substituted for.** Per
`docs/MORNING-HANDOFF-2026-08-05.md` block B, the followed-circle
`get_circle_suggestions` path must not be reported as invited-Crew coverage.
Crews, invite-scoped suggestion/voting, member removal and expiry remain
unbuilt.

**Native shell items cannot be tested here at all**: safe areas, background
behavior, and scrolling on the TestFlight build are physical-device gaps, and
the overnight branch's features (`/search`, `/nights`, pins, matcher v1.1) are
not on this deployment because it serves `6ec5e5d`.

## What this unblocks

The migration packet's "verify behavior against restored Staging" condition is
**satisfied for compatibility**: `6ec5e5d` runs correctly against a database
holding 0033–0036. Remaining before a GO on `g-87cf2100` are the write-path
acceptance items above, which need an explicit decision about writing to
protected Staging.
