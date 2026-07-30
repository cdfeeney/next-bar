# C2/C3 remaining findings — disposition

Written 2026-07-30 during the overnight run for goal `g-c6848f33`. Six findings were left
open by the C2 and C3 audits. Two are now fixed in code; three get a recorded decision; one
is blocked on an operator answer.

| Finding | Severity | Outcome |
|---|---|---|
| C2 F1b — middleware amplification | MEDIUM | **SURFACE REDUCED** — `/api/:path*` removed from the matcher; the lever survives on the matched paths (see correction below) |
| C2 F5 — the shared `unknown` bucket | MEDIUM | **INSTRUMENTED** — measurement added, fix deferred until there is data |
| C2 F2 — X-Forwarded-For trust boundary | MEDIUM (HIGH if the origin is exposed) | **BLOCKED** on operator question 7 |
| C2 F4 — per-instance counters | MEDIUM | **ACCEPTED for now**, with the migration path recorded |
| C3 F1 — `search_path = public` vs `''` | MEDIUM | **DECIDED** — keep `public` on existing functions, require `''` on new ones |
| C3 F4 — two unreachable `follows` policies | LOW | **RETAINED deliberately**, and the reason is now in the migration |

---

## C2 F1b — SURFACE REDUCED (not eliminated)

`src/middleware.ts` matched `/api/:path*`, so `await supabase.auth.getUser()` ran on every
API request. Middleware runs **before** route handlers, so no per-route limiter could gate
it, and the audit measured the cost: **0** outbound Supabase calls with no cookie, **1**
(to `/auth/v1/user`) with a single fabricated `sb-<ref>-auth-token`. That is a free
amplification lever for anyone willing to send a forged cookie.

The old justification was "api routes may act on behalf of the user". Checked against every
API route, and it is not true of any of them:

| Route | How it authenticates | Needs a cookie session? |
|---|---|---|
| `api/account/delete` | **Bearer token**, verified with its own service-role client | no |
| `api/waitlist` | anonymous | no |
| `api/event` | anonymous, service-role writer | no |
| `api/health` | anonymous | no |

So the middleware was refreshing a session no API route consumed. The matcher is now
`['/auth/:path*', '/settings/:path*']` — the callback that *writes* the cookie and the page
that *reads* it. `src/middleware.test.ts` pins this, including the negative case, because the
regression to fear is someone re-adding a wildcard for convenience.

Side benefit: every `/api/*` request loses a middleware hop it never needed.

**Correction from the multi-model review (GLM).** The first version of this section, and the
commit message, said this "closed" the amplification lever. That over-claimed. The middleware
body still calls `getUser()` unconditionally, so a forged cookie aimed at `/settings/*` or
`/auth/*` still costs one outbound call. What changed is that the highest-volume and most
automatable paths no longer do. The root fix — verify the JWT locally before making any
network call, so a fabricated token costs zero — is recorded as follow-up work below.

### Follow-up work this review surfaced

| # | Item | Raised by | Why not now |
|---|---|---|---|
| 1 | Verify the session JWT locally in middleware before any network call | GLM | Architecture change to a T0 file; removes the amplification on *every* path rather than shrinking it |
| 2 | Wrap service-role client construction so it REQUIRES a verified user id | Kimi | `api/account/delete` is now a copy-paste template; a copy that drops the Bearer check would be a service-role endpoint keyed on a body-supplied id |
| 3 | Move `account/delete`'s 20/hour failed-verification bucket to shared state | Kimi | The one limiter where per-instance is a real hole rather than a rounding error — it is credential-stuffing defence on a destructive endpoint, so C2 F4's blanket "accepted" is too coarse for this specific bucket |
| 4 | Alert on unattributable-count spikes | Kimi | A log nobody alerts on is observability theatre; belongs with the observability goal |
| 5 | ADR recording the two auth paths (cookie vs Bearer) and the conflation failure modes | Kimi | Cheap, and the distinction currently exists only in commit messages |

## C2 F5 — INSTRUMENTED, not fixed

The finding is that all traffic with neither `x-forwarded-for` nor `x-real-ip` collapses into
one shared `'unknown'` bucket. The audit's own remediation order says **"measure before
fixing"**, and nobody had ever measured how much traffic lands there.

`clientIpFromHeaders` now counts attributed vs unattributable requests and exposes
`ipAttributionStats()`. At most once per hour **per warm instance** (not fleet-wide, and the
first unattributable request an instance sees logs immediately), it emits a single summary line. **Counts only — never header values**, since logging client IPs
would turn instrumentation into a privacy problem.

No behaviour changed: the returned bucket keys are identical, and a test pins that, because
altering them would silently repartition live rate-limit traffic.

**Next step is the operator's:** read those log lines. If `unknown` is a rounding error, the
finding closes as accepted. If it is material, the fix (a separate, tighter budget for
unattributable traffic) can be chosen against real numbers instead of a guess.

## C2 F2 — BLOCKED on operator question 7

The limiter trusts the first hop of `x-forwarded-for`. That is correct **only** while the
origin is reachable exclusively through Vercel's edge, which rewrites the header. If the
origin can be reached directly, a client sets `x-forwarded-for` freely and every IP-keyed
limit in the app becomes advisory — including the coarse pre-auth bound on account deletion.

This is not a code decision. It depends on deployment topology that the repository cannot
prove, which is why the audit rates it MEDIUM but says it **returns to HIGH** if the origin
is exposed.

> **Q7: can the application origin be reached directly, bypassing the Vercel edge?**

If **no**: document the trust assumption at the limiter and close.
If **yes**: switch to a hop the client cannot set (`request.ip`, or
`x-vercel-forwarded-for`) and treat this as HIGH.

## C2 F4 — ACCEPTED for now, path recorded

Counters live in module scope, so each warm serverless instance keeps its own. The effective
cap is `limit × instances`, and a redeploy or cold start resets everything.

**Accepted for now**, deliberately and with the reasoning stated rather than by omission:

- The two limits that matter most are already bounded by something other than the counter.
  `api/account/delete` now keys its real quota on the **verified user id**, and the action is
  idempotent — deleting an already-deleted account does nothing. `api/event` writes to an
  atomic upsert-increment bounded at 4 rows per night, so a flood inflates a counter but
  cannot bloat storage.
- Making it durable means a database round trip on every rate-limited request, including the
  destructive one. That is a latency and failure-mode change on the account-deletion path,
  which is exactly the kind of change that should not land unattended.

**When it should change:** the moment a limit protects something that costs money per call,
or the moment the app runs enough warm instances that `limit × instances` stops resembling
the intended number. The pattern already exists in-project —
`handle_claim_attempts`, `handle_search_attempts` and `follow_attempts` are all
database-backed rate-limit tables (migrations `0006`, `0007`). Moving
`api/account/delete` first is the right order, because it is the only destructive endpoint.

## C3 F1 — DECIDED: `public` stays on existing functions, `''` required on new ones

All 29 security-definer functions pin `search_path`. Twenty-eight pin `= public`; the LWW
guard added in `0033` pins `= ''`, so the codebase now carries two standards.

`= ''` is genuinely stricter: it forces every reference to be schema-qualified, so nothing
resolves through a search path at all. But the attack `= public` is exposed to requires an
attacker to **create an object in the `public` schema** that shadows something a definer
function resolves — and `anon`/`authenticated` have no `CREATE` privilege on that schema.
The pinned `= public` already defeats the search-path-manipulation attack itself.

Migrating 28 functions would mean re-qualifying every table and function reference in each
one, in a single sweep, with no test database available to prove it (see the goal-1 blocker).
That is a large mechanical change with real breakage risk and a small marginal gain.

**Decision:** existing functions keep `= public`. **Every new security-definer function must
use `set search_path = ''`** with fully-qualified references, as `0033` already does. The
gap closes as functions are touched for other reasons, rather than in one risky sweep.

## C3 F4 — RETAINED deliberately

`0007` revokes `insert`/`update`/`delete` on `public.follows` from client roles and grants
only `select`, while keeping the insert and delete **policies**. Without the table privilege
those policies can never be evaluated by a client — writes go through `follow_user` /
`unfollow_user`.

The audit calls this defensible, and it is: the policies are owner-scoped, so if a blanket
grant ever returned (the `0006` lesson — Supabase's defaults handed out table-level UPDATE
on `profiles`), they would still constrain writes to the caller's own rows. Dropping them, as
`0014` does elsewhere, would make that accident strictly more dangerous.

**Decision: retain.** The finding was really about two conventions existing for one
situation, so the fix is documentation, not SQL. The reasoning is recorded here and the
migration comment at `0007:69-71` already states it.
