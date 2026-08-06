# PACKET — Reusable Crews + ephemeral invited Night Outs — 2026-08-05 (goal g-6b9f79ec)

Architecture packet only: **nothing here is built, and this packet authors no
DDL.** It defines the target contract, data model, privacy boundaries, and
policies for the feature the repository currently does NOT have, so that
implementation can start from a reviewed design. Review class: T0 privacy
(scope doc) — Fable + Codex gating, GLM cross-file + DeepSeek RLS/privacy as
risk-routed specialists.

## What exists today is NOT this feature (explicit distinction)

Repository evidence (matrix row "Crews", handoff block B, code):

- `TonightSuggestions` mounts on `/friends/consensus` for signed-in
  server-mode users; `get_circle_suggestions` reads **the caller plus users
  they follow** — a *followed-circle*, not a night-scoped invitee set.
- "Invite friends" is the zero-server-state `/join` link: no roster, no
  acceptance, no revocation, no night binding.
- Suggestion e2e stubs Supabase; nothing proves an invited member can join,
  see, suggest, vote, be removed, or lose access.

Any implementation that widens `get_circle_suggestions` instead of scoping to
an invited roster fails steps 4–6 of the contract below by construction.

## Target contract (verbatim, docs/MORNING-HANDOFF-2026-08-05.md block B)

1. Owner creates a reusable Crew and invites two real accounts.
2. Invitees accept and appear in the reusable roster.
3. Owner starts a Night Out from that Crew and may alter that night's roster.
4. An invited member sees the Night Out on mobile and suggests a bar.
5. Every invited member sees and can vote on the suggestion.
6. A follower/nonmember cannot see the Night Out or its activity.
7. A removed or blocked member loses access; revoked/expired links fail safely.
8. A one-night guest does not silently join the permanent Crew.
9. Weekend coordination closes while the reusable Crew and permitted recap
   remain according to the approved retention policy.
10. The complete chain passes real multi-account protected-Staging testing,
    dual mobile viewports, and privacy/RLS review.

## Data model (proposed)

Two lifetimes, deliberately separate: a **Crew** is durable social structure;
a **Night Out** is one night's ephemeral coordination that *references* a
Crew but owns its own roster (steps 3 and 8 both demand the copy, not a
pointer).

```
crews                 id, owner_id → profiles, name, created_at
crew_members          crew_id, user_id, role ('owner'|'member'),
                      added_at, PK (crew_id, user_id)
crew_invitations      id, crew_id, inviter_id, token_hash, invitee_id NULL
                      (bound on accept), status ('pending'|'accepted'|
                      'revoked'|'expired'), created_at, expires_at
night_outs            id, crew_id NULL (a crew may be deleted later;
                      the night survives), owner_id, night_key, status
                      ('open'|'locked'|'closed'), winner_suggestion_id
                      NULL → night_out_suggestions (soft pointer,
                      ON DELETE SET NULL), winner_bar_id NULL → bars
                      (denormalized at lock), locked_tally jsonb NULL
                      (frozen per-suggestion counts + suggester
                      identities, written at lock), created_at, closes_at
night_out_invitations id, night_out_id, inviter_id, token_hash,
                      invitee_id NULL (bound on accept), status
                      ('pending'|'accepted'|'revoked'|'expired'),
                      used_at NULL (single-use burn), created_at,
                      expires_at (= the night's closes_at)
night_out_members     night_out_id, user_id, role ('owner'|'member'|'guest'),
                      source ('crew'|'guest_invite'), added_at,
                      removed_at NULL, PK (night_out_id, user_id)
night_out_suggestions id, night_out_id, suggester_id, bar_id → bars,
                      created_at
night_out_votes       suggestion_id, voter_id, created_at,
                      PK (suggestion_id, voter_id)
```

Design commitments the model encodes:

- **Roster copy at start (step 3):** starting a Night Out snapshots current
  `crew_members` into `night_out_members` with `source='crew'`; the owner
  edits the copy. Later Crew changes never mutate a started night.
- **Guests stay guests (step 8):** a one-night guest is a
  `night_out_members` row with `source='guest_invite'`; **no code path
  writes `crew_members` from a Night Out flow.** The implementation must
  carry a test asserting exactly this negative.
- **Soft remove (step 7):** `removed_at` on `night_out_members` rather than
  row deletion, so "was removed" is distinguishable from "never invited" for
  both RLS and audit; RLS predicates require `removed_at IS NULL`.
- **Votes are per-suggestion, one per voter** (matrix E1.4 remainder:
  persistent server-side votes) — the poll register (counts + voter names)
  is a SELECT over `night_out_votes` joined to members, never a denormalized
  counter. **The join must repeat `removed_at IS NULL`** — aggregation
  queries are where the predicate is most plausibly forgotten, silently
  counting removed members' votes (consult: DeepSeek).
- **The E1.4 LOCK step is a status value, not a timestamp inference**
  (consult: GLM): `open → locked` fixes `winner_suggestion_id` and freezes
  suggestions/votes; `locked → closed` ends the night. `closes_at` alone
  cannot express "poll locked, winner chosen" without race-prone
  application-derived state.
- **Boundary with `bar_rsvps` (0012–0014), defined, not integrated**
  (consult: GLM): `bar_rsvps` = "I'll be at bar X" (existing, follows-facing
  surface); `night_out_votes` = "which bar should OUR night pick" (roster-
  scoped). v1 performs no join or dedup between them; a user may legitimately
  hold both. Reading RSVPs as a suggestion *signal* is a later, separate
  decision — silently merging the two surfaces would re-open the
  followed-circle leak this design exists to close.
- **Relation to the personal night log:** `nightLog`/`nightKey` (local,
  personal) stays untouched. A member's personal log MAY reference the
  Night Out id later (recap integration) — out of scope here.

## Invitations and revocation

- Crew invitations are **account-bound on acceptance**: the link carries a
  single-use token stored as `token_hash`. **This is a deliberate
  strengthening over, not a continuation of, the shared-nights precedent**
  (santa round-2: Fable — 0016 stores its `share_token` in plaintext with
  a unique index; no `token_hash` exists anywhere in the repo today): the
  shared-nights pattern contributes only "unguessable high-entropy bearer,
  no enumeration path"; hashing at rest is new here because crew tokens
  gate membership, not one page. Accepting while signed in binds
  `invitee_id` and flips status. Accepting signed-out routes through `/auth` with the
  validated same-origin `?next=` return path — **that return path is Phase B
  scope (`g-c8b26779` item 4); this packet depends on it and must not
  re-implement it.**
- **Acceptance is an atomic compare-and-swap, never SELECT-then-UPDATE**
  (consult: DeepSeek): `UPDATE crew_invitations SET invitee_id=$caller,
  status='accepted' WHERE token_hash=$h AND status='pending' AND
  expires_at>now() AND invitee_id IS NULL RETURNING …` — rows-affected is
  the verdict. Two sessions racing one token cannot both bind, and there is
  no window in which a second caller learns "someone just accepted."
- **The same RPC statement inserts the roster row** (santa: Codex + Fable,
  independently): the CAS above and `INSERT INTO crew_members (crew_id,
  user_id, role) … 'member'` execute as one CTE in the definer RPC —
  step 2's "appear in the reusable roster" is the insert, not the status
  flip. An implementation that ships only the invitation-flip has built
  nothing; the acceptance test is a crew page the invitee can now read.
- **Failure indistinguishability is a hard requirement** (consult:
  DeepSeek): expired, revoked, already-used, and never-existed tokens must
  produce the identical error code, message, and response timing —
  otherwise the token endpoint is a state-probing oracle (crew exists /
  inviter active / someone joined). On success the RPC returns
  `{crew_id, crew_name}` and nothing else — no member count, no inviter
  identity, no created_at.
- Revocation (`status='revoked'`) and expiry (`expires_at`, default
  proposal: 14 days) fail closed: an accepted-then-revoked invitation does
  not remove an existing member (removal is a roster operation, not an
  invitation operation); a revoked/expired **pending** token dead-ends with
  the honest-fallback pattern from Phase A (no oracle about crew existence).
- Night-out guest invites reuse the same token mechanics scoped to one
  `night_out_id` with `role='guest'`, expiry = the night's `closes_at`, and
  **single-use burn recorded on the token row (`used_at`)** so a night that
  ever re-opens cannot resurrect an already-spent guest link (consult:
  DeepSeek).
- **Guest entry path, distinct from `/join`** (consult: GLM): the stateless
  `/join` link remains what it is today — an account-acquisition link with
  zero server state — and gains no crew semantics. Guest invites are a NEW
  night-scoped token route; opening one signed-out routes through `/auth`
  with the validated `?next=` return (the Phase B dependency named above)
  and lands the acceptor in `night_out_members` with `role='guest'` via the
  same definer-RPC CAS pattern.

## RLS / privacy boundaries (step 6 and 7 as predicates)

Written as intent, not DDL; the migration author turns each into a policy +
a test on real Staging (step 10).

| Table | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| crews | members only | owner only (rename/delete); creation by any authed user |
| crew_members | members of that crew | additions ONLY via the acceptance definer RPC (no direct owner-add policy exists — every join passes through an invitation); owner removes; self-remove allowed |
| crew_invitations | inviter + bound invitee only — **never listable by token** | inviter creates/revokes; invitee accepts via definer RPC |
| night_outs | current members (`removed_at IS NULL`) only | owner only |
| night_out_members | current members of that night | additions only while `status='open'`, and only via the start-snapshot / guest-accept definer RPCs; removals (owner, self-leave, moderation) in every state |
| night_out_suggestions | current members | suggester inserts (open only); owner or suggester deletes (open only — lock freezes deletion) |
| night_out_votes | current members | voter mutates own vote, `status='open'` only — enforced in the policy predicate itself, not just the RPC |
| night_out_invitations | inviter + bound invitee only — never listable by token | inviter creates/revokes (open only); acceptance via definer RPC CAS |

Cross-cutting rules:

- **Every night-table policy correlates BOTH conditions** (consult:
  DeepSeek): membership checks must bind `night_out_members.night_out_id`
  to the row under test AND require `removed_at IS NULL` — an uncorrelated
  `EXISTS (… WHERE user_id = auth.uid())` lets a guest on night A read
  night B, and an uncorrelated own-row vote SELECT lets a *removed* member
  keep reading the suggestions they voted on. This applies to the caller's
  own rows too.
- **`start_night` is definer-scoped and atomic** (consult: DeepSeek): the
  roster snapshot re-verifies the caller's live crew membership and copies
  `crew_members` rows in one statement (CTE), so a concurrently-removed
  member can neither snapshot themselves in nor harvest a roster they can
  no longer see; failure surfaces no crew-size side channel. **v1 caller =
  the crew owner only** (santa: Codex — contract step 3 says the owner
  starts; a member-start relaxation is a later operator decision, not a
  default).
- **Lifecycle enforcement lives in the authorization layer, not app code**
  (santa: Kimi): the `open→locked→closed` machine is enforced by (a) a DB
  trigger refusing skips and regressions and (b) `night_outs.status`
  checks inside the mutation policies / definer RPCs themselves. **The
  freeze is precisely scoped** (santa round-2: Codex + DeepSeek caught
  the earlier absolute contradicting close and Block): what lock freezes
  is *member-initiated* mutation — votes, suggestions, suggestion
  deletion, roster ADDITIONS. Privileged, privacy-TIGHTENING definer
  operations — moderation removals (incl. v1 Block's compound removal,
  which targets every NON-CLOSED night: open AND locked — santa round-3:
  Codex) and close's guest termination — are permitted in every state;
  a rule that blocked removals after lock would leave a blocked member
  authorized, which is the worse failure. Division of labor, stated
  precisely (santa round-3: Fable): the `night_outs` trigger owns ONLY
  the status state machine (open→locked→closed, plus a direct
  open→closed CANCEL transition for abandoned nights, which skips
  materialization and leaves the winner columns NULL); the per-table
  freeze/exception rules live in each table's policies and definer RPCs
  — no triggers on the child tables.
- **All member mutations flow through definer RPCs; direct DML is denied
  by policy** (santa round-3: Codex + DeepSeek + Kimi, independently):
  votes and suggestions carry no direct INSERT/DELETE grant — the RPCs
  are the only writers, each takes the night row's `FOR UPDATE` lock
  before mutating, and the `status='open'` predicate additionally lives
  in the policies as defense in depth. This closes the remaining race: a
  vote cannot land between the lock transaction's count and its status
  flip, because every write path serializes on the row lock the lock
  transaction already holds.
- **Nothing closes a night except code that runs** (santa round-3: Codex
  + DeepSeek — time passing flips no row): the authorization predicate
  treats a night as effectively open only while `status='open' AND
  now() < closes_at`, so expiry revokes mutation immediately with no
  scheduler; the first definer-RPC touch after `closes_at` executes the
  close transition lazily — no cron dependency, and an owner who goes
  dark cannot strand a night in a writable state.
- **The recorded outcome is denormalized at lock, in the model** (santa
  round-2: Codex + DeepSeek + Kimi, independently): the lock transaction
  takes `FOR UPDATE` on the `night_outs` row, counts votes under that
  lock, and writes `winner_bar_id` (plain bar reference) and
  `locked_tally` (frozen per-suggestion counts + suggester identities)
  onto `night_outs` — THEN flips status. Every mutating RPC's status
  predicate is evaluated under the same row lock, closing the
  vote-lands-during-lock race (Kimi's highest residual risk).
  `winner_suggestion_id` stays as a soft pointer with `ON DELETE SET
  NULL`; retention may purge suggestion rows without erasing what was
  decided, and a NULLed pointer leaks nothing because the outcome lives
  in the denormalized columns. The acceptance CTE's roster INSERT
  **selects from the CAS UPDATE's RETURNING set** — never from raw
  parameters — so a failed CAS cannot commit a roster row (santa
  round-2: Kimi).
- **Crew removal does not propagate into non-closed nights** (santa: Kimi —
  named as the deliberate consequence of the snapshot, with its lever):
  removing someone from a crew leaves them on nights already started;
  the moderation UI's compound action "remove from crew AND all non-closed nights" (open and locked)
  is the operator-facing lever, executing per-night roster removals.
- **Close sets guests' `removed_at` — decided, one behavior** (consult:
  DeepSeek; fork resolved santa round-2: Fable): closing a night stamps
  `removed_at` on every `source='guest_invite'` row, which fully revokes
  guest access — a later re-open cannot silently re-admit expired guests,
  and a former guest reads nothing after close. Whether guests should
  instead retain read access to the closed night's OUTCOME (the frozen
  winner/tally, nothing live) is a product call — promoted to operator
  question 7; the v1 default is full revocation.
- **Followers get nothing (step 6):** no policy may reference `follows` —
  the deliberate inversion of `get_circle_suggestions`. A follower who is
  not a member sees zero rows from all seven tables.
- **Acceptance goes through a SECURITY DEFINER RPC** (matching the repo's
  definer-RPC precedent and the 0034 revoke-first grant discipline): token
  verification must not require SELECT on `crew_invitations`, or the token
  becomes an enumeration oracle. The RPC takes the raw token, hashes,
  matches single-use, binds, and returns only the joined crew's display
  fields.
- **Blocked users (step 7):** blocking is not yet a first-class object in
  the schema (follows has no block table). Proposal: removal from the
  roster is the enforcement point for Night Outs; a durable `blocks` table
  is a SEPARATE decision explicitly not smuggled in here. If the operator
  wants block-propagation into Crews, that is new scope.
- **Anti-abuse parity:** invitation creation gets an attempts table or rate
  limit consistent with `handle_claim_attempts` / `follow_attempts`
  precedent; and **suggestions carry the same 3-live-per-member-per-night
  cap `suggest_bar` (0011) already enforces** (santa: Codex + Fable + GLM,
  independently) — the closed roster lowers the abuse surface but does not
  justify silently dropping the repo's own precedent.
- **Bearer share links have no path into these tables** (santa: GLM): the
  existing `shared_nights` tokens expose the personal-night share surface
  only; no policy on the seven Crews tables honors any bearer token, and
  group-night sharing is out of scope for v1. Pre-burn forwarding of a
  crew/guest invite link grants the seat to the first acceptor only —
  the burn is the containment (santa: Kimi).

## Expiry, retention, closure (step 9)

- A Night Out closes at `closes_at` (default proposal: the **6am NY
  rollover** following its `night_key` — `NIGHT_ROLLOVER_HOUR = 6` in
  `src/lib/socialNight.ts` is this branch's single rollover; the 5am/6am
  split exists only in the `release/beta1-rc` composition, NOT here —
  santa: Fable) or when the owner closes it. `night_key` is computed by
  the existing `nycNightKey` convention at the explicit start action; the
  roster snapshot happens at that same event, not at a midnight boundary
  (santa: GLM). Closed = read-only for suggestions/votes.
- **Retention policy — OPERATOR DECISION, options proposed, not decided:**
  - **A (minimal):** purge `night_out_suggestions`/`votes` N days after
    close (proposal N=30); keep `night_outs` + roster as history; recap
    remains personal-side.
  - **B (keep-all):** everything persists until crew/night deletion;
    simplest, heaviest privacy surface.
  - **C (anonymize):** after N days, drop voter identities, keep counts.
- Crew deletion cascades invitations; started nights survive with
  `crew_id NULL` (history is the member's too, not only the owner's).
- **Recap/retention views must not leak past a removal** (consult:
  DeepSeek): whichever retention option is chosen, a removed member's view
  of history ends at their `removed_at` — the "historical roster" a recap
  deliberately preserves is what OTHERS see about the night, never a
  window through which the removed member reads activity that happened
  after removal.

## Moderation

Owner removes members (crew or night); removed members lose access
immediately via the `removed_at` predicate (step 7). **In v1, "Block" IS
the compound removal** (santa: Codex — step 7 names blocked members, so
the trace must be explicit): the moderation UI's Block action performs
removal from the crew and all non-closed nights (open AND locked — santa round-3: Codex); there is no independent block
state or table. Guests expire with the night. Ownership transfer,
reporting, and a durable block system are named non-goals of v1 — each is
an operator decision if wanted.

## Notification policy — OPERATOR DECISION, options proposed

Foundation: `push_subscriptions` (0009) exists; push is preflight-disabled;
native APNs is the platform packet's subject (`g-9b97c22d`) — this packet
only defines *what* may notify:

- Candidate events: crew invitation received; night out started from your
  crew; suggestion added; vote landed; poll locked; roster change affecting
  you.
- **Integration point** (consult: GLM + DeepSeek): events are emitted
  app-side after commit (no DB triggers in v1) against the
  `push_subscriptions` rows of **current** members only — the fan-out query
  carries the same `removed_at IS NULL` predicate as the RLS policies, or
  removed members keep receiving the night's activity through the side
  channel the policies just closed. The membership predicate is written
  ONCE as a SQL function both the policies and the fan-out call — copied
  predicates drift (santa round-2: Kimi).
- **The channel is OFF today and this packet does not turn it on** (santa:
  GLM): push is preflight-disabled and native APNs is absent — the policy
  above activates only after the platform packet's APNs work
  (`g-9b97c22d`) and an explicit operator enable. No Crews implementation
  work implies enabling push.
- **Opt-in default options:** (i) all off until the user enables per-crew
  (privacy-first, recommended for beta); (ii) invitation+night-start on by
  default, activity off; (iii) all on. No notification may leak content to
  a lock screen beyond crew name + event type until reviewed.

## Migration numbering (goal requirement — reservations respected)

| Number | State |
|---|---|
| 0038 | RESERVED venue pins (draft at `supabase/migrations/drafts/0038_venue_pins.sql` — NOT in the top-level migrations dir; santa: Codex misread exactly this) |
| 0039 | RESERVED social Phase B (no file) |
| 0040 | RESERVED night photos (no file) |
| 0041 | census source widening — applied to Staging only |
| 0042 | **CLAIMED by `feat/beta1-account-sync@f40783a`** (sibling worktree `nb-account-sync`, unreviewed, unapplied, unpushed — verified 2026-08-05) |
| **Crews** | therefore targets **0043+**, re-verified against the ledger and all worktrees at authoring time; it must NOT create or renumber 0038/0039/0040/0042 |

## Acceptance mapping

Steps 1–9 map to the model/policies above; step 10 is the gate this packet
cannot satisfy: **real multi-account protected-Staging testing, dual mobile
viewports, privacy/RLS review** happen at implementation. Every RLS row in
the table above must land as at least one live-Staging denial test (stranger,
follower-nonmember, removed member, revoked token, expired token, guest
post-close).

## Open questions for the operator (decide before implementation)

1. Retention option A / B / C (default proposed: A, N=30).
2. Notification opt-in default (i) / (ii) / (iii) (proposed: (i) for beta).
3. Should blocking be a durable first-class object now, or is roster
   removal sufficient for beta? (Proposed: removal only; block table later.)
4. May a Night Out exist without a Crew (ad-hoc night with guests only)?
   The model permits it (`crew_id NULL`); product call.
5. **Voting model** (santa: DeepSeek): the PK `(suggestion_id, voter_id)`
   is approval voting — a member may up-vote several suggestions.
   (Suggestion rows belong to exactly one night, so the key is
   night-scoped transitively — there is no cross-night collision; santa:
   Kimi's contrary reading checked and refuted.) Alternative: single-choice
   via a `(night_out_id, voter_id)` unique key. Proposed: approval for
   beta. **Tie rule at lock** must be stated either way. Note (santa
   round-2: Kimi): earliest-created tie-break + the 3-cap incentivizes
   dumping low-effort suggestions at night creation to bank priority —
   so the options are (a) earliest-created (simple, gameable), (b)
   random seeded by night id (ungameable, verifiable), (c) owner picks
   manually from the tied set before locking. Proposed: (c) with (b) as
   the no-show fallback.
6. **Follows↔Crew bridge** (santa: Kimi, strategic): the design gives a
   follower no route into a crew except an out-of-band invite. Leaving
   the two graphs unbridged is a conscious product decision — decide
   whether crew invite surfaces suggest from the follows graph, or the
   surfaces stay fully separate for beta (proposed: separate; revisit
   after real usage).
7. **Guest access to a closed night's outcome** (santa round-2: Fable):
   v1 fully revokes guests at close. Should former guests instead keep
   read access to the frozen winner/tally (a growth-friendly artifact,
   also a privacy expansion)? Proposed: full revocation for beta; the
   share-loop question returns with group-night sharing later.
8. **Who may start a Night Out** (santa round-3: Fable — stated in prose,
   now listed): v1 default is the crew owner only (contract step 3);
   relaxing start to any member is an operator decision, not a default.
