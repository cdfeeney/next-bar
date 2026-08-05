# C4 — Security-definer function audit (C3 F2)

Audited 2026-07-30 against `feat/phase1-compliance-media` at `458b994`.
No migration applied, no database mutated, no live access. Static audit of the
migration sources only.

`docs/C3-RLS-AUDIT-2026-07-30.md` F2 named this "the highest-value security work
remaining" and admitted it only spot-read these functions. This is the dedicated
pass. The premise, restated because everything below depends on it: these
functions run as their **definer**, so RLS does not constrain them. Each
function body **is** the entire access-control boundary for the rows it touches.

## Method

Counting this surface by hand is what produced wrong numbers earlier in this
work queue, so the inventory is parsed deterministically rather than eyeballed:

- Every `create [or replace] function public.*` across `supabase/migrations/*.sql`
  is collected in file order, and **the last definition wins** — `follow_user`
  (0007, then dropped and recreated in 0008) and `pending_change_count` (0020,
  replaced in 0021) both have superseded earlier versions that must not be
  audited as if live.
- A function is counted as a definer function only if its **surviving**
  definition carries `security definer`.
- EXECUTE grants and revokes are replayed **in order**, including the fact that
  `CREATE FUNCTION` grants EXECUTE to `PUBLIC` by default while
  `CREATE OR REPLACE` preserves the existing ACL and `DROP` discards it.

Result: **29 security-definer functions**, **28 callable via PostgREST**,
`handle_new_user` trigger-only, **0 with an unpinned `search_path`**. This
reproduces C3's independently-derived counts exactly, which is the cross-check
that the parser is reading the same surface a human reviewer did.

## Headline

**No function derives identity from a caller-supplied parameter.** This was the
single most important thing to look for — a definer function taking a user id as
an argument and trusting it would be a straightforward authorization bypass, and
there is not one. All 26 authenticated functions read the actor from
`auth.uid()` and treat any uuid parameter strictly as the *object* of the
action, never the subject.

The two functions with no `auth.uid()` are both deliberate anonymous reads with
their own gate, examined individually below.

## Per-function matrix

Identity = where the acting user comes from. Bound = what stops abuse.

| Function | Mig | Execute | Identity | Bound | Verdict |
|---|---|---|---|---|---|
| `handle_new_user` | 0001 | PUBLIC (default) | trigger context | trigger-only | F3 (info) |
| `claim_handle` | 0006 | authenticated | `auth.uid()` | 10/day `handle_claim_attempts`; no renames | OK |
| `search_handles` | 0006 | authenticated | `auth.uid()` | 500/day `handle_search_attempts`; prefix only | OK |
| `get_following` | 0007 | authenticated | `auth.uid()` | own graph | OK |
| `get_friend_ratings` | 0007 | authenticated | `auth.uid()` | own graph; materialized fence | OK |
| `get_profile_by_handle` | 0007 | authenticated | `auth.uid()` | 500/day shared cap | OK |
| `unfollow_user(target)` | 0007 | authenticated | `auth.uid()` | deletes own edge only | OK |
| `follow_user(target)` | 0008 | authenticated | `auth.uid()` | 100/day `follow_attempts`, bump-then-check | OK |
| `accept_follow_request(requester)` | 0008 | authenticated | `auth.uid()` | `target_id = uid`; refuses if not found | OK |
| `decline_follow_request(requester)` | 0008 | authenticated | `auth.uid()` | `target_id = uid` | OK |
| `cancel_follow_request(target)` | 0008 | authenticated | `auth.uid()` | `requester_id = uid` | OK |
| `get_follow_requests` | 0008 | authenticated | `auth.uid()` | own inbox | OK |
| `get_outgoing_requests` | 0008 | authenticated | `auth.uid()` | own outbox | OK |
| `save_push_subscription` | 0009 | authenticated | `auth.uid()` | PK `(user_id, endpoint)` | OK |
| `delete_push_subscription` | 0009 | authenticated | `auth.uid()` | own row only | OK |
| `get_followers` | 0010 | authenticated | `auth.uid()` | own followers | OK |
| `get_follower_count(profile_id)` | 0010 | authenticated | `auth.uid()` | 500/day cap; privacy-gated | **exemplary** |
| `suggest_bar(bar, night)` | 0011 | authenticated | `auth.uid()` | cap + ±2-day window | OK |
| `get_circle_suggestions(night)` | 0011 | authenticated | `auth.uid()` | own circle | OK |
| `rsvp_bar(bar, night)` | 0012 | authenticated | `auth.uid()` | ±2-day window; 1/night; advisory lock | OK |
| `get_circle_rsvps(night)` | 0012 | authenticated | `auth.uid()` | own circle | OK |
| `unrsvp_bar(bar, night)` | 0013 | authenticated | `auth.uid()` | own row only | OK |
| `get_public_ratings(handle)` | 0015 | **anon** + auth | none — by design | opt-in + `is_private` + tier-only + `limit 50` | OK |
| `share_night(night, bar_ids, loved)` | 0016 | authenticated | `auth.uid()` | route validated; **night NOT bounded** | **F1** |
| `unshare_night(night)` | 0016 | authenticated | `auth.uid()` | own row only | OK |
| `get_shared_night(p_token)` | 0016 | **anon** + auth | none — bearer token | 122-bit `gen_random_uuid()`; `limit 1` | **F2** |
| `cast_vibe_vote(night, tag)` | 0017 | authenticated | `auth.uid()` | ±2-day window; PK `(user, night)` | OK |
| `get_circle_vibe_votes(night)` | 0017 | authenticated | `auth.uid()` | own circle | OK |
| `pending_change_count` | 0021 | authenticated | `auth.uid()` | scalar count | OK |

## Findings

### F1 — MEDIUM · `share_night` is the one night-scoped writer with no date bound

`supabase/migrations/0016_shared_nights.sql`, `share_night`

`share_night` validates its route thoroughly — 1–20 bar ids, each non-empty and
≤100 chars, and the loved bar must be on the route — but performs **no
validation on `p_night`** beyond `not null`, and has no rate cap. Its three
sibling night-scoped writers all bound the date to a ±2-day window:

| Function | `current_date` guard |
|---|---|
| `suggest_bar` (0011) | yes |
| `rsvp_bar` (0012) | yes |
| `cast_vibe_vote` (0017) | yes |
| `share_night` (0016) | **none** |

**Exploit scenario.** Any signed-in user calls `share_night` in a loop over
distinct dates: `share_night('2999-01-01', [...20 ids...])`,
`'2999-01-02'`, and so on. The primary key is `(user_id, night)`, so each
distinct date is a **new row**, not an upsert. Nothing caps the call rate and
nothing rejects the date. Each row carries up to 20 bar ids of up to 100 chars,
so roughly 2 KB; 100,000 dates is ~200 MB from one account, and the loop costs
the attacker nothing but time. Every row also holds a `gen_random_uuid()` in a
unique index.

This is write amplification against storage, not a data-exposure bypass — it
requires an authenticated account and exposes nothing. That is why it is MEDIUM
and not HIGH.

*Fix:* apply the same `current_date ± 2` bound the siblings use. It is a
three-line change and makes the four night-scoped writers consistent. A
`shared_nights` row is meaningful only for a night the user actually went out,
so the window costs no legitimate functionality.

### F2 — LOW · Flipping a profile to private does not kill existing share links

`0016` `get_shared_night` vs `0015` `get_public_ratings`

`get_shared_night` resolves a night purely on the bearer token and returns the
owner's `handle` and `display_name` by joining `profiles`. It does **not** check
`is_private`. `get_public_ratings` explicitly does, with a comment calling it
"belt and braces: a private profile is never publicly listable even if the
opt-in got set before `is_private` was flipped on."

So the two anon-reachable functions carry different privacy semantics. A user
who shares a night, distributes the link, and later sets their profile to
private has stopped appearing in public listings — but every previously issued
link still resolves and still returns their handle, display name and route.

**Exploit scenario.** There is no unauthorized access here: the token is a
122-bit random capability with a unique index, unguessable and unenumerable, and
whoever holds it was given it by the owner. The gap is a *user expectation* one
— "make my profile private" plausibly reads as "stop showing my stuff to the
public", and it does not revoke bearer links. The documented revocation is
`unshare_night`, which does work.

*Fix:* an operator decision, not obviously a code bug. Either (a) have
`get_shared_night` drop the row when `p.is_private` is true, matching 0015, or
(b) state in the share UI that going private does not revoke links already sent
and that `unshare_night` is the control. Recommend (b) plus a UI line, since
killing live links on a privacy toggle would surprise in the other direction.

### F3 — INFO · `handle_new_user` is the one function that never revokes from `PUBLIC`

`0001_v0.5.0_auth_and_ratings.sql`

Postgres grants EXECUTE to `PUBLIC` on `CREATE FUNCTION`, and `anon` is a member
of `PUBLIC`. 28 of the 29 definer functions explicitly `revoke all ... from
public` before granting. `handle_new_user` never does, so `PUBLIC` retains
EXECUTE on it.

**Not exploitable, stated plainly:** it is declared `returns trigger`. Postgres
refuses a direct call with "trigger functions can only be called as triggers",
and PostgREST does not expose trigger-returning functions at all. There is no
reachable path.

It is recorded because it is the single deviation from an otherwise perfect
pattern, and because the *reason* it is safe is the return type rather than the
ACL — if this function were ever changed to return something else, the missing
revoke would become live in the same edit. A `revoke all on function
public.handle_new_user() from public, anon, authenticated;` costs nothing and
removes that coupling.

## What I did not find

Stated explicitly, because an audit reporting only problems is hard to trust —
and because these negatives were the specific things worth hunting:

- **No parameter-driven identity.** Not one function accepts a user id and acts
  as that user. Every uuid parameter is the object of the action; the subject is
  always `auth.uid()`.
- **No missing `PUBLIC` revoke on any callable function.** The ordered ACL
  replay found exactly one function where `PUBLIC` retains EXECUTE, and it is
  unreachable (F3).
- **No unpinned `search_path`.** All 29 pin it (C3 F1 separately argues `''` is
  stricter than `public`; that remains open and is not re-litigated here).
- **No unbounded writer.** My working hypothesis was that the ten writers with
  no rate-limit counter could grow rows without limit. Verified false for nine
  of them: they are bounded by a primary key containing `user_id` plus a ±2-day
  date window, which is a legitimate alternative to a counter. `share_night` is
  the single exception and is F1.
- **No accept-side consent forgery.** `accept_follow_request` constrains on
  `target_id = uid` and returns false when nothing was pending, so it cannot
  manufacture a follow edge nobody requested.
- **No existence oracle in `get_follower_count`.** An unknown profile and a
  hidden private profile both return the same `null`.

## What this audit did not cover

- **Live verification.** Everything here is read from migration sources. The
  live database was not queried, so this proves what the committed schema
  *says*, not what the production database currently *is*. C3's own warning
  applies: the ledger ends at `0032`.
- **Adversarial execution.** No function was called. Under the ROE
  (`docs/SAFE-SECURITY-TEST-ROE-2026-07-30.md`) active testing is staging-first
  and separately authorized; F1 in particular is a good candidate for a bounded
  staging test with a synthetic account, and must not be exercised against
  production.
- **The `_attempts` counter tables themselves**, which C3 covered.

## Disposition

| Finding | Severity | Needs |
|---|---|---|
| F1 `share_night` unbounded night | MEDIUM | a migration adding the ±2-day bound |
| F2 private-vs-share-link semantics | LOW | an operator decision |
| F3 `handle_new_user` PUBLIC execute | INFO | one revoke line, defence in depth |

None of the three is a reachable authorization bypass. Against the specific
question C3 F2 raised — whether authorization actually holds inside code RLS
does not constrain — the answer is that it holds.
