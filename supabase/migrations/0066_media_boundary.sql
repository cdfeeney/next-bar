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
--
-- PARTY GUARD, same reason as everywhere else in this file. SECURITY DEFINER is
-- what lets this see references the caller cannot, so granted to `authenticated`
-- with no caller check it is an ORACLE: anyone holding a media id could poll
-- whether somebody else's photo is still referenced by a live story, watch it
-- flip on expiry or deletion, and keep doing so after being blocked. 0065
-- refuses exactly that shape in `story_media_is_dead`.
--
-- It fails CLOSED at 1 rather than 0: every caller of this function acts on
-- "zero means the bytes may go", so a refusal must never be the answer that
-- authorises destroying data. A NULL caller is trusted infrastructure.
create or replace function public.media_live_reference_count(p_media_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is not null and not exists (
    select 1
      from public.media_objects m
     where m.id = p_media_id
       and m.owner_id = v_caller
  ) then
    return 1;
  end if;

  return (
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
        )));
end;
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
-- OWN-PREFIX GUARD, and it fails CLOSED at true for the same reason the count
-- above fails closed at 1: "no live reference" is the answer that authorises
-- destroying bytes, so a caller who may not ask must never receive it. Without
-- the guard this is a liveness oracle over any path a caller has ever seen —
-- true while somebody else's story is live, false the moment it expires or is
-- deleted, and still answering after a block.
--
-- Both in-repo callers already act on the caller's own prefix: the storage
-- DELETE policy below requires `(storage.foldername(name))[1] = auth.uid()`,
-- and the route's pre-removal re-check runs on media the deletion RPC has
-- already confirmed the caller owns. The guard costs neither of them anything.
create or replace function public.media_path_has_live_reference(
  p_bucket text,
  p_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is not null
     and (storage.foldername(p_name))[1] is distinct from v_caller::text then
    return true;
  end if;

  return exists (
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
end;
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
  --
  -- AND THE STORY MUST ACTUALLY NAME THESE BYTES. `media_destinations.ref_id`
  -- has no foreign key and the upload route lets a client name any story it
  -- owns as the destination of a NEW object, so a spine row can point at a
  -- story that references some other photo entirely. Without this term,
  -- removing that mismatched destination soft-deletes an unrelated live story —
  -- a destructive write driven by a value the client chose. The guard belongs
  -- here rather than in the upload route because every caller of this verb
  -- routes through it, and at upload time the story usually does not exist yet.
  update public.stories s
     set deleted_at = now()
    from public.media_destinations d,
         public.media_objects m
   where d.id = p_destination_id
     and d.kind = 'story'
     and m.id = v_media
     and s.id::text = d.ref_id
     and s.author_id = auth.uid()
     and s.deleted_at is null
     and (s.media_path = m.storage_path or s.inset_path = m.storage_path);

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
-- 5a. Reclamation is a CLAIM, not a check-then-delete (V8-R-CMP-012)
------------------------------------------------------------------------------

-- WHY THIS REPLACES THE OLD SHAPE, written down because the old shape looked
-- correct and was reported three review rounds running.
--
-- The route used to (1) ask "are there zero references?", then (2) remove the
-- bytes with service role. Two steps, no lock spanning both, so a `publish_story`
-- committing in between produced a live story whose photo was destroyed
-- microseconds later. Narrowing the window is not closing it, and the loss is
-- silent and permanent.
--
-- Storage is not in the database transaction, so the removal itself can never be
-- atomic with the count. What CAN be atomic is the CLAIM: under a row lock on
-- `media_objects`, recount and stamp `bytes_removed_at` in the same transaction.
-- After that the object is spoken for — `publish_story` (section 7b) takes the
-- SAME lock and refuses a claimed object, so a story can no longer appear
-- against bytes already committed to removal. The removal then happens outside
-- the transaction against an object nothing may attach to any more.
--
-- The stamp is the tombstone AND the claim, one fact in one column. If the
-- removal does not happen, `release_media_claim` puts the object back; if the
-- process dies in between, section 5a's orphan sweep finds it again because the
-- bytes are still in the bucket. There is no state in which a claim silently
-- becomes a lie.
--
-- `skip locked`: a row another transaction is already working on is somebody
-- else's claim, and waiting for it only to find it stamped is wasted work.
create or replace function public.claim_media_for_removal(
  p_media_id uuid default null,
  p_limit integer default 25
)
returns table (media_id uuid, bucket_id text, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  r record;
begin
  for r in
    select m.id as id, m.bucket_id as bucket_id, m.storage_path as storage_path
      from public.media_objects m
     where m.bytes_removed_at is null
       and (p_media_id is null or m.id = p_media_id)
       -- OWNER SCOPING. A null caller is trusted infrastructure (the service
       -- role sweep); an authenticated caller reclaims only their own bytes.
       and (v_caller is null or m.owner_id = v_caller)
       -- THE GRACE WINDOW, and it only applies to the SWEEP.
       --
       -- Upload-then-publish means a freshly verified object legitimately has
       -- zero references for as long as the composer stays open. Sweeping it
       -- would delete the photo out from under someone mid-post. An object that
       -- has EVER carried a destination is past that stage, so it is eligible
       -- immediately; one that never has waits out the window.
       --
       -- A targeted claim (p_media_id given) skips this entirely: the caller
       -- just deleted that object's last destination and is entitled to an
       -- immediate answer.
       and (
         p_media_id is not null
         or m.created_at < now() - interval '24 hours'
         or exists (
           select 1
             from public.media_destinations d
            where d.media_id = m.id
         )
       )
     order by m.created_at
     limit v_limit
     for update of m skip locked
  loop
    -- Recounted UNDER THE LOCK. The count the caller was given earlier was
    -- taken under a lock that has since been released; this one is taken under
    -- the lock that also blocks publication, which is what makes it binding.
    if public.media_live_reference_count(r.id) = 0 then
      update public.media_objects m
         set bytes_removed_at = now()
       where m.id = r.id
         and m.bytes_removed_at is null;

      if found then
        media_id := r.id;
        bucket_id := r.bucket_id;
        storage_path := r.storage_path;
        return next;
      end if;
    end if;
  end loop;
end;
$$;

comment on function public.claim_media_for_removal(uuid, integer) is
  'V8-R-CMP-012. Atomically claims zero-reference bytes for removal: recounts under a row lock and stamps bytes_removed_at in the same transaction, so publish_story cannot attach a new destination to bytes already committed to deletion. Pass a media id for a targeted claim, or nothing for a bounded sweep.';

revoke all on function public.claim_media_for_removal(uuid, integer) from public, anon;
grant execute on function public.claim_media_for_removal(uuid, integer) to authenticated;

-- THE CLAIM IS GIVEN BACK WHEN THE REMOVAL DID NOT HAPPEN.
--
-- Storage can refuse or silently skip an object. Leaving the stamp in place
-- would file bytes as reclaimed while they sit in the bucket, and every future
-- sweep would skip them — the registry lying about the world. Releasing puts the
-- object back in front of the sweep.
create or replace function public.release_media_claim(p_media_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  update public.media_objects m
     set bytes_removed_at = null
   where m.id = p_media_id
     and m.bytes_removed_at is not null
     and (v_caller is null or m.owner_id = v_caller);

  return found;
end;
$$;

comment on function public.release_media_claim(uuid) is
  'V8-R-CMP-012. Undoes a claim whose byte removal did not actually happen, so an orphan returns to the sweep instead of being recorded as reclaimed. SERVICE ROLE ONLY: releasing is the sweep telling the truth about its own failed removal, never a user reopening bytes the sweep is still holding.';

-- NOT GRANTED TO `authenticated`, and the omission is the point.
--
-- A claim is the sweep's exclusive right to delete an object; the removal it
-- authorises happens OUTSIDE the transaction, against Storage. While that
-- removal is in flight the stamp is the only thing keeping `publish_story` off
-- those bytes. An owner who could call this over PostgREST would un-stamp the
-- object, publish a story against it, and watch the sweep's already-issued
-- delete destroy a live story's photo — the exact publish-versus-delete loss the
-- claim exists to prevent, reintroduced through the undo. Only the sweep that
-- took a claim may give it back, and the sweep runs as the service role.
revoke all on function public.release_media_claim(uuid) from public, anon, authenticated;

-- BYTES THE REGISTRY CANNOT SEE AT ALL.
--
-- Two populations never reach `claim_media_for_removal`, and both leak forever
-- without this:
--
--   * Objects written before this boundary existed, or by any caller that still
--     talks to Storage directly. They have no `media_objects` row, so there is
--     nothing to claim and nothing to stamp. Every story photo in the product
--     today is in this population.
--   * Objects whose claim was stamped but whose removal never landed and whose
--     release never ran — a crashed process between the two. The registry says
--     gone; the bucket says otherwise. The BUCKET is the evidence, so a row that
--     claims removal while its object is still there is treated as unreclaimed.
--
-- Eligibility is deliberately conservative: past the grace window, under the
-- caller's own prefix (or anywhere, for the service-role sweep), and named by no
-- live story. Being wrong here destroys data, so every uncertain case keeps the
-- bytes.
--
-- AND ELIGIBILITY IS NOT ENOUGH — IT IS A CLAIM HERE TOO.
--
-- The first shape of this function returned PATHS. That reopened, for exactly
-- the population it was written to cover, the race the claim above closes: an
-- object with no `media_objects` row is an object `publish_story`'s `for update`
-- matches nothing for, so the sweep could list a path, the owner could publish a
-- story against it, and the sweep's service-role removal — which bypasses RLS
-- and therefore the storage DELETE policy's live-reference re-check — could then
-- destroy a live story's bytes. Both review lanes reported it. The window is not
-- narrow: it spans an HTTP round trip to Storage.
--
-- So the unregistered object is ADOPTED before it is claimed. Inserting the
-- registry row is what gives `publish_story` something to lock, and the stamp in
-- the same transaction is what makes it refuse. After this function returns,
-- there is no longer a population without a row, and both halves of reclamation
-- are the same mechanism instead of two that only look alike.
--
-- Ownership comes from the path prefix, which is what ownership MEANS in this
-- bucket — every policy 0065 wrote and every one 0066 replaces keys on it. A
-- prefix that is not a real account's id is left alone: `continue` keeps the
-- bytes, and keeping bytes is the safe direction.
--
-- A row already stamped but still present (a crashed removal) is claimed by
-- `coalesce`, which preserves the original claim time and still returns the row,
-- so the retry the bucket evidence calls for actually happens.
create or replace function public.claim_orphan_paths(p_limit integer default 25)
returns table (media_id uuid, bucket_id text, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  r record;
  v_owner uuid;
  v_id uuid;
begin
  for r in
    select o.name as name, (storage.foldername(o.name))[1] as prefix
      from storage.objects o
     where o.bucket_id = 'story-media'
       and o.created_at < now() - interval '24 hours'
       and (
         v_caller is null
         or (storage.foldername(o.name))[1] = v_caller::text
       )
       and not exists (
         select 1
           from public.media_objects m
          where m.bucket_id = 'story-media'
            and m.storage_path = o.name
            and m.bytes_removed_at is null
       )
       and not exists (
         select 1
           from public.stories s
          where (s.media_path = o.name or s.inset_path = o.name)
            and s.deleted_at is null
            and s.expires_at > now()
       )
     order by o.created_at
     limit v_limit
  loop
    begin
      v_owner := r.prefix::uuid;
    exception when others then
      continue;  -- not an account prefix; the bytes stay
    end;

    if not exists (select 1 from public.profiles p where p.id = v_owner) then
      continue;  -- no account owns this prefix; the bytes stay
    end if;

    -- ADOPT. From here `publish_story` has a row to lock and a stamp to see.
    insert into public.media_objects (owner_id, bucket_id, storage_path)
    values (v_owner, 'story-media', r.name)
    on conflict (bucket_id, storage_path) do nothing;

    select m.id into v_id
      from public.media_objects m
     where m.bucket_id = 'story-media'
       and m.storage_path = r.name
     for update skip locked;

    if v_id is null then
      continue;  -- another transaction is already working on this object
    end if;

    -- RECOUNTED UNDER THE LOCK, exactly as claim_media_for_removal does: a story
    -- can have been published against these bytes since the scan above.
    if public.media_live_reference_count(v_id) = 0 then
      update public.media_objects m
         set bytes_removed_at = coalesce(m.bytes_removed_at, now())
       where m.id = v_id;

      media_id := v_id;
      bucket_id := 'story-media';
      storage_path := r.name;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.claim_orphan_paths(integer) is
  'V8-R-CMP-012 / V8-R-STO-016. Adopts and CLAIMS storage objects no live story and no unclaimed registry row accounts for — pre-boundary media, abandoned uploads, bytes a crashed removal left behind. Adoption is what makes publish_story able to refuse them, so the unregistered half of reclamation is no longer a check-then-delete.';

revoke all on function public.claim_orphan_paths(integer) from public, anon;
grant execute on function public.claim_orphan_paths(integer) to authenticated;

-- The path-returning predecessor is withdrawn rather than left standing: it is
-- granted to `authenticated`, it answers "are these bytes unreferenced?" for any
-- path, and leaving it in place keeps both the race and a liveness oracle alive
-- beside the function that closes them.
drop function if exists public.unreferenced_orphan_paths(integer);

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
-- CONSEQUENCE, STATED RATHER THAN DISCOVERED — AND THIS FILE MUST NOT BE
-- APPLIED BEFORE THE CLIENT MOVES.
--
-- Dropping these three policies breaks every caller that still talks to Storage
-- directly, and in this repository that is `src/lib/stories.server.ts` plus the
-- capture/story components — ALL OUTSIDE this lane's exclusive write scope, so
-- they are reported here and not edited. Applying 0066 on its own leaves the
-- product with failing uploads and unsignable story photos. The three edits that
-- must land in the SAME deployment, named exactly so integration is a checklist
-- and not an investigation:
--
--   1. `uploadStoryMedia` (stories.server.ts) — POST the bytes to
--      /api/media/upload instead of `storage.from('story-media').upload(...)`.
--      That route decodes and re-encodes them, which is the whole of
--      V8-R-STO-014.
--   2. story rendering — GET /api/media/:id/url instead of
--      `createSignedUrl(path, ttl)`. The route decides the lifetime, which is
--      the whole of V8-R-STO-015.
--   3. `deleteStory` (stories.server.ts) — call `delete_story` FIRST and remove
--      the bytes afterwards, or better, let /api/media handle the removal. Its
--      current order (remove, then RPC) removes while the reference is still
--      live, and 0066's DELETE policy correctly refuses that. Storage reports a
--      refusal by OMITTING the object from the returned list with `error` null,
--      and `removeBytes` there inspects only `error`, so the refusal reads as
--      success and the bytes are orphaned.
--
-- Item 3 orphans bytes rather than destroying them, and section 5a's sweep is
-- what stops that being permanent: a soft-deleted story stops counting, the
-- object has no unclaimed registry row, and `unreferenced_orphan_paths` hands it
-- to the reclaim route. The orphan is bounded by the sweep interval instead of
-- being forever. That is a mitigation, not a fix — the fix is item 3, and it is
-- outside this lane.
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
    -- THE HIDE APPLIES TO THE AUTHOR TOO. `report_content` explicitly accepts an
    -- author reporting their own story, and V8-R-FEED-010 says a report hides
    -- the content FOR THE REPORTER — with no exception for the reporter also
    -- being the author. Without this term the self-report succeeded while the
    -- photo went on signing for the person who reported it.
    select max(s.expires_at) into v_expiry
      from public.stories s
     where (s.media_path = p_name or s.inset_path = p_name)
       and s.deleted_at is null
       and s.expires_at > now()
       and not exists (
         select 1
           from public.content_reports cr
          where cr.reporter_id = v_caller
            and cr.subject_kind = 'story'
            and cr.subject_ref = s.id::text
       );

    -- A null expiry means one of two different things here, and they must not
    -- collapse: no story names these bytes at all (the upload-before-publish
    -- window, unbounded and readable), or every live story that names them is
    -- one this caller reported (hidden).
    if v_expiry is null and exists (
      select 1
        from public.stories s
       where (s.media_path = p_name or s.inset_path = p_name)
         and s.deleted_at is null
         and s.expires_at > now()
    ) then
      return query select false, null::timestamptz;
      return;
    end if;

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
     -- THE REPORTER'S HIDE APPLIES TO THE BYTES TOO. The stories SELECT policy
     -- excludes a story the caller reported, but this function is SECURITY
     -- DEFINER and reads public.stories directly, so the policy does not run
     -- here: without this clause a viewer could report a story, lose the row,
     -- and still mint a fresh signed URL for its photo with a media id they had
     -- already seen. "Reporting IMMEDIATELY HIDES the reported content" is not
     -- satisfied by hiding the caption while the image still loads.
     and not exists (
       select 1
         from public.content_reports cr
        where cr.reporter_id = v_caller
          and cr.subject_kind = 'story'
          and cr.subject_ref = s.id::text
     )
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
-- The policies that use this always pair it with a caller-scoped term, so
-- inside a policy it is not an oracle. Reached DIRECTLY over PostgREST it would
-- be one: any caller holding a story uuid could poll whether that story is
-- still live and watch the answer flip on expiry or deletion — metadata
-- V8-R-STO-016 makes unqueryable.
--
-- The guard is PARTY-BASED rather than a revoke. RLS policy expressions are
-- evaluated as the querying user, so withdrawing EXECUTE from `authenticated`
-- risks breaking the two policies below, and no local gate here executes SQL to
-- prove otherwise. Restricting the ANSWER is safe in a way that restricting the
-- grant is not.
--
-- Author or mutual friend of the author, which is exactly the set both policies
-- can already reach this function with: a story_audience recipient and a tagged
-- profile are mutual friends by 0065's own rules, and so is any viewer of a
-- 'friends' story. A stranger now gets false instead of the truth. Since
-- is_mutual_friend carries the block, a blocked account also stops getting an
-- answer.
create or replace function public.is_story_live(p_story_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is not null and not exists (
    select 1
      from public.stories s
     where s.id = p_story_id
       and (
         s.author_id = v_caller
         or public.is_mutual_friend(v_caller, s.author_id)
       )
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.stories s
     where s.id = p_story_id
       and s.deleted_at is null
       and s.expires_at > now()
  );
end;
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
-- 7b. Publication takes the same lock reclamation takes (V8-R-CMP-012)
------------------------------------------------------------------------------

-- Replaces 0065's `publish_story`. Same signature, same defaults, same
-- validation, same return — 0065's body is preserved verbatim between the two
-- additions marked below, so this is not a rewrite of somebody else's function.
--
-- ADDITION 1 — THE LOCK. 0065 checked that the object EXISTS and nothing else.
-- Existence is a fact about the past: `claim_media_for_removal` can have
-- recounted, stamped and be on its way to Storage while this check passes, and
-- the story then goes live against bytes that are already gone. Taking `for
-- update` on the same `media_objects` rows the claim takes makes the two
-- mutually exclusive — whichever arrives second sees the first's committed
-- decision instead of a stale one. A claimed object is refused; an object being
-- published is skipped by the claim's `skip locked`.
--
-- ADDITION 2 — THE SPINE ROW. 0065 published without writing to
-- `media_destinations`, which is why `media_live_reference_count` needs a second
-- term that counts stories directly. That term is defence in depth and stays,
-- but the spine is now written where the destination is actually created, so the
-- count's FIRST term is true on its own for everything published after this
-- migration, and "one media object, several destinations" (V8-R-CMP-012) has a
-- row to hang a second destination beside.
--
-- Objects with no registry row (everything uploaded before this boundary) simply
-- match nothing in either addition and behave exactly as they did under 0065.
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

  -- ADDITION 1. Taken BEFORE the existence check, so the existence check is a
  -- fact about the present rather than a fact about the past.
  perform 1
     from public.media_objects m
    where m.bucket_id = 'story-media'
      and m.storage_path in (p_media_path, p_inset_path)
    for update;

  if exists (
    select 1
      from public.media_objects m
     where m.bucket_id = 'story-media'
       and m.storage_path in (p_media_path, p_inset_path)
       and m.bytes_removed_at is not null
  ) then
    raise exception 'publish_story: those bytes have already been reclaimed'
      using errcode = '22023';
  end if;

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

  if p_audience = 'custom' and exists (
    select 1 from unnest(p_audience_ids) as candidate(id)
     where not public.is_mutual_friend(v_author, candidate.id)
  ) then
    raise exception 'publish_story: every custom recipient must be a mutual friend'
      using errcode = '42501';
  end if;

  if p_tag_ids is not null and exists (
    select 1 from unnest(p_tag_ids) as candidate(id)
     where candidate.id <> v_author
       and not public.is_mutual_friend(v_author, candidate.id)
  ) then
    raise exception 'publish_story: you can only tag friends who follow you back'
      using errcode = '42501';
  end if;

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

  -- ADDITION 2.
  insert into public.media_destinations (media_id, kind, ref_id)
  select m.id, 'story', v_id::text
    from public.media_objects m
   where m.bucket_id = 'story-media'
     and m.storage_path in (p_media_path, p_inset_path)
  on conflict do nothing;

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

comment on function public.publish_story(text, text, text, text, text, text, uuid[], uuid[]) is
  '0065''s publication verb plus 0066''s two additions: it takes the same media_objects row lock reclamation takes (so a story can never appear against claimed bytes) and writes the destination spine row (V8-R-CMP-012).';

revoke all on function public.publish_story(text, text, text, text, text, text, uuid[], uuid[]) from public, anon;
grant execute on function public.publish_story(text, text, text, text, text, text, uuid[], uuid[]) to authenticated;

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

-- ...AND AT THE TWO READ PATHS THAT FIND A PERSON IN THE FIRST PLACE.
--
-- V8-R-FEED-009 is "visibility and interaction stop BETWEEN the two users", and
-- severing the follow edges (below) removes the pair from every reader of
-- `follows` and `follow_requests` at once. Profile DISCOVERY is not one of those
-- readers: `search_handles` (0006) and `get_profile_by_handle` (0007) are
-- SECURITY DEFINER functions that read `public.profiles` directly, so no policy
-- and no severed edge touches them. After A blocks B, B could still type A's
-- handle and get back A's display name — and, on the exact-match lookup, A's
-- profile id, which is the key every other surface is addressed by.
--
-- These are 0006's and 0007's bodies verbatim plus one term. The rate cap, the
-- input shape, the privacy flag and the ordering are unchanged; only the block
-- is added, and it is added through `is_blocked_between`, which the caller is
-- always a party to here, so this site cannot drift from the others that ask it.
create or replace function public.search_handles(query text)
returns table (handle text, display_name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  search_cap constant integer := 500;  -- searches per user per day
  uid uuid := auth.uid();
  attempts integer;
begin
  if uid is null then
    return;
  end if;
  if lower(coalesce(query, '')) !~ '^[a-z0-9_]{1,20}$' then
    return;
  end if;

  insert into public.handle_search_attempts as a (user_id, day, count)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = a.count + 1
  returning count into attempts;

  if attempts > search_cap then
    return;
  end if;

  return query
  select p.handle, p.display_name
    from public.profiles p
   where p.is_private = false
     and p.handle_normalized like replace(lower(query), '_', '\_') || '%' escape '\'
     and not public.is_blocked_between(uid, p.id)
   order by p.handle_normalized
   limit 10;
end;
$$;

comment on function public.search_handles(text) is
  '0006''s handle search plus V8-R-FEED-009''s block: a blocked pair does not find each other by search.';

revoke all on function public.search_handles(text) from public, anon;
grant execute on function public.search_handles(text) to authenticated;

create or replace function public.get_profile_by_handle(h text)
returns table (id uuid, handle text, display_name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  search_cap constant integer := 500;  -- shared with search_handles
  uid uuid := auth.uid();
  attempts integer;
begin
  if uid is null then
    return;
  end if;
  if lower(coalesce(h, '')) !~ '^[a-z0-9_]{3,20}$' then
    return;
  end if;

  insert into public.handle_search_attempts as a (user_id, day, count)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = a.count + 1
  returning count into attempts;

  if attempts > search_cap then
    return;
  end if;

  return query
  select p.id, p.handle, p.display_name
    from public.profiles p
   where p.handle_normalized = lower(h)
     and not public.is_blocked_between(uid, p.id);
end;
$$;

comment on function public.get_profile_by_handle(text) is
  '0007''s exact-handle lookup plus V8-R-FEED-009''s block: a blocked pair cannot resolve each other''s profile id.';

revoke all on function public.get_profile_by_handle(text) from public, anon;
grant execute on function public.get_profile_by_handle(text) to authenticated;

-- ...AND AT EVERY TABLE THAT CARRIES A CONNECTION BETWEEN TWO ACCOUNTS.
--
-- THIS IS THE REDESIGN, and it is worth saying why the obvious alternative kept
-- failing. Enforcing the block inside each RPC that creates a connection is
-- per-call-site enforcement: `follow_user` was patched, then
-- `accept_follow_request`, then `invite_to_night_out` — each time a DIFFERENT
-- surface, each time the same defect, and each time the next surface was still
-- open. There is no version of that list that is finished, because the list
-- grows with the product.
--
-- A connection between two accounts cannot exist without a ROW existing, and
-- there are exactly five tables in this schema that hold one. Guarding the
-- tables makes the invariant belong to the data rather than to whoever last
-- wrote an RPC, and a surface added tomorrow inherits it without knowing it
-- exists. The complete list, and what the pair is on each:
--
--   public.follows           follower_id  <-> followee_id
--   public.follow_requests   requester_id <-> target_id
--   public.night_out_members user_id      <-> invited_by AND every existing
--                                             member of that night out
--   public.story_audience    profile_id   <-> the story's author
--   public.story_tags        profile_id   <-> the story's author
--
-- `follow_user` already wraps its inserts in `exception when others then return
-- 'rejected'`, so a raise here surfaces as an ordinary rejection rather than an
-- error — the product behaviour a block should have.
--
-- NIGHT OUTS ARE THE CASE THAT PROVES THE SHAPE. `invite_to_night_out` checks
-- the cap and the token and inserts; it has never heard of blocks. After A
-- blocks B, B could stay in a draft night out and have A added to it, putting
-- the two back in a shared group. The guard refuses the INSERT, so it does not
-- matter which RPC attempted it. Existing memberships are untouched — the
-- contract says a block "does not retroactively dissolve existing shared
-- GROUPS", so only a NEW co-membership is refused.
--
-- The lookup is INLINE rather than a call to is_blocked_between: that function
-- refuses a caller who is not one of the two parties, and a trigger can fire
-- under a writer that is neither (a migration, a server-side job). The
-- invariant belongs to the table, so it must not depend on who is asking.
--
-- SERIALIZED against a concurrent block. Without the pair lock, an INSERT here
-- and an INSERT into `profile_blocks` can each miss the other's uncommitted row
-- and both commit, leaving a block and a live connection standing together. The
-- lock is taken on the ORDERED pair by both sides, so whichever commits second
-- sees the first. Pairs are locked in sorted order, which is what keeps two
-- multi-pair night-out inserts from deadlocking against each other.
create or replace function public.blocked_pair_lock(a uuid, b uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(
    hashtextextended(
      least(a::text, b::text) || '|' || greatest(a::text, b::text),
      0
    )
  );
$$;

comment on function public.blocked_pair_lock(uuid, uuid) is
  'V8-R-FEED-009. Transaction-scoped advisory lock over an unordered pair of accounts. Both the block trigger and the connection guard take it, so a block and a connection between the same two people cannot commit concurrently.';

-- SERIALIZED AGAINST A CONCURRENT MEMBER INSERT, which the pair lock alone
-- cannot do.
--
-- The night-out rule is not "is this pair blocked?" — it is "is this new member
-- blocked with anyone ALREADY IN the group?", and that question is answered by
-- READING the other members. Two invitations arriving at once each read a member
-- list taken before the other's uncommitted row existed, so neither sees the
-- other and neither takes the (A, B) pair lock: both commit and a blocked pair
-- lands in a NEW shared group, the one outcome the guard exists to refuse.
--
-- Locking the night out itself is what makes the read binding. The second
-- transaction waits, and under READ COMMITTED its member query then runs after
-- the first has committed — so it sees the new member and takes the pair lock
-- that refuses it. Taken BEFORE the member query, and before any pair lock, so
-- the lock order is the same in every transaction that reaches here.
create or replace function public.night_out_guard_lock(p_night_out uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(
    hashtextextended('night_out:' || p_night_out::text, 0)
  );
$$;

comment on function public.night_out_guard_lock(uuid) is
  'V8-R-FEED-009. Transaction-scoped advisory lock over one night out. The membership guard takes it before reading the member list, so two concurrent invitations cannot each miss the other and seat a blocked pair together.';

create or replace function public.forbid_blocked_edge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self uuid;
  v_parties uuid[];
  v_other uuid;
begin
  if tg_table_name = 'follows' then
    v_self := new.follower_id;
    v_parties := array[new.followee_id];

  elsif tg_table_name = 'follow_requests' then
    v_self := new.requester_id;
    v_parties := array[new.target_id];

  elsif tg_table_name = 'night_out_members' then
    v_self := new.user_id;
    -- Before the member list is read, so the list is not a snapshot a concurrent
    -- invitation can invalidate. See night_out_guard_lock.
    perform public.night_out_guard_lock(new.night_out_id);
    select coalesce(array_agg(distinct s.party), '{}'::uuid[])
      into v_parties
      from (
        select nm.user_id as party
          from public.night_out_members nm
         where nm.night_out_id = new.night_out_id
           and nm.user_id <> new.user_id
        union
        select new.invited_by
         where new.invited_by is not null
           and new.invited_by <> new.user_id
      ) s
     where s.party is not null;

  elsif tg_table_name in ('story_audience', 'story_tags') then
    v_self := new.profile_id;
    select coalesce(array_agg(st.author_id), '{}'::uuid[])
      into v_parties
      from public.stories st
     where st.id = new.story_id
       and st.author_id <> new.profile_id;

  else
    -- A trigger attached to a table this function does not know how to read is
    -- a wiring mistake, and passing the row through would enforce nothing while
    -- looking enforced.
    raise exception 'forbid_blocked_edge: no pair rule for table %', tg_table_name
      using errcode = '42P01';
  end if;

  -- Sorted, so two transactions locking overlapping sets take them in the same
  -- order and cannot deadlock.
  select coalesce(array_agg(p order by p), '{}'::uuid[])
    into v_parties
    from unnest(v_parties) as p
   where p is not null;

  foreach v_other in array v_parties loop
    perform public.blocked_pair_lock(v_self, v_other);

    if exists (
      select 1
        from public.profile_blocks pb
       where (pb.blocker_id = v_self and pb.blocked_id = v_other)
          or (pb.blocker_id = v_other and pb.blocked_id = v_self)
    ) then
      raise exception 'blocked: no new connection between these accounts'
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.forbid_blocked_edge() is
  'V8-R-FEED-009. Table-level guard on every table that holds a connection between two accounts — follows, follow_requests, night_out_members, story_audience, story_tags. No such row may be created while either party has blocked the other, whichever RPC attempts it.';

drop trigger if exists follows_blocked_guard on public.follows;
create trigger follows_blocked_guard
  before insert on public.follows
  for each row execute function public.forbid_blocked_edge();

drop trigger if exists follow_requests_blocked_guard on public.follow_requests;
create trigger follow_requests_blocked_guard
  before insert on public.follow_requests
  for each row execute function public.forbid_blocked_edge();

drop trigger if exists night_out_members_blocked_guard on public.night_out_members;
create trigger night_out_members_blocked_guard
  before insert on public.night_out_members
  for each row execute function public.forbid_blocked_edge();

drop trigger if exists story_audience_blocked_guard on public.story_audience;
create trigger story_audience_blocked_guard
  before insert on public.story_audience
  for each row execute function public.forbid_blocked_edge();

drop trigger if exists story_tags_blocked_guard on public.story_tags;
create trigger story_tags_blocked_guard
  before insert on public.story_tags
  for each row execute function public.forbid_blocked_edge();

-- ...AND THE EDGES THAT ALREADY EXIST, because refusing new ones changes
-- nothing for the case that actually matters. People block someone they are
-- already connected to. The guard above stops a NEW follow, but an existing
-- follow edge or pending request survived the block, and 0007/0008 read those
-- rows through their own policies: `get_following`, `get_friend_ratings`,
-- `get_follow_requests` and `get_outgoing_requests` all keep returning data
-- across a block because none of them consults profile_blocks.
--
-- Redefining those four functions would be four copies of somebody else's code
-- and a fifth reader forgotten later. Removing the EDGE removes the answer from
-- every reader at once, including ones not written yet — there is nothing left
-- to return.
--
-- AN EXPLICIT READING, written down so it can be overruled: the contract says a
-- block "does not retroactively dissolve existing shared GROUPS", and names only
-- groups. A follow edge is the direct connection the requirement says must
-- stop, so severing it is the reading taken here. Unblocking does not restore
-- the edge — the follow has to be made again, which is the honest consequence
-- of having severed it rather than hidden it.
create or replace function public.sever_blocked_connections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- THE SAME LOCK THE CONNECTION GUARD TAKES. Without it this trigger and a
  -- concurrent follow insert each run against a snapshot taken before the
  -- other's row existed: the guard sees no block, this sees no edge, and both
  -- commit — a block with a live follow standing beside it. Taking the pair lock
  -- on both sides forces one of them to observe the other.
  perform public.blocked_pair_lock(new.blocker_id, new.blocked_id);

  delete from public.follows f
   where (f.follower_id = new.blocker_id and f.followee_id = new.blocked_id)
      or (f.follower_id = new.blocked_id and f.followee_id = new.blocker_id);

  delete from public.follow_requests r
   where (r.requester_id = new.blocker_id and r.target_id = new.blocked_id)
      or (r.requester_id = new.blocked_id and r.target_id = new.blocker_id);

  return new;
end;
$$;

comment on function public.sever_blocked_connections() is
  'V8-R-FEED-009. Blocking removes the follow edges and pending requests in BOTH directions, so every existing reader of those tables stops returning the pair without each one having to learn about blocks.';

drop trigger if exists profile_blocks_sever_connections on public.profile_blocks;
create trigger profile_blocks_sever_connections
  after insert on public.profile_blocks
  for each row execute function public.sever_blocked_connections();

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

  -- A SUBJECT REF IS AN ID, NOT A STRING. Every one of the four subject kinds is
  -- keyed by a uuid in this schema. Accepting arbitrary text let one account
  -- mint an unlimited number of distinct "subjects" and so walk straight past
  -- the one-report-per-subject index, which is the anti-flood measure.
  if btrim(p_subject_ref) !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'report_content: subject_ref is not an id'
      using errcode = '22023';
  end if;

  -- YOU MAY ONLY REPORT WHAT YOU CAN SEE. Reporting is an accusation against a
  -- named account attached to a durable, non-withdrawable operator record, so a
  -- caller who cannot reach the content has no business filing one — and could
  -- otherwise fabricate reports about stories they were never shown.
  --
  -- A KIND WITH NO SUBJECT TABLE IS REFUSED, not waved through. The earlier
  -- shape checked `story` and let `feed_post`, `comment` and `group_message`
  -- past with nothing but an id-shaped string, on the reasoning that their
  -- surfaces had not landed yet. That is unverifiable by construction: any
  -- account could mint an unlimited number of distinct fabricated subjects and
  -- walk straight past the one-report-per-subject index, which is the whole of
  -- the anti-flood measure. The id shape bounds the STRING, never the CLAIM. So
  -- a kind this schema cannot resolve is rejected until its table exists — the
  -- check constraint still records the vocabulary, and adding a branch here is
  -- what admits each new kind.
  if p_subject_kind <> 'story' then
    raise exception 'report_content: % has no reportable subject in this schema yet',
      p_subject_kind
      using errcode = '22023';
  end if;

  -- AND THE STORY HAS TO BE ONE THE CALLER CAN CURRENTLY READ. Omitting
  -- `deleted_at` and `expires_at` let anyone holding a retained uuid report a
  -- story that is already gone — content no read path would show them, so the
  -- accusation cannot be one they are making about something they saw.
  if not exists (
    select 1
      from public.stories s
     where s.id = btrim(p_subject_ref)::uuid
       and s.deleted_at is null
       and s.expires_at > now()
       and (
         s.author_id = auth.uid()
         or (
           public.is_mutual_friend(auth.uid(), s.author_id)
           and (
             s.audience = 'friends'
             or public.is_story_recipient(s.id, auth.uid())
           )
         )
       )
  ) then
    raise exception 'report_content: that story is not yours to report'
      using errcode = '42501';
  end if;

  -- AND A CEILING ON THE QUEUE. The visibility check bounds WHAT can be
  -- reported; this bounds HOW MUCH, which is the other half of the same abuse.
  -- Deliberately generous: a real person reporting fifty distinct things in a
  -- day is already extraordinary, so this never reaches ordinary use.
  --
  -- It applies to NEW subjects only. Re-reporting something already reported
  -- writes nothing, and it has to keep returning the existing id, because the
  -- caller hides the content on a returned id and only on a returned id — a
  -- rate limit that made the hide fail would punish the reporter.
  if not exists (
    select 1
      from public.content_reports cr
     where cr.reporter_id = auth.uid()
       and cr.subject_kind = p_subject_kind
       and cr.subject_ref = btrim(p_subject_ref)
  ) and (
    select count(*)
      from public.content_reports cr
     where cr.reporter_id = auth.uid()
       and cr.created_at > now() - interval '24 hours'
  ) >= 50 then
    raise exception 'report_content: too many reports from this account today'
      using errcode = '54000';
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
-- THE AUTHOR IS A REPORTER LIKE ANY OTHER. `report_content` accepts an author
-- reporting their own story (the `s.author_id = auth.uid()` branch of its
-- visibility check), and V8-R-FEED-010 says the report hides the content FOR
-- THE REPORTER. 0065's author policy gates on identity and expiry only, so a
-- self-report succeeded and changed nothing the author could see: the story
-- stayed in their own feed and its bytes went on signing. This is 0065's policy
-- verbatim plus the same one term the audience gate below carries.
drop policy if exists "stories: author reads own" on public.stories;
create policy "stories: author reads own"
  on public.stories for select
  using (
    auth.uid() = author_id
    and deleted_at is null
    and expires_at > now()
    and not exists (
      select 1
        from public.content_reports cr
       where cr.reporter_id = auth.uid()
         and cr.subject_kind = 'story'
         and cr.subject_ref = public.stories.id::text
    )
  );

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
