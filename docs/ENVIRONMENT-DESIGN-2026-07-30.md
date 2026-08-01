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
| Google Maps keys (**4 total, see §4**) | staging browser + staging server | staging browser only | staging browser + staging server | production browser + production server |
| Analytics | off | off | on (to prove the path) | operator decision (Q3) |
| Email (Brevo) | sink / catch-all | sink | sink | live sender, DKIM+SPF |
| **Storage buckets** | staging project's buckets | staging project's buckets | staging project's buckets | production project's buckets |
| **Monitoring** | none | none | alerts to a dev channel, never paged | paged; alerts tagged `production` |
| **Mobile builds** | n/a | n/a | staging bundle id, points at staging | App Store bundle id — the **only** build config that may point at production |

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

## Cost, and how much of this to actually build now

**This design is not free, and the recurring cost is the operator's to approve.** Production
alone was already recorded as needing Vercel Pro + Supabase Pro (~$45/mo) at launch. A second
Supabase project adds either $0 (free tier) or another Pro subscription.

> **Free tier is the right choice for staging today, with one caveat to confirm:** free Supabase
> projects have historically **auto-paused after inactivity**. This is Supabase's product policy,
> not something this repository can prove — **check the current free-tier terms before relying on
> it.** If it still holds, a paused staging project looks like a broken staging project; expect to
> un-pause it before use, and do not read a pause as a code failure.

**Proportionality — read this before doing all eight steps.** This app is pre-launch: zero users,
one owner. The safety property that matters *today* is narrow: **local and preview must stop
holding production credentials.** That needs a bare free-tier project and step 2 — nothing more.

The fully-rehearsed staging tier (complete synthetic seed across nine tables, deployment
protection, a dedicated staging hostname, DKIM-adjacent Brevo config) is real value *later*, and
carries a real maintenance cost: every schema change must be re-applied and re-seeded, or it
rots into a misleading environment. **Defer the full tier until a stated trigger:** the first
native mobile build, or the first real user — whichever comes first.

### If you only have one hour

Do this and stop; it closes the incident that motivated this document:

1. Step 1.1 — create the staging project, **bare** (no seed, no migrations yet).
2. Step 1.4 — record the ref.
3. **Step 2 in full** — re-point `.env.local` at staging and confirm no production
   credentials remain on the machine.

4. **Step 3's Preview column** — clear `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` from
   Vercel's Preview environment. Preview URLs are public and per-PR; leaving production
   credentials there is the same hazard as leaving them on the laptop, reachable from a link.
   Local-only isolation is a half fix.
5. **Rotate the production service-role key and `DATABASE_URL` password.**

Read step 5 twice, because it is the only step that actually *closes* the incident rather than
reducing future exposure. Editing `.env.local` cleans one file. It does not touch shell history,
other `.env*` files, an exported variable in a terminal that is still open, an editor's recent
buffers, or a snippet pasted into a chat earlier today. **Rotation is the only action that makes
every forgotten copy inert, wherever it is hiding.** Until you rotate, "no developer machine
holds a production credential" is a hope, not a verified state — so do not tick that box.

Everything else can follow later: steps 1.2, 1.3, 1.5, the rest of 3, and 4–7, plus the
remaining step-8 checks.

**What the one-hour path does NOT prove, so that you don't over-trust it:**

- **Write isolation is unproven.** Step 8's "a write against staging is invisible in
  production" cannot run yet — on a bare project with migrations deferred, `public.waitlist`
  and every other custom table does not exist, so the original incident's write path cannot be
  reproduced. Prove this after step 1.2, not now.
- **`curl /api/health` does not identify the project.** Step 2.2 says it "should report the
  staging project", but the route returns only `{ ok, supabase, sha, at }` — no project ref or
  URL — and `sha` is the literal string `dev` under `next dev`. The response looks identical
  whether you are pointed at staging or production. **Use `printenv NEXT_PUBLIC_SUPABASE_URL`
  and compare it against the ref recorded in step 1.4** — that is the check that actually
  distinguishes them.

## Operator setup steps

Ordered so that nothing depends on a step that has not run yet.

### 1. Supabase staging project
1. Create a second Supabase project, named to make confusion impossible (`next-bar-staging`).
   **Tier: free.** See the cost note above, including auto-pause.
2. After review, apply migrations `0000`→`0036` in order via
   `npm run db:bootstrap` with `DATABASE_URL` pointed at **staging**. Do not use
   `--baseline`; the bootstrap supplies the sanitized public catalog fixture
   required after migration `0019`. Follow
   `FRESH-STAGING-BOOTSTRAP-RUNBOOK-2026-07-31.md`. This doubles as the
   clean-database rehearsal that goal 1 was blocked on.
3. Seed any additional synthetic user/test data above. The catalog migration
   fixture is already supplied by `db:bootstrap`.
4. Record the project ref. **Do not** put its service-role key on a developer machine beyond
   the one that needs it.
5. **Storage:** create the same bucket names the production project uses, in the *staging*
   project only. **Bucket names and policies are not in version control** — nothing in
   `supabase/migrations/` or `src/` defines them, so read them off the Storage tab of the
   production Supabase dashboard. (Worth fixing separately: storage config that exists only in
   a dashboard cannot be reviewed, diffed, or restored.) Apply the same bucket policies, seed synthetic objects, and confirm a staging
   object is not readable via the production project's URL. Buckets are per-project, so this is
   isolation by construction — but it is not *configured* until the buckets exist.

### 2. Re-point local development
1. Replace `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` with the **staging** values.
2. Verify with `printenv NEXT_PUBLIC_SUPABASE_URL` (or the shell equivalent) and compare it to
   the staging ref recorded in step 1.4. **Do not use `curl /api/health` for this** — that route
   returns `{ ok, supabase, sha, at }` with no project identity, and `sha` is literally `dev`
   under `next dev`, so its response is identical whichever project you are pointed at.
3. Confirm no developer machine retains production credentials. **This needs a method, not an
   assertion:** grep your home directory, shell profile and shell history for the production
   project ref and for the key prefix; check every other `.env*` file; check terminals still
   open with exported variables. Then **rotate the production service-role key and `DATABASE_URL`
   password** — rotation is the only step that makes a copy you failed to find harmless. Ticking
   this box after editing one file is precisely the false confidence this document exists to
   prevent.

### 3. Vercel environments

Vercel gives you Production and Preview by default. **Staging is not automatic** — decide which
model you want and record the choice here before configuring anything:

- **(a) Branch-as-staging (recommended now):** a long-lived `staging` branch whose Preview
  deployment is treated as staging, with deployment protection on and a stable alias.
  No extra Vercel cost.
- **(b) A second Vercel project** pointed at the same repo. Cleaner separation, more upkeep.

Exact variable matrix — set every row, and leave blank cells genuinely unset:

| Variable | Production | Preview | Staging |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | production | staging | staging |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production | staging | staging |
| `SUPABASE_SERVICE_ROLE_KEY` | production | **unset** | staging |
| `DATABASE_URL` | production | **unset** | staging |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | production browser key | staging browser key | staging browser key |
| `GOOGLE_MAPS_API_KEY` | production server key | **unset** | staging server key |
| `NEXT_PUBLIC_ANALYTICS` | per Q3 | `0` | `1` |
| `ANALYTICS_ENABLED` | per Q3 | `0` | `1` |
| `NEXT_PUBLIC_SITE_URL` | the production origin | Vercel-injected | the staging alias |
| `NEXT_PUBLIC_GOOGLE_MEDIA` | **unset** | **unset** | **unset** |
| `NEXT_PUBLIC_PUSH_ENABLED` | deliberate per env — leaving it inherited silently activates the push path (`src/lib/push.ts`) | `0` | `0` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | set only if push is on | **unset** | **unset** |
| `NEXT_PUBLIC_BUILD_SHA` | Vercel-injected; this is the fallback `/api/health` uses when `VERCEL_GIT_COMMIT_SHA` is absent | Vercel-injected | Vercel-injected |
| `NEXT_PUBLIC_LEGACY_PHOTOS` | **`1`** — `.env.example` requires it for current deployments; leaving it unset silently drops affected surfaces to the glyph fallback | `1` | `1` |
| `ALLOW_GOOGLE_PHOTO_INGEST` | **unset** | **unset** | **unset** |
| `ALLOW_GOOGLE_REVIEW_INGEST` | **unset** | **unset** | **unset** |
| `LOOP_UNATTENDED` | **unset** | **unset** | **unset** |

Both analytics variables must agree — the client flag and the server gate are separate, and
setting only one makes the path un-provable end to end.

Then: confirm `LOOP_UNATTENDED` is absent from **every** Vercel environment. If it ever appears
in production, account deletion hard-refuses with 503 and users silently lose that right.
Enable deployment protection on Preview and on the staging alias.

### 4. Google keys — **four**, not two

The repository uses two *different* Google credentials, and conflating them is a real
vulnerability: the browser key ships in the JS bundle, the server key must never.

| Key | Variable | Restriction |
|---|---|---|
| Production browser | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | HTTP-referrer restricted to the production origin; quota; budget alert |
| Production server | `GOOGLE_MAPS_API_KEY` | IP-restricted or unrestricted-but-quota'd — **referrer restrictions do not work for server calls**; budget alert |
| Staging browser | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | referrer-restricted to the staging alias; tight quota |
| Staging server | `GOOGLE_MAPS_API_KEY` | tight quota |

1. Never reuse one key across browser and server. A referrer restriction that secures the
   browser key will break server calls; removing it to fix them exposes a billable key in the
   bundle.
2. Every one of the four gets its own quota cap. An unrestricted staging key is billable abuse
   exposure just like a production one.
3. Confirm `ALLOW_GOOGLE_PHOTO_INGEST` / `ALLOW_GOOGLE_REVIEW_INGEST` are **unset** in
   production unless a compliance decision says otherwise, and that
   `NEXT_PUBLIC_LEGACY_PHOTOS` is set deliberately per environment rather than inherited.
4. **`NEXT_PUBLIC_GOOGLE_MEDIA` stays UNSET in every environment, production included.**
   `.env.example` is explicit: leave it unset until the Places UI Kit integration ships **with a
   server-enforced spend cap**, because every card render is a billable event. This is not a
   toggle to flip on judgement — both prerequisites must exist first.

### 5. Domain and email
1. Custom domain → production. **The exact spelling is unresolved in our own docs
   (`nextbar.app` vs `next-bar.app`) — confirm it at the registrar first.** Give staging a
   stable hostname (e.g. `staging.<domain>`); it is **required**, not optional, because the
   Auth redirect allowlist and the Google referrer restrictions both need a fixed host.
2. Supabase Auth per environment — set Site URL and the redirect allowlist separately in each
   project. **Production's allowlist must contain production callbacks only**: no staging host,
   no Vercel preview wildcard. A wildcard preview entry in production turns every PR URL into a
   valid auth callback.
3. Brevo / email:
   - Production: DKIM + SPF on the live sender.
   - Non-production: a **separate** Brevo (or SMTP) account and API key — never the production
     sender's credentials — configured in the staging Supabase project's Auth SMTP settings.
   - Point it at a catch-all sink you control, or set a hard recipient allowlist of your own
     synthetic addresses.
   - **Do this before creating any test users.** `signUp()` fires signup/verification mail at
     account creation, so if SMTP still points at the production sender that message is already
     gone before you can fix it. (Password-reset mail is *not* part of account creation — it
     fires only when `resetPasswordForEmail()` is invoked by the forgot-password flow. Same
     sender, different trigger.)

### 6. Monitoring boundary

No monitoring exists yet, so this is a boundary to establish *when* it is added, not a step to
run today. Record it now so the first monitoring tool inherits the split rather than being
retrofitted:

1. Tag every event with its environment at source. Untagged alerts are indistinguishable, and a
   noisy staging alert that pages at 3am trains the operator to ignore the channel.
2. Separate destinations: staging → a dev channel, never paged. Production → the paged path.
3. Uptime checks target production's real hostname *and* staging's alias, with only production's
   failure escalating.
4. Prove it once by firing a test error in staging and confirming it arrives on the dev channel
   and **not** the paged one.

### 7. Mobile builds boundary

Not needed until the first native build, but decide it before then — this is the boundary most
likely to leak production credentials into a test artifact:

1. Two bundle identifiers: a staging one and the App Store one. Never one bundle id repointed
   between environments.
2. The staging build embeds staging Supabase URL/anon key and the staging browser Google key.
   **The App Store build config is the only one that may ever carry production values.**
3. Signing ownership is an operator/account question, not a repo one — see the recovery
   inventory in `SYSTEM-INVENTORY-2026-07-30.md`.
4. Verify before any TestFlight upload: install the staging build, create an account, and
   confirm the row appears in **staging**, not production.

### 8. Prove the separation
The setup is not done until these hold:

- [ ] A write against staging is invisible in production.
- [ ] A preview deployment cannot reach production data — confirm `api/account/delete`
      returns 503 there (unconfigured), not 200.
- [ ] Production `/api/health` reports the production sha; staging reports staging's.
- [ ] No developer machine holds a production service-role key or `DATABASE_URL`. **Tick this
      only after rotating both** — a search that finds nothing proves you looked, not that
      nothing is there.
- [ ] A staging Storage object is not reachable through the production project.
- [ ] *(once monitoring exists — step 6)* A test error fired in staging arrives on the dev
      channel and **not** the paged one.
- [ ] *(once a native build exists — step 7)* An account created in the staging build lands in
      the staging project, not production.
- [ ] **Rotating a staging credential leaves PRODUCTION untouched.** State it that way, not as
      "breaks staging and nothing else" — that phrasing is wrong under this very design.
      Local, Preview and Staging deliberately *share* the staging project, so rotating the
      staging anon key breaks all three, and rotating the staging service-role key breaks Local
      and Staging. That is expected. The property being tested is that **production keeps
      serving**, and it is worth actually performing once.

## What stays UNVERIFIED until you run this

Every item above. The repository cannot prove any external state, so none of it may be
recorded as passing on the strength of this document existing.
