# App Privacy nutrition-label inventory — 2026-07-30

Code-evidenced inventory of what Next Bar collects, for Apple's App Privacy
questionnaire. Every claim below cites a file, migration, or schema. Where the
code cannot settle a question this document says **UNVERIFIED** rather than
guessing — a wrong App Privacy label is a false statement to Apple and to users.

**Scope:** the *currently shipped* product. Proposed features are in §5, clearly
separated. Supersedes the sketch in `docs/MASTER-TODO-2026-07-30.md:166`, which
omitted six categories (waitlist signups, push tokens, vibe profile, shared
nights, and the three rate-limit attempt tables).

**Method note — read this before regenerating.** The category list is derived by
enumerating **every column that references `public.profiles(id)` or
`auth.users(id)`**, not by grepping for plausible column names. Two failures on
earlier passes, both caught in review:
1. Name-matching missed `bar_change_queue.submitted_by` (not called `user_id`).
2. Enumerating only `supabase/migrations/*.sql` missed **`public.waitlist`
   entirely** — it is declared in `supabase/schema.sql`. That was the single most
   serious omission, because it is an unauthenticated email-collection surface
   with no deletion path (§3.0).
Regenerate over **both** `supabase/migrations/*.sql` **and**
`supabase/schema.sql`, and cross-check each table against whether `src/`
actually queries it.

---

## 1. Summary for the questionnaire

| Apple category | Collected | Linked to identity | Used for tracking |
|---|---|---|---|
| Contact Info — Email (accounts **and** waitlist) | **Yes** | Yes | No |
| User Content — ratings, comparisons, RSVPs, suggestions, vibe votes, shared nights | **Yes** | Yes | No |
| Contact Info — waitlist neighborhood + vibe profile | **Yes** (§3.0) | Yes | No |
| Identifiers — user ID, handle | **Yes** | Yes | No |
| Identifiers — push token | **Yes** | Yes | No |
| Usage Data — product analytics | **Yes** | **No** (see §3.12) | No |
| Location — precise | **Used, not collected** (see §3.13) | No | No |
| Diagnostics — crash/performance | **No** (see §4) | — | — |

**No third-party tracking SDK is present.** Runtime dependencies are
`@supabase/ssr`, `@supabase/supabase-js`, `framer-motion`, `leaflet`,
`leaflet-gesture-handling`, `next`, `react`, `react-dom`, `react-leaflet`
(`package.json`). None is an analytics, advertising, attribution, or crash
-reporting SDK. See §4 for the one third-party *data flow* that does exist.

---

## 2. How deletion works (applies to every row below)

`POST /api/account/delete` (`src/app/api/account/delete/route.ts:104`) calls
`admin.auth.admin.deleteUser(userId)` on the **token-verified caller only** —
"you can delete yourself, nobody else" (line 16). There are no per-table deletes;
everything relies on foreign-key cascade.

Enumerating **every** column in the migrations that references
`public.profiles(id)` or `auth.users(id)` gives **18 declarations**. **17** are
`on delete cascade`. **Exactly one is not:**

> `photo_permissions.granted_by_user_id uuid references public.profiles(id)
> **on delete set null**` — `0020_provenance_and_media.sql`

So the honest statement is: deleting the account removes every user row **except**
that one, where the row survives with its user reference nulled. The record
becomes anonymous rather than being erased — arguably the right call for a media
licence audit trail, but it means "delete my account" does not delete that row.
**Confirm this is intended before answering Apple's data-deletion question.**

**A second, larger gap: `public.waitlist` is not reachable by this cascade at
all.** It has no foreign key to `auth.users`, and it is defined in
`supabase/schema.sql` rather than the numbered migration set. A waitlist signup
therefore has **no deletion path anywhere in the product today** — see §3.0.

Two further notes:
- The route refuses when `LOOP_UNATTENDED=1` (line 41) — an unattended-safety
  gate, not a user-facing limitation.
- `src/lib/accountDeletion.ts` returns false on **any** failure, and the UI
  treats that as "nothing was deleted."

---

## 3. Shipped data categories

### 3.0 Waitlist signup — **pre-auth, unauthenticated, no deletion path**
- **Collected:** yes. **Linked:** yes (email is the identifier). **Tracking:** no.
- **Purpose:** launch waitlist.
- **Storage:** `public.waitlist(id, email, vibe_profile jsonb, neighborhood,
  age_range, source, created_at)` — defined in **`supabase/schema.sql`**, not in
  the numbered migrations.
- **Actually written:** only `{ email, neighborhood, vibe_profile }`
  (`src/app/api/waitlist/route.ts:70`). **`age_range` and `source` are dead
  schema** — a repo-wide search finds no write to either from any code path. Do
  **not** declare age range as collected; the column's existence is not
  collection. (Same "schema present, no write path" rule as §3.11a.)
- **Collected from:** `POST /api/waitlist` (`src/app/api/waitlist/route.ts`) — a
  **public, unauthenticated** endpoint. No account is required, so this is the
  one surface that collects personal data from a visitor who never signs up.
- **Deletion: NONE.** The table has no FK to `auth.users`, so
  `auth.admin.deleteUser` does not reach it, and no other code path deletes from
  it. A waitlist entry currently persists indefinitely with no self-service
  removal.
- **Why this was nearly missed, recorded so it is not missed again:** the
  completeness method in the header enumerates `supabase/migrations/*.sql`.
  This table is not there. **Any regeneration must also read
  `supabase/schema.sql`.**
- **Action before shipping the App Privacy answers:** this needs either a
  deletion path or an explicit retention statement. It also means §3.1's
  "email lives only in `auth.users`" is true for *accounts* but not for the
  product as a whole.

### 3.1 Email / auth identity
- **Collected:** yes. **Linked:** yes. **Tracking:** no.
- **Purpose:** account authentication.
- **Storage:** Supabase-managed `auth.users`. **Not** in `public.profiles` —
  that table has no email column (`0001_v0.5.0_auth_and_ratings.sql`). Note the
  separate pre-auth surface in §3.0, and that `0000_reconcile_v01_schema.sql`
  *renamed* rather than dropped the legacy v0.1 tables, so
  `profiles_v01_legacy` still physically carries an `email` column (empty). A
  future auditor grepping for `email` will find it; it is not a live path.
  The same rename left **`visits_v01_legacy`** and **`saves_v01_legacy`**
  (`supabase/schema.sql:45`, `:61`) — both user-referencing, and `visits` even
  carries free-text `notes`. All verified empty and queried by no code under
  `src/`, so they change no Apple answer, but they are listed here so the
  "enumerate both files" method reads consistently.
- **Deletion:** `auth.admin.deleteUser` (§2).

### 3.2 Display name and handle
- **Collected:** yes. **Linked:** yes. **Tracking:** no.
- **Storage:** `public.profiles(handle, display_name)` — `0001`, handles added in
  `0006_usernames.sql`.
- **Note for the reviewer — the default is NOT private.** `0001` created
  `is_private boolean not null default true`, but
  **`0006_usernames.sql` flips it: `alter column is_private set default false`**
  (recorded at `0006:20` as an operator decision), with a one-shot backfill of
  existing rows. So **new accounts are discoverable by handle/display name by
  default.** Citing only `0001` gives the opposite answer; this document said
  "private by default" until review caught it.
- **Deletion:** cascade from `auth.users`.

### 3.3 Bar ratings
- **Collected:** yes. **Linked:** yes. **Tracking:** no. **Purpose:** app functionality.
- **Storage:** `public.ratings(user_id, bar_id, tier, rated_at, score)` — `0001`.
  `tier` ∈ loved/liked/pass; `score numeric(3,1)` is null until pairwise runs.

### 3.4 Pairwise comparisons
- **Storage:** `public.pairwise_comparisons(user_id, winner_bar_id, loser_bar_id, compared_at)` — `0002`.

### 3.5 Follows and follow requests
- **Storage:** `public.follows(follower_id, followee_id, created_at)` — `0007`;
  `public.follow_requests(requester_id, target_id, created_at)` — `0008`.

### 3.6 RSVPs
- **Storage:** `public.bar_rsvps(user_id, bar_id, night, created_at)` — `0012`.

### 3.7 Bar suggestions
- **Storage:** `public.bar_suggestions(user_id, bar_id, night, created_at)` — `0011`.

### 3.8 Vibe votes
- **Storage:** `public.vibe_votes(user_id, night, tag, created_at)` — `0017`.

### 3.9 Shared nights
- **Storage:** `public.shared_nights(user_id, night, bar_ids[], loved_bar_id, share_token, shared_at)` — `0016`.
- **Reviewer note:** `share_token uuid` backs a deliberately public share link
  (`0015_public_shared_list.sql`). Anyone holding the token can read that night.
  That is intended, but it means this row is **user content the user can choose to
  publish**, and it should be described that way.

### 3.10 Push subscription tokens
- **Collected:** yes. **Linked:** yes. **Tracking:** no.
- **Storage:** `public.push_subscriptions(user_id, endpoint, p256dh, auth, created_at)` — `0009`.
  `endpoint`, `p256dh` and `auth` together are the Web Push credential —
  device-scoped identifiers.
- **Omitted from the earlier sketch.** Apple treats push tokens as an Identifier.

### 3.11 Rate-limit activity metadata — **omitted from the earlier sketch**
- **Collected:** yes. **Linked:** yes. **Tracking:** no. **Purpose:** abuse prevention.
- **Storage:** `public.follow_attempts`, `public.handle_claim_attempts`,
  `public.handle_search_attempts` — each keyed by user id with attempt
  counts/timestamps (`0006`, `0007`).
- These map a user id to activity timing. Low sensitivity, but they are
  user-scoped rows and belong in the inventory.

### 3.11a Schema exists, but NO shipped code path writes to it
Two tables carry user-referencing columns yet are **not** written by any
application code — verified: no file under `src/` queries either table by name.
They are therefore **not currently collected**, but they are one feature away
from being so, and their columns are already declared:

| Table | User column | On delete | Written by app code? |
|---|---|---|---|
| `public.bar_change_queue` | `submitted_by` | cascade | **no** |
| `public.photo_permissions` | `granted_by_user_id` | **set null** | **no** |

Both are from `0020_provenance_and_media.sql`. `bar_change_queue` was missed on
the first pass because its column is named `submitted_by`, not `user_id` — which
is why the completeness method in the header enumerates *references*, not column
names. If a bar-correction or photo-permission feature ships, promote these to §3
and re-check the `set null` on `photo_permissions` against §2.

### 3.12 Product analytics — collected but **genuinely not linked**
- **Collected:** yes (when enabled). **Linked:** **no.** **Tracking:** no.
- **Evidence, which is unusually strong here:**
  - `src/lib/analytics.ts` sends only `{ name }` from a four-value enum
    (`search|share|save|visit`). No user id, no bar id, no payload.
  - `src/app/api/event/route.ts:84` calls `bump_analytics_event(p_name, p_night)`.
  - `0018_analytics_events.sql` defines `analytics_events(name, night, count)`
    with primary key `(name, night)` and `count = count + 1`. **There is no
    per-user row and the schema physically cannot store an identifier.**
  - The table has RLS enabled and `revoke all … from public, anon, authenticated`;
    only `service_role` may touch it.
- **Off by default:** requires `NEXT_PUBLIC_ANALYTICS='1'` client-side *and*
  `ANALYTICS_ENABLED='1'` server-side (route returns 503 otherwise).
- The caller's IP is used transiently for rate limiting
  (`clientIpFromHeaders`, 60/min) and is **never persisted** to this table.

### 3.13 Precise location — **used, not collected**
- **Collected (stored):** **no.** **Linked:** n/a. **Tracking:** no.
- **Precision:** *precise*. `src/hooks/useGeolocation.ts:33` sets
  `enableHighAccuracy: true` (with `timeout: 10_000`, `maximumAge: 60_000`).
  Do **not** answer "coarse" on the questionnaire.
- **When:** while-using only — `getCurrentPosition` on demand
  (`useGeolocation.ts:184, 229`). There is exactly one geolocation
  implementation site in the codebase.
- **Never persisted, verified two ways:**
  - No user-scoped table has a coordinate column. `lat`/`lng` columns appear in
    only four migrations — `0019_bars_catalog`, `0029`, `0030`, `0032` — all of
    them **venue** coordinates for `public.bars`.
  - No client storage key holds coordinates (22 `next-bar:*` localStorage keys
    enumerated; none coordinate-bearing).
- Apple still requires disclosure of location **use**; the honest answer is that
  precise location is accessed while-using for nearby-bar ranking and is not
  stored or transmitted to us.

### 3.14 Client-side storage (not "collection", but disclose if asked)
22 `next-bar:*` `localStorage` keys, all device-local: age acknowledgement,
ratings, pairwise, follows, lists/want-to-go, night log/phase/vibe, intent,
saved, onboarding + nudge dismissals, demo-seed markers, and the vibe profile
(`next-bar:profile:v1`). Cleared on sign-out via `src/lib/accountCache.ts`.

---

## 4. Third-party data flows

| Recipient | What it receives | Evidence |
|---|---|---|
| **Supabase** | All §3 rows; acts as processor/backend | `@supabase/*`, all migrations |
| **CARTO** (`basemaps.cartocdn.com`) | **IP address and map viewport** on every tile request | `src/components/BarMap.tsx:246` — `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png` |

The CARTO flow is easy to miss because it is not an SDK — it is a tile URL. Every
map pan/zoom reveals the user's approximate area and IP to a third-party CDN. It
is standard for web maps, but it is a genuine outbound flow and should be
declared or consciously accepted.

**No crash reporter, no attribution SDK, no ad network, no session-replay tool.**

---

## 5. Proposed — NOT SHIPPED, do not declare yet

- **Geo-tagged night-out photos.** Would introduce user-supplied photos with
  embedded location. `public.bar_photos` carries **no** user-referencing column
  (verified against the full reference enumeration in §2) — it is venue/catalog
  media. `public.bar_change_queue` and `public.photo_permissions` **do** carry
  user references and are therefore already shipped categories, documented at
  §3.11a and §3.11b rather than deferred here. Gated on open question **B8**,
  still unanswered.
- **`public.vibe_profiles`** (`0033_vibe_profiles.sql`) — the code path shipped
  (commits `be45c58`, `b19c0e8`) and stores the quiz result
  (`user_id, profile jsonb, saved_at`) under owner-only RLS. **The migration is
  authored and NOT applied**, so nothing is stored server-side today. It becomes
  §3 "User Content — linked, no tracking" the moment 0033 is applied.

---

## 6. UNVERIFIED — needs operator confirmation

These cannot be settled from the repository:

1. **Supabase project region / data residency**, and whether a DPA is in place.
2. **Server log retention** — whether the host retains request logs containing
   IPs, and for how long. The app logs errors via `console.error`; where those
   land is host configuration.
3. **CARTO terms** — whether the current tile usage is within their free/attributed
   tier and what they retain.
4. **Whether analytics is actually enabled in production** — both flags default
   off; §3.12's "collected: yes" assumes they are on. If they are off in
   production, Usage Data is **not collected** and the label should say so.
5. **Backup retention** — how long deleted rows persist in Supabase backups after
   the cascade.

---

## 7. Reconciliation with `docs/APP-STORE-PLAN.md`

That document predates this inventory. Where the two disagree, **this document is
authoritative** (it is code-evidenced and dated). Specifically it omits: push
tokens, vibe profile, shared-night share tokens, the three rate-limit attempt
tables, and the CARTO tile flow; and it does not distinguish *precise* from
*coarse* location. A follow-up should annotate that file to point here rather
than restating the inventory in two places.
