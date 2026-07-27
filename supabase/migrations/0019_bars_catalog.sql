-- Next Bar — 0019 bars catalog table (mass-import prerequisite, goal
-- g-c81262b5). Design: docs/BARS-TABLE-SCHEMA.md (+ Codex B1 addenda) and
-- docs/SCALE-PLAN.md §3 — the in-bundle catalog breaks phone load times
-- around ~1,000 bars, and the 2,000-venue Manhattan import needs new rows
-- to land WITHOUT a code deploy per batch.
--
-- Read path: the catalog is PUBLIC data — anon SELECT via a true policy.
-- Write path: service role only (seed + import scripts); no client role
-- ever gets INSERT/UPDATE/DELETE. The client accessor validates rows at
-- the boundary (vocabulary, bbox, freshness) — the table is storage, the
-- app-side vocabulary stays authoritative (schema-doc decision).
--
-- last_verified is NOT NULL (Codex addendum: Bar.lastVerified is required
-- and matching hard-filters on freshness — a naively-mapped NULL would
-- silently exclude the bar).
--
-- Idempotent: safe to re-run.

create table if not exists public.bars (
  id             text primary key,
  name           text not null,
  lat            double precision not null,
  lng            double precision not null,
  tags           text[] not null default '{}',
  neighborhood   text not null,
  price_tier     smallint not null
    constraint bars_price_tier_check check (price_tier between 1 and 4),
  hours          jsonb,
  blurb          text not null default '',
  address        text not null default '',
  source         text not null default 'curated'
    constraint bars_source_check check (source in ('curated', 'places', 'import', 'user-submitted')),
  place_id       text,
  business_status text,
  photo_count    smallint not null default 0,
  photo_attributions jsonb,
  reviews        jsonb,
  last_verified  date not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- DeepSeek review: DB-side backstops for the import pipeline. Coords
  -- must be NYC-plausible (generous bounds so a service-area expansion
  -- needs no migration — the app-side bbox stays the tight filter; this
  -- catches the wrong-city Places match class found 2026-07-27, e.g.
  -- Bootleg Bar resolving to Long Island). reviews/attributions must be
  -- arrays — our ingest writes arrays of public Google snippets; an
  -- accidental object dump is a shape bug.
  constraint bars_coord_bbox_check check (
    lat between 40.45 and 41.0 and lng between -74.30 and -73.60
  ),
  constraint bars_reviews_shape_check check (
    reviews is null or jsonb_typeof(reviews) = 'array'
  ),
  constraint bars_photo_attr_shape_check check (
    photo_attributions is null or jsonb_typeof(photo_attributions) = 'array'
  )
);

-- updated_at auto-bump (DeepSeek review: a re-import that forgets the
-- manual bump silently diverges freshness signals). Hand-rolled — no
-- moddatetime extension dependency.
create or replace function public.bars_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists bars_updated_at on public.bars;
create trigger bars_updated_at
  before update on public.bars
  for each row execute function public.bars_touch_updated_at();

-- NOT applied from the review: (a) a DB tag-allowlist CHECK — the schema
-- doc's standing decision keeps the vocabulary APP-side authoritative
-- (evolves without migrations; accessor drops unknown tags); (b) an
-- "alter default privileges" stanza — no existing migration (0000-0018)
-- uses one; the house pattern is per-object revoke-first, which this
-- file follows.

create index if not exists bars_neighborhood_idx on public.bars (neighborhood);

alter table public.bars enable row level security;
revoke all on table public.bars from public, anon, authenticated;

-- Catalog is public data: anonymous read is the product (the app works
-- signed-out). SELECT only — writes stay service-role-only.
grant select on table public.bars to anon, authenticated;
drop policy if exists bars_select_all on public.bars;
create policy bars_select_all on public.bars
  for select to anon, authenticated
  using (true);

grant select, insert, update, delete on table public.bars to service_role;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop policy if exists bars_select_all on public.bars;
--   drop table if exists public.bars;
------------------------------------------------------------------------------
