# Environment variables — classification, ownership, rotation

Written 2026-07-30 for goal `g-a0fb864b`. **Names only. No values appear here, and
`scripts/check-env.mjs` is written so it can never print one either.**

The per-variable public/server split lives in `SYSTEM-INVENTORY-2026-07-30.md` and is not
repeated. This document adds the operational half: where each value comes from per
environment, who owns it, how it rotates, and what happens when it is wrong.

## The two failures worth automating against

Both are silent. Both are now caught by `scripts/check-env.mjs`.

1. **A server secret under a `NEXT_PUBLIC_` name.** Next.js compiles `NEXT_PUBLIC_*` into the
   browser bundle. `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` would publish a full RLS bypass to
   every visitor — and the app would work perfectly while doing it. Nothing about the running
   system looks wrong, which is why this needs a check rather than a code review.
2. **`LOOP_UNATTENDED` in production.** `/api/account/delete` hard-refuses with 503 while it
   is set. Users silently lose the ability to delete their accounts — invisible from the
   outside, and a compliance problem rather than a bug.

Verified working (both exit 1):

```
[CRITICAL] NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
    ... compiles the value into the browser bundle ... Remove it and ROTATE SUPABASE_SERVICE_ROLE_KEY.
[CRITICAL] LOOP_UNATTENDED
    ... /api/account/delete hard-refuses with 503 while it is set ...
```

## Source, owner, rotation

Owner is "Connor" throughout today, which is itself the finding — see the bottom.

| Variable | Local | Preview | Staging | Production | Rotation | If wrong |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | staging | staging | staging | prod | with the project | app cannot reach data |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging | staging | staging | prod | Supabase dashboard | app cannot reach data; **safe to expose** only because RLS is correct |
| `SUPABASE_SERVICE_ROLE_KEY` | staging | **absent** | staging | prod | Supabase dashboard; invalidates old immediately | **CRITICAL** — full bypass |
| `DATABASE_URL` | staging | **absent** | staging | prod | with the DB password | **CRITICAL** — full bypass + schema |
| `GOOGLE_MAPS_API_KEY` | staging key | staging key | staging key | restricted prod key | Google Cloud console | **billable abuse** |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | staging key | staging key | staging key | referrer-restricted | Google Cloud console | **billable abuse** — ships in the bundle |
| `ANALYTICS_ENABLED` / `NEXT_PUBLIC_ANALYTICS` | off | off | on | **operator (Q3)** | n/a | wrong App Privacy answer |
| `LOOP_UNATTENDED` | harness only | absent | absent | **absent** | n/a | account deletion dies silently |
| `ALLOW_GOOGLE_*_INGEST` | absent | absent | absent | absent unless a compliance decision says otherwise | n/a | compliance exposure |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | shared | shared | shared | prod pair | with the VAPID pair | push breaks |

## Running the check

```bash
node scripts/check-env.mjs --environment production   # or preview / staging / local
```

Exit 1 on anything critical or high; medium findings are advisory. It reads `process.env`
directly and does **not** load `.env.local` — that is Next.js's job — so running it bare in a
local shell reports the Supabase variables as missing. That is an artifact of invocation, not
a finding. Its homes are CI and a real deployment environment.

Suggested CI wiring (goal 10 owns the change): run it on pull requests, where a
`NEXT_PUBLIC_`-prefixed secret would be caught before it ever reaches a deployment.

## The finding this exercise produced

**Every variable has the same owner, and no rotation has ever been rehearsed.** If Connor
loses access to the Google Cloud console or the Supabase dashboard, there is no documented
second path to rotate a leaked key — and rotation is precisely what a leak demands within
minutes.

That is a bigger operational risk than any individual variable's classification, and it is
cheap to fix: a second owner on each account, plus one rehearsed rotation of a **staging**
key to prove the procedure works before it is needed on a production one.
