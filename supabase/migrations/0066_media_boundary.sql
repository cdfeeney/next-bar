------------------------------------------------------------------------------
-- 0066_media_boundary.sql — WP1: media trust boundary and shared destination
-- spine.
--
-- Requirements discharged here (V8 contract 3.1.0):
--   V8-R-STO-014  media is re-encoded server-side; content type verified by
--                 inspection. The DB half is the registry that records what the
--                 server actually verified; the re-encode itself is
--                 src/lib/media/reEncode.ts, reachable only through
--                 src/app/api/media/upload.
--   V8-R-STO-015  signed-URL lifetime is decided server-side (this registry
--                 supplies the media's own window; src/lib/media/signedUrl.ts
--                 mints against it).
--   V8-R-STO-016  deletion removes bytes AND makes audience/tag metadata
--                 unqueryable.
--   V8-R-CMP-012  one media object, several destination references; bytes die
--                 only with the LAST reference.
--   V8-R-CMP-015  "remove from this destination" — that destination only.
--   V8-R-CMP-016  "delete everywhere" — every destination; bytes reclaimed only
--                 if no Saved Nights Out archive still holds one.
--   V8-R-FEED-009 block: server-enforced, BOTH directions.
--   V8-R-FEED-010 report: server-OWNED record, reporter cannot withdraw it.
--
-- Idempotent throughout: create ... if not exists, drop policy if exists.
-- This file is WRITTEN ONLY. Applying it is a separate attended step against a
-- ledger-aware runner; a migration file in the repository is not applied
-- anywhere until the target project's ledger says so.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. The physical byte
------------------------------------------------------------------------------

-- One row per stored object. `content_type` is what the SERVER decoded, never
-- what a client declared: V8-R-STO-014 rejects a client-declared MIME allowlist
-- as a trust boundary, because a modified client simply declares something else.
create table if not exists public.media_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  bucket_id text not null,
  storage_path text not null,
  -- Null ONLY for an object that predates this boundary. A row minted by the
  -- upload route always carries the decoded type and the re-encoded length, and
  -- `server_verified` is what tells the two apart honestly, rather than a
  -- backfilled guess that would read as verification it never performed.
  content_type text,
  byte_size bigint check (byte_size is null or byte_size > 0),
  server_verified boolean not null default false,
  created_at timestamptz not null default now(),
  bytes_removed_at timestamptz,
  constraint media_objects_path_unique unique (bucket_id, storage_path),
  -- A verified row must carry the evidence of verification.
  constraint media_objects_verified_is_described check (
    server_verified = false
    or (content_type is not null and byte_size is not null)
  )
);

create index if not exists media_objects_owner_idx
  on public.media_objects (owner_id, created_at desc);

comment on table public.media_objects is
  'One row per physical object in a media bucket. content_type is the type the server DECODED (V8-R-STO-014), never a client-declared MIME.';

------------------------------------------------------------------------------
-- 2. The destination spine (V8-R-CMP-012)
------------------------------------------------------------------------------

-- ONE media object may carry MANY destination references. This table IS the
-- reference count: bytes are reclaimable exactly when no row here is live.
--
-- `archive` is a Saved Nights Out reference. It is a retention HOLD, not a
-- destination a user can see or remove: "delete everywhere" clears every other
-- kind and still must not reclaim bytes while an archive row survives
-- (V8-R-CMP-016).
create table if not exists public.media_destinations (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media_objects(id) on delete cascade,
  kind text not null check (kind in ('story', 'feed', 'group', 'archive')),
  -- The destination's own identifier (a story id, a feed post id, ...). Text so
  -- one spine serves surfaces whose keys are not all uuids.
  ref_id text not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);

-- A media object references a given destination at most once while live.
create unique index if not exists media_destinations_live_uniq
  on public.media_destinations (media_id, kind, ref_id)
  where removed_at is null;

-- The reference-count read path.
create index if not exists media_destinations_live_idx
  on public.media_destinations (media_id)
  where removed_at is null;

create index if not exists media_destinations_ref_idx
  on public.media_destinations (kind, ref_id)
  where removed_at is null;

comment on table public.media_destinations is
  'Destination references for one media object (V8-R-CMP-012). Bytes are reclaimable only when NO row here is live, archive holds included.';

comment on column public.media_destinations.id is
  'Stable anchor for per-destination child rows. A Feed comments table added later references THIS id with on delete cascade, which is how V8-R-CMP-015 "removing the Feed destination also removes that post''s comments" becomes automatic rather than a second delete somebody must remember to write.';

------------------------------------------------------------------------------
-- 3. Reference counting
------------------------------------------------------------------------------

-- SECURITY DEFINER: the count must be the TRUE count. A caller-visible count
-- filtered by that caller's RLS would report zero for references it merely
-- cannot see, and "reclaim the bytes" is the action taken on zero.
--
-- TWO TERMS, and both are load-bearing.
--
--   * A live destination ROW is not automatically a live reference. Nothing
--     retires a story destination when its story EXPIRES — `delete_story` covers
--     deletion, expiry has no owner (0065 records that gap) — so counting the
--     row itself would hold every expired story's bytes forever, and the storage
--     DELETE policy below would refuse the cleanup that is supposed to free
--     them. A story destination counts only while its story is actually live.
--
--   * A story can reference an object WITHOUT a spine row at all. `publish_story`
--     predates this table and still does not write to it, and there is no
--     backfill, so for every story published outside the media route the spine is
--     EMPTY. Counting only the spine would report zero references for a photo two
--     live stories are still showing, and zero is the licence to destroy the
--     bytes. The second term counts those stories directly, skipping any that the
--     first term already counted through a spine row.
create or replace function public.media_live_reference_count(p_media_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int
       from public.media_destinations d
      where d.media_id = p_media_id
        and d.removed_at is null
        and (
          d.kind <> 'story'
          or exists (
            select 1
              from public.stories s
             where s.id::text = d.ref_id
               and s.deleted_at is null
               and s.expires_at > now()
          )
        ))
    +
    (select count(*)::int
       from public.media_objects m
       join public.stories s
         on (s.media_path = m.storage_path or s.inset_path = m.storage_path)
      where m.id = p_media_id
        and s.deleted_at is null
        and s.expires_at > now()
        and not exists (
          select 1
            from public.media_destinations d2
           where d2.media_id = p_media_id
             and d2.kind = 'story'
             and d2.ref_id = s.id::text
             and d2.removed_at is null
        ));
$$;

revoke all on function public.media_live_reference_count(uuid) from public, anon;
grant execute on function public.media_live_reference_count(uuid) to authenticated;

-- Path-keyed variant, for the storage DELETE policy, which sees a name and not
-- an id.
--
-- It delegates to the count above rather than restating the join, so the two can
-- never drift — and it carries the same second term for the same reason: an
-- object uploaded before this registry existed has NO `media_objects` row, so a
-- registry-only lookup answers "no references" for a photo a live story is
-- showing right now.
create or replace function public.media_path_has_live_reference(
  p_bucket text,
  p_name text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.media_objects m
     where m.bucket_id = p_bucket
       and m.storage_path = p_name
       and public.media_live_reference_count(m.id) > 0
  )
  or (
    p_bucket = 'story-media'
    and exists (
      select 1
        from public.stories s
       where (s.media_path = p_name or s.inset_path = p_name)
         and s.deleted_at is null
         and s.expires_at > now()
    )
  );
$$;

revoke all on function public.media_path_has_live_reference(text, text) from public, anon;
grant execute on function public.media_path_has_live_reference(text, text) to authenticated;

------------------------------------------------------------------------------
-- 4. The two deletion verbs (V8-R-CMP-015, V8-R-CMP-016)
------------------------------------------------------------------------------

-- "Remove from this destination". Removes ONLY the named destination; every
-- other destination of the same media object stays live, and the bytes stay
-- with them.
--
-- Returns the object's identity plus whether the bytes are now reclaimable.
-- Zero rows means the removal did NOT happen (not the author, or already
-- removed): V8-R-CMP-015 requires that a failed removal never report success.
create or replace function public.remove_media_destination(p_destination_id uuid)
returns table (
  media_id uuid,
  bucket_id text,
  storage_path text,
  reclaimable boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media uuid;
begin
  if auth.uid() is null then
    raise exception 'remove_media_destination: not authenticated'
      using errcode = '28000';
  end if;

  -- Lock the media row FIRST. Without it a concurrent add-destination can slip
  -- in between the removal and the count, and this function would report
  -- reclaimable:true for bytes that just acquired a new reference — the exact
  -- "reference count that cannot be read" V8-R-CMP-012 forbids guessing on.
  --
  -- `kind <> 'archive'` is the retention hold, and it belongs HERE rather than
  -- only in delete_media_everywhere. An archive row is "a retention HOLD, not a
  -- destination a user can see or remove"; without this clause the owner reads
  -- the hold's id through the owner SELECT policy, passes it to this function,
  -- and strips the very reference V8-R-CMP-016 keeps the bytes for. Zero rows
  -- back is the same answer as any other unremovable destination.
  select m.id into v_media
    from public.media_objects m
    join public.media_destinations d on d.media_id = m.id
   where d.id = p_destination_id
     and d.kind <> 'archive'
     and m.owner_id = auth.uid()
   for update of m;

  if v_media is null then
    return;
  end if;

  update public.media_destinations d
     set removed_at = now()
   where d.id = p_destination_id
     and d.removed_at is null;

  if not found then
    -- Already removed. Not an error, but not a fresh removal either, and it
    -- must not be reported as one.
    return;
  end if;

  -- Same reading as delete_media_everywhere, narrowed to the ONE destination
  -- being removed: if this row is a story reference, that story stops showing
  -- the media. Retiring the spine row alone left the story live and still
  -- displaying it, which is not "removed from this destination".
  update public.stories s
     set deleted_at = now()
    from public.media_destinations d
   where d.id = p_destination_id
     and d.kind = 'story'
     and s.id::text = d.ref_id
     and s.author_id = auth.uid()
     and s.deleted_at is null;

  return query
    select m.id,
           m.bucket_id,
           m.storage_path,
           public.media_live_reference_count(m.id) = 0
      from public.media_objects m
     where m.id = v_media;
end;
$$;

comment on function public.remove_media_destination(uuid) is
  'V8-R-CMP-015. Removes ONE destination, never a kind=archive retention hold. Other destinations and the bytes survive. Zero rows returned = nothing was removed.';

revoke all on function public.remove_media_destination(uuid) from public, anon;
grant execute on function public.remove_media_destination(uuid) to authenticated;

-- "Delete everywhere". Removes EVERY user-facing destination. Bytes become
-- reclaimable only if no Saved Nights Out archive hold survives, so this
-- deliberately does NOT clear kind='archive' (V8-R-CMP-016).
create or replace function public.delete_media_everywhere(p_media_id uuid)
returns table (
  bucket_id text,
  storage_path text,
  reclaimable boolean,
  remaining_references integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media uuid;
begin
  if auth.uid() is null then
    raise exception 'delete_media_everywhere: not authenticated'
      using errcode = '28000';
  end if;

  select m.id into v_media
    from public.media_objects m
   where m.id = p_media_id
     and m.owner_id = auth.uid()
   for update;

  if v_media is null then
    return;
  end if;

  update public.media_destinations d
     set removed_at = now()
   where d.media_id = v_media
     and d.removed_at is null
     and d.kind <> 'archive';

  -- A LIVE STORY IS A DESTINATION, so "every destination" has to include it.
  --
  -- This is an explicit reading of V8-R-CMP-016 and it is written down so it
  -- can be overruled rather than discovered. Retiring only the spine rows left
  -- any story that names these bytes still live: the photo went on being shown,
  -- its audience and tag rows went on being queryable against V8-R-STO-016, the
  -- reference count could never reach zero because the story still counts, and
  -- the verb returned "one reference remaining" forever. That is not a partial
  -- delete honestly reported — it is a delete that cannot complete.
  --
  -- Author-scoped by construction: v_media was already checked to be owned by
  -- auth.uid(), and only that same account's stories are touched. Soft delete,
  -- like delete_story, so the read gate closes instantly.
  update public.stories s
     set deleted_at = now()
    from public.media_objects m
   where m.id = v_media
     and s.author_id = auth.uid()
     and s.deleted_at is null
     and (s.media_path = m.storage_path or s.inset_path = m.storage_path);

  return query
    select m.bucket_id,
           m.storage_path,
           public.media_live_reference_count(m.id) = 0,
           public.media_live_reference_count(m.id)
      from public.media_objects m
     where m.id = v_media;
end;
$$;

comment on function public.delete_media_everywhere(uuid) is
  'V8-R-CMP-016. Clears every destination except a Saved Nights Out archive hold; reports remaining_references so a partial delete is never reported as complete.';

revoke all on function public.delete_media_everywhere(uuid) from public, anon;
grant execute on function public.delete_media_everywhere(uuid) to authenticated;

------------------------------------------------------------------------------
-- 5. Bytes outlive nothing but their last reference (V8-R-CMP-012)
------------------------------------------------------------------------------

-- The chokepoint. Every byte-removal path in the product — the stories client,
-- the media route, a future sweep — goes through the storage DELETE policy, so
-- the reference check belongs HERE rather than in each caller. A caller that
-- forgets it now gets a refused delete (and its own orphan report) instead of
-- destroying media that another live destination still shows.
--
-- Prefix scoping is retained exactly as 0065 had it: V8-R-STO-016's trust
-- boundary is that a removal can never reach another user's bytes.
drop policy if exists "story-media: owner deletes own prefix" on storage.objects;
create policy "story-media: owner deletes own prefix"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'story-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.media_path_has_live_reference('story-media', name)
  );

------------------------------------------------------------------------------
-- 5b. THE BOUNDARY ITSELF: no client reaches these bytes directly
------------------------------------------------------------------------------

-- 0065 let an authenticated client write to and read from `story-media` on its
-- own account, and that is the hole this whole work package exists to close.
-- Two requirements are unsatisfiable while those policies stand, and no amount
-- of server code closes them from the other side:
--
--   V8-R-STO-014 — "SERVER. A client-side strip is bypassable by definition."
--     While `story-media: owner writes own prefix` grants INSERT, a modified
--     client uploads an EXIF/GPS-bearing JPEG straight into its own prefix and
--     `publish_story` — which checks that the object EXISTS, not where it came
--     from — publishes the original bytes. The re-encode in
--     src/app/api/media/upload is then optional, and an optional strip is not a
--     trust boundary.
--
--   V8-R-STO-015 — the signed-URL lifetime is decided by the SERVER.
--     While SELECT is granted, any authorised viewer calls
--     `createSignedUrl(path, 86400)` for themselves. A route that computes a
--     300-second TTL is a suggestion when the client can mint its own.
--
-- So both grants go. The service role bypasses RLS, which leaves exactly one
-- writer (the upload route, which decodes and re-encodes) and exactly one
-- reader (the url route, which decides the TTL) — the chokepoints both
-- requirements describe.
--
-- CONSEQUENCE, STATED RATHER THAN DISCOVERED: every caller that still talks to
-- Storage directly stops working and must go through /api/media. In this
-- repository that is `src/lib/stories.server.ts` and the capture/story
-- components, which are OUTSIDE this lane's write scope and are therefore
-- reported, not edited. Wiring them to the media API is an integration step.
drop policy if exists "story-media: owner writes own prefix" on storage.objects;
drop policy if exists "story-media: owner reads own prefix" on storage.objects;
drop policy if exists "story-media: audience reads referenced" on storage.objects;

-- The read decision those two SELECT policies used to make, moved into one
-- function the url route asks BEFORE it mints anything with service role.
--
-- SECURITY DEFINER, and it still answers as the CALLER: `auth.uid()` is
-- preserved through a definer function, and every helper it leans on
-- (`is_mutual_friend`, `is_story_recipient`, `story_media_is_dead`) carries its
-- own party guard keyed to that same id. Moving the mint to service role
-- therefore moves WHO SIGNS, never WHO IS ALLOWED.
--
-- `is_blocked_between` is consumed HERE. V8-R-FEED-009 says a block is
-- server-enforced in both directions; a helper no policy and no route calls is
-- a recorded intention, not an enforcement point, and a blocked viewer who
-- still holds an audience row would otherwise keep receiving signed URLs.
--
-- It is created in section 8, BELOW. That is deliberate and safe: this function
-- is plpgsql, whose body is only syntax-checked at creation and whose names
-- resolve at call time. A `language sql` body here would be validated eagerly
-- and would fail on the forward reference, so the language choice is load
-- bearing rather than incidental.
-- ONE function answers BOTH questions, because they have the same answer.
--
-- Splitting "may this caller read it?" from "how long is it readable?" is what
-- let a URL outlive the permission it was granted under. The route used to
-- compute the window from every LIVE DESTINATION the service role could see —
-- a set the caller may have no access to — so a viewer authorised through a
-- story expiring in two minutes could be handed a lifetime borrowed from a
-- destination they cannot read at all. The window has to be the window of the
-- references that ACTUALLY authorise this caller, so it is computed from
-- exactly the rows that decided `readable`.
--
-- Reading it from `public.stories` rather than from `media_destinations` is
-- also what makes the route work at all. `publish_story` does not write to the
-- spine, and upload-before-publish cannot name a story that does not exist
-- yet, so for normally published and for legacy media the spine is EMPTY. A
-- window derived from spine rows alone reports "no live destination" and the
-- route 404s every real story photo in the product. Stories carry their own
-- expiry, and they are where the dropped 0065 SELECT policies read it from.
create or replace function public.media_read_window(p_name text)
returns table (readable boolean, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_expiry timestamptz;
begin
  if v_caller is null or p_name is null then
    return query select false, null::timestamptz;
    return;
  end if;

  -- THE OWNER, on their own prefix. `story_media_is_dead` is 0065's rule that
  -- an author cannot sign their own expired or deleted media, kept rather than
  -- quietly relaxed. It is also what keeps the upload-before-publish window
  -- open: an object no story references at all is not "dead", and its window is
  -- unbounded, so only the signed-URL ceiling applies.
  if (storage.foldername(p_name))[1] = v_caller::text then
    if public.story_media_is_dead(p_name) then
      return query select false, null::timestamptz;
      return;
    end if;
    select max(s.expires_at) into v_expiry
      from public.stories s
     where (s.media_path = p_name or s.inset_path = p_name)
       and s.deleted_at is null
       and s.expires_at > now();
    return query select true, v_expiry;
    return;
  end if;

  -- A VIEWER, only through a story they can actually read. This is the
  -- predicate the dropped "story-media: audience reads referenced" policy
  -- carried. The block is inherited from is_mutual_friend rather than restated
  -- here, so this site cannot drift from the other four that ask it.
  select max(s.expires_at) into v_expiry
    from public.stories s
   where (s.media_path = p_name or s.inset_path = p_name)
     and s.deleted_at is null
     and s.expires_at > now()
     and public.is_mutual_friend(v_caller, s.author_id)
     and (
       s.audience = 'friends'
       or public.is_story_recipient(s.id, v_caller)
     );

  -- No readable story means no window and no read. Note the difference from the
  -- owner branch: a null expiry here is "nothing authorises you", not
  -- "unbounded".
  return query select v_expiry is not null, v_expiry;
end;
$$;

comment on function public.media_read_window(text) is
  'V8-R-STO-015 / V8-R-FEED-009. May the CALLER read this object, and until when? The url route asks this before minting with service role, so authorization stays in the database and the lifetime is the caller''s own rather than the longest one anybody holds.';

revoke all on function public.media_read_window(text) from public, anon;
grant execute on function public.media_read_window(text) to authenticated;

------------------------------------------------------------------------------
-- 6. Deletion clears metadata too (V8-R-STO-016)
------------------------------------------------------------------------------

-- Liveness as a DEFINER helper, not a subquery. public.stories' own SELECT
-- policy reads story_audience, so a bare subquery on stories from a
-- story_audience policy closes the cycle and PostgreSQL refuses BOTH tables
-- with an infinite-recursion error. 0065 records that trap; this stays clear of
-- it the same way, with a definer helper.
create or replace function public.is_story_live(p_story_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.stories s
     where s.id = p_story_id
       and s.deleted_at is null
       and s.expires_at > now()
  );
$$;

revoke all on function public.is_story_live(uuid) from public, anon;
grant execute on function public.is_story_live(uuid) to authenticated;

-- V8-R-STO-016 requires "no residual metadata", and 0065's audience policy
-- gated on identity alone: a recipient could still enumerate their own
-- story_audience rows after the story expired or was deleted, which is exactly
-- the audience metadata the requirement says must become unqueryable.
drop policy if exists "story_audience: parties read" on public.story_audience;
create policy "story_audience: parties read"
  on public.story_audience for select
  using (
    (
      auth.uid() = profile_id
      or public.is_story_author(story_id, auth.uid())
    )
    and public.is_story_live(story_id)
  );

-- The same hole on the tag side: `exists (select 1 from public.stories ...)`
-- carried no liveness term at all, so tag metadata survived expiry and
-- deletion. Withdrawal still works after this change: remove_my_story_tag is
-- SECURITY DEFINER and does not read through this policy.
--
-- LIVENESS IS ADDED TO 0065'S TEST, NOT SUBSTITUTED FOR IT. `is_story_live` is
-- SECURITY DEFINER, so on its own it answers true for every authenticated
-- caller and would publish the tag list of every live private story to anyone
-- who asked — a wider read than 0065 allowed, introduced by the migration that
-- was meant to narrow it. 0065's `exists (select 1 from public.stories ...)`
-- runs under the CALLER's RLS and is therefore audience-scoped; it stays, and
-- liveness is an additional term.
drop policy if exists "story_tags: readable with story" on public.story_tags;
create policy "story_tags: readable with story"
  on public.story_tags for select
  using (
    public.is_story_live(story_id)
    and (
      auth.uid() = profile_id
      or exists (select 1 from public.stories s where s.id = story_id)
    )
  );

------------------------------------------------------------------------------
-- 7. Story deletion retires its destination references
------------------------------------------------------------------------------

-- Replaces 0065's delete_story. Same signature, same author-only soft delete,
-- same returned object keys — plus the destination retirement that lets the
-- reference count fall to zero, so the caller's byte removal is actually
-- permitted by the policy in section 5.
--
-- Ordering is deliberate: the destination rows are retired in the SAME
-- transaction as the soft delete. Doing it in the client instead would leave a
-- window in which the story is dead but its reference is live, and every byte
-- removal attempted in that window is refused and orphaned.
create or replace function public.delete_story(p_story_id uuid)
returns table (media_path text, inset_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media text;
  v_inset text;
begin
  if auth.uid() is null then
    raise exception 'delete_story: not authenticated' using errcode = '28000';
  end if;

  update public.stories s
     set deleted_at = now()
   where s.id = p_story_id
     and s.author_id = auth.uid()
     and s.deleted_at is null
  returning s.media_path, s.inset_path into v_media, v_inset;

  if v_media is null then
    -- Not the author, already deleted, or never existed. Zero rows, exactly as
    -- 0065 promised its caller.
    return;
  end if;

  update public.media_destinations d
     set removed_at = now()
   where d.kind = 'story'
     and d.ref_id = p_story_id::text
     and d.removed_at is null;

  return query select v_media, v_inset;
end;
$$;

comment on function public.delete_story(uuid) is
  'Author-only soft delete (0065) plus destination retirement (0066). Returns the object keys; the read gate closes immediately regardless of cleanup.';

revoke all on function public.delete_story(uuid) from public, anon;
grant execute on function public.delete_story(uuid) to authenticated;

------------------------------------------------------------------------------
-- 8. Blocking (V8-R-FEED-009)
------------------------------------------------------------------------------

create table if not exists public.profile_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint profile_blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists profile_blocks_blocked_idx
  on public.profile_blocks (blocked_id);

comment on table public.profile_blocks is
  'V8-R-FEED-009. The blocking user owns the row; enforcement runs BOTH ways.';

-- BOTH DIRECTIONS from one row. The requirement is that visibility and
-- interaction stop between the two users, not that the blocker stops seeing the
-- blocked one. A one-directional read here is the whole defect.
--
-- DEFINER because the answer must not depend on which side is asking: a block
-- row is readable only by its owner (policy below), so a non-definer check
-- would return false for the blocked party and re-open the direction that
-- matters most.
-- THE PARTY GUARD IS NOT OPTIONAL, for exactly the reason 0065 gives for
-- is_mutual_friend. SECURITY DEFINER is what lets this function see a row the
-- policy below hides, so without a caller check it is a pairwise ORACLE over
-- private block data: any authenticated account could ask "has either of these
-- two blocked the other?" about ANY two ids and learn something the migration
-- states only the blocker may read. Every legitimate call site passes the
-- caller as one of the two arguments, so the guard changes no behaviour this
-- schema depends on.
--
-- A NULL caller is trusted infrastructure — migrations, the service role, a
-- server-side job — and is allowed through, the same carve-out 0065 makes.
create or replace function public.is_blocked_between(a uuid, b uuid)
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
    raise exception 'is_blocked_between: a caller may only ask about itself'
      using errcode = '42501';
  end if;
  return exists (
    select 1
      from public.profile_blocks pb
     where (pb.blocker_id = a and pb.blocked_id = b)
        or (pb.blocker_id = b and pb.blocked_id = a)
  );
end;
$$;

comment on function public.is_blocked_between(uuid, uuid) is
  'V8-R-FEED-009. True when EITHER user has blocked the other. Refuses any caller that is not one of the two parties, so it cannot be used as an oracle over block data.';

revoke all on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

-- ...AND AT THE TABLES THEMSELVES, because not every interaction path asks a
-- predicate. `is_mutual_friend` covers everything that reads or publishes a
-- story, but `follow_user` (0008) never consults it: it checks the rate cap and
-- the target's privacy flag and then inserts. So after A blocks B, B could
-- still follow A, or raise a follow request against them, and the resulting row
-- was readable to both parties — "interaction stops between the two users" with
-- the most direct interaction of all left open.
--
-- A BEFORE INSERT trigger on the two tables that carry those edges catches
-- every writer at once, including `accept_follow_request` and anything added
-- later, which a fix inside `follow_user` alone would not. `follow_user`
-- already wraps both of its inserts in `exception when others then return
-- 'rejected'`, so a raise here surfaces to the client as an ordinary rejection
-- rather than an error — the product behaviour a block should have.
--
-- The lookup is INLINE rather than a call to is_blocked_between: that function
-- refuses a caller who is not one of the two parties, and a trigger can fire
-- under a writer that is neither (a migration, a server-side job). The
-- invariant belongs to the table, so it must not depend on who is asking.
create or replace function public.forbid_blocked_edge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
begin
  if tg_table_name = 'follows' then
    v_a := new.follower_id;
    v_b := new.followee_id;
  else
    v_a := new.requester_id;
    v_b := new.target_id;
  end if;

  if exists (
    select 1
      from public.profile_blocks pb
     where (pb.blocker_id = v_a and pb.blocked_id = v_b)
        or (pb.blocker_id = v_b and pb.blocked_id = v_a)
  ) then
    raise exception 'blocked: no new connection between these accounts'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.forbid_blocked_edge() is
  'V8-R-FEED-009. Table-level guard: no follow edge and no follow request may be created between two accounts while either has blocked the other.';

drop trigger if exists follows_blocked_guard on public.follows;
create trigger follows_blocked_guard
  before insert on public.follows
  for each row execute function public.forbid_blocked_edge();

drop trigger if exists follow_requests_blocked_guard on public.follow_requests;
create trigger follow_requests_blocked_guard
  before insert on public.follow_requests
  for each row execute function public.forbid_blocked_edge();

-- ENFORCEMENT GOES IN THE SHARED PREDICATE, NOT AT EACH CALL SITE.
--
-- V8-R-FEED-009 is "visibility and interaction stop BETWEEN the two users",
-- and blocking deletes no `follows` edge — `blockProfile` only inserts a
-- profile_blocks row. So a blocked pair stays mutually following, and every
-- rule 0065 keyed on mutuality kept passing: the stories SELECT policy still
-- returned the blocker's live story metadata and caption to the blocked user,
-- and publish_story still let either of them name the other in a custom
-- audience or, worse, TAG them — a write onto the blocked person's own consent
-- surface.
--
-- Adding `not is_blocked_between(...)` at each of those sites would be four
-- edits today and a fifth one forgotten tomorrow. `is_mutual_friend` is the one
-- predicate all of them already ask, so the block belongs inside it: a blocked
-- pair are not, for any product purpose, mutual friends. Every existing call
-- site (both story RLS policies, publish_story's audience check and its tag
-- check) inherits the rule, and so does every call site added later.
--
-- The body is otherwise 0065's, verbatim, including the party guard.
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
     and not public.is_blocked_between(a, b)
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
  'Accepted mutual friendship: follows edges in BOTH directions AND no block in either direction (V8-R-FEED-009, added by 0066). A one-way follow is not a friend and a blocked pair is not either. Refuses any caller that is not one of the two parties.';

revoke all on function public.is_mutual_friend(uuid, uuid) from public, anon;
grant execute on function public.is_mutual_friend(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- 9. Reporting (V8-R-FEED-010)
------------------------------------------------------------------------------

-- SERVER-OWNED. The reporter may create a report and may read their own (that
-- read is what hides the content for them), but there is no UPDATE and no
-- DELETE grant anywhere below: V8-R-FEED-010 says the reporter cannot edit or
-- withdraw a report into invisibility. Retention runs until operator removal or
-- account deletion, the latter arriving through the profiles cascade.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  subject_kind text not null
    check (subject_kind in ('story', 'feed_post', 'comment', 'group_message')),
  subject_ref text not null,
  reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- One standing report per reporter per subject. Re-reporting is idempotent
-- rather than a way to flood the operator queue.
create unique index if not exists content_reports_one_per_reporter
  on public.content_reports (reporter_id, subject_kind, subject_ref);

create index if not exists content_reports_open_idx
  on public.content_reports (created_at desc)
  where resolved_at is null;

comment on table public.content_reports is
  'V8-R-FEED-010. Server-owned; no UPDATE or DELETE is granted to any application role. Existing operator tooling reads it — V8 adds no dashboard.';

-- The hide is DERIVED from the report, so it cannot drift from it: content is
-- hidden for a reporter exactly while their report row exists. A separate
-- "hidden" flag would be a second source of truth for one fact.
create or replace function public.report_content(
  p_subject_kind text,
  p_subject_ref text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'report_content: not authenticated' using errcode = '28000';
  end if;

  -- BOUNDS BELONG HERE, not only in reports.ts. This function is granted to
  -- `authenticated`, so it is callable directly over PostgREST; a cap that
  -- exists only in the TypeScript caller bounds the app's own UI and nothing
  -- else. Without it one account can post unbounded reasons under fabricated
  -- refs and the one-report-per-subject index — the anti-flood measure — is
  -- defeated by simply varying the ref.
  if p_subject_ref is null or length(btrim(p_subject_ref)) = 0 then
    raise exception 'report_content: subject_ref is required'
      using errcode = '22023';
  end if;
  if length(p_subject_ref) > 200 then
    raise exception 'report_content: subject_ref is too long'
      using errcode = '22001';
  end if;
  if p_reason is not null and length(p_reason) > 1000 then
    raise exception 'report_content: reason is too long'
      using errcode = '22001';
  end if;

  -- THE FIRST REPORT IS THE REPORT. V8-R-FEED-010 makes the record
  -- server-owned and says the reporter cannot edit or withdraw it, so a repeat
  -- report changes NOTHING about the stored row — not even a reason that was
  -- left null the first time. Filling a null still let the reporter choose,
  -- after the fact, what the operator reads.
  --
  -- `do update set reason = <itself>` rather than `do nothing`: the write is a
  -- no-op either way, but DO NOTHING returns no row, `v_id` would come back
  -- null, and the caller treats a null id as a FAILED report and refuses to
  -- hide the content. Re-reporting has to stay idempotent all the way out to
  -- the UI.
  insert into public.content_reports (reporter_id, subject_kind, subject_ref, reason)
  values (auth.uid(), p_subject_kind, btrim(p_subject_ref), p_reason)
  on conflict (reporter_id, subject_kind, subject_ref) do update
     set reason = public.content_reports.reason
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.report_content(text, text, text) is
  'V8-R-FEED-010. Creates the server-owned report. The caller hides the content ONLY on a returned id — a failed write must not present a silent hide.';

revoke all on function public.report_content(text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text) to authenticated;

-- THE HIDE IS A READ RULE, NOT A UI RULE.
--
-- V8-R-FEED-010 says reporting IMMEDIATELY HIDES the content FOR THE REPORTER.
-- `reportContent` returned `hideForReporter: true` and `listReportedSubjects`
-- offered the hide set, but nothing in a read path consulted either: the story
-- policies did not look at content_reports, so a reported story stayed visible
-- and the requirement was discharged by a boolean nobody read. A client-side
-- filter would not have fixed it either — the same class of defect as an EXIF
-- strip that lives in the browser.
--
-- So the hide moves into the audience gate. This is 0065's policy verbatim plus
-- one term; every other clause, and the comment explaining why the custom
-- branch goes through a definer helper, is unchanged. It must be created here,
-- AFTER content_reports exists, because a policy's USING expression is resolved
-- when the policy is created.
--
-- Scoped to the CALLER's own reports by `cr.reporter_id = auth.uid()`: a report
-- hides the content for the person who reported it, and for nobody else. It is
-- not a moderation action and must not behave like one.
drop policy if exists "stories: audience reads unexpired" on public.stories;
create policy "stories: audience reads unexpired"
  on public.stories for select
  using (
    deleted_at is null
    and expires_at > now()
    and auth.uid() <> author_id
    and public.is_mutual_friend(auth.uid(), author_id)
    and not exists (
      select 1
        from public.content_reports cr
       where cr.reporter_id = auth.uid()
         and cr.subject_kind = 'story'
         and cr.subject_ref = public.stories.id::text
    )
    and (
      audience = 'friends'
      -- Through the definer helper, NOT a bare subquery: story_audience's own
      -- policy asks whether the caller authored this story, which reads
      -- public.stories, which expands this policy again. See 0065's helper
      -- header.
      or (
        audience = 'custom'
        and public.is_story_recipient(public.stories.id, auth.uid())
      )
    )
  );

------------------------------------------------------------------------------
-- 10. Row level security
------------------------------------------------------------------------------

alter table public.media_objects       enable row level security;
alter table public.media_destinations  enable row level security;
alter table public.profile_blocks      enable row level security;
alter table public.content_reports     enable row level security;

-- No INSERT/UPDATE/DELETE policy on media_objects or media_destinations, and no
-- write grant in section 11. They are written ONLY by the definer functions
-- here and by the service-role upload route, which is the point: a client that
-- can insert its own media row can declare its own content_type and defeat
-- V8-R-STO-014.
drop policy if exists "media_objects: owner reads own" on public.media_objects;
create policy "media_objects: owner reads own"
  on public.media_objects for select
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "media_destinations: owner reads own" on public.media_destinations;
create policy "media_destinations: owner reads own"
  on public.media_destinations for select
  to authenticated
  using (
    exists (
      select 1
        from public.media_objects m
       where m.id = media_id
         and m.owner_id = auth.uid()
    )
  );

-- A user manages THEIR OWN blocks and reads only their own rows. The blocked
-- party is never shown the row: they experience the block, they do not read it.
drop policy if exists "profile_blocks: blocker manages own" on public.profile_blocks;
create policy "profile_blocks: blocker manages own"
  on public.profile_blocks for select
  to authenticated
  using (auth.uid() = blocker_id);

drop policy if exists "profile_blocks: blocker inserts own" on public.profile_blocks;
create policy "profile_blocks: blocker inserts own"
  on public.profile_blocks for insert
  to authenticated
  with check (auth.uid() = blocker_id);

-- Unblocking is the documented way out ("until the block is lifted").
drop policy if exists "profile_blocks: blocker deletes own" on public.profile_blocks;
create policy "profile_blocks: blocker deletes own"
  on public.profile_blocks for delete
  to authenticated
  using (auth.uid() = blocker_id);

-- Read-own only. Insert goes through report_content(); there is deliberately no
-- UPDATE and no DELETE policy.
drop policy if exists "content_reports: reporter reads own" on public.content_reports;
create policy "content_reports: reporter reads own"
  on public.content_reports for select
  to authenticated
  using (auth.uid() = reporter_id);

------------------------------------------------------------------------------
-- 11. Grants
------------------------------------------------------------------------------

revoke all on public.media_objects      from public, anon;
revoke all on public.media_destinations from public, anon;
revoke all on public.profile_blocks     from public, anon;
revoke all on public.content_reports    from public, anon;

grant select on public.media_objects      to authenticated;
grant select on public.media_destinations to authenticated;
grant select, insert, delete on public.profile_blocks to authenticated;
-- SELECT only. The absence of insert/update/delete here is what makes the
-- report record server-owned; report_content() is definer and does not need it.
grant select on public.content_reports to authenticated;
