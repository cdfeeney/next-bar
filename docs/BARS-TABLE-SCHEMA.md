# `bars` table schema sketch + catalog swap plan (B1)

Status: **design sketch, not a migration.** The catalog is served today from
the static TypeScript arrays (`src/lib/bars*.ts`) through the single accessor
`src/lib/catalog.ts` (blueprint B1). This doc records the future table shape
and the exact swap plan so the server-backed catalog is a one-file change
when it lands. The Places pipeline (escalation-gated: Google key) later
*enriches* this table — it never replaces the accessor.

## Table sketch

```sql
CREATE TABLE bars (
  id             text PRIMARY KEY,          -- stable slug, matches today's static ids ('attaboy')
  name           text NOT NULL,
  lat            double precision NOT NULL,
  lng            double precision NOT NULL,
  tags           text[] NOT NULL DEFAULT '{}',  -- VibeTag values; app-side vocabulary is authoritative
  neighborhood   text NOT NULL,             -- Neighborhood union value ('LES', 'Williamsburg', …)
  price_tier     smallint NOT NULL CHECK (price_tier BETWEEN 1 AND 4),
  hours          jsonb,                     -- WeeklyHours shape: { "0": [{"open":"18:00","close":"02:00"}], … }
  blurb          text NOT NULL DEFAULT '',
  address        text NOT NULL DEFAULT '',
  source         text NOT NULL DEFAULT 'curated',  -- 'curated' | 'places' | 'user-submitted'
  place_id       text,                      -- Google Place ID once the Places pipeline enriches the row
  last_verified  date,                      -- mirrors Bar.lastVerified; drives the 180-day hard filter
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Read path is anonymous-friendly: catalog is public data.
-- RLS: enable, public SELECT, writes via service role / admin only.
```

Notes:

- `id` stays a text slug (not uuid) so the existing static ids, localStorage
  ratings, pairwise transcripts, and share URLs (`/share/[barId]`) keep
  working unchanged across the swap.
- `tags` stays `text[]`; the **app-side** `VibeTag` union remains the
  authoritative vocabulary (the bitmask in `catalog.ts` is built from it —
  bit positions are append-only). Unknown tags arriving from the server are
  a validation error at the accessor boundary, not silently accepted.
- `hours` is the `WeeklyHours` JSON shape already produced by
  `scripts/refresh-places.mjs`; "open now" stays a client-side computation.
- `business_status` (OPERATIONAL / CLOSED_*) can ride in later as an
  additive column; omitted from the first cut since the Places pipeline is
  what populates it.

## Accessor swap plan (the one-file change)

`src/lib/catalog.ts` is the only file that changes:

1. `getBars()` starts by fetching from Supabase (`select * from bars`),
   validating rows at the boundary (tags in vocabulary, coords in bbox),
   and calling the existing `replaceCatalog(serverBars)` on success.
2. The **static array remains the fallback**: module-level cache still
   initializes synchronously from the static import, so first paint never
   blocks and a failed/slow fetch degrades to today's behavior exactly.
3. `useBars()` consumers re-render automatically via the existing
   subscription (`useSyncExternalStore`) when the server catalog lands —
   no import site changes.
4. `getBarById` / `getTagMask` re-index automatically because
   `replaceCatalog` rebuilds the id map and tag bitmasks.

Import sites already route through the accessor (done in B1), so no UI code
changes when the swap happens.

## Perf triggers (documented, not built — per B1)

- **Web Worker for matching** when the catalog exceeds **1,000 bars**:
  move `matches()` off the main thread; the bitmask jaccard
  (`jaccardByMask`, precomputed via `getTagMask`) is the transferable-
  friendly representation. Budget test (5k synthetic bars < 50ms in
  `src/lib/catalog.test.ts`) is the tripwire — revisit when it trends up.
- **Map marker clustering** when the map shows more than **500 markers**
  (B6 also documents canvas rendering; clustering is the next step after
  `preferCanvas`).
- Matching adoption of the bitmask path is **B7**, not B1 — `matching.ts`
  keeps its set-based jaccard until then.

## Review addenda (2026-07-23, Codex B1 review)

- `last_verified` must be `NOT NULL` (with an explicit seed/backfill policy): the runtime `Bar.lastVerified` is required and matching hard-filters on freshness — a NULL mapped naively would silently exclude the bar.
- The "one-file swap" claim holds for CLIENT surfaces only. Server routes (share page, edge OG image) do synchronous lookups today and never call async `getBars()`; the swap step must add an awaited server-side accessor in those routes, plus defer client `replaceCatalog` until after hydration (SSR/browser snapshot mismatch otherwise).
- Non-reactive `getBarById` readers needing a `useBars()` subscription at swap time: RatingControl, rankings/page, demo/index (see catalog.ts swap-day checklist).
