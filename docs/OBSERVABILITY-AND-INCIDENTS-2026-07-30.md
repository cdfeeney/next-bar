# Observability, incidents and cost controls

Written 2026-07-30 for goal `g-3e3083c5`. Design and runbooks. **No monitoring provider is
configured in this repository, and no dashboard state is claimed.**

*Precisely: the repository contains no monitoring dependency and no alert configuration. It
cannot see whether Vercel's built-in alerting or an external uptime monitor is switched on —
that is **UNVERIFIED**, not "absent". Do not read "we have no monitoring" as a proven fact
about the running system; read it as "nothing we control provides it."*

## Start from the true baseline

**Nothing in this repository observes the system.** Verified from `package.json`: nine runtime
dependencies, none of them an error tracker, APM or logging SDK. No uptime check and no alert
path exists *in anything we control* — whether the Vercel dashboard has built-in alerting
switched on is **UNVERIFIED** and cannot be settled from here.

Concretely: **unless platform-native alerting is on, the way you would find out production
broke is a user telling you.** Every gap below follows from that, and it is worth stating
plainly because
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
| 2b | **Synthetic probe of `/api/account/delete`** | Availability of a *rights* endpoint should not wait for a real user to discover it is broken. **Probe: POST with NO `Authorization` header. Treat 401 OR 429 as healthy.** See the exactness note below — the naive version of this check is dangerous. |
| 3 | **Browser errors** | The app is a client-heavy PWA; most user-visible breakage never reaches a server log. |
| 4 | **Auth failure rate** | A spike means either an attack or a broken callback allowlist; both need a human. |
| 5 | **Google Places/Maps spend** | The only unbounded cost surface. See below. |
| 6 | Native crashes | Only once a Capacitor build ships — but **decide the provider before then, not after**. The constraint that actually narrows the choice: whatever tool is picked for browser/server errors in rows 1 and 3 must also ship a **Capacitor/iOS SDK**, or the native build ends up on a second, unrelated tool and no error can be traced across the web→native boundary. Make that a selection criterion now; retrofitting it costs a migration. |

### Probing `/api/account/delete` safely — read before configuring it

**Never probe this endpoint with a real token.** A "does deletion actually work" check that
authenticates would delete an account on every interval. That is worse than having no check.

The token-less probe is safe in the ways that matter, and the precise reasons are worth stating
because a first draft of this section overstated them:

*What it cannot do* (verified in `src/app/api/account/delete/route.ts:109-117`): a token-less
POST returns `unauthorized()` **before** any Supabase admin client is constructed. No deletion,
no outbound call, and the missing-token path is deliberately **not charged** to the limiter.

*What it does still touch* — it is **not** side-effect-free:

- `clientIpFromHeaders()` and `unverifiedIpLimiter.peek(ip)` both run **before** the token
  check (`:106-107`). So the probe lands in the C2 F5 attribution counters and can contribute
  to the guard's periodic warning log.
- Because `peek` runs first, **an exhausted bucket for the monitor's IP returns 429, not 401.**
  A check asserting "== 401" would then alarm on a perfectly healthy route. Accept **401 or
  429**; both prove the endpoint is up and refusing correctly. A 5xx, or a connection failure,
  is the real signal.

## Alerts that are worth waking up for

An alert nobody acts on trains you to ignore alerts. Only these four:

| Alert | Condition | Action |
|---|---|---|
| App down | `/api/health` non-200 twice in a row | check Vercel status, then roll back to the last known-good deploy |
| Backend unreachable | `health.supabase === "unreachable"` | check Supabase status; the app degrades but does not necessarily fail |
| Deletion failing | any 500 from `api/account/delete` | **1.** Check whether `LOOP_UNATTENDED` is set in the production environment — it makes this route hard-refuse by design, and it is the single most likely cause. **2.** Find the failing request's release sha via `/api/health`. **3.** If the failure started at a deploy, roll back first and diagnose after. This is a **user-rights** issue: people cannot delete their accounts while it lasts. |
| Cost spike | Google spend over the daily budget (**set the amount — see below**) | **1.** In the Google Cloud console, **regenerate or delete the key**, and/or tighten the **per-API, per-project quota**. Note both caveats: a standard API key has no "disable" toggle, and key deletion **takes a few minutes to propagate** — so nothing here is instant. **2.** Set `NEXT_PUBLIC_GOOGLE_MEDIA=0` **and redeploy** — it is NOT a runtime switch (see below). **Because neither control is immediate, the pre-set quota is what actually bounds the loss; reactive steps only shorten the tail.** |

> ### ⚠️ The media kill switch requires a REDEPLOY. Corrected 2026-07-31.
>
> This table previously said "flip `NEXT_PUBLIC_GOOGLE_MEDIA` off; it is a runtime kill switch
> and needs no redeploy." **That was false, and it was false in the worst possible place** — the
> instruction an operator follows while money is actively burning.
>
> `defaultMediaFlags()` (`src/lib/mediaPolicy.ts:78-83`) reads `NEXT_PUBLIC_GOOGLE_MEDIA` and
> `NEXT_PUBLIC_LEGACY_PHOTOS`. `NEXT_PUBLIC_` variables are **inlined into the client bundle at
> build time**. The source comment above that function says so explicitly: *"A build shipped
> without the variable keeps its value for that build's entire life."* Changing the value in a
> dashboard does nothing to clients already served. Making the flip runtime-controllable is an
> open decision (D1, kill-switch transport) — it has not been built.
>
> **Therefore, during a cost incident, reach for the Google Cloud console first.** The env
> variable is the follow-up that makes the change stick, not the stop-the-bleeding control.
>
> Acceptance criterion 6 ("the media kill switch must work WITHOUT a redeploy") is therefore
> **UNMET**, and this document must not be read as evidence that it is met.

Everything else goes to a dashboard, not a phone.

## Cost controls

| Surface | Bound today | Needed |
|---|---|---|
| Google Places/Maps | `ALLOW_GOOGLE_*_INGEST` (ingest-time, server-side); `NEXT_PUBLIC_GOOGLE_MEDIA` — **build-time, NOT a runtime switch** | **quota + budget alert in Google Cloud.** The browser key ships in the bundle and is billable — referrer restriction is not optional. **Nothing here stops spend instantly** — the env flag needs a redeploy, and key deletion takes minutes to propagate. Only a quota set *in advance* bounds the loss; everything else shortens the tail. |
| Supabase | free/paid tier limits | a plan chosen deliberately before real user data exists |
| Vercel functions | per-invocation | the C2 F1b middleware fix already removed a per-request outbound call from every `/api/*` hit |

The media kill switch **must work without a redeploy** — that is a launch-gate requirement, and
it is **currently UNMET**: the flag is `NEXT_PUBLIC_`, so it is baked in at build time (see the
warning above). Closing this gate needs the D1 kill-switch-transport decision — a server-fetched
flag or an edge config — not another env variable. Exercise it once it exists; do not trust it
before then.

## Incident runbook

Written to be followed at 3am by someone who did not write the code.

1. **Detect.** Alert fires, or a user reports. Get `/api/health` first: it tells you *up or
   down*, *backend reachable or not*, and *which build is serving*.
2. **Triage.** Compare the reported sha against the last deploy. Different → the deploy is
   suspect. Same → look outward at Supabase/Google status.
3. **Mitigate before diagnosing.** Roll back to the previous Vercel deployment. Diagnosis is
   cheaper on a system that is serving users.

   **Concretely** — the previous wording assumed knowledge the 3am reader may not have:
   - Dashboard: **Vercel → the project → Deployments → pick the last known-good → Promote to
     Production.**
   - CLI: `npx vercel rollback <deployment-url>` (needs `npx vercel login` first).
   - **Access:** this requires membership of the Vercel project. If you do not have it, there
     is currently **no second account that can grant it** — see the single-owner recovery gap
     in `SYSTEM-INVENTORY-2026-07-30.md`. That is the real blocker to fix before relying on
     this step.
4. **If the database is implicated**, do NOT apply or revert a migration mid-incident.
   `0033`–`0035` are expand-only and safe to leave in place; a panicked schema change during
   an outage is how a recoverable incident becomes a data-loss incident.
5. **Communicate.** Even a single-operator product should record what broke, for how long,
   and who was affected — the App Store review process and any future user trust depend on
   having that history.

   **Where:** append to `docs/INCIDENTS.md` (create it on first use) with the date, the
   release sha that was serving, start/end times, and user-visible impact. There is no
   status page and no user mailing path today, so "communicate" currently means *record*;
   if an incident ever affects real users, that gap becomes the next thing to close.
6. **Postmortem.** What failed, what detected it (or failed to), what would have caught it
   sooner. The output is a test or an alert, not a resolution to be more careful.

## Two rehearsals before launch

Neither has been performed. Both are cheap and both are listed as launch gates:

1. **Bad deployment.** Concretely: to staging, set `NEXT_PUBLIC_SUPABASE_URL` to an
   unreachable host and deploy. **Expected signal:** the uptime check sees `/api/health`
   reporting `supabase: "unreachable"` and the alert reaches a human. **Pass condition:** the
   alert arrives *and* a rollback restores a healthy `/api/health` — both halves, because the
   half people skip is proving the alert path actually delivers.

   **Ordering note:** this rehearsal presupposes an alert system, and per the baseline at the
   top of this document none is configured yet in anything we control. So rehearsal 2 is
   runnable first; this one is gated on the provider decision.
2. **Dependency failure.** Point staging at an unreachable Supabase and confirm `/api/health`
   reports `unreachable` and returns 503 — the route is already written to do exactly this,
   and the behaviour is unit-tested, but it has never been exercised against a real outage.

## What remains UNVERIFIED

Provider choice, account setup, alert delivery, on-call ownership and budget configuration
are all operator decisions and none can be evidenced from this repository. **No alert may be
recorded as working until it has actually fired and reached a human.**

## Owners and thresholds — the blanks that make this runbook inert

Criteria 4 and 6 require a **named** owner per alert and per cost-bearing dependency, and a
concrete threshold per alert. Today every one of them is the same person, and none of the
numbers is set. Writing "Connor" four times would satisfy the letter of the criterion and
teach nothing, so instead:

| Thing | Owner | Status |
|---|---|---|
| All four alerts above | **Connor** (sole operator) | There is no second responder. That is the finding, not an oversight — see the single-owner recovery gap in `SYSTEM-INVENTORY-2026-07-30.md`. |
| Google Places / Maps spend | **Connor** | Daily budget amount **NOT SET** — fill it in before enabling the alert, or the alert cannot be configured at all. |
| Supabase | **Connor** | Plan/quota thresholds not set. |
| Vercel functions | **Connor** | Invocation/bandwidth thresholds not set. |

**A single-owner on-call rota is a single point of failure, not a rota.** The cheapest real
mitigation is not a second person — it is making the alerts *survivable when unread*: hard
budget caps in the Google console and a Supabase plan limit, so an unanswered alert degrades
to a capped bill rather than an unbounded one.

**Numbers the operator must fill in before any of this works:**

- Google daily budget: `____` (and alert at 50% / 90% / 100%)
- Supabase spend or row/egress ceiling: `____`
- Vercel function invocation ceiling: `____`
- Uptime check interval and the consecutive-failure count that pages: `____`

Until these are set, the alert table is a design, not a control.
