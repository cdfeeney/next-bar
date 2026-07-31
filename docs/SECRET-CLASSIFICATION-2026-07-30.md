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
| `G4_DUMP` | harness only | absent | absent | **absent** | n/a | diagnostic dump flag, read only by a debug script — no user-facing consequence, but it is harness-only and `checkEnv` treats it as such |
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

**Now wired, in two places, because a check nothing must run is not validation:**

1. `.github/workflows/ci.yml` runs it on every push/PR — deliberately WITHOUT
   `--environment production`. CI holds no Supabase variables (the build is dual-mode), so
   forcing the production profile there fails every run on values that are correctly absent.
   *This was verified by running it: it exited 1.* Without the flag it derives from
   `VERCEL_ENV`, falls back to `local`, and still catches the dangerous class — a server
   secret mirrored under a `NEXT_PUBLIC_` name.
2. `package.json`'s `build` script is `node scripts/check-env.mjs && next build`. On Vercel,
   `VERCEL_ENV` makes the profile `production` or `preview`, so the rules that need real values
   are enforced exactly where those values exist, and a bad environment **fails the deploy**.

   It is written inline rather than as a `prebuild` lifecycle hook on purpose. A `prebuild` hook
   only fires when something runs `npm run build`; Vercel's Build Command is a **dashboard
   setting not present in this repository**, so if it were ever changed to call `next build`
   directly the gate would silently stop firing with no signal anywhere in the code. Inlining it
   into `build` means the check cannot be skipped without editing this line.

### Open disagreement: the analytics-mismatch severity

A reviewer argued the analytics client/server mismatch (rule 5) should be **high**, not
**medium**, because a mismatch means we cannot truthfully answer the App Store's
"do you collect usage data" question, and `isEnvSafe()` ignores medium — so it never blocks
anything. The asymmetry argument is good: the cost of a false positive is a five-minute env
correction; the cost of a false negative is shipping a privacy misrepresentation.

**Left at medium for now, deliberately, and this is an operator call.** Raising it to high
makes `prebuild` fail a deploy the moment the two flags disagree, and that change was not
worth making unattended. It is bound to open question **Q3** (are the analytics flags actually
on in production?) — answer Q3 and this severity question resolves with it.

### Known coverage limits — read before trusting a clean result

- **It classifies 13 of the repo's 25 variables.** A clean result means "none of the checked
  variables is misconfigured", not "the environment is correct".
- **It checks presence and name, not value validity.** A typo'd anon key, a malformed
  `NEXT_PUBLIC_SITE_URL`, or a revoked key all pass.
- **It cannot see `next.config` exposure.** Anything surfaced to the browser via a
  `next.config` `env` block bypasses the `NEXT_PUBLIC_` naming rule entirely.
- **The value-mirror net covers three secrets, not all of them.** It can only detect a
  `PUBLIC_BY_DESIGN` variable carrying the value of something in `SERVER_ONLY_SECRETS`
  (currently `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `GOOGLE_MAPS_API_KEY`). A future
  third-party secret mirrored into a public variable has nothing to compare against and is
  invisible.
- **Nothing fails when a 26th variable is added** without being classified here. That is a
  manual chore today and it will rot; treat any new `process.env.*` reference as owing an
  entry in this table.

## The finding this exercise produced

**Every variable has the same owner, and no rotation has ever been rehearsed.** If Connor
loses access to the Google Cloud console or the Supabase dashboard, there is no documented
second path to rotate a leaked key — and rotation is precisely what a leak demands within
minutes.

That is a bigger operational risk than any individual variable's classification, and it is
cheap to fix: a second owner on each account, plus one rehearsed rotation of a **staging**
key to prove the procedure works before it is needed on a production one.
