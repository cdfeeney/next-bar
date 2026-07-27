# Next Bar — Scale Plan

> **Scope.** Architecture review of the Next.js 14 + Supabase PWA ahead of an App Store (Capacitor wrap) launch, answering the operator's question: *"what's the plan when we have a bunch of users?"*
> **Reviewed tree:** worktree at `…/scratchpad/wt-night4` (read-only), migrations `0000`–`0018`, `src/` as of night-4.
> **Paths below are repo-relative.** Everything quantitative is derived from the code as it exists; every load assumption is stated in §0.3 so the arithmetic can be re-run when real numbers arrive.

---

## Executive summary — what breaks first, and when

**At 1,000 MAU, nothing breaks numerically.** Every free-tier ceiling has 5–20× headroom. The catalog is static and CDN-served, all Supabase traffic goes browser→Supabase directly (`src/lib/supabase/client.ts` uses `createBrowserClient`, so it never touches a Vercel function), and `matches()` over 5,000 synthetic bars already measures ~6 ms (`src/lib/catalog.test.ts:148`). At this size the plan is: pay the two small bills below, add three indexes, and ship.

**Two things break on day 0 regardless of user count — neither is a capacity limit:**

1. **Vercel Hobby is not licensed for commercial use.** An App Store product is commercial by Vercel's own definition. A Hobby-plan deployment serving a shipped app is a ToS violation that resolves as an account suspension — i.e. the entire product goes dark with no warning tied to any metric you're watching. **Vercel Pro ($20/mo) is a launch prerequisite, not a scaling step.**
2. **Supabase Free has no automated backups and no PITR.** Today the only durable copy of a user's ratings and pairwise transcript is the free-tier Postgres. `localStorage` is a *cache*, not a replica — `useRatings` (`src/hooks/useRatings.ts:206`) treats the server as authoritative on hydrate. One bad migration or one dropped table and every user's rankings are gone, permanently. **Supabase Pro ($25/mo) is also a launch prerequisite.** The upgrade decision point is "before the first real user", not "at 400 MB".

**At 10,000 MAU, the first numeric wall is Vercel bandwidth, not the database.** `public/bar-photos/` holds **926 JPEG files** at ~640 px wide, served as raw `<img>` with no resizing (`src/components/BarVisualTile.tsx` deliberately avoids `next/image`) — including into **32 px tiles** in `BarPicker`. A single scroll through the 406-bar picker can pull tens of MB. Projected cold-cache transfer at 10k MAU is ~90–150 GB/mo against Hobby's ~100 GB (and comfortably inside Pro's ~1 TB). *The Capacitor wrap is the structural fix here: bundling `public/bar-photos/` into the app binary removes this cost entirely for native users.*

**The second wall is Supabase egress (5 GB free), and its single largest contributor is one RPC.** `get_friend_ratings` (`supabase/migrations/0007_follows.sql:277`) returns **every rating of everyone you follow, unpaginated, with no filter argument**, and the consensus board re-fetches it on every mount (`src/app/friends/consensus/page.tsx:70` → `fetchAllFriendRatings`, `src/lib/follows.server.ts:342`). Worse, the single-friend variant `fetchFriendRatings` (`src/lib/follows.server.ts:197`) fetches the *same full set* and filters client-side. A median circle costs ~18 KB per board view; a p90 circle (30 friends × 40 ratings) costs ~130 KB. Projected 2–3.5 GB/mo at 10k MAU — 40–70% of the free tier, and the growth is *quadratic in social density*, which is exactly the metric a social launch is trying to move.

**The third wall is DB size, and it is a housekeeping problem, not a data problem.** Core data at 10k MAU is only ~100 MB (§1.2). But `bar_suggestions`, `bar_rsvps`, and `vibe_votes` are night-scoped rows with **no retention policy anywhere** — they accumulate at roughly 50 MB/month at 10k MAU. So does `handle_search_attempts` (migration 0007 explicitly says "no cleanup needed yet"). A 14-day purge job is ~20 lines and removes the entire category.

**Things that will *not* break, contrary to the usual serverless worry:** auth MAU (50k free vs. 10k needed), and connection limits. There is no serverless connection storm here — the browser talks to PostgREST directly, and the only pooled-connection consumers are `scripts/apply-migrations.ts` and two rarely-hit API routes.

**The one latent cliff that is invisible until it isn't:** the free-tier Postgres is shared-CPU. A Friday 9 pm burst at 10k MAU is ~40 req/s of definer-RPC traffic, and the consensus board fires **8 round-trips per visit** (§2.1). If any of those RPCs picks a sequential scan — and two of them plausibly do today (§2.2) — that burst is where you find out. Three indexes and one `EXPLAIN` session is the cheapest insurance in this document.

**Ranked action list is in §7.** The top five, in effort order: pay for Pro on both providers (10 min), add three indexes (1 h), add a client SWR cache over the circle RPCs (4 h), bound `get_friend_ratings` and batch the score writes (3 h), ship photo thumbnails (4 h).

---

## 0. Method and assumptions

### 0.1 What the architecture actually is

| Layer | Reality in code | Scaling consequence |
|---|---|---|
| Pages | Every route is `'use client'` (`src/app/**/page.tsx`); no `generateStaticParams`, no server data fetching in pages | Pages prerender at build → **served from CDN, zero function invocations per page view** |
| Data | `createBrowserClient` singleton (`src/lib/supabase/client.ts`) | All read/write traffic is **browser → Supabase**, bypassing Vercel entirely. Vercel bandwidth ≠ data traffic |
| Catalog | Static TS arrays merged at module load (`src/lib/bars.ts:69`, `src/lib/catalog.ts:146`) | Zero query cost, but full catalog ships in the **JS bundle on every page** |
| Functions | 4 route handlers + 6 edge OG images | Only meaningful invocation source; OG unfurls are the volume driver |
| Auth | Supabase GoTrue via `@supabase/ssr`, `/auth/callback` route | Token refresh is the only background network chatter |

### 0.2 Catalog inventory (verified by counting `id:` entries)

`bars.core` 37 + `bars.extra` 59 + `expansion` 48 + `expansion2` 51 + `expansion3` 45 + `expansion4` 38 + `expansion5` 96 + `expansion6` 32 = **406 bars**, plus the generated `bars.places.ts` sidecar (427 very long lines, ~500 KB) and **926 photo files** in `public/bar-photos/`.

### 0.3 Load model (assumptions — replace with real telemetry once 0018 lands)

| Parameter | Value | Basis |
|---|---|---|
| Signed-in share of MAU | 40% | App is localStorage-first; social features are the sign-in hook. Sensitivity-tested at 25%/60% below |
| Sessions / MAU / month | 6 median, 20 p90 | Nightlife cadence, Thu–Sat weighted |
| Page views / session | 5 | |
| Consensus-board views / signed-in user / month | 8 | Primary social surface |
| Rated bars / signed-in user | 20 median, 80 p90 | |
| Pairwise rows / rated bar | 3.5 | Binary-insert chain caps at 7 (`src/lib/insertFlow.ts` via `usePairwise`) |
| Circle size | 8 median, 30 p90 | |
| Photo bytes | 80 KB avg / file | 640 px Google Places JPEG; **measure this — it is the single biggest lever in §4** |
| Peak concurrency | 3% of MAU, Friday 21:00–23:00 ET | |

Row-size estimates use Postgres heap overhead (~24 B header) + column widths + index entries, rounded up ~30% for fill factor and alignment.

---

## 1. Supabase free tier vs. 1k and 10k MAU

### 1.1 Ceilings vs. projected load

| Limit | Free tier | @1k MAU | @10k MAU | Verdict |
|---|---|---|---|---|
| Auth MAU | 50,000 | 400 | 4,000 | **Never binds.** 12× headroom even at 10k |
| DB size | 500 MB | ~12 MB + 5 MB/mo | ~105 MB + **~55 MB/mo** | Binds in **6–9 months at 10k** — entirely due to un-purged night rows |
| Egress | 5 GB/mo | ~0.25 GB | **2–3.5 GB (p50) / >5 GB (p90 circles)** | **First DB-side wall.** §1.3 |
| Realtime | 2 GB | 0 (unused) | 0 | N/A — no `.channel()` / `.subscribe()` anywhere in `src/` |
| Storage | 1 GB | 0 (photos are in git/Vercel) | 0 | N/A |
| Compute | Shared CPU, ~500 MB–1 GB RAM | ~4 req/s peak | **~40 req/s peak** | Latency risk under Friday burst; see §2 |
| Direct connections | ~60 (pooler) | 0 sustained | 0 sustained | **Never binds** — browser uses PostgREST |
| Backups | **None. No PITR.** | — | — | **Blocking at any size** |
| Project pausing | After 7 days idle | N/A (active) | N/A | Not a risk once live |

### 1.2 DB size derivation @10k MAU (4,000 signed-in accounts)

| Table | Rows | Bytes/row (heap+idx) | Total |
|---|---|---|---|
| `ratings` (3 indexes: PK, `user_idx`, `user_tier_idx`) | 80,000 | ~220 B | 18 MB |
| `pairwise_comparisons` (PK uuid + 2 indexes) | 280,000 | ~260 B | **73 MB** |
| `profiles` (+2 unique indexes on handle) | 4,000 | ~250 B | 1 MB |
| `follows` (PK + followee idx) | 32,000 | ~100 B | 3 MB |
| `auth.*` (users, sessions, rotating refresh tokens) | — | ~2 KB/account | 8 MB |
| **Core subtotal** | | | **~105 MB** |
| `bar_suggestions` + `bar_rsvps` + `vibe_votes` | 360k rows/mo | ~150 B | **+55 MB/month, forever** |
| `handle_search_attempts` + `follow_attempts` | ≤1 row/user/day | ~80 B | +10 MB/yr |
| `analytics_events` (0018, unapplied) | ~800k rows/mo | ~90 B | **+70 MB/month if applied as written** |

The `pairwise_comparisons` table is the largest *legitimate* consumer and it is append-only by design (migration 0002: "comparisons are immutable"). That's correct — but note the transcript is replayed in full client-side on every hydrate (`usePairwise` → `fetchServerComparisons` → `reconcileScores`), so a p90 user with 280 rows re-downloads and re-replays them on **every app open**. Bounded, but worth a compaction pass if p99 users reach thousands of rows.

**Retention is the whole story here.** Adding a 14-day purge on the three night-scoped tables turns "+55 MB/month forever" into a flat ~25 MB steady state, and moves the DB-size wall from ~9 months to *never* at this scale.

### 1.3 Egress derivation — where the 5 GB goes

Per consensus-board view (`/friends/consensus`, signed-in):

| RPC | Rows (p50 / p90) | Bytes (p50 / p90) |
|---|---|---|
| `get_friend_ratings` | 160 / 1,200 | **18 KB / 132 KB** |
| `get_following` + `get_followers` + `get_outgoing_requests` | 8 / 30 each | ~1 KB / 4 KB |
| `get_circle_suggestions` + `get_circle_rsvps` | ~15 / 60 | ~2 KB / 8 KB |
| `get_circle_vibe_votes` | ~8 / 30 | ~1 KB / 4 KB |
| `select` on `ratings` | 20 / 80 | ~2 KB / 8 KB |
| **Total per view** | | **~25 KB / ~156 KB** |

4,000 signed-in × 8 views/mo = 32,000 views. At a p50/p90 blend: **~1.5–2.5 GB**. Add per-navigation `select ratings` (every route change remounts `useRatings`, ~2 KB × 5 views × 6 sessions × 4,000 = 0.25 GB) and auth token refreshes, and the realistic band is **2–3.5 GB/mo at 10k MAU**.

Sensitivity: at 60% sign-in rate, or if median circle grows from 8 to 20 (a *successful* social launch), this crosses 5 GB. **Egress scales with social density, which is the exact thing the product is optimizing for** — that makes it the metric to instrument first.

### 1.4 Upgrade decision points

| Trigger | Action | Cost |
|---|---|---|
| **Any real user exists** | Supabase **Pro** — for daily backups + 7-day PITR, not for the quotas | **$25/mo** |
| Egress >4 GB/mo (80% of free) | Already on Pro (250 GB included) — no action | — |
| DB >400 MB | Already on Pro (8 GB included) — no action | — |
| p95 RPC latency >500 ms during Friday peak | Compute add-on: Micro→Small | +$10/mo |
| Sustained >100 req/s | Compute Medium + read replica evaluation | +$60/mo |
| 50k MAU | Auth billing kicks in ($0.00325/MAU beyond) | ~$130/mo @ 90k |

Once on Pro, **none of the free-tier ceilings in §1.1 bind before ~100k MAU.** The $25 buys you out of this entire section.

---

## 2. Definer-RPC hot paths under load

### 2.1 Per-page-view vs. per-action inventory

**`/friends/consensus` — 8 network round-trips on mount, in 4 parallel waves:**

| Wave | Calls | Source |
|---|---|---|
| 1 | `auth.getSession()` (+ token refresh if stale) | `src/hooks/useAuth.ts:33` |
| 2 | `get_following`, `get_outgoing_requests`, `get_followers` (`Promise.all`) | `src/hooks/useFollows.ts:157` |
| 3 | `get_friend_ratings` | `src/app/friends/consensus/page.tsx:70` |
| 3 | `get_circle_vibe_votes` | `src/hooks/useVibeVotes.ts:48` |
| 3 | `get_circle_suggestions` + `get_circle_rsvps` (`Promise.all`) | `src/components/TonightSuggestions.tsx:62` |
| 3 | `select bar_id,tier,rated_at,score from ratings` | `src/hooks/useRatings.ts:206` |

**`/friends` — 5 round-trips:** the same `useFollows` trio + `get_follow_requests` (`useFollowRequests`) + `get_circle_suggestions` (`src/app/friends/page.tsx:70`).

**Per-action write amplification** — every write on the consensus board triggers a full re-read of its section:

| Action | Writes | Reads triggered |
|---|---|---|
| Vote on a bar (▲) | `suggest_bar` or `delete bar_suggestions` | `refresh()` → `get_circle_suggestions` + `get_circle_rsvps` (`TonightSuggestions.tsx:128`) |
| Cast/rescind vibe vote | `cast_vibe_vote` / delete | `refresh()` → `get_circle_vibe_votes` (`useVibeVotes.ts:88`) |
| Follow/unfollow | `get_profile_by_handle` + `follow_user` | none (optimistic, `useFollows.ts:268`) |
| Rate a bar | 1 upsert | none (optimistic + broadcast) |
| Answer one pairwise probe | 1 insert **+ N score UPDATEs** | none |

**The one genuine N+1 write** is `updateServerScores` (`src/lib/ratings.server.ts:100-111`): a `Promise.all` issuing **one HTTP PATCH per changed score**. A binary-insert chain of 7 answers, each shifting 5–15 scores, can emit **~50–100 individual requests** for a single ranking session. It's serialized through a promise chain in `usePairwise.ts:317` (correctly, to preserve ordering), which means those requests are *sequential* — so it's also the slowest path in the app.

> **Fix:** one `update_rating_scores(p_entries jsonb)` definer RPC that applies all rows in a single statement. ~30 lines of SQL, removes 90%+ of write round-trips.

### 2.2 Index and query-plan findings

**FINDING A — `bar_suggestions` is missing a `(user_id, night)` index. (HIGH)**
`get_circle_suggestions` (0011:126) filters `s.night = $1 AND (s.user_id = auth.uid() OR s.user_id IN (…follows…))`. The only usable index is `bar_suggestions_night_idx (night, user_id)` (0011:43), so the planner's cheapest route is *"read every row for tonight, then filter by circle"*. At 10k MAU that's ~3,000 rows scanned per call — on a page that fires this RPC on every visit, from a shared-CPU instance, during a Friday burst.

Contrast `bar_rsvps`, which has `bar_rsvps_one_per_night (user_id, night)` (0012:47) and `vibe_votes`, whose PK **is** `(user_id, night)` (0017:35) — both let the planner drive from `follows` (PK `(follower_id, followee_id)`) into an index lookup per circle member. `bar_suggestions`' PK is `(user_id, bar_id, night)`, which cannot serve `user_id = X AND night = Y` efficiently because `bar_id` sits between them.

```sql
create index if not exists bar_suggestions_user_night_idx
  on public.bar_suggestions (user_id, night);
```

**FINDING B — `search_handles` prefix LIKE probably cannot use its index. (HIGH)**
`search_handles` (0006:195) does `p.handle_normalized like lower(query) || '%'`. The supporting index is `profiles_handle_normalized_key` (0006:40), a plain btree. Under a non-`C` collation (Supabase provisions `en_US.UTF-8` by default) **a plain btree is not usable for `LIKE 'x%'`** — Postgres requires `text_pattern_ops`. If so, every debounced keystroke in `FindFriends` (`src/components/FindFriends.tsx:53`, 400 ms debounce) sequentially scans `profiles`.

At 4,000 profiles this is invisible. At 40,000 it is a shared-CPU tax paid on every character the user types, hit hardest during the exact "everyone's inviting friends" growth moment.

```sql
-- verify first: show lc_collate;   explain analyze select … like 'ab%';
create index if not exists profiles_handle_norm_pattern_idx
  on public.profiles (handle_normalized text_pattern_ops);
```

**FINDING C — `get_friend_ratings` needs an `EXPLAIN` before launch. (HIGH, verification task)**
The `with gated as materialized (…)` fence (0007:284) is a deliberate and correct *security* choice — it stops the planner pushing a caller predicate below the follow gate (a documented DeepSeek timing side-channel). But `MATERIALIZED` also removes the planner's freedom to optimize across the boundary, and the inner query has no user-scoping predicate on `ratings` at all:

```sql
select r.user_id, r.bar_id, r.tier::text, r.rated_at
  from public.ratings r
 where exists (select 1 from public.follows f
                where f.follower_id = auth.uid() and f.followee_id = r.user_id)
```

Two plans are possible: a **nested loop** (`follows` outer → `ratings_user_idx` inner) which is cheap, or a **hash semi-join** with a **sequential scan of the entire `ratings` table** which is not. At 80,000 rating rows a seq scan per consensus view during peak is the single most likely source of a Friday-night stall. `auth.uid()` is `STABLE`, so the estimate quality here depends on statistics the planner has no good handle on.

> **Action:** run `explain (analyze, buffers) select * from get_friend_ratings();` as a user with a realistic circle, against a seeded 100k-row `ratings` table. If it seq-scans, the fix that preserves the security property is to materialize the *followee id set* first and join, rather than gating with `EXISTS`:
> ```sql
> with circle as materialized (
>   select f.followee_id from public.follows f where f.follower_id = auth.uid()
> ), gated as materialized (
>   select r.user_id, r.bar_id, r.tier::text, r.rated_at
>     from circle c join public.ratings r on r.user_id = c.followee_id
> ) select * from gated;
> ```
> This keeps the fence (the outer predicate still cannot reach under it) while forcing the index-driven direction. **Migration 0007's comment block correctly warns that the gating predicate must never be edited without a test — any change here must land with a test proving an unfollowed user's rows are unreachable.**

**FINDING D — `get_friend_ratings` has no bound and no filter argument. (HIGH)**
It returns the caller's *entire* social graph's ratings. `fetchFriendRatings(supabase, userId)` (`src/lib/follows.server.ts:197`) then **discards all but one user's rows client-side** — the docstring is explicit that this is intentional (to avoid the pushdown side-channel), but the cost is real: a 130 KB payload to read one friend's list. And `fetchAllFriendRatings` re-pulls it on every board mount with no cache.

> **Fix (both halves):**
> - Add `p_user_ids uuid[] default null` — filtering *inside* the materialized fence is safe (the fence is what prevents pushdown; a parameter consumed within it is not a leak vector, but this needs the same "never edit the predicate without a test" discipline).
> - Add a hard `LIMIT` (e.g. 5,000 rows) so one pathological circle cannot emit a multi-MB response.
> - Cache the result client-side (§5).

**FINDING E — no retention on the rate-limit counter tables. (MEDIUM)**
`follow_attempts` (0007:79) and `handle_search_attempts` (0006) accumulate one row per user per day forever; migration 0007 line 118 says "Old rows are tiny — no cleanup needed yet". True at 400 users; at 10k MAU over two years it's ~3 M rows of pure garbage sitting in a 500 MB budget.

**FINDING F — `analytics_events` (0018) is unbounded and unapplied. (MEDIUM — fix before applying)**
The design is admirably privacy-light (no user id, no session, no payload). But it is an append-only firehose with no retention and no rollup, projecting ~70 MB/month at 10k MAU. Apply it **with** a nightly rollup into a `analytics_daily (name, night, count)` table and a 30-day raw purge, or it becomes the largest table in the database within a quarter.

**FINDING G — good patterns worth preserving.** The advisory-lock cap enforcement (`pg_advisory_xact_lock` in 0011:98 / 0012:85) is per-user and xact-scoped — it serializes one user's writes without touching global throughput, so it does *not* become a contention point at scale. The `on conflict on constraint` convention (the 42702 prod lesson) and the revoke-first grant discipline are both correct and should be carried into every new migration.

### 2.3 Consolidation opportunity

The consensus board's 8 round-trips are 8 TLS-warm-but-still-serial-ish HTTP requests from a phone on LTE — realistically 400–900 ms of latency before the board is usable, and 8× the per-request overhead on the database.

> **Proposal:** two consolidating definer reads.
> - `get_social_bootstrap()` → `{ following, followers, outgoing_requests, incoming_requests }` as one JSON payload. Replaces 4 calls, and is cacheable for minutes.
> - `get_night_board(p_night date)` → `{ suggestions, rsvps, vibe_votes }` as one JSON payload. Replaces 3 calls, and matches how the UI actually consumes them (all three render into one board).
>
> Each must carry the same materialized fence and the same "own rows OR follower_id = auth.uid()" predicate as the RPCs it replaces, and each needs the boundary test the existing ones have. **8 → 3 round-trips** (bootstrap + board + friend ratings), with the write path re-reading only `get_night_board` instead of two separate RPCs.

---

## 3. Catalog growth: 406 → 1,000+ bars

### 3.1 What the catalog costs today

The merged catalog (`src/lib/bars.ts:69` — `applyPlaces([...8 expansion files])`) is built at module load and imported by `src/lib/catalog.ts`, which is imported by essentially every page. So **the full 406-bar catalog plus the ~500 KB Places sidecar ships in the JS bundle of every route.** Estimated ~1 MB raw JS, ~200–250 KB gzipped over the wire, parsed and re-indexed (`buildState` builds a `Map` + a bigint tag mask per bar, `catalog.ts:138`) on every cold load.

This already bit once: the 2026-07-24 expansion pushed the share-card edge bundle to **1.03 MB against the 1 MB edge limit and blocked all deploys**, which is why `src/lib/catalog.slim.ts` exists.

### 3.2 Projection to 1,000+ bars

| Cost | @406 | @1,000 | Verdict |
|---|---|---|---|
| Client JS (merged catalog + sidecar) | ~1 MB raw / ~225 KB gz | **~2.5 MB raw / ~550 KB gz** | **Breaks mobile TTI.** Half a megabyte of gzipped data before the app can render |
| Edge OG bundle via `catalog.slim.ts` | ~250 KB (curated fields only) | **~600 KB + og runtime** | Approaches the 1 MB Hobby edge limit again. **Vercel Pro raises this to 2 MB** — a second, quieter reason Pro matters |
| `matches()` CPU | ~6 ms @5k bars (measured, `catalog.test.ts:148`) | **Not a problem.** ~2 ms @1k | The documented 1,000-bar Web Worker trigger (`docs/BARS-TABLE-SCHEMA.md:71`) is **premature** — the budget test says so |
| `BarPicker` filter per keystroke (`src/components/BarPicker.tsx:39`) | 406 `String.includes` + group + sort | ~1,000 | ~0.2 ms. **Not a problem** |
| `BarPicker` *rendering* | 406 `<li>` each with a lazily-loaded 640 px JPEG | 1,000 | **Is a problem** — §4 |
| Map markers | 406 DOM `divIcon` markers, `preferCanvas` on | 1,000 | Exceeds the documented 500-marker clustering trigger (`BarMap.tsx:225` already notes this) |
| `catalog.slim.ts` drift risk | Manual: new expansion files must be added in **3 places** | worse | Guarded by the count cross-check in `bars.test.ts` (`rawBarCount`) — keep that guard |

**Conclusion: the growth constraint is bytes-to-the-client, not CPU.** The perf-trigger doc has this backwards — it schedules a Web Worker at 1,000 bars (unnecessary, matching is 6 ms at 5,000) and says nothing about the bundle (which breaks at ~1,000).

### 3.3 The growth path, in order

1. **Split the sidecar out of the initial bundle (do before 600 bars).** `bars.places.ts` carries hours, reviews, photo metadata and attributions — none of it is needed for first paint. Move it behind a dynamic `import()` fired after hydration, and have `replaceCatalog()` (`catalog.ts:210` — the seam already exists) swap in the enriched catalog. This roughly **halves the initial payload today** and is a contained change: `catalog.ts` plus the swap-day checklist already written in `catalog.ts:199`.
2. **Then do the documented `bars` table swap** (`docs/BARS-TABLE-SCHEMA.md`) — a public-read Supabase table with the static array as fallback, fetched once and cached in `localStorage` with an `updated_at` cursor. This decouples catalog growth from bundle size **permanently** and removes the deploy-per-bar coupling. The doc's Codex addendum correctly notes the server-side surfaces (share page, OG images) need an awaited accessor and that client `replaceCatalog` must defer until after hydration.
3. **Keep `catalog.slim.ts`** for edge modules regardless — a token-keyed OG image must not wait on a catalog fetch. Once the table lands, the slim view should shrink to *only the fields the OG card renders* (name, neighborhood, priceTier — `catalog.slim.ts:40`), which at 1,000 bars is ~60 KB, not 600 KB.
4. **Map clustering at 500 markers**, per the existing note in `BarMap.tsx:225`. Canvas `CircleMarker`s for the grey tail + `leaflet.markercluster` for the rest.
5. **Virtualize `BarPicker`** at ~600 bars (render only the visible window). This matters more for the photo requests it triggers than for the DOM.

---

## 4. Vercel limits at 10k users

> Hobby ceilings below are approximate — **verify against the current pricing page before relying on the exact numbers.** The arithmetic and the ranking of what binds first are what matter.

| Resource | Hobby (approx) | Pro (approx) | @1k MAU | @10k MAU |
|---|---|---|---|---|
| Fast data transfer | ~100 GB/mo | ~1 TB/mo | ~9–15 GB | **~90–150 GB → over Hobby** |
| Edge function executions | ~500k–1M/mo | 1M+ incl. | ~5k | ~60k |
| Serverless invocations | generous | generous | ~2k | ~20k |
| Image optimization | 1,000 source images | 5,000 | **0 — not used** | 0 |
| Build execution | ~6,000 min/mo | 24,000 | ~40 min | ~40 min |
| Deployments | 100/day | higher | fine | fine |
| Edge bundle size | **1 MB** | **2 MB** | already hit once | see §3.2 |
| **Commercial use** | **Prohibited** | Allowed | **blocking** | **blocking** |

### 4.1 Bandwidth is the only binding meter, and photos are ~70% of it

`public/bar-photos/` is 926 files × ~80 KB ≈ **74 MB of static assets**, served as plain `<img src="/bar-photos/x.jpg">` (`src/lib/barVisual.ts:150`, rendered by `BarVisualTile.tsx`). There is **no `next.config.js` image configuration** (the file is 6 lines: `reactStrictMode` only), **no `vercel.json`**, and no `srcset`. Consequences:

- A **640 px, 80 KB JPEG is downloaded to fill a 32 px tile** in `BarPicker` and a 56 px tile in `TonightSuggestions` / the shared-night route list. That's ~40× more bytes than the rendered pixels need.
- Scrolling the full picker (406 entries) can pull **~32 MB in one interaction**.
- `/discover` swipes one full-size photo per card.

Cold-cache session estimate: 3–8 MB of photos + ~1.5 MB of first-load JS. At 10k MAU × ~1.5 cold sessions/mo → **~75–120 GB of photos plus ~15 GB of app shell.**

**Three fixes, in leverage order:**
1. **Generate thumbnails.** A 64 px and 400 px variant per photo, selected by call site (`barImageUrl` already centralizes the URL construction — add a `size` parameter there and nowhere else). This requires an image-resize step; the codebase deliberately has no `sharp` dependency (`barVisual.ts:10`), so do it in the **ingest script** (`scripts/refresh-places.mjs` already writes the files) rather than adding a runtime dep. **Estimated saving: 80–90% of photo bytes.**
2. **Bundle photos into the Capacitor binary.** Native users then fetch zero photo bytes from the CDN, forever. This inverts the usual assumption — *the App Store wrap makes the infrastructure cheaper, not more expensive.* It also fixes the "slow first scroll on LTE" UX problem outright.
3. **Add long-lived immutable cache headers** for `/bar-photos/*` via `next.config.js` `headers()`. Vercel's CDN already caches static assets, but explicit `max-age=31536000, immutable` guarantees browser-side persistence across sessions (and the filenames are content-stable).

### 4.2 OG images — the K-factor cost path

Six edge functions render PNGs: root, `/join`, `/share/[barId]`, `/u/[handle]`, `/u/[handle]/night/[shareId]`, plus icons. None declares `revalidate` or explicit cache headers.

- `/share/[barId]` (`src/app/share/[barId]/opengraph-image.tsx`) is pure — it reads only `catalog.slim.ts`. It should be **prerendered at build** via `generateStaticParams` over the catalog (406 PNGs today; reconsider at 1,000+, where build time and deployment size argue for on-demand ISR with a long `s-maxage` instead).
- `/u/[handle]/night/[shareId]` (`.../night/[shareId]/opengraph-image.tsx:33`) does a **raw `fetch` to `get_shared_night` on every request**. Every share into a group chat triggers one unfurl per client (iMessage, WhatsApp, Slack, Twitter each fetch independently) — so one share can be 5–15 edge invocations *and* 5–15 anon RPCs. It cannot be prerendered (the token is unguessable by design, which is the correct security property), but it **can and should carry `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`** — the night's content is immutable once shared, and unsharing kills the page rather than the card.

At 10k MAU with a healthy share loop this is the fastest-growing invocation source in the app, and it is essentially free to cap.

### 4.3 In-memory rate limiters do not survive horizontal scale

`createIpRateLimiter` (`src/lib/waitlistGuard.ts:101`) is module-scoped — **per warm lambda instance.** It's well-built (bounded at 10,000 buckets, fails closed, opportunistic prune), but under Vercel's autoscaling the effective limit is `10/hour × N instances`. For `/api/waitlist` (10/hr) that's an annoyance; for `/api/account/delete` (5/hr, service-role, destructive) it is a **security-relevant weakening at scale**.

> **Fix at 10k:** move both to a shared counter — the cheapest option that adds no infrastructure is a Postgres counter table behind a definer RPC, reusing the exact `handle_search_attempts` bump-then-check pattern already proven in migrations 0006/0007. (Note `/api/account/delete` is additionally gated by a verified bearer token, so the blast radius is self-deletion only.)

### 4.4 Build minutes and CI

`.github/workflows/ci.yml` runs `tsc` + `vitest` + `next build` per PR and per push to main, 15-minute timeout. That's ~5–8 minutes per run — comfortably inside GitHub's free tier for a solo operator, and inside Vercel's build allowance. **Not a scaling concern.** The e2e suite is deliberately excluded (workflow comment lines 9–11); leave it that way and add it as a nightly job rather than a per-PR gate.

---

## 5. Caching strategy

### 5.1 What's already right

- **Every page is statically prerendered and CDN-served.** No SSR, no per-view function cost. This is the single best structural decision in the app for scale, and it should be defended: adding one server-rendered dynamic page would put a Vercel function in the path of every visit.
- **localStorage write-through is thorough.** `ratings` (`src/lib/ratings.ts`), pairwise transcript (`pairwise.local.ts`), local follows, quiz profile (`storedProfile.ts`), want-to-go (`wantToGo.ts`), intent, night log. Server-mode writes mirror into the same cache (`useRatings.ts:280`) so sign-out degrades gracefully.
- **`accountCache.ts` epoch guards** (`getCacheEpoch()`) are the correct invalidation primitive and are already threaded through every async hydrate. **Any new cache layer must participate in this** — it's what prevents one account's data surfacing under another on a shared device.
- **Optimistic UI with rollback** on follows (`useFollows.ts:225`) and ratings — writes feel instant and don't block on the network.

### 5.2 The gap: zero caching of circle RPC reads

Every mount of `/friends` or `/friends/consensus` re-fetches all 5–8 circle RPCs from scratch. Navigating consensus → friends → consensus (an entirely normal 20-second interaction) costs **21 round-trips**. This is the highest-leverage caching change in the document.

> **Proposal — a minimal SWR layer (~80 lines, no dependency):**
> - In-memory `Map<key, {data, fetchedAt, epoch}>` plus optional `sessionStorage` mirror.
> - Keys: `${userId}:${rpcName}:${nightKey}` — the night key (`src/lib/nightKey.ts`) already gives correct 6 am-rollover invalidation for free.
> - TTLs: `get_following`/`get_followers`/`get_outgoing_requests` → **5 min**; `get_friend_ratings` → **5 min**; `get_circle_suggestions`/`rsvps`/`vibe_votes` → **30 s** (these are the live board).
> - Serve stale immediately, revalidate in background, and **hard-invalidate on write** (the existing `refresh()` calls become `invalidate() + refresh()`).
> - Invalidate the whole map when `getCacheEpoch()` changes — one line, and the cross-account guarantee holds.
>
> Effect: the tab-switching pattern collapses from 21 round-trips to ~8, and repeat consensus views inside 30 s cost 3. Combined with §2.3's consolidation, a warm board view is **1 round-trip**.

### 5.3 The service worker says stale-while-revalidate but implements cache-first-forever

`public/sw.js:118-131`:

```js
// Stale-while-revalidate for everything else from our origin.
event.respondWith(
  caches.match(request).then((cached) => cached ?? fetch(request).then(…))
);
```

There is **no background revalidation** — a cache hit returns forever and never refreshes. For Next's content-hashed JS/CSS that's correct (and beneficial). For `/bar-photos/*.jpg` it means **a photo replaced by a `refresh-places.mjs --force-photos` run will never update on an installed PWA**, and for `/manifest.webmanifest` and the 4 precached shell routes it means stale-but-not-broken. There's also a single unbounded cache (`next-bar-shell-v1`) with no eviction — an aggressive picker scroll can push tens of MB into it.

> **Fix:** split into two caches — `next-bar-shell` (navigations + shell, network-first, already correct) and `next-bar-photos` (cache-first with an LRU cap of ~150 entries). Add true SWR (return cached, `fetch` and `cache.put` in the background) for non-hashed assets. Bump `CACHE_NAME` on the deploy that lands it so existing clients purge (the `activate` handler already deletes non-matching cache names — that mechanism works).

### 5.4 CDN / ISR summary

| Surface | Today | Should be |
|---|---|---|
| All app pages | Static prerender, CDN | ✅ unchanged |
| `/bar-photos/*` | Static, default headers | `max-age=31536000, immutable` via `next.config.js` headers() |
| `/share/[barId]` OG | Dynamic edge, no cache header | `generateStaticParams` (≤1,000 bars) or long `s-maxage` |
| `/u/[handle]/night/[token]` OG | Dynamic edge + anon RPC per unfurl | `s-maxage=86400, stale-while-revalidate=604800` |
| `/u/[handle]` OG | Dynamic edge | long `s-maxage` (profile cards change rarely) |
| Circle RPCs | No cache | Client SWR, §5.2 |
| Catalog | In bundle | localStorage + `updated_at` cursor once the `bars` table lands |

---

## 6. Cost model

### 6.1 Monthly run rate

| Line item | @1k MAU | @10k MAU | Notes |
|---|---|---|---|
| **Vercel** | **$20** (Pro) | **$20–40** (Pro) | Hobby is not an option — commercial ToS. Pro's ~1 TB covers 10k even before photo thumbnails |
| **Supabase** | **$25** (Pro) | **$25–60** | Pro for backups/PITR, not quotas. +$10 Micro→Small compute if Friday p95 degrades; +$60 Medium beyond ~50k |
| **Google Places** | **$0–10** | **$0–10** | Per `scripts/refresh-places.mjs:1-25`: monthly (not weekly) Details refresh at ~400 calls sits inside the free allowance; the script is *not* scheduled, so cost is only incurred on manual runs. Independent of user count — users never call Google |
| **Apple Developer Program** | **$8.25** | **$8.25** | $99/yr — mandatory for App Store |
| **Domain** | **$1.50** | **$1.50** | ~$18/yr |
| **Error/uptime monitoring** | $0 | $0–26 | Sentry free tier covers 1k; consider paid at 10k |
| **Total** | **~$55/mo** | **~$60–125/mo** | |

**Sensitivity — what could push 10k past $125:**
- Photos not thumbnailed **and** low Capacitor adoption → Vercel bandwidth overage (~$0.15/GB beyond 1 TB). Bounded at ~$20/mo in the realistic worst case.
- Median circle size >20 (a *successful* social launch) → Supabase egress past Pro's 250 GB. Would require ~10× the projected traffic; not a near-term risk.
- `analytics_events` applied without retention → DB growth, but 8 GB Pro absorbs years of it.

**The cost model is boring, and that's the finding.** This app costs ~$55/mo at 1k users and ~$100/mo at 10k. There is no cliff. The risks are *availability and correctness* risks (ToS suspension, data loss, a Friday-night stall), not bill-shock risks — which is why §7 ranks by risk-reduction, not by dollars.

### 6.2 Per-user economics

~$0.055/user/month at 1k, ~$0.010/user/month at 10k. If the product ever monetizes at even $1/user/year, the infrastructure is ~12% of revenue at 1k and ~1% at 10k. Infrastructure is not the constraint on this business.

---

## 7. Prioritized action list

Ranked by **risk reduction per unit of effort.** Items 1–5 are the pre-launch set.

### Tier 1 — before the App Store submission

**1. Pay for Vercel Pro + Supabase Pro. — 10 minutes, $45/mo**
Removes the two day-0 failure modes: commercial-use ToS suspension (total outage, no warning) and unrecoverable data loss (no backups on free). Enable **daily backups + PITR** on Supabase and verify a restore once. Also doubles the edge bundle limit 1 MB → 2 MB, which buys headroom on the constraint that has already blocked deploys once.
*Risk removed: catastrophic. Effort: trivial. This is the single highest-value item in the document.*

**2. Three indexes + an `EXPLAIN` session on the four definer reads. — ~1 hour, one migration**
- `create index bar_suggestions_user_night_idx on bar_suggestions (user_id, night);` (Finding A)
- `create index profiles_handle_norm_pattern_idx on profiles (handle_normalized text_pattern_ops);` after confirming `lc_collate` (Finding B)
- `explain (analyze, buffers)` on `get_friend_ratings`, `get_circle_suggestions`, `get_circle_rsvps`, `get_circle_vibe_votes` against a seeded ~100k-row dataset; restructure `get_friend_ratings` per Finding C if it seq-scans.
*Risk removed: the Friday-night stall — the failure mode that arrives exactly when growth is working, and is hardest to diagnose live. Ship with the boundary tests the existing RPCs have; a predicate change here is a security change.*

**3. Client SWR cache over the circle RPCs. — ~4 hours**
§5.2. Keyed on `userId + nightKey`, invalidated by `getCacheEpoch()`. Collapses the tab-switching pattern from 21 round-trips to ~8, cuts projected Supabase egress ~40%, and makes the board feel instant on repeat views.
*Risk removed: egress ceiling + perceived latency. Also the change most visible to users.*

**4. Bound `get_friend_ratings` + batch `updateServerScores`. — ~3 hours**
Add `p_user_ids uuid[] default null` and a `LIMIT` inside the materialized fence; add `update_rating_scores(p_entries jsonb)` to replace the per-row PATCH storm in `src/lib/ratings.server.ts:100`. The first caps the largest egress line item; the second removes ~50–100 sequential HTTP requests from every ranking session.
*Risk removed: unbounded payload growth (the one cost that scales super-linearly with product success) + the slowest write path in the app.*

**5. Photo thumbnails + Capacitor asset bundling. — ~4 hours**
Add a resize step to `scripts/refresh-places.mjs` producing 64 px and 400 px variants; add a `size` parameter to `barImageUrl`/`barImageUrls` in `src/lib/barVisual.ts` (the single URL-construction chokepoint). Bundle `public/bar-photos/` into the Capacitor binary. Add immutable cache headers via `next.config.js`.
*Risk removed: the only binding Vercel meter, ~80–90% of photo bytes, and the "slow first scroll on LTE" UX problem. Do the thumbnails even if the Capacitor wrap slips.*

### Tier 2 — first month after launch

**6. Retention jobs. — ~2 hours**
Nightly purge: `bar_suggestions` / `bar_rsvps` / `vibe_votes` older than 14 days; `handle_search_attempts` / `follow_attempts` older than 7 days. This converts "+55 MB/month forever" into a flat steady state and removes DB size from the risk register entirely. Run via `pg_cron` (available on Supabase) so it needs no external scheduler.

**7. OG image caching. — ~1 hour**
`generateStaticParams` for `/share/[barId]`; explicit `s-maxage` + `stale-while-revalidate` headers on the night and profile cards. Caps the fastest-growing invocation source and removes a per-unfurl anon RPC from the share loop.

**8. Consolidate the consensus board into `get_night_board()` + `get_social_bootstrap()`. — ~6 hours**
§2.3. 8 → 3 round-trips cold, 1 warm (with item 3). Higher effort than the cache and partially redundant with it — hence Tier 2 — but it's the change that makes the board fast on a bad LTE connection, and it halves the per-view database work.

**9. Service worker split + LRU photo cache. — ~2 hours**
§5.3. Fixes the "photos never update on installed PWAs" bug and bounds SW storage.

**10. Fix `analytics_events` before applying 0018. — ~2 hours**
Add a nightly rollup to `analytics_daily` + 30-day raw purge. Then apply — the telemetry is what replaces every assumption in §0.3 with a measurement, which is the real unlock for the next revision of this plan.

### Tier 3 — before the catalog doubles (~600 bars)

**11. Lazy-load the Places sidecar. — ~1 day.** Dynamic `import()` after hydration + `replaceCatalog()`. Halves the initial bundle. The seam and the swap-day checklist already exist in `src/lib/catalog.ts:199`.

**12. The `bars` table swap. — ~2 days.** Per `docs/BARS-TABLE-SCHEMA.md`, including the Codex addendum's server-surface accessor and post-hydration replacement. Decouples catalog growth from bundle size permanently and ends the deploy-per-bar coupling.

**13. Map marker clustering at 500 markers, `BarPicker` virtualization at ~600.** Both already flagged in-code (`BarMap.tsx:225`).

**14. Shared-state rate limiters** for `/api/waitlist` and `/api/account/delete` (§4.3), reusing the `handle_search_attempts` bump-then-check pattern.

### Explicitly *not* recommended

- **Web Worker for matching at 1,000 bars.** `docs/BARS-TABLE-SCHEMA.md:71` schedules this, but the budget test (`src/lib/catalog.test.ts:148`) measures ~6 ms over **5,000** bars. Revisit if that test trends toward its 50 ms ceiling — not on a bar count.
- **Realtime subscriptions for the consensus board.** Tempting (live vote tallies), but it converts a cacheable poll into a persistent connection per user and puts you on a metric (2 GB realtime, concurrent connections) that currently reads zero. Do the SWR cache first; revisit only if users complain that the board is stale.
- **Read replicas / connection pooling work.** Neither binds before ~100k MAU given the browser-direct architecture.
- **Migrating off the static catalog before 600 bars.** It works, it's fast, and it's zero-cost. The trigger is bundle bytes, not principle.

---

## Appendix — key file references

| Concern | File |
|---|---|
| Consensus board (8 RPCs/view) | `src/app/friends/consensus/page.tsx` |
| Circle read fan-out | `src/hooks/useFollows.ts:157`, `src/components/TonightSuggestions.tsx:62`, `src/hooks/useVibeVotes.ts:43` |
| Unbounded friend-ratings read | `src/lib/follows.server.ts:197,342`; `supabase/migrations/0007_follows.sql:277` |
| Write N+1 (score updates) | `src/lib/ratings.server.ts:100-111`, chained at `src/hooks/usePairwise.ts:317` |
| Missing suggestion index | `supabase/migrations/0011_bar_suggestions.sql:43` (vs. the correct pattern at `0012:47`, `0017:35`) |
| Handle-search prefix scan | `supabase/migrations/0006_usernames.sql:40,195`; `src/components/FindFriends.tsx:53` |
| Catalog assembly / edge split | `src/lib/bars.ts:69`, `src/lib/catalog.ts:146`, `src/lib/catalog.slim.ts` |
| Matching perf budget (~6 ms @5k) | `src/lib/catalog.test.ts:148`; `src/lib/matching.ts:97` |
| Oversized photo delivery | `src/lib/barVisual.ts:150`, `src/components/BarVisualTile.tsx`, `public/bar-photos/` (926 files) |
| Service worker cache-first | `public/sw.js:118-131` |
| Per-unfurl edge RPC | `src/app/u/[handle]/night/[shareId]/opengraph-image.tsx:33` |
| Per-instance rate limiters | `src/lib/waitlistGuard.ts:101`; `src/app/api/waitlist/route.ts:29`, `src/app/api/account/delete/route.ts:28` |
| Browser-direct data path | `src/lib/supabase/client.ts:20` |
| Places cost notes | `scripts/refresh-places.mjs:1-25` |
| Existing swap plan | `docs/BARS-TABLE-SCHEMA.md` |
| CI gates | `.github/workflows/ci.yml` |
| Missing infra config | `next.config.js` (6 lines), no `vercel.json` |
