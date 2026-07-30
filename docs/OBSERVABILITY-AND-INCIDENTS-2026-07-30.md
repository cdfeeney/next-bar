# Observability, incidents and cost controls

Written 2026-07-30 for goal `g-3e3083c5`. Design and runbooks. **No provider was signed up
for, no alert was configured, and no dashboard state is claimed.**

## Start from the true baseline

**Nothing observes this system today.** Verified from `package.json`: nine runtime
dependencies, none of them an error tracker, APM or logging SDK. There is no uptime check
beyond the fact that `/api/health` exists, and no alert path to any human.

Concretely: **if production broke right now, the way you would find out is a user telling
you.** Every gap below follows from that one fact, and it is worth stating plainly because
the rest of this program has been improving code quality in a system that cannot report its
own failures.

The one thing that already exists and is genuinely useful:

| Exists | What it gives you |
|---|---|
| `GET /api/health` | `ok`, Supabase reachability, a **12-char commit sha**, and a timestamp. The sha is what ties an error to a deploy — the release identifier is already there and needs no work. |

## Release identity

Use the sha `/api/health` already returns. Whatever error tracker is chosen, set its release
to the same `VERCEL_GIT_COMMIT_SHA`, so "which build produced this error" is answerable
without guessing. Truncated to 12 characters deliberately — enough to match against git, not
enough for version-targeted reconnaissance.

## What to instrument, in priority order

| # | Signal | Why this order |
|---|---|---|
| 1 | **Server errors from `/api/*`** | The service-role routes live here. A 500 in `account/delete` is a user unable to exercise a deletion right — a compliance failure, not just a bug. |
| 2 | **Uptime on `/api/health`** | Cheapest possible outage detection, and it already reports Supabase reachability, so one check covers app and backend. |
| 3 | **Browser errors** | The app is a client-heavy PWA; most user-visible breakage never reaches a server log. |
| 4 | **Auth failure rate** | A spike means either an attack or a broken callback allowlist; both need a human. |
| 5 | **Google Places/Maps spend** | The only unbounded cost surface. See below. |
| 6 | Native crashes | Only once a Capacitor build ships. |

## Alerts that are worth waking up for

An alert nobody acts on trains you to ignore alerts. Only these four:

| Alert | Condition | Action |
|---|---|---|
| App down | `/api/health` non-200 twice in a row | check Vercel status, then roll back to the last known-good deploy |
| Backend unreachable | `health.supabase === "unreachable"` | check Supabase status; the app degrades but does not necessarily fail |
| Deletion failing | any 500 from `api/account/delete` | investigate immediately — it is a rights issue |
| Cost spike | Google spend over the daily budget | flip `NEXT_PUBLIC_GOOGLE_MEDIA` off; it is a runtime kill switch and needs no redeploy |

Everything else goes to a dashboard, not a phone.

## Cost controls

| Surface | Bound today | Needed |
|---|---|---|
| Google Places/Maps | `ALLOW_GOOGLE_*_INGEST` kill switches; `NEXT_PUBLIC_GOOGLE_MEDIA` runtime switch | **quota + budget alert in Google Cloud.** The browser key ships in the bundle and is billable — referrer restriction is not optional. |
| Supabase | free/paid tier limits | a plan chosen deliberately before real user data exists |
| Vercel functions | per-invocation | the C2 F1b middleware fix already removed a per-request outbound call from every `/api/*` hit |

The media kill switch **must work without a redeploy** — that is a launch-gate requirement,
and it should be exercised once before launch rather than trusted.

## Incident runbook

Written to be followed at 3am by someone who did not write the code.

1. **Detect.** Alert fires, or a user reports. Get `/api/health` first: it tells you *up or
   down*, *backend reachable or not*, and *which build is serving*.
2. **Triage.** Compare the reported sha against the last deploy. Different → the deploy is
   suspect. Same → look outward at Supabase/Google status.
3. **Mitigate before diagnosing.** Roll back to the previous Vercel deployment. Diagnosis is
   cheaper on a system that is serving users.
4. **If the database is implicated**, do NOT apply or revert a migration mid-incident.
   `0033`–`0035` are expand-only and safe to leave in place; a panicked schema change during
   an outage is how a recoverable incident becomes a data-loss incident.
5. **Communicate.** Even a single-operator product should record what broke, for how long,
   and who was affected — the App Store review process and any future user trust depend on
   having that history.
6. **Postmortem.** What failed, what detected it (or failed to), what would have caught it
   sooner. The output is a test or an alert, not a resolution to be more careful.

## Two rehearsals before launch

Neither has been performed. Both are cheap and both are listed as launch gates:

1. **Bad deployment.** Deploy something deliberately broken to staging, confirm the alert
   fires, roll back, confirm recovery. This proves the alert path end to end, which is the
   half people skip.
2. **Dependency failure.** Point staging at an unreachable Supabase and confirm `/api/health`
   reports `unreachable` and returns 503 — the route is already written to do exactly this,
   and the behaviour is unit-tested, but it has never been exercised against a real outage.

## What remains UNVERIFIED

Provider choice, account setup, alert delivery, on-call ownership and budget configuration
are all operator decisions and none can be evidenced from this repository. **No alert may be
recorded as working until it has actually fired and reached a human.**
