# Local / Preview / Staging / Production — design and setup

Written 2026-07-30 for goal `g-7c12a62f`. Design plus **operator-executable** setup steps.
Nothing here was provisioned by the agent; every step is yours to run.

## The rule everything else follows

> Production and staging must not share databases, service-role keys, users, storage buckets,
> email recipients, or any cost-bearing unrestricted credential. No raw production user data
> is ever copied into staging.

Today this rule is **violated by construction**, because staging does not exist: there is one
Supabase project, and `.env.local` on the dev machine points a developer's shell straight at
production. That is how a routine local probe wrote a real row into `public.waitlist` earlier
today — a harmless row, caught and removed, but the mechanism was "local dev has production
credentials", and next time it might not be a waitlist row.

**Standing up staging is therefore not polish. It is the control that makes every other
safety rule enforceable.**

## The four environments

| | Local | Preview | Staging | Production |
|---|---|---|---|---|
| Purpose | write code | review a PR | rehearse the real thing | serve users |
| Vercel | `next dev` | auto per-PR | protected deployment | `next-bar.app` |
| Supabase | **staging** project | **staging** project | staging project | production project |
| Service-role key | staging only | **NONE** | staging | production |
| Data | synthetic | synthetic | synthetic | real |
| Google Maps key | staging key, tight quota | staging key | staging key | production key, restricted + budget alert |
| Analytics | off | off | on (to prove the path) | operator decision (Q3) |
| Email (Brevo) | sink / catch-all | sink | sink | live sender, DKIM+SPF |

Two entries carry most of the value:

- **Local points at STAGING, not production.** This is the single change that would have
  prevented today's stray write. Production credentials should exist in exactly one place —
  Vercel's production environment store — and on no developer machine.
- **Preview gets NO service-role key.** Preview URLs are effectively public and per-PR. A
  service-role key there is a full RLS bypass reachable from a link. Preview may hold the
  staging anon key and nothing more; `api/account/delete` and `api/event` will 503 there,
  which is the correct behaviour and already how the routes are written.

## Synthetic staging data

Never a production dump. Generate:

| Table | Synthetic requirement |
|---|---|
| `auth.users` | 4–6 accounts on a domain you own; one private, one public, one with a handle, one with none |
| `profiles` | created by the `handle_new_user` trigger; set `is_private` and `shares_list_publicly` by hand to cover both |
| `bars` | the committed catalog is already synthetic-safe — it is public venue data, not user data |
| `ratings`, `pairwise_comparisons` | generated for the test accounts only |
| `follows`, `follow_requests` | at least one accepted edge and one pending request, to exercise both policies |
| `shared_nights` | one row, to exercise the bearer-token read path |
| `waitlist` | synthetic addresses only |

The follow-graph rows matter more than they look: `get_follower_count` and
`get_friend_ratings` behave differently for a private profile you follow versus one you do
not, and that difference is only testable with both edges present.

## Operator setup steps

Ordered so that nothing depends on a step that has not run yet.

### 1. Supabase staging project
1. Create a second Supabase project, named to make confusion impossible (`next-bar-staging`).
2. Apply migrations `0000`→`0035` in order via `npm run db:migrate` with `DATABASE_URL`
   pointed at **staging**. This doubles as the clean-database rehearsal that goal 1 was
   blocked on.
3. Seed the synthetic data above.
4. Record the project ref. **Do not** put its service-role key on a developer machine beyond
   the one that needs it.

### 2. Re-point local development
1. Replace `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` with the **staging** values.
2. Verify: `curl localhost:3000/api/health` should report the staging project.
3. Confirm no developer machine retains production credentials.

### 3. Vercel environments
1. Production env vars: production Supabase, production Google key, `ANALYTICS_ENABLED` per Q3.
2. Preview env vars: staging anon key and URL. **No service-role key. No `DATABASE_URL`.**
3. Confirm `LOOP_UNATTENDED` is absent from every Vercel environment — if it ever appears in
   production, account deletion hard-refuses with 503 and users silently lose that right.
4. Enable deployment protection on preview if the URLs should not be publicly reachable.

### 4. Google keys
1. Two keys: staging (tight quota) and production (HTTP-referrer restricted, quota, budget alert).
2. Verify the browser key is referrer-restricted — it ships in the bundle and is billable.
3. Confirm `ALLOW_GOOGLE_PHOTO_INGEST` / `ALLOW_GOOGLE_REVIEW_INGEST` are **unset** in
   production unless a compliance decision says otherwise.

### 5. Domain and email
1. `next-bar.app` → production; optionally `staging.next-bar.app` → staging.
2. Supabase Auth redirect allowlist per environment — a staging callback must not be valid
   for production.
3. Brevo: DKIM/SPF on the production sender; staging sends to a sink.

### 6. Prove the separation
The setup is not done until these hold:

- [ ] A write against staging is invisible in production.
- [ ] A preview deployment cannot reach production data — confirm `api/account/delete`
      returns 503 there (unconfigured), not 200.
- [ ] Production `/api/health` reports the production sha; staging reports staging's.
- [ ] No developer machine holds a production service-role key or `DATABASE_URL`.
- [ ] Rotating the staging key breaks staging and **nothing else**.

That last item is the real test of separation, and it is worth actually performing once.

## What stays UNVERIFIED until you run this

Every item above. The repository cannot prove any external state, so none of it may be
recorded as passing on the strength of this document existing.
