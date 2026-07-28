-- Next Bar — 0020 provenance + owned-media foundation (Phase 1)
--
-- WHY: the catalog currently stores Google Places content (hours, photo
-- references) as if we owned it. Google's Places policy permits storing
-- the place_id indefinitely and nothing else beyond narrow exceptions —
-- there is no allowance covering opening hours. This migration adds the
-- provenance needed to (a) stop RELYING on Google-derived hours without
-- deleting anything yet, and (b) hold first-party media we actually have
-- the rights to.
--
-- House style (0016/0017/0018): revoke-first grants, definer reads behind
-- a materialized fence, p_-prefixed params, idempotent DDL.

------------------------------------------------------------------------------
-- 1. Hours provenance on bars
------------------------------------------------------------------------------

alter table public.bars
  add column if not exists hours_source text,
  add column if not exists hours_verified_at timestamptz,
  add column if not exists hours_confidence text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bars_hours_source_check'
  ) then
    alter table public.bars add constraint bars_hours_source_check
      check (hours_source is null or hours_source in
        ('google', 'venue', 'nextbar', 'user', 'official_site'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'bars_hours_confidence_check'
  ) then
    alter table public.bars add constraint bars_hours_confidence_check
      check (hours_confidence is null or hours_confidence in
        ('unverified', 'reported', 'verified'));
  end if;
end $$;

-- BACKFILL: every hours value we hold today came from Google enrichment.
-- Marking it 'unverified' is the actual remediation — the app stops
-- treating it as authoritative immediately, without a destructive delete
-- and without waiting for replacement hours to exist.
update public.bars
   set hours_source = 'google',
       hours_confidence = 'unverified'
 where hours is not null
   and hours_source is null;

comment on column public.bars.hours_confidence is
  'unverified = Google-derived, NOT usable for strict Open-now filtering; '
  'reported = venue/user claimed, unconfirmed; verified = first-party checked.';

------------------------------------------------------------------------------
-- 2. photo_permissions — INSERT-ONLY rights record
------------------------------------------------------------------------------
-- The permission record must survive the photo it authorizes. If a
-- claimant could edit or delete their own grant after a DMCA notice, the
-- evidence of good-faith reliance disappears exactly when it is needed.
-- Grants alone don't achieve that (service_role bypasses RLS), so
-- immutability is enforced by a TRIGGER: an UPDATE or DELETE raises,
-- whoever attempts it.

create table if not exists public.photo_permissions (
  id uuid primary key default gen_random_uuid(),
  rights_basis text not null
    constraint photo_permissions_rights_basis_check
    check (rights_basis in
      ('venue_owned', 'venue_licensed', 'user_owned', 'nextbar_owned', 'licensed_stock')),
  granted_by text not null,
  granted_by_user_id uuid references public.profiles(id) on delete set null,
  permission_timestamp timestamptz not null default now(),
  license_version_accepted text not null,
  evidence_url text,
  created_at timestamptz not null default now()
);

create or replace function public.photo_permissions_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'photo_permissions is append-only: % on row % is not permitted (rights records must survive takedown)',
    tg_op, coalesce(old.id::text, '?');
end;
$$;

drop trigger if exists photo_permissions_no_update on public.photo_permissions;
create trigger photo_permissions_no_update
  before update or delete on public.photo_permissions
  for each row execute function public.photo_permissions_immutable();

alter table public.photo_permissions enable row level security;
revoke all on table public.photo_permissions from public, anon, authenticated;

------------------------------------------------------------------------------
-- 3. bar_photos — first-party media
------------------------------------------------------------------------------
-- Google photos are NEVER written here. Uploads land private and pending;
-- only 'approved' rows are publicly readable. All writes go through
-- service-role server routes because an upload needs server-side
-- processing (re-encode to strip EXIF/polyglot payloads, hash, scan) that
-- RLS cannot perform.

create table if not exists public.bar_photos (
  id uuid primary key default gen_random_uuid(),
  bar_id text not null references public.bars(id) on delete cascade,
  storage_key text not null unique,
  source text not null
    constraint bar_photos_source_check
    check (source in ('nextbar', 'venue', 'user', 'licensed')),
  permission_id uuid not null references public.photo_permissions(id),
  photographer text,
  attribution_text text,
  is_primary boolean not null default false,
  moderation_status text not null default 'pending'
    constraint bar_photos_moderation_check
    check (moderation_status in ('pending', 'approved', 'rejected', 'removed')),
  file_hash text,
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bar_photos_bar_approved_idx
  on public.bar_photos (bar_id) where moderation_status = 'approved';

-- At most one primary photo per bar (partial unique index).
create unique index if not exists bar_photos_one_primary_idx
  on public.bar_photos (bar_id) where is_primary and moderation_status = 'approved';

alter table public.bar_photos enable row level security;
revoke all on table public.bar_photos from public, anon, authenticated;
grant select on table public.bar_photos to anon, authenticated;

drop policy if exists bar_photos_read_approved on public.bar_photos;
create policy bar_photos_read_approved on public.bar_photos
  for select to anon, authenticated
  using (moderation_status = 'approved');

drop trigger if exists bar_photos_touch_updated_at on public.bar_photos;
create trigger bar_photos_touch_updated_at
  before update on public.bar_photos
  for each row execute function public.bars_touch_updated_at();

------------------------------------------------------------------------------
-- 4. bar_change_queue — moderated corrections
------------------------------------------------------------------------------
-- Low blast radius (a suggestion, not a write to production data), so
-- authenticated INSERT under RLS is acceptable here — unlike photos and
-- claims. A per-user pending cap stops one account flooding the queue.
-- The cap is computed by a DEFINER function so the policy does not
-- subquery its own table under RLS (that recurses).

create table if not exists public.bar_change_queue (
  id uuid primary key default gen_random_uuid(),
  bar_id text not null references public.bars(id) on delete cascade,
  field text not null
    constraint bar_change_queue_field_check
    check (field in
      ('hours', 'price_tier', 'tags', 'address', 'name', 'closed', 'links', 'other')),
  proposed_value jsonb,
  note text,
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    constraint bar_change_queue_status_check
    check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_note text
);

create index if not exists bar_change_queue_pending_idx
  on public.bar_change_queue (status, created_at) where status = 'pending';

create or replace function public.pending_change_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.bar_change_queue q
   where q.submitted_by = p_user
     and q.status = 'pending';
$$;

revoke all on function public.pending_change_count(uuid) from public, anon, authenticated;
grant execute on function public.pending_change_count(uuid) to authenticated;

alter table public.bar_change_queue enable row level security;
revoke all on table public.bar_change_queue from public, anon, authenticated;
grant select, insert on table public.bar_change_queue to authenticated;

drop policy if exists bar_change_queue_insert_own on public.bar_change_queue;
create policy bar_change_queue_insert_own on public.bar_change_queue
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and status = 'pending'
    and public.pending_change_count(auth.uid()) < 20
  );

drop policy if exists bar_change_queue_read_own on public.bar_change_queue;
create policy bar_change_queue_read_own on public.bar_change_queue
  for select to authenticated
  using (submitted_by = auth.uid());

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop policy if exists bar_change_queue_read_own on public.bar_change_queue;
--   drop policy if exists bar_change_queue_insert_own on public.bar_change_queue;
--   drop function if exists public.pending_change_count(uuid);
--   drop table if exists public.bar_change_queue;
--   drop trigger if exists bar_photos_touch_updated_at on public.bar_photos;
--   drop policy if exists bar_photos_read_approved on public.bar_photos;
--   drop table if exists public.bar_photos;
--   drop trigger if exists photo_permissions_no_update on public.photo_permissions;
--   drop function if exists public.photo_permissions_immutable();
--   drop table if exists public.photo_permissions;
--   alter table public.bars drop column if exists hours_confidence,
--     drop column if exists hours_verified_at, drop column if exists hours_source;
------------------------------------------------------------------------------
