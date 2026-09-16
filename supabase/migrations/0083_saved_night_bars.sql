-- 0083 — snapshot a saved night's route and ratings (S-08 / S-08a).
--
-- Owner-authorised 2026-09-16: the saved-night recap (README section 8) needs
-- the bars the night visited and the owner's rating of each, but 0068's archive
-- kept only a bar COUNT and the photos. This adds the missing snapshot so the
-- recap composes from the archive itself — "opens that night's archived recap
-- exactly as it was saved", not from the live plan (which may be renamed,
-- re-decided, cancelled, or deleted).
--
-- THREE CHANGES:
--   1. saved_night_bars — the ordered stops of one saved night, each with the
--      archiving owner's rating tier (loved/liked/pass) or NULL, captured at
--      save time. Own-row RLS through saved_nights, exactly like
--      saved_night_media. On re-archive the set is refreshed wholesale.
--   2. archive_night_out — after the media snapshot, snapshot the shortlist
--      bars (public.night_out_suggestions, one row per bar) ordered by when each
--      was suggested, joined to the owner's public.ratings. The rest of the
--      function is byte-for-byte 0068 (this file was generated from that body).
--   3. get_saved_night_bars — the caller reads the stops of their OWN saved
--      night (owner-scoped, like get_saved_night). Counts and photos stay in
--      get_saved_night, untouched.
--
-- Applied to STAGING on the owner's word (alongside 0081/0082); production as
-- its own authorised step. Number is above the repo max (0082).

------------------------------------------------------------------------------
-- 1. saved_night_bars — the ordered, rated stops of one saved night.
------------------------------------------------------------------------------

create table if not exists public.saved_night_bars (
  saved_night_id uuid        not null references public.saved_nights(id) on delete cascade,
  bar_id         text        not null,
  sort_order     integer     not null default 0,
  -- The owner's tier for this bar at archive time; NULL = unrated then.
  rating         text        null,
  created_at     timestamptz not null default now(),
  constraint saved_night_bars_pkey primary key (saved_night_id, bar_id),
  constraint saved_night_bars_bar_check check (bar_id ~ '^[a-z0-9-]{1,60}$'),
  constraint saved_night_bars_rating_check check (rating is null or rating in ('loved', 'liked', 'pass'))
);

comment on table public.saved_night_bars is
  'S-08a (0083). The stops of one saved night, ordered, each with the archiving owner''s rating tier captured at save time (NULL = unrated). Snapshot, not a live read: the recap opens exactly as it was saved. Own-row via saved_nights.';

alter table public.saved_night_bars enable row level security;
revoke all on table public.saved_night_bars from public, anon, authenticated;

drop policy if exists saved_night_bars_own_row on public.saved_night_bars;
create policy saved_night_bars_own_row on public.saved_night_bars
  for all
  using (
    exists (
      select 1 from public.saved_nights sn
       where sn.id = saved_night_id and sn.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.saved_nights sn
       where sn.id = saved_night_id and sn.owner_id = auth.uid()
    )
  );

------------------------------------------------------------------------------
-- 2. archive_night_out — also snapshot the route + ratings.
------------------------------------------------------------------------------

create or replace function public.archive_night_out(p_night_out uuid)
returns table (saved_night_id uuid, photo_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_night  date;
  v_title  text;
  v_bars   integer;
  v_saved  uuid;
  v_count  integer;
  v_locked uuid[];
  v_media  uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  -- PARTICIPATION IS REQUIRED, exactly as V8-R-NO-009's trust boundary states:
  -- "authentication and Night Out participation are both required". A
  -- token-scoped recipient without the app is not a member and cannot archive
  -- (D-C-23).
  if public.night_out_role(p_night_out) is null then
    raise exception 'not a member of that night out' using errcode = '42501';
  end if;

  select n.night, n.title into v_night, v_title
    from public.night_outs n
   where n.id = p_night_out;
  if v_night is null then
    raise exception 'no such night out' using errcode = '42501';
  end if;

  -- AHEAD OF EVERY WRITE. Same errcode and same single predicate as
  -- add_night_out_media's own guard, asked of the same PLAN, so both halves of
  -- "you may act on this night's media" open and close at exactly the same two
  -- instants — including when the owner has edited When (V8-R-NO-002).
  if not public.night_out_media_window_open(p_night_out) then
    raise exception 'the night out media window is not open' using errcode = '22023';
  end if;

  select count(distinct s.bar_id)::integer into v_bars
    from public.night_out_suggestions s
   where s.night_out_id = p_night_out;

  insert into public.saved_nights (owner_id, night_out_id, title, night, bar_count)
  values (v_uid, p_night_out, v_title, v_night, coalesce(v_bars, 0))
  on conflict (owner_id, night_out_id) where night_out_id is not null
  do update set
    title      = excluded.title,
    bar_count  = excluded.bar_count,
    archived_at = now()
  returning id into v_saved;

  -- THE ORDERED LIST, in two steps: take in whatever is live, then number the
  -- WHOLE card.
  --
  -- ROUND-3 PANEL (Claude gate). One statement used to do both, numbering with
  -- `row_number()` over the live set and inserting `on conflict do nothing` —
  -- so a row that already existed KEPT the number an earlier pass gave it while
  -- new rows got numbers from a freshly recomputed sequence. Archive A,B,C
  -- (1,2,3); B's destination is removed; attach D and re-archive: the live set
  -- A,C,D numbers 1,2,3, C's insert is skipped and keeps 3, and D arrives as 3
  -- too. `get_saved_night`'s ORDER BY sort_order then returns those two in
  -- whatever order the executor likes, and the archive stops opening "in the
  -- order the night actually happened" — the only promise this column makes.
  --
  -- Renumbering just the live rows does NOT fix it, which is why the numbering
  -- is its own statement over the whole saved night. The archive deliberately
  -- OUTLIVES the live window — a retention hold keeps bytes an author removed
  -- everywhere else (V8-R-CMP-016) — so a card routinely holds rows that are no
  -- longer live, and those rows carry numbers from the pass that added them. B
  -- above is exactly such a row: renumber A,C,D to 1,2,3 and B's stale 2
  -- collides with C.
  --
  -- The key is the MEDIA's own created_at rather than the destination's: it is
  -- the one instant every row on the card has, live or retained, and it is the
  -- order the night happened in. media_id breaks ties so the result is total.
  -- THE BYTES ARE LOCKED BEFORE THEY ARE ARCHIVED (round-6 panel, Codex, HIGH).
  -- `get_night_out_media` filters `bytes_removed_at is null`, but that is a
  -- fact about this transaction's snapshot: a reclamation that committed after
  -- it still left the row in this list, and the archive then took a retention
  -- hold on bytes already claimed for deletion — a saved card that loses its
  -- photo the moment the sweep runs.
  --
  -- Ordered by media id so two participants archiving the same night cannot
  -- deadlock against each other, and the INSERT below reads only the ids we
  -- hold, in its own statement, so its snapshot is taken after every claim we
  -- waited on had committed.
  select coalesce(array_agg(live.media_id order by live.media_id), '{}'::uuid[])
    into v_locked
    from public.get_night_out_media(p_night_out) live;

  foreach v_media in array v_locked loop
    perform 1 from public.media_objects m where m.id = v_media for update;
  end loop;

  insert into public.saved_night_media (saved_night_id, media_id)
  select v_saved, m.id
    from public.media_objects m
   where m.id = any(v_locked)
     and m.bytes_removed_at is null
  on conflict on constraint saved_night_media_pkey do nothing;

  with ordered as (
    select snm.media_id,
           (row_number() over (order by m.created_at, m.id))::integer as n
      from public.saved_night_media snm
      join public.media_objects m on m.id = snm.media_id
     where snm.saved_night_id = v_saved
  )
  update public.saved_night_media snm
     set sort_order = ordered.n
    from ordered
   where snm.saved_night_id = v_saved
     and snm.media_id = ordered.media_id
     and snm.sort_order is distinct from ordered.n;

  -- THE RETENTION HOLD, one per archived object. 0066 already treats a live
  -- kind='archive' row as the thing that keeps bytes from being reclaimed and
  -- that "delete everywhere" must not clear (V8-R-CMP-016) — this is the writer
  -- that table was waiting for, and the reason "indefinite until account
  -- deletion" survives the author deleting the post everywhere else.
  insert into public.media_destinations (media_id, kind, ref_id)
  select snm.media_id, 'archive', v_saved::text
    from public.saved_night_media snm
   where snm.saved_night_id = v_saved
  on conflict do nothing;

  -- S-08a (0083): SNAPSHOT THE ROUTE AND THE OWNER'S RATINGS at archive time, so
  -- the recap opens exactly as it was saved — a plan later renamed, re-decided
  -- or cancelled does not rewrite it, and a deleted plan (night_out_id set null)
  -- does not empty it. The stops are the plan's shortlist (night_out_suggestions,
  -- one row per bar), ordered by when each was suggested; the rating is the
  -- ARCHIVING owner's own tier for that bar, read here as the definer (v_uid is
  -- auth.uid()). Refreshed wholesale on re-archive: a re-save reflects the
  -- shortlist and the ratings as they stand now, matching how the media list is
  -- rebuilt above.
  delete from public.saved_night_bars where saved_night_id = v_saved;
  insert into public.saved_night_bars (saved_night_id, bar_id, sort_order, rating)
  select v_saved,
         s.bar_id,
         (row_number() over (order by s.created_at, s.bar_id))::integer as sort_order,
         r.tier
    from public.night_out_suggestions s
    left join public.ratings r
      on r.user_id = v_uid and r.bar_id = s.bar_id
   where s.night_out_id = p_night_out;

  select count(*)::integer into v_count
    from public.saved_night_media snm
   where snm.saved_night_id = v_saved;

  return query select v_saved, v_count;
end;
$$;

------------------------------------------------------------------------------
-- 3. get_saved_night_bars — the owner reads their saved night's stops.
------------------------------------------------------------------------------

create or replace function public.get_saved_night_bars(p_id uuid)
returns table (bar_id text, sort_order integer, rating text)
language sql
stable
security definer
set search_path = public
as $$
  select b.bar_id, b.sort_order, b.rating
    from public.saved_night_bars b
    join public.saved_nights sn on sn.id = b.saved_night_id
   where b.saved_night_id = p_id
     and sn.owner_id = auth.uid()
   order by b.sort_order asc;
$$;

comment on function public.get_saved_night_bars(uuid) is
  'S-08a (0083). The ordered, rated stops of the caller''s OWN saved night (owner-scoped like get_saved_night). Counts and photos stay in get_saved_night.';

revoke all on function public.get_saved_night_bars(uuid) from public, anon, authenticated;
grant execute on function public.get_saved_night_bars(uuid) to authenticated;
