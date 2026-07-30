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
| Photo permission grants | `photo_permissions.granted_by_user_id` | **survives**, anonymised to `null` |

Third-party SDKs collecting data: **none.** No analytics, ad or error-tracking SDK is
installed. That makes the App Privacy answer for third-party collection straightforwardly
"none" — and is simultaneously why goal 11 exists.

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
| Q2 | Should anonymised `photo_permissions.granted_by_user_id = null` rows survive deletion? | Defensible as a licence audit trail — the grant is a legal record, not user content — but it must be *stated*, since "we delete everything" would then be untrue. |
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

| Category | Collected | Linked | Tracking |
|---|---|---|---|
| Contact info (email) | yes | yes | no |
| User content (ratings, lists, shared nights) | yes | yes | no |
| Identifiers (user id, handle) | yes | yes | no |
| Location (coarse + precise, while-using) | yes | yes | no |
| Usage data | **depends on Q3** | — | no |
| Diagnostics | **no today** — changes the moment an error tracker is added (goal 11) | — | no |

Two of those rows move if a decision lands: Q3 for usage data, and adding any error tracker
flips diagnostics to yes. Both need re-checking immediately before submission.

## Not done here

- No live deletion was executed.
- No production data was read.
- No answer was submitted.
- Q1 and Q3 remain open and continue to block submission.
