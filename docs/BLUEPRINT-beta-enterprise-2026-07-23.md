# BLUEPRINT — Beta/Enterprise-Ready (2026-07-23)

Objective: real multi-user beta — unique accounts with usernames, add friends, fast Beli-style add-bar + "more or less than X?" comparison flow, rankings that actually work signed-in, bar icons on suggestion cards, map that highlights suggested bars and greys the rest, and a watertight + independently sanity-checked suggestion/ranking pipeline that survives catalog growth.

Consulted 2026-07-23: GLM (architecture) + DeepSeek (algorithms) via coordinated wrapper; adopted findings are baked into the steps below. Companion docs: `UI-PATH-REVIEW-2026-07-23.md` (finding refs), `CAPABILITIES-REVIEW-2026-07-23.md`. **`NIGHTLOG-2026-07-24.md` executes B0 tonight** (its F1–F7 = B0.1, S1 = B0.4); post-B0 phases in the nightlog are superseded by this blueprint.

Ground rules (every step): TDD where logic exists; `npm test && npx tsc --noEmit && npm run build` green before commit; commit locally `[T1]`/`[T2]`, never push without operator ask; migrations **additive-only**, one migration per dependent policy-set, applied via `scripts/apply-migrations.ts` with the filename recorded as revert point; secrets stay in `.env.local`; escalate-don't-fake.

## Dependency graph

```
B0 (correctness gate) ──> B1 (catalog layer) ──> B5 (icons)   ──┐
        │                        │            └> B6 (map)      ├──> B7 (hardening) ──> B8 (sanity check)
        │                        └────────────────────────────┐│
        └──> B2 (usernames) ──> B3 (friends)                  ┘│
        └──> B4 (ranking UX; needs B0.2+B0.4) ─────────────────┘
```
Parallel-safe: B1 ∥ B2 after B0 · B5 ∥ B6 after B1 · B3 ∥ B4 after their parents.

## Steps (each ≈ one PR; brief is self-contained)

### B0 — Correctness gate (blocks everything; = tonight's nightlog)
- **B0.1** Audit HIGH fixes F1–F7 (see `NIGHTLOG-2026-07-24.md`): server-mode broadcast, clear-all deletes server rows, demo-merge guard, auth `?error=` surfacing, intent rollover, delete-list confirm + share-cancel + share CTA, GpsConfirm requesting state. **Add (GLM):** cleanup migration **0003** deleting already-merged sample-night rows from real accounts (demo bar ids are enumerable from `src/lib/demo/`), and a minimal error-observability hook (console-error boundary + report route; Sentry = escalation).
- **B0.2** Pairwise correctness (DeepSeek; gates B0.4 AND B4): **replace winrate-aggregate scoring with a rank-order model** — per tier, comparisons build an ordered list (binary-insert position is the source of truth, Beli-style); score = interpolation of list index across the tier band (loved 8–10, liked 5–8, pass 0–5); existing `pairwise_comparisons` replayed once to seed the order. This makes final position deterministic from the comparison transcript (B4's e2e depends on that property). Fixes `:205` (only the inserted bar moves) and `:230-233` (unscored bars sit at tier midpoint, never below a lower tier) by construction. Add `comparisonCount` per bar. Property tests: insert-position determinism, scores within tier band, no cross-tier inversion, idempotent replay.
- **B0.3** Sync hardening (DeepSeek): migration 0003 (additive): `ALTER TABLE ratings ADD COLUMN updated_at timestamptz` + **LWW enforced server-side via BEFORE UPDATE trigger** (reject when `NEW.updated_at <= OLD.updated_at`) because supabase-js `.upsert()` cannot express a conditional `DO UPDATE … WHERE`; client sends its `updated_at` on every write. After first-sign-in merge, hydrate server rows (including `score`, `updated_at`) back into localStorage. Add `session_id` UUID column to `pairwise_comparisons` (reconcile UX deferred). All in migration **0004** (additive).
- **B0.4** Pairwise server sync + score sync; re-enable pairwise prompts for signed-in users. **Exact `ratings.server.ts` changes (a cold agent will not find these):** `fetchServerRatings` currently selects only `bar_id, tier, rated_at` — add `score, updated_at`; `upsertServerRating` currently writes rows without `score` — it must preserve/recompute score or every tier tap nulls the synced score. Then clone the `useRatings` dual-mode pattern into `usePairwise`. Depends B0.2 + B0.3.

### B1 — Catalog access layer (decides the growth path before UX builds on it)
Single accessor `getBars()` in `src/lib/catalog.ts`, **async signature from day one** (`Promise<Bar[]>`, resolved instantly from the static import today) so the static→server swap later really is one file. Note: `matching.ts` takes `bars: Bar[]` as a parameter — it is NOT an importer; the real import sites (~15) are ResultsView, RatingControl, BarPicker, `demo/index`, and the map/quiz/rankings/settings/share pages — all move to the accessor. Precompute per-bar at module load: tag bitmask (global tag vocabulary → BigInt AND+popcount jaccard) + Set forms; perf budget test: full match over 5k synthetic bars < 50ms. Sketch `bars` table schema (id, name, lat, lng, tags, neighborhood, price_tier, hours, source, place_id) in `docs/` — the Places pipeline (escalation-gated) later *enriches* this table; it never replaces the accessor. Web Worker + clustering = triggers documented at >1k bars, not built now.

### B2 — Unique usernames
Migration 0005: `handle_normalized` generated column (`lower(handle)`) with UNIQUE index; atomic claim via security-definer RPC `claim_handle(text)` (validate charset `[a-z0-9_]{3,20}`, insert-or-conflict, zero-row = lost race → UI retries); search RPC `search_handles(query)` security-definer, returns handle+display_name only, `is_private=false` rows only, LIMIT 10 (no table-level public read on profiles — enumeration guard). UI: claim sheet on `/settings` + post-sign-in nudge when handle NULL; availability check debounced against RPC. Abuse caps in the same migration: claim RPC limited to N attempts/user/day; search RPC per-user call cap (counter table or pg_net-free throttle). **Decision recorded (operator may override): `is_private` default flips to `false`** = discoverable handle/display-name; content visibility stays separately gated by ratings RLS. Private users remain addable by exact handle only.

### B3 — Add friends (real follows)
**One migration** (0006) ships together: `follows(follower_id, followee_id, created_at, pk both)` + its RLS (owner-write, both-parties-read) + friend-read policy on `ratings` **exposing tier only — score column stays owner-only** (DeepSeek side-channel) via a `ratings_friend_view` or column-limited policy. Client: `useFollows` dual-mode (demo seed removed when signed-in); find-friends UI = handle search (B2 RPC) + follow/unfollow with a per-user follow-rate cap (abuse guard); `/u/[handle]` becomes real (profiles lookup, `notFound()` on unknown, friend's tier-ranked list from the view). **Empty states are acceptance criteria:** user #1 with zero friends sees an inviting find-friends state, not a broken page. Consensus/tonight surfaces keep demo data behind explicit "demo" labels until intents/votes tables land (out of beta-critical scope).

### B4 — Beli add flow + rankings that work (needs B0.2 + B0.4)
Quick-add on `/rankings`: persistent "+ Add a bar" → BarPicker search → tier pick → **comparison popup chain**: binary insert against current tier list (~log₂ n comparisons, ≤7 cap), wider insertion window while `comparisonCount < 3`, skip allowed (falls back to midpoint), cycle detection on the tier's comparison graph → conflicting triad flagged for one re-compare instead of silent insert. Same flow triggers from ResultCard rating taps. Works identically signed-in (server-synced) and anonymous. E2e: add 4 bars → answer prompts → ranking order matches answers → reload → order persists → sign in → order survives.

### B5 — Bar icons on suggestion cards (needs B1)
Today `ResultCard.tsx` is text-only. Add deterministic visual identity: category glyph + color derived from primary vibe tag + price tier (pure function in `src/lib/barVisual.ts`, unit-tested), rendered as leading icon on ResultCard and BarPicker rows (map popup icons belong to B6, which owns `BarMap.tsx` — keeps B5 ∥ B6 truly parallel). Upgrade path = Places photos (escalation: Google key); the component takes `imageUrl?` now so photos drop in without rework.

### B6 — Map: suggested vs everything else (needs B1)
`BarMap` gains marker tiers: **suggested** (accent, glow, current matching output for the user's profile/location) · **rated** (small accent ring) · **other** (light-grey 8px dot, `#9ca3af` @ 60%). `/map` computes suggestions via the same `matches()` call as home (shared hook). Perf: switch to canvas renderer (`preferCanvas`) now; clustering trigger documented at >500 markers. E2e: suggested markers count ≤ maxResults, grey markers non-interactive except popup.

### B7 — Algorithm hardening + intelligent-data groundwork (needs B1, B4)
Property/eval suite in `src/lib/__evals__/`: pairwise invariants from B0.2 plus transitivity sampling (random triads, violation rate < threshold); matching invariants (score monotonic in jaccard and distance; neighborhood-filter honesty per MED-12; exploration: 1 of top-10 slots reserved for a qualified long-tail pick — DeepSeek ε-greedy, simplified); perf: 5k-bar match under budget on CI machine. Freshness/`lastVerified` staleness surfaced (bars > 12mo flagged in results footer). This step turns "watertight" into assertions.

### B8 — Independent sanity check (last; do not self-review)
Run `/review-routed` on the accumulated B0–B7 diff (Codex + GLM + DeepSeek + Claude verify). DeepSeek re-critique specifically of final `pairwise.ts` + `matching.ts` against B7's invariants. Full e2e beta script **against the real Supabase project** (not stubs — current `auth-page.spec.ts` stubs every endpoint): two fresh accounts (so the follow step doesn't presuppose an existing friend) → sign up → claim usernames → account A follows B → add 5 bars via comparison flow → rankings correct → map shows suggested/grey split → second device sign-in shows same state → empty-state checks for a friendless brand-new account. Fix confirmed HIGH/MED; ship-gate = all green + operator walkthrough on phone.

## Escalations (operator)
Sentry (or chosen error tracker) account · Google Places key (B5 photos + data pipeline) · `is_private` default decision (recommended `false`, see B2) · Brevo/Twilio finish (parallel, already in motion) · eventual `bars` table migration timing.

## Rollback
Every step lands as local commits on `main` (never pushed); revert = `git revert <step shas>`. Migrations are additive-only; rollback = drop-policy/drop-table statements included as comments in each migration header. Record applied-migration filenames in the nightlog tick lines.
