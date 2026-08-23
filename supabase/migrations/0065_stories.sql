-- Next Bar — 0065 Stories: real, cross-account, photo-backed, 24-hour
--
-- Operator decision 2026-08-22. V8 Stories were built local-first in cycle 1 —
-- `localStorage` records, data URLs, a demo-seeded people graph — and that is
-- not acceptable for production. This migration is the authoritative store:
-- real image bytes in a PRIVATE bucket, metadata in Postgres, visibility
-- decided by the database rather than by the client.
--
-- FIRST STORAGE BUCKET IN THIS REPOSITORY. Nothing referenced `storage.objects`
-- before this file, so the conventions below are established here.
--
-- WHAT THE DATABASE OWNS, AND WHY IT MUST
--
--   * TIME. `created_at` and `expires_at` are set from SERVER time and are not
--     insertable by a client — there is no INSERT grant on `public.stories` at
--     all, only `publish_story()`. A story becomes unreadable exactly when
--     `expires_at <= now()`, evaluated per query, so it stops being readable at
--     that instant whether or not any cleanup job has run and whatever the
--     client clock says. Physical deletion is housekeeping, never the gate.
--
--     THAT HOUSEKEEPING HAS NO OWNER YET. Nothing in this repository deletes
--     the BYTES of an expired story: the read gate closes on time, the object
--     stays in the bucket. It is not a visibility hole — every read policy
--     above, including the author's own and the storage ones, refuses an
--     expired story's object — but it is a retention gap against the 24-hour
--     promise, and a scheduled sweep (Storage API, not SQL: deleting a
--     storage.objects row does not free the backing object) is required
--     before this ships to real users. Recorded, not hidden.
--
--   * AUDIENCE. "Friends" means ACCEPTED MUTUAL friends — edges in
--     `public.follows` in BOTH directions — consistent with the app's own copy.
--     A one-way follow is not a friend and reads nothing. A custom audience is
--     a stored set of real profile ids in `public.story_audience`, enforced
--     here; it ALSO requires mutuality, so a custom pick can never reach
--     someone who is not already a friend. "Selected groups" is deliberately
--     absent: no saved-groups capability exists in this database, and V8 must
--     not present a people picker as a group feature (deferred to V9).
--
--   * TAGS. `public.story_tags` is a real relationship, and the tagged person —
--     not the author — can remove their own tag. That is a consent control and
--     a local-only version of it is worthless.
--
-- MEDIA PRIVACY RULES INHERITED, NOT RE-DECIDED. Goal g-e9d493e9 ("venue-tagged
-- personal night photos") already settled the private-media design for this
-- repository. Its rules bind here: personal media stays SEPARATE from the
-- publicly readable `public.bar_photos`; bytes live in a private bucket reached
-- only by short-lived signed URLs; deletion cascades. Story media differs from
-- night photos only in LIFETIME (24 hours, expiry-enforced), which is why it
-- gets its own table and bucket rather than borrowing 0038's draft.
--
-- EXIF/GPS STRIPPING IS NOT YET ENFORCED SERVER-SIDE, and this header used to
-- claim it was "recorded on the upload path" when nothing on that path
-- recorded or performed it. Stated honestly instead: the capture pipeline
-- re-encodes through a canvas, which drops metadata, and that fallback now
-- fails CLOSED rather than passing raw bytes through — but a MODIFIED client
-- still uploads whatever bytes it likes. What this file can enforce it does:
-- allowed_mime_types on the bucket below rejects non-image content outright.
-- What it cannot enforce is a decode-and-re-encode of the stored object, which
-- needs a server-side upload path (an edge function or a route handler) that
-- this build does not have. That is an OPEN obligation, recorded here and in
-- src/lib/stories.server.ts, and it is not closed by a bucket policy.
--
-- NUMBERING. The serving ledger head was 0064 when this was written, with 0060
-- stranded below it and 0061-0063 unaccounted for (see the migration-drift
-- report, goal g-92f959db). 0065 is the next free number ON THIS BRANCH; the
-- next free number on the TARGET must be re-confirmed against that target's
-- own `public.schema_migrations` before this is applied anywhere.
--
-- NOT APPLIED BY THIS CHANGE. This file is authored, tested statically, and
-- left for an attended staging apply. Nothing here has run against any database.
--
-- Idempotent throughout: `create ... if not exists`, `drop policy if exists`
-- before each policy, `create or replace` for functions. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Mutuality helper
------------------------------------------------------------------------------

-- SECURITY DEFINER because `public.follows` RLS (0007) only lets a caller read
-- edges it is a party to, and deciding "are A and B mutual" needs both edges
-- even when the caller is only one of them. STABLE, and it reads nothing but
-- follows.
--
-- THE PARTY GUARD IS NOT OPTIONAL. SECURITY DEFINER is exactly what makes this
-- function see the edges 0007 hides, so without a caller check it is a
-- pairwise ORACLE over the private follow graph: any authenticated account
-- could ask "are these two profiles friends?" about ANY two ids and, by
-- probing, enumerate a target's friendships — relationship data 0007
-- deliberately restricts to the parties themselves. Every legitimate call site
-- (both story RLS policies and publish_story) passes auth.uid() as one of the
-- two arguments, so the guard changes no behaviour this schema depends on.
--
-- A NULL caller is trusted infrastructure — migrations, the service role, a
-- server-side job — and is allowed through: PostgREST always carries a JWT, so
-- "auth.uid() is null" is not reachable from a signed-in browser.
create or replace function public.is_mutual_friend(a uuid, b uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is not null and v_caller <> a and v_caller <> b then
    raise exception 'is_mutual_friend: a caller may only ask about itself'
      using errcode = '42501';
  end if;
  return a is not null
     and b is not null
     and a <> b
     and exists (
       select 1 from public.follows f
        where f.follower_id = a and f.followee_id = b
     )
     and exists (
       select 1 from public.follows f
        where f.follower_id = b and f.followee_id = a
     );
end;
$$;

comment on function public.is_mutual_friend(uuid, uuid) is
  'Accepted mutual friendship: follows edges in BOTH directions. A one-way '
  'follow is not a friend. Used by the stories RLS policies. Refuses any '
  'caller that is not one of the two parties, so it cannot be used as an '
  'oracle over the follow graph 0007 restricts.';

revoke all on function public.is_mutual_friend(uuid, uuid) from public, anon;
grant execute on function public.is_mutual_friend(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- 2. Tables
------------------------------------------------------------------------------

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  -- Catalog id chosen by the poster. Venue-tagged, never geotagged.
  bar_id text,
  caption text,
  -- Object keys in the private `story-media` bucket. `inset_path` is present
  -- only for a dual shot; the pair is the locked composition the author
  -- approved.
  media_path text not null,
  inset_path text,
  media_kind text not null default 'single'
    check (media_kind in ('single', 'dual')),
  audience text not null default 'friends'
    check (audience in ('friends', 'custom')),
  -- SERVER time, both of them. No client writes these: there is no INSERT
  -- grant on this table, and publish_story() is the only way in.
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  -- Author "Undo"/delete. Soft first so the read gate stops instantly while
  -- the caller still holds the paths it needs to delete the bytes.
  deleted_at timestamptz,
  constraint stories_expiry_after_creation check (expires_at > created_at),
  constraint stories_dual_has_inset check (
    (media_kind = 'dual' and inset_path is not null)
    or (media_kind = 'single' and inset_path is null)
  )
);

-- The read path is always "unexpired, not deleted, by these authors".
create index if not exists stories_live_idx
  on public.stories (author_id, created_at desc)
  where deleted_at is null;
create index if not exists stories_expires_idx
  on public.stories (expires_at)
  where deleted_at is null;

-- Custom-audience recipients: REAL profile ids, never handles.
create table if not exists public.story_audience (
  story_id uuid not null references public.stories(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (story_id, profile_id)
);
create index if not exists story_audience_profile_idx
  on public.story_audience (profile_id);

-- Tagged people. `removed_at` is the tagged person's own consent withdrawal.
create table if not exists public.story_tags (
  story_id uuid not null references public.stories(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  removed_at timestamptz,
  primary key (story_id, profile_id)
);
create index if not exists story_tags_profile_idx
  on public.story_tags (profile_id) where removed_at is null;

------------------------------------------------------------------------------
-- 3. Row level security
------------------------------------------------------------------------------

alter table public.stories enable row level security;
alter table public.story_audience enable row level security;
alter table public.story_tags enable row level security;

-- Author sees its own — and the SAME expiry boundary applies. This policy
-- previously carried no expires_at term, on the reasoning that an author may
-- see its own history. That made the file contradict its own header ("a story
-- becomes unreadable exactly when expires_at <= now()") and left an author
-- able to read, and to mint media URLs for, content the product told them was
-- gone after 24 hours. No V8 surface wanted the exception — the client already
-- filters on expiry — and delete_story does not depend on this policy, so the
-- boundary is now uniform: unexpired, undeleted, or unreadable.
drop policy if exists "stories: author reads own" on public.stories;
create policy "stories: author reads own"
  on public.stories for select
  using (
    auth.uid() = author_id
    and deleted_at is null
    and expires_at > now()
  );

-- THE AUDIENCE GATE. Expiry is part of the predicate, so an expired story is
-- unreadable by query even if physical cleanup has not run.
drop policy if exists "stories: audience reads unexpired" on public.stories;
create policy "stories: audience reads unexpired"
  on public.stories for select
  using (
    deleted_at is null
    and expires_at > now()
    and auth.uid() <> author_id
    and public.is_mutual_friend(auth.uid(), author_id)
    and (
      audience = 'friends'
      or (
        audience = 'custom'
        and exists (
          select 1 from public.story_audience sa
           where sa.story_id = public.stories.id
             and sa.profile_id = auth.uid()
        )
      )
    )
  );

-- Only the author may soft-delete, and only its own row.
drop policy if exists "stories: author updates own" on public.stories;
create policy "stories: author updates own"
  on public.stories for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- Recipients are readable by the author and by the recipient themselves.
drop policy if exists "story_audience: parties read" on public.story_audience;
create policy "story_audience: parties read"
  on public.story_audience for select
  using (
    auth.uid() = profile_id
    or exists (
      select 1 from public.stories s
       where s.id = story_id and s.author_id = auth.uid()
    )
  );

-- Tags are readable by anyone who can read the story, plus the tagged person.
drop policy if exists "story_tags: readable with story" on public.story_tags;
create policy "story_tags: readable with story"
  on public.story_tags for select
  using (
    auth.uid() = profile_id
    or exists (select 1 from public.stories s where s.id = story_id)
  );

-- A tagged person removes THEIR OWN tag. Nobody else's.
drop policy if exists "story_tags: subject removes own" on public.story_tags;
create policy "story_tags: subject removes own"
  on public.story_tags for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- No direct INSERT policy on any of the three: publication goes through
-- publish_story() so server time and the mutuality checks cannot be bypassed.
revoke all on table public.stories from public, anon;
revoke all on table public.story_audience from public, anon;
revoke all on table public.story_tags from public, anon;
grant select on table public.stories to authenticated;
grant update (deleted_at) on table public.stories to authenticated;
grant select on table public.story_audience to authenticated;
grant select on table public.story_tags to authenticated;
grant update (removed_at) on table public.story_tags to authenticated;

------------------------------------------------------------------------------
-- 4. Private media bucket
------------------------------------------------------------------------------

-- PRIVATE. `public = false` means no anonymous object URL exists; every read is
-- a short-lived signed URL minted for an authorised caller.
--
-- BOUNDED AND TYPED. The insert policy below decides WHO may write under a
-- prefix; it cannot decide how big the object is or what it contains, so an
-- authenticated account could otherwise store arbitrary bytes of arbitrary
-- type under its own prefix, unmetered. The bucket's own limits are the only
-- place that rule can live. 8 MiB is comfortably above a re-encoded 1440px
-- JPEG (the capture pipeline's own bound) and far below a useful file dump.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-media', 'story-media', false,
  8388608, -- 8 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object key convention, enforced below: `<author_id>/<story_id>/<main|inset>`.
-- The first path segment is the owner, so ownership is decidable from the key
-- alone before any story row exists — which is what makes the upload-then-
-- publish order safe.
drop policy if exists "story-media: owner writes own prefix" on storage.objects;
create policy "story-media: owner writes own prefix"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'story-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Is this object referenced by a story that is deleted or expired?
--
-- SECURITY DEFINER ON PURPOSE, and it is the whole point of this function. The
-- owner-read policy below used to inline this as a plain `not exists (select
-- ... from public.stories ...)`. That subquery runs under the CALLER's RLS, and
-- the author SELECT policy above deliberately hides expired and deleted rows
-- from the author too — so for the one caller that matters the subquery matched
-- NOTHING, `not exists` was therefore TRUE, and the author could still sign
-- their own expired media. The check inverted itself precisely when it was
-- needed. Reading the stories table with the definer's rights is the only way
-- for the policy to see the row that disqualifies the object.
--
-- FAILS CLOSED, and refuses to be an oracle: it answers only for objects under
-- the CALLER's own prefix. For anything else it returns true ("treat as dead"),
-- so a direct call cannot be used to probe whether someone else's object exists
-- or is still live. The owner policy already requires that same ownership, so
-- the restriction costs the legitimate caller nothing.
create or replace function public.story_media_is_dead(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_name is null
     or auth.uid() is null
     or (storage.foldername(p_name))[1] is distinct from auth.uid()::text then
    return true;
  end if;
  return exists (
    select 1 from public.stories s
     where (s.media_path = p_name or s.inset_path = p_name)
       and (s.deleted_at is not null or s.expires_at <= now())
  );
end;
$$;

revoke all on function public.story_media_is_dead(text) from public, anon;
grant execute on function public.story_media_is_dead(text) to authenticated;

comment on function public.story_media_is_dead(text) is
  'True when a story-media object is referenced by a deleted or expired story. '
  'SECURITY DEFINER because the owner storage policy must see rows the author''s '
  'own RLS hides. Answers only for the caller''s own prefix and fails closed.';

-- The owner reads its own bytes — but not once the story that referenced them
-- has expired or been deleted. Prefix ownership alone would have left the
-- author able to mint a signed URL for its own expired media indefinitely,
-- which is the byte-level version of the gap the author SELECT policy above
-- closed. An object no story references YET is still readable by its owner:
-- that is the window between upload and publish, and cleanup depends on it.
drop policy if exists "story-media: owner reads own prefix" on storage.objects;
create policy "story-media: owner reads own prefix"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'story-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.story_media_is_dead(storage.objects.name)
  );

-- A viewer reads an object only while some story it can actually read points at
-- it. The same predicate as the table gate, reached through the row, so expiry
-- and audience apply to the BYTES and not only to the metadata.
drop policy if exists "story-media: audience reads referenced" on storage.objects;
create policy "story-media: audience reads referenced"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'story-media'
    and exists (
      select 1 from public.stories s
       where (s.media_path = storage.objects.name
              or s.inset_path = storage.objects.name)
         and s.deleted_at is null
         and s.expires_at > now()
         and public.is_mutual_friend(auth.uid(), s.author_id)
         and (
           s.audience = 'friends'
           or exists (
             select 1 from public.story_audience sa
              where sa.story_id = s.id and sa.profile_id = auth.uid()
           )
         )
    )
  );

-- Only the owner deletes their own bytes. This is also the cleanup path for a
-- partial upload, which is why it does not depend on a story row existing.
drop policy if exists "story-media: owner deletes own prefix" on storage.objects;
create policy "story-media: owner deletes own prefix"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'story-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

------------------------------------------------------------------------------
-- 5. Publication, deletion, tag withdrawal
------------------------------------------------------------------------------

-- The ONLY way a story is created. SECURITY DEFINER so it can verify mutuality
-- against both follows edges and stamp server time, neither of which a direct
-- INSERT could be trusted to do.
--
-- Every custom recipient must already be a mutual friend. An audience naming
-- nobody reachable is REFUSED rather than silently downgraded to 'friends':
-- widening an audience the author narrowed is the more dangerous failure.
create or replace function public.publish_story(
  p_media_path text,
  p_media_kind text default 'single',
  p_inset_path text default null,
  p_bar_id text default null,
  p_caption text default null,
  p_audience text default 'friends',
  p_audience_ids uuid[] default '{}',
  p_tag_ids uuid[] default '{}'
)
returns public.stories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid := auth.uid();
  v_story public.stories;
  v_id uuid;
begin
  if v_author is null then
    raise exception 'publish_story: not authenticated' using errcode = '28000';
  end if;
  if p_media_path is null or length(trim(p_media_path)) = 0 then
    raise exception 'publish_story: media_path is required' using errcode = '22023';
  end if;
  -- The bytes must already be under this author's own prefix. Publishing a
  -- path the caller does not own would let one account claim another's object.
  if split_part(p_media_path, '/', 1) <> v_author::text then
    raise exception 'publish_story: media_path is not owned by the caller'
      using errcode = '42501';
  end if;
  if p_inset_path is not null
     and split_part(p_inset_path, '/', 1) <> v_author::text then
    raise exception 'publish_story: inset_path is not owned by the caller'
      using errcode = '42501';
  end if;
  if p_audience not in ('friends', 'custom') then
    raise exception 'publish_story: unknown audience %', p_audience
      using errcode = '22023';
  end if;
  if p_audience = 'custom'
     and (p_audience_ids is null or array_length(p_audience_ids, 1) is null) then
    raise exception 'publish_story: a custom audience needs at least one recipient'
      using errcode = '22023';
  end if;

  -- THE BYTES MUST BE THERE. Owning the prefix is not the same as having
  -- uploaded anything: without this check any authenticated caller can publish
  -- a live story naming a path under its own UUID that holds no object, and
  -- the surface renders a photo-less card for every friend. Publication is
  -- upload-THEN-publish precisely so this is checkable, and checking it is
  -- what makes the story row's promise ("there is a photo here") true.
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'story-media' and o.name = p_media_path
  ) then
    raise exception 'publish_story: media_path names no uploaded object'
      using errcode = '22023';
  end if;
  if p_inset_path is not null and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'story-media' and o.name = p_inset_path
  ) then
    raise exception 'publish_story: inset_path names no uploaded object'
      using errcode = '22023';
  end if;

  -- Checked BEFORE anything is written. A raise would roll the whole function
  -- back anyway, but refusing first keeps the failure a validation error rather
  -- than a rolled-back write, and keeps the order readable.
  if p_audience = 'custom' and exists (
    select 1 from unnest(p_audience_ids) as candidate(id)
     where not public.is_mutual_friend(v_author, candidate.id)
  ) then
    raise exception 'publish_story: every custom recipient must be a mutual friend'
      using errcode = '42501';
  end if;

  -- TAGS TAKE THE SAME RULE. A tag is a write onto ANOTHER person's consent
  -- surface: the tagged profile can read its own story_tags row, so an
  -- unchecked p_tag_ids let any authenticated caller attach a stranger to a
  -- story that stranger cannot even see — a harassment/spam write the
  -- friends-only people picker in the UI implies is impossible. Tagging
  -- YOURSELF stays allowed; is_mutual_friend is false for a = b.
  if p_tag_ids is not null and exists (
    select 1 from unnest(p_tag_ids) as candidate(id)
     where candidate.id <> v_author
       and not public.is_mutual_friend(v_author, candidate.id)
  ) then
    raise exception 'publish_story: you can only tag friends who follow you back'
      using errcode = '42501';
  end if;

  -- A TAGGED PERSON MUST BE ABLE TO REACH THEIR OWN TAG. Mutuality alone is not
  -- enough on a CUSTOM story: the audience is exactly `p_audience_ids`, so a
  -- mutual friend who is tagged but NOT named in that audience cannot read the
  -- story, cannot see the tagged-people sheet, and therefore cannot reach the
  -- "Remove me" control that is their only consent withdrawal. The tag would be
  -- a write onto their consent surface that they can neither see nor undo —
  -- which is the same harassment shape the mutuality rule above exists to stop,
  -- reached by a different route.
  --
  -- Refused rather than auto-widened: silently adding the tagged person to the
  -- audience would publish to someone the author deliberately excluded, and
  -- widening an audience the author narrowed is the more dangerous repair.
  -- Tagging YOURSELF stays allowed — the author always reads their own story.
  if p_audience = 'custom' and p_tag_ids is not null and exists (
    select 1 from unnest(p_tag_ids) as candidate(id)
     where candidate.id <> v_author
       and not (candidate.id = any (coalesce(p_audience_ids, '{}'::uuid[])))
  ) then
    raise exception
      'publish_story: everyone you tag must be in a custom story''s audience'
      using errcode = '42501';
  end if;

  insert into public.stories (
    author_id, bar_id, caption, media_path, inset_path, media_kind, audience
  )
  values (
    v_author, p_bar_id, p_caption, p_media_path, p_inset_path,
    p_media_kind, p_audience
  )
  returning id into v_id;

  if p_audience = 'custom' then
    insert into public.story_audience (story_id, profile_id)
      select v_id, distinct_id
        from (select distinct unnest(p_audience_ids) as distinct_id) ids
      on conflict do nothing;
  end if;

  if p_tag_ids is not null and array_length(p_tag_ids, 1) is not null then
    insert into public.story_tags (story_id, profile_id)
      select v_id, distinct_id
        from (select distinct unnest(p_tag_ids) as distinct_id) ids
      on conflict do nothing;
  end if;

  select * into v_story from public.stories where id = v_id;
  return v_story;
end;
$$;

comment on function public.publish_story is
  'The only path that creates a story. Stamps server created_at/expires_at, '
  'verifies the media keys belong to the caller AND name objects that were '
  'actually uploaded, and refuses a custom audience or a tag list containing '
  'anyone who is not an accepted mutual friend.';

revoke all on function public.publish_story from public, anon;
grant execute on function public.publish_story to authenticated;

-- Author delete / Undo. Soft-deletes and RETURNS the object keys so the caller
-- can remove the bytes; the read gate is already closed by the time it does.
create or replace function public.delete_story(p_story_id uuid)
returns table (media_path text, inset_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'delete_story: not authenticated' using errcode = '28000';
  end if;
  return query
    update public.stories s
       set deleted_at = now()
     where s.id = p_story_id
       and s.author_id = auth.uid()
       and s.deleted_at is null
    returning s.media_path, s.inset_path;
end;
$$;

comment on function public.delete_story(uuid) is
  'Author-only soft delete. Returns the object keys so the caller can delete '
  'the bytes; the read gate closes immediately regardless of that cleanup.';

revoke all on function public.delete_story(uuid) from public, anon;
grant execute on function public.delete_story(uuid) to authenticated;

-- A tagged person withdraws their own tag. Never the author's decision.
create or replace function public.remove_my_story_tag(p_story_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if auth.uid() is null then
    raise exception 'remove_my_story_tag: not authenticated' using errcode = '28000';
  end if;
  update public.story_tags
     set removed_at = now()
   where story_id = p_story_id
     and profile_id = auth.uid()
     and removed_at is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.remove_my_story_tag(uuid) is
  'Consent withdrawal by the TAGGED person. The author cannot call it for '
  'someone else and it never touches another profile''s row.';

revoke all on function public.remove_my_story_tag(uuid) from public, anon;
grant execute on function public.remove_my_story_tag(uuid) to authenticated;

------------------------------------------------------------------------------
-- Rollback: supabase/migrations/revert/revert-0065-transaction.sql.
-- Read revert/README.md first. The restore and the schema_migrations ledger
-- delete must be ONE transaction — a comment cannot enforce that, the script
-- does, and a ledger row left claiming 0065 over a dropped table is exactly the
-- split 0064's header records as the hazard.
------------------------------------------------------------------------------
