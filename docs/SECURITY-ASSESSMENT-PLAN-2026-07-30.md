# Safe adversarial assessment — preparation

Written 2026-07-30 for goal `g-ac3bad15`, under
`docs/SAFE-SECURITY-TEST-ROE-2026-07-30.md`.

**No active testing was performed and none is authorized by this document.** Source review
only. ROE steps 3 (staging active checks) and 5 (production confirmation) are forbidden to
any unattended run and require the completed authorization record at the end.

## Asset inventory

| Asset | Owner | In scope when authorized |
|---|---|---|
| `next-bar.app` (production web) | Connor | **production confirmation only**, separately approved |
| staging deployment | Connor | yes, primary target — **does not exist yet** |
| Supabase staging project | Connor | yes — **does not exist yet** |
| Supabase production project | Connor | read-only confirmation only |
| Browser bundle | — | yes, passive (it is public) |
| TestFlight build | Connor | yes, once one exists |
| Vercel / Supabase / Google / Apple infrastructure | **the providers** | **NEVER** — out of scope, always |

Two of the three primary targets do not exist yet. **Staging is a prerequisite for the
assessment, not merely for convenience** — the ROE requires staging-first, so the assessment
cannot begin until `ENVIRONMENT-DESIGN-2026-07-30.md` step 1 is done.

## Trust boundaries to attack (in priority order)

Derived from `SYSTEM-INVENTORY-2026-07-30.md` and the **C2, C3 and C4** audits.
(C2 was missing from this line until 2026-07-31, which is how boundary 7 below came to be
omitted — the plan under-sourced the one audit with a still-open finding.)

| # | Boundary | Why it ranks here |
|---|---|---|
| 1 | **Browser → PostgREST RPCs** | 28 browser-callable security-definer functions. RLS does not constrain them; each body *is* the boundary. C4 found no parameter-driven identity, but that was static review — this is where dynamic testing pays. |
| 2 | **Table-level RLS** | Owner-scoped policies on 12 tables. Test cross-account reads directly, not through the UI. |
| 3 | **`api/account/delete`** | Destructive, service-role, Bearer-authenticated. The highest-consequence endpoint. |
| 4 | **Rate limits** | Per-instance and IP-keyed; F2's trust assumption is unresolved. |
| 5 | **Share tokens** | 122-bit capability URLs — check they are unguessable *and* not leaking via referrer. |
| 6 | **Auth callback / redirect allowlist** | Classic open-redirect and token-leak surface. |
| 7 | **Middleware session verification** (`/auth/*`, `/settings/*`) | **Added 2026-07-31 — the only boundary here with a currently-OPEN finding.** C2 F1b: `src/middleware.ts:39` calls `supabase.auth.getUser()` unconditionally for any request matching the `:83` matcher, so one *fabricated* `sb-<ref>-auth-token` cookie forces an uncached outbound Supabase call with no valid credential. The disposition is "SURFACE REDUCED, not eliminated", and the code says so itself at `:68-79`. Testing the other six boundaries and declaring the auth surface done would miss the one live issue on it. |

## Synthetic accounts required

| Account | Configuration |
|---|---|
| A | public profile, handle, ratings, one shared night |
| B | private profile, handle, ratings |
| C | follows B (so the "private but followed" path is reachable) |
| D | no handle, no follows — the empty-state account |
| E | to be deleted during the test, proving deletion end to end |

**Never a real user account, and never production data.** Accounts A–E exist only in staging.

## Staging test cases

Each stops at minimum proof. None may run before authorization.

| # | Case | Pass = |
|---|---|---|
| S1a | **The 6 functions that actually take a user-identifying parameter** — `follow_user(target)`, `unfollow_user(target)`, `accept_follow_request(requester)`, `decline_follow_request(requester)`, `cancel_follow_request(target)`, `get_follower_count(profile_id)`. Call each as A, passing **B's** uuid. | no function returns or mutates B's rows |
| S1b | **The handle-targeted functions** — `get_profile_by_handle(h)` and `get_public_ratings(handle)`. Call each as A, passing **B's handle**. | Identity can be named by **handle**, not only by uuid — so these belong with S1a, not with the "no way to name B" group. Pass = only data B has actually made public is returned: `get_public_ratings` must still honour `is_private` and the opt-in (it is `anon`-callable, so also try it **signed out**), and neither may leak a private profile's existence. |
| S1c | **The remaining ~20 RPCs**, which take no parameter naming another user by uuid *or* handle. Call each as A and inspect what comes back. | every returned or mutated row is scoped to A's own `auth.uid()`-derived data, **and there is no parameter through which B could be named at all**. That absence is what confirms C4's "no parameter-driven identity" headline for these functions. |

| S2 | `get_follower_count(B)` as D (not following, B private) | returns `null`, and the *same* null as for a non-existent uuid — no existence oracle |
| S3 | `get_public_ratings` for B (opted out) | empty |
| S4 | Direct PostgREST `select` on `ratings`, `profiles`, `vibe_profiles` as A | only A's rows |
| S5 | **As C**, call `accept_follow_request(A)` where the pending request is A→B, i.e. addressed to **B**, not to the caller | refused. The guard is `target_id = uid`, so naming someone else's pending request must not manufacture a follow edge. *(Caller and request made explicit 2026-07-31 — "someone else" left the tester to guess which account ran it.)* |
| S6 | `api/account/delete` with A's token but B's id in the body | A is deleted, B untouched |
| S7 | 20 forged-token deletes from one IP, then a valid one from the same IP | stage-1 cap holds; the valid caller is not locked out |
| S8 | **C4 F1** — `share_night` over many distinct dates | with `0035` applied, rejected outside ±2 days. **Bounded: stop at 10 dates.** Never run against production. |
| S9 | `get_shared_night` with a random uuid | nothing |
| S10 | Auth callback with an off-allowlist redirect | rejected |
| S11 | **C2 F1b, boundary 7 — the only still-open finding.** `GET /settings` carrying a **fabricated** `sb-<ref>-auth-token` cookie and no valid session. Count outbound Supabase calls. **Ceiling: 5 requests.** | Matches the documented residual of **1** outbound `getUser()` per request — confirming the surface is reduced but live. If the JWT-local-verify follow-up in `C2-C3-REMAINING-DISPOSITION-2026-07-30.md` has since landed, expect **0** and update that disposition. Staging only: this is an amplification lever, so **never** against production, and the 5-request ceiling exists because volume here is the harm. |

S7, S8 and S11 touch rate limits, storage and load amplification respectively, so all three
carry explicit ceilings. S8 in particular must never run against production: the whole finding
is that it writes unbounded rows.

> **Why S1 is three rows.** It began as one: *"call each of the 28 RPCs as A with B's uuid as
> an argument."* Only 6 of the 28 have a slot to put a uuid in, so for the rest the instruction
> was unexecutable — a tester would have skipped them, or improvised with no stated pass
> criterion, on the boundary this plan ranks **#1**. A second pass then found the split itself
> was still wrong: identity can be named by **handle** as well as by uuid, so
> `get_profile_by_handle` and `get_public_ratings` had been left in the "no way to name B"
> group. Both corrections are worth keeping visible — "no parameter-driven identity" is only a
> meaningful result if the test actually reaches every parameter that names a person.

## Production confirmation candidates

Only if a staging finding is real, and only with separate attended approval:

- passive TLS/header/bundle inspection (no traffic beyond a normal page load);
- one read-only check that a confirmed staging authorization bug is or is not present, using a
  synthetic account, stopping the instant it is answered.

**Never** in production: S7, S8, **S11**, anything enumerating, anything writing, and anything
that amplifies load.

## Request ceilings

| Class | Ceiling |
|---|---|
| RPC probes | 200 total across the assessment |
| Rate-limit tests | one bucket per test, per the cap under test |
| `share_night` (S8) | **10 rows**, staging only |
| Forged-cookie middleware probe (S11) | **5 requests**, staging only. This one is an amplification lever, so the ceiling *is* the safety property — each request costs an outbound Supabase call. |
| Production confirmation | 10 requests total |

## Stop conditions

Straight from the ROE. Stop and notify immediately if: a real user's data becomes visible;
availability, latency, errors or cost move; a test reaches anything out of scope; a
credential is exposed; a result could alter or delete real data; monitoring is unavailable or
the window ends; or the stop phrase is issued.

**Do not continue to determine how much more is exposed.** Preserve minimal evidence, stop,
switch to incident handling.

## Monitoring prerequisite

The ROE requires a monitoring owner watching logs, alerts, cost and availability. **Today
there is no monitoring** (goal 11). So an assessment cannot satisfy its own go/no-go
condition until observability exists.

That is a real ordering constraint, not paperwork: staging → observability → assessment.

## Evidence template

For each finding: identifier, date, tester, environment, asset · preconditions and synthetic
accounts · plain-language impact and boundary crossed · minimal reproduction with secrets and
personal data redacted · smallest sufficient evidence · severity and confidence · whether
existing monitoring noticed it · recommended fix, owner, retest status · the nine-factor
Change Risk Brief if remediation is consequential.

## Authorization record — BLANK, unsigned

| Field | Value |
|---|---|
| Authorizing owner | |
| Test lead | |
| In-scope assets | |
| Environment | |
| Start / stop (with timezone) | |
| Source machine / IP | |
| Test accounts | |
| Allowed techniques | |
| Request ceiling | |
| Monitoring owner | |
| Emergency contact | |
| Stop phrase | |
| Evidence location + retention date | |

**Testing defaults to NOT ALLOWED for anything this record does not explicitly cover.**

## Pre-test go/no-go — current status

| Condition | Status |
|---|---|
| Authorization record complete | **NO** — blank |
| Staging exists with synthetic data only | **NO** |
| Backups and rollback understood | **NO** — restore never rehearsed |
| Monitoring and budget alerts active and watched | **NO** — none exist |
| Dedicated accounts ready | **NO** |
| Provider acceptable-use terms checked | **NO** |
| Test cases and ceilings approved | drafted above, unapproved |
| Emergency contact available | **NO** |

**Current verdict: NO-GO on every count.** That is the correct answer today, and the list
above is the shortest path to changing it.
