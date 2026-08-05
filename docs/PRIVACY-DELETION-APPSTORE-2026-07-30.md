# Privacy, deletion and App Store declarations

Written 2026-07-30 for goal `g-375d4ce0`. Reconciles shipped behaviour against the
authoritative inventory and surfaces every operator decision. **No live deletion was
performed and no production data was read.**

`docs/APP-PRIVACY-LABELS-2026-07-30.md` remains authoritative for the label inventory itself;
`APP-STORE-PLAN.md` now points at it rather than keeping a competing copy.

## What the code actually collects

| Data | Where | Deletion path |
|---|---|---|
| Email | `auth.users` | **yes** — `api/account/delete` cascades |
| Handle, display name, privacy flags | `profiles` | **yes** — cascade from `auth.users` (0001) |
| Ratings, comparisons | `ratings`, `pairwise_comparisons` | **yes** — cascade |
| Follows, requests | `follows`, `follow_requests` | **yes** — cascade |
| Vibe profile | `vibe_profiles` (**unapplied**) | **yes** — `on delete cascade`, plus an owner-delete policy for the Settings button |
| Shared nights | `shared_nights` | **yes** — cascade |
| Push subscriptions | `push_subscriptions` | **yes** — cascade |
| Waitlist email | `public.waitlist` | **NO PATH — this is the blocker** |
| Photo permission grants | `photo_permissions` | **schema only — NOT collected today.** See the blocker below; the previous "survives, anonymised to null" was wrong twice over. |

Third-party **SDKs** collecting data: **none.** No analytics, ad or error-tracking SDK is
installed — and that is why goal 11 exists.

> **But "no third-party SDK" is NOT the same as "no third-party disclosure", and the earlier
> wording conflated them.** Corrected 2026-07-31.
>
> `BarMap.tsx:245` loads basemap tiles from `basemaps.cartocdn.com`, and the map centres on
> `userCoords` whenever location has been granted (`:191`). So **CARTO receives tile
> coordinates revealing the user's approximate area, plus their IP** — no SDK required, and no
> code of ours "collects" it, but data about the user does reach a third party as a direct
> result of using the app.
>
> Whether that requires disclosure is a **judgement for the authoritative document**
> (`APP-PRIVACY-LABELS-2026-07-30.md` §1/§4), not something to answer twice. What must not
> happen is this file asserting a flat "none" that a reviewer could read as "no user data
> reaches any third party." It also raises the CARTO-terms item already listed below.

> ### 🚨 SCHEMA BUG — account deletion FAILS for a user referenced by a photo_permissions row
>
> Found by the review panel 2026-07-31, verified in
> `supabase/migrations/0020_provenance_and_media.sql`. **This is a code defect, not a
> documentation problem, and it needs a migration to fix.**
>
> - Line 72: `granted_by_user_id uuid references public.profiles(id) **on delete set null**`
> - Lines 90-93: a trigger `before update **or delete** on public.photo_permissions` running
>   `photo_permissions_immutable()`, which **always raises** ("append-only: rights records
>   must survive takedown").
>
> `ON DELETE SET NULL` performs an **UPDATE** on the referencing row. The append-only trigger
> rejects that UPDATE. So deleting a profile whose id appears in a row's `granted_by_user_id`
> raises, **the whole deletion transaction rolls back**, and `POST /api/account/delete` returns
> 500. Every other cascade in the table above is rolled back with it.
>
> **Precise trigger condition:** only a profile referenced by some row's **non-null** `granted_by_user_id` is affected. A row whose `granted_by_user_id` is already null, or points at a different user, causes no FK update and blocks nothing — so this is not "any row exists". **Why it has not bitten yet:** nothing writes to `photo_permissions` — `grep -rn
> "photo_permissions" src/ scripts/` returns **zero** hits outside the migration. The table is
> schema-only. The bug is therefore **latent, and it arms itself the moment the photo-rights
> feature ships.**
>
> Two requirements collide here and the collision is the real decision: rights records must
> survive a takedown (why the trigger exists), and a deleted user's link must be severed (why
> the FK is SET NULL). **An operator must choose** — e.g. let the trigger permit a
> `granted_by_user_id`-only nulling, or make the FK `ON DELETE NO ACTION` and sever the link
> some other way. Not fixable from this documentation goal: it needs a migration, which is T0
> and attended.
>
> **A second, separate disclosure problem:** even if the nulling worked, calling the surviving
> row "anonymised" would be false. `granted_by text **not null**` (line 71) and `evidence_url`
> remain and can name or re-identify the grantor. Any future declaration must disclose those
> retained fields, or the deletion path must clear them too.

## Deletion verified by reading, not by running

`api/account/delete` was reviewed and is covered by tests (`route.test.ts`). The properties
that matter for a privacy claim:

- The deletion target is **never** taken from the request body. It is the user id extracted
  from a verified Bearer token — pinned by an adversarial test that supplies
  `{userId, id}` in the body and asserts the verified id still wins.
- Deleting `auth.users` cascades through `profiles` into ratings, comparisons, follows and
  requests, so one call removes the graph.
- **`LOOP_UNATTENDED` hard-refuses the route with 503.** If that variable ever reaches
  production, users silently lose their deletion right. `scripts/check-env.mjs` now flags it
  as CRITICAL, and this is the single strongest reason that check exists.

## The two submission blockers

### Q1 — `public.waitlist` has no deletion path

It lives only in `supabase/schema.sql`, has no `user_id`, no cascade, and is not touched by
`api/account/delete`. A person who joined the waitlist and later asked to be forgotten cannot
be, except by hand.

This is not theoretical: removing today's stray probe row required raw SQL against
production, which is exactly the manual process a retention policy exists to avoid.

> **Decide one:** (a) add a deletion endpoint or a documented manual process with an owner;
> (b) set a retention window and delete on a schedule; (c) declare it out of scope because
> the addresses are never linked to an account — which must then be *true*, and stated in the
> privacy policy.

### Q3 — production analytics status is unknown

`ANALYTICS_ENABLED` gates the server route; `NEXT_PUBLIC_ANALYTICS` gates the client. If both
are off in production, **"Usage Data collected" is the wrong answer to Apple** and the label
must say so.

`check-env.mjs` now flags the flags disagreeing, because a half-on configuration makes the
question unanswerable rather than merely unanswered.

> **Confirm the production values, then answer accordingly.**

## Remaining operator decisions

| # | Decision | Consequence |
|---|---|---|
| Q2 | **Rewritten 2026-07-31.** Should `photo_permissions` rows survive deletion — and **how**, given the append-only trigger currently makes the FK's `SET NULL` raise and fail the whole deletion? See the schema-bug box above. | Two legitimate requirements collide: rights records must survive a takedown, and a deleted user's link must be severed. Whatever is chosen needs a **migration** (T0, attended). Also note "anonymised" is not achievable by nulling alone — `granted_by` (NOT NULL) and `evidence_url` survive and can re-identify. |
| — | **Location retention: nothing to decide, and that is the answer.** Device location is used while-using and **never persisted** — verified in `useGeolocation` and against every `lat`/`lng` column in the schema (all venue-catalog, none user-scoped). Recorded explicitly so a future reader does not assume the decision was simply forgotten. | If any feature ever persists a user coordinate (e.g. geo-tagged night-out photos, Q4), this stops being a non-decision and the App Privacy answer for Location must change in the same commit. |
| Q4 | Night-out photo storage/retention | Gates B8. Geo-tagged photos are the most sensitive data the product would hold. |
| — | Log retention | Vercel/Supabase defaults apply until chosen. |
| — | Supabase region / data residency | Affects the privacy policy. |
| — | Backup retention | A backup holding deleted user data past the deletion promise is a real inconsistency. |
| — | CARTO basemap terms | Map tiles are third-party; the terms need reading before launch. |

The backup point deserves emphasis: if backups retain data for 30 days, then "deleted
immediately" is false, and the honest phrasing is deletion from live systems within X and
from backups within Y.

## Draft App Privacy answers

To be confirmed against production, not submitted from this document.

**There is no answer table here. It lives in exactly one place:
`docs/APP-PRIVACY-LABELS-2026-07-30.md` §1. Read it there.**

This section used to restate it. That copy had already drifted from the source — most
seriously by declaring precise Location as collected **and** linked, which is false and would
have certified to Apple that this app stores and links user location. It does not.

**Do not re-create the table here, not even "for convenience", and not even annotated.** Two
answer sets in two files is how the drift happened; a corrected second copy is still a second
copy. The details of what drifted are recorded in the goal's completion evidence and in the
commit message, deliberately **not** in this file, so that nothing here can be mistaken for a
declaration.

## Not done here

- No live deletion was executed.
- No production data was read.
- No answer was submitted.
- Q1 and Q3 remain open and continue to block submission.
