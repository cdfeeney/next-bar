------------------------------------------------------------------------------
-- 0069_feed_and_comments.sql — WP5: the Feed destination, its mutual-friend
-- audience, and the first visible comment surface in V8.
--
-- Requirements discharged here (V8 contract 3.1.0):
--   V8-R-FEED-001  Feed is a photo-memory view AND a composer destination. A
--                  card carries author, place, time, image, caption and tags,
--                  with exactly two actions: View night and Reply.
--   V8-R-FEED-002  a Feed post has NO expiry; it lives until its author deletes
--                  it. (Contrast a Story: 24 hours, migration 0065.)
--   V8-R-FEED-003  anyone authorized to VIEW a post may COMMENT on it, and the
--                  comments are visible to that same audience.
--   V8-R-FEED-004  "View night" opens the night the photo belongs to, and only
--                  for a viewer who may see that night.
--   V8-R-FEED-005  "Reply" opens that same visible thread. The right to reply is
--                  exactly the right to view.
--   V8-R-FEED-006  Feed is NEVER public. The audience is all mutual friends, a
--                  named mutual-friend group, or a custom mutual-friend subset,
--                  and a named group is INTERSECTED with the poster's own mutual
--                  friends server-side (D-C-37).
--   V8-R-FEED-008  a comment is deletable by its commenter or by the post
--                  author; deleting the post — or removing the Feed destination
--                  from a multi-destination media object — removes its visible
--                  comments.
--   V8-R-FEED-010  (EXTENSION, cross-lane) reporting resolves 'feed_post' and
--                  'comment'. 0066 owns the foundation and the 'story' case;
--                  WP6's 0067 owns 'group_message'. See section 9.
--
-- Idempotent throughout: create ... if not exists, drop policy if exists,
-- create or replace function, and guarded DO blocks for the two extensions.
-- This file is WRITTEN ONLY. Applying it is a separate attended step against a
-- ledger-aware runner; a migration file in the repository is not applied
-- anywhere until the target project's ledger says so.
--
-- THE RULE THIS FILE FOLLOWS WHEREVER IT TOUCHES ANOTHER LANE'S FUNCTION:
-- EXTEND, NEVER RESTATE. 0069 applies after 0066 and after WP6's 0067, and it
-- cannot see 0067's body. Rewriting a shared function from what 0066 says would
-- silently delete whatever 0067 added. So both shared functions this file
-- widens — `report_content` and `media_read_window` — are RENAMED to a
-- `_before_0069` name and then DELEGATED to for every case this lane does not
-- own. Whatever the previous migration decided keeps deciding; this file only
-- adds the cases it can actually resolve.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. Recursion-breaking, caller-scoped helpers
------------------------------------------------------------------------------

-- Same trap 0065 records for stories, and it is not hypothetical: `feed_posts`'
-- SELECT policy has to ask whether the caller is a named recipient, which lives
-- in `feed_post_audience`; that table's own policy has to ask whether the caller
-- authored the parent post, which lives in `feed_posts`. Written as plain
-- subqueries the two policies reference each other, PostgreSQL expands policies
-- at plan time, and reading EITHER table raises "infinite recursion detected in
-- policy for relation" — no post readable by anyone. Nothing local catches it:
-- typecheck, vitest and the browser gate never execute SQL.
--
-- Both directions go through SECURITY DEFINER helpers. The definer is the table
-- owner, exempt from RLS (these tables enable RLS but do not FORCE it), so the
-- inner read expands no policy and the cycle is cut.
--
-- Every one of them FAILS CLOSED and refuses to be an oracle: each answers only
-- about `auth.uid()`, so a direct PostgREST call cannot enumerate somebody
-- else's audience membership, authorship or reporting activity.

create or replace function public.is_feed_post_author(
  p_post_id uuid,
  p_profile_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_post_id is null
     or p_profile_id is null
     or auth.uid() is null
     or p_profile_id <> auth.uid() then
    return false;
  end if;
  return exists (
    select 1 from public.feed_posts p
     where p.id = p_post_id and p.author_id = p_profile_id
  );
end;
$$;

comment on function public.is_feed_post_author(uuid, uuid) is
  'Did this profile author this Feed post? SECURITY DEFINER so the audience and tag policies can ask without expanding the feed_posts policy, which reads feed_post_audience and would recurse. Own-id only; fails closed.';

revoke all on function public.is_feed_post_author(uuid, uuid) from public, anon;
grant execute on function public.is_feed_post_author(uuid, uuid) to authenticated;

-- `is_feed_post_recipient` IS GONE, and removing it is the fix rather than a
-- tidy-up (round 8, CRITICAL, codex).
--
-- It was SECURITY DEFINER, granted to `authenticated`, took a caller-supplied
-- post id, and its only guard was "answer about your own id". Own-id is not a
-- sufficient guard for a MEMBERSHIP question: a recipient who saw a post while
-- authorised keeps its uuid, and after unfollowing the author, being blocked,
-- reporting the post, or the author deleting it, could still call
-- `is_feed_post_recipient(postId, self)` over PostgREST and read `true` off a
-- materialised row no other surface would show them any more. That is the same
-- oracle shape 0066 closed for the story helper and this file closed again for
-- `feed_post_destination_is_live` — a definer function answering a question the
-- caller is no longer entitled to ask.
--
-- Patching it would have meant a fourth copy of the audience rule. The audience
-- lookup now lives INSIDE `public.feed_post_visible_to` (section 3), which is
-- SECURITY DEFINER and reads `feed_post_audience` directly with RLS bypassed —
-- so the recursion this helper existed to cut is still cut, by the same
-- mechanism, in the one place the rule is written.
--
-- Dropped BEFORE anything in this file redefines the gate, and `if exists` so a
-- first apply and a re-apply behave identically. No policy references it (the
-- policies ask the gate function), and PostgreSQL does not record dependencies
-- from function bodies, so nothing blocks the drop.
drop function if exists public.is_feed_post_recipient(uuid, uuid);

-- THE FEED DESTINATION IS PART OF THE READ GATE (V8-R-CMP-015 / V8-R-FEED-008).
--
-- "Remove from this destination" is `remove_media_destination` in 0066, and it
-- is a SOFT retirement: it stamps `removed_at`, it does not delete the row. So
-- the cascade 0066's comment on `media_destinations.id` anticipates ("a Feed
-- comments table added later references THIS id with on delete cascade") would
-- never fire for the operation it was meant to cover. A cascade that cannot run
-- is not a mechanism, so the rule lives in the READ GATE instead, where a soft
-- retirement actually reaches it: a post whose Feed destination is retired stops
-- being readable, and its comments go with it because they are gated on the post.
--
-- Positive form ("a LIVE feed destination exists"), not "no retired one exists".
-- A post whose spine row has been hard-deleted — `media_objects` cascade — has
-- lost its photo, and a photo-memory card with no photo is not a post that
-- should still be shown. Publication always writes exactly one spine row, so the
-- two forms differ only in that case, and hiding is the honest answer there.
create or replace function public.feed_post_destination_is_live(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.media_destinations d
     where d.kind = 'feed'
       and d.ref_id = p_post_id::text
       and d.removed_at is null
  );
$$;

comment on function public.feed_post_destination_is_live(uuid) is
  'V8-R-CMP-015. Does this Feed post still hold its media destination? remove_media_destination retires the spine row rather than deleting it, so this READ-GATE term is what makes "removing the Feed destination removes that post and its comments" real; the anticipated on-delete cascade could never fire against a soft retirement.';

-- NOT GRANTED TO `authenticated`, and the omission is the point.
--
-- This is an internal helper with exactly one caller: `feed_post_visible_to`, which is
-- SECURITY DEFINER and therefore executes as the owner, who holds EXECUTE regardless.
-- No application role needs it, and granting it made it a LIVENESS ORACLE: it is
-- SECURITY DEFINER, takes a caller-supplied post id, and applies no party guard, so any
-- authenticated holder of a post uuid — an audience member who has since been blocked or
-- unfriended, and who saw the id while authorised — could call it directly over PostgREST
-- and poll whether that post's destination is still live, watching the flip when the
-- author deletes.
--
-- That is the same shape 0066 closed for the story-shaped helper after it shipped a
-- cross-user disclosure oracle: a definer function taking an identity or a subject from
-- its caller and answering a question the caller is no longer entitled to ask. The rule
-- (EC-08): the caller gets their own data through a scoped path, and a helper only
-- definer functions call is granted to nobody.
revoke all on function public.feed_post_destination_is_live(uuid) from public, anon, authenticated;

-- THE HIDE, ASKED THROUGH DEFINER PREDICATES — 0066's rule, applied to this
-- lane's two new subject kinds.
--
-- `content_reports` is operator-only: 0066 leaves it with no SELECT policy and
-- no grant to `authenticated`. A policy USING expression runs with the CALLER's
-- privileges, so a bare `select 1 from public.content_reports` in the policies
-- below would either raise permission denied or contribute nothing and make
-- `not exists (...)` unconditionally true — silently un-hiding every reported
-- post. 0066 records that exact failure for stories; these are the same shape.
--
-- Not oracles: each answers only about the CALLER's own reports.
--
-- Compared against `p_id::text`, which PostgreSQL renders lowercase, matching
-- the normalised `subject_ref` `record_content_report` stores.
-- THE HIDE, WRITTEN ONCE, VIEWER-PARAMETRISED. `can_view_feed_post` (section 3)
-- has to ask it about a viewer who is not always `auth.uid()`, and the
-- caller-scoped spelling below is now just this function with the caller's id
-- filled in — so the two can no longer disagree.
--
-- NOT GRANTED TO ANY APPLICATION ROLE, for the same reason `feed_post_visible_to`
-- is not: it takes an arbitrary viewer, so a grant would let one account read
-- whether ANOTHER account has reported a post. Its only callers are SECURITY
-- DEFINER functions, which execute as the owner.
create or replace function public.feed_post_reported_by(
  p_viewer uuid,
  p_post_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.content_reports cr
     where p_viewer is not null
       and p_post_id is not null
       and cr.reporter_id = p_viewer
       and cr.subject_kind = 'feed_post'
       and cr.subject_ref = p_post_id::text
  );
$$;

comment on function public.feed_post_reported_by(uuid, uuid) is
  'V8-R-FEED-010. The one definition of "this viewer hid this Feed post". Viewer-parametrised because the audience gate asks it about a viewer who is not always the caller; granted to nobody, because an arbitrary-viewer answer would be a cross-account oracle.';

revoke all on function public.feed_post_reported_by(uuid, uuid) from public, anon, authenticated;

create or replace function public.feed_post_reported_by_caller(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.feed_post_reported_by(auth.uid(), p_post_id);
$$;

comment on function public.feed_post_reported_by_caller(uuid) is
  'V8-R-FEED-010. Whether the CALLER reported this Feed post. The feed_posts SELECT policy asks through this definer predicate because content_reports carries no reporter grant; a bare subquery there would fail open and un-hide reported content.';

revoke all on function public.feed_post_reported_by_caller(uuid) from public, anon;
grant execute on function public.feed_post_reported_by_caller(uuid) to authenticated;

create or replace function public.feed_comment_reported_by_caller(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.content_reports cr
     where auth.uid() is not null
       and cr.reporter_id = auth.uid()
       and cr.subject_kind = 'comment'
       and cr.subject_ref = p_comment_id::text
  );
$$;

comment on function public.feed_comment_reported_by_caller(uuid) is
  'V8-R-FEED-010. Whether the CALLER reported this comment. Same definer-predicate reason as feed_post_reported_by_caller.';

revoke all on function public.feed_comment_reported_by_caller(uuid) from public, anon;
grant execute on function public.feed_comment_reported_by_caller(uuid) to authenticated;

------------------------------------------------------------------------------
-- 2. Tables
------------------------------------------------------------------------------

-- V8-R-FEED-001 / V8-R-FEED-002. NO `expires_at` COLUMN AT ALL, and the absence
-- is the requirement rather than an oversight: "Feed posts have no expiry. They
-- persist until the author deletes them." A nullable expiry column would be a
-- place for a later change to reintroduce one by default.
create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  -- THE PHOTO IS NOT OPTIONAL. Feed is "a photo-memory view"; a card with no
  -- image is a different product. The reference is to the 0066 REGISTRY, never
  -- to a raw storage path, so the post inherits the whole media trust boundary:
  -- what the server decoded, the reference count, and the claim.
  media_id uuid not null references public.media_objects(id) on delete cascade,
  -- Catalog id chosen by the poster. Venue-tagged, never geotagged — same rule
  -- and same shape bound as a night out's decided bar (0044).
  bar_id text,
  caption text,
  -- V8-R-FEED-004's target. No foreign key ON PURPOSE would be the wrong call
  -- here — `night_outs` is a real table in this schema (0044), so the reference
  -- is declared and a deleted night leaves the card without its action rather
  -- than pointing at nothing.
  night_out_id uuid references public.night_outs(id) on delete set null,
  -- V8-R-FEED-006's three-way shape, and there is deliberately no 'public'.
  audience text not null default 'friends'
    check (audience in ('friends', 'group', 'custom')),
  -- PROVENANCE ONLY, and never the gate. Group membership lives on WP6's
  -- surface, which this schema cannot resolve at 0069; what makes a named-group
  -- audience safe is not this column but the INTERSECTION the publish verb
  -- performs — see `publish_feed_post`. Recorded without a foreign key for the
  -- same reason `media_destinations.ref_id` carries none: the referent belongs
  -- to another lane's migration.
  audience_group_id uuid,
  -- SERVER time. No client writes it: there is no INSERT grant on this table and
  -- publish_feed_post() is the only way in.
  created_at timestamptz not null default now(),
  -- Author deletion. Soft, like a story, so the read gate closes instantly while
  -- the caller still holds the media identity it needs to reclaim the bytes.
  deleted_at timestamptz,
  constraint feed_posts_caption_length check (
    caption is null or char_length(caption) between 1 and 1000
  ),
  constraint feed_posts_bar_shape check (
    bar_id is null or bar_id ~ '^[a-z0-9-]{1,60}$'
  ),
  -- A group audience names its group; a non-group audience must not carry one.
  constraint feed_posts_group_id_matches_audience check (
    (audience = 'group' and audience_group_id is not null)
    or (audience <> 'group' and audience_group_id is null)
  )
);

-- The read path is always "not deleted, by these authors, newest first".
create index if not exists feed_posts_live_idx
  on public.feed_posts (author_id, created_at desc)
  where deleted_at is null;
create index if not exists feed_posts_media_idx
  on public.feed_posts (media_id);

comment on table public.feed_posts is
  'V8-R-FEED-001 / V8-R-FEED-002. A Feed post: one media object, an author, a place, a caption and an optional night. No expiry — it lives until its author deletes it.';

-- THE MATERIALISED AUDIENCE (V8-R-FEED-006). For 'group' and 'custom' the rows
-- here ARE the audience, already intersected with the poster's mutual friends by
-- `publish_feed_post`. Materialising is what makes D-C-37 enforceable at read
-- time without re-resolving a group this schema cannot see: the intersection is
-- computed once, server-side, at publication.
create table if not exists public.feed_post_audience (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (post_id, profile_id)
);
create index if not exists feed_post_audience_profile_idx
  on public.feed_post_audience (profile_id);

comment on table public.feed_post_audience is
  'V8-R-FEED-006 / D-C-37. The resolved recipients of a group or custom Feed post: the selected set INTERSECTED with the poster''s mutual friends, computed server-side at publication.';

-- Tagged people, mirroring `story_tags` including the consent withdrawal.
-- `removed_at` is the TAGGED person's own, never the author's.
create table if not exists public.feed_post_tags (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  removed_at timestamptz,
  primary key (post_id, profile_id)
);
create index if not exists feed_post_tags_profile_idx
  on public.feed_post_tags (profile_id) where removed_at is null;

-- V8-R-FEED-003. The first comment surface in V8.
create table if not exists public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- WHO removed it, because V8-R-FEED-008 gives two different people the right
  -- and they are not the same event: a commenter deleting their own words is not
  -- a post author removing them from their post.
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint feed_comments_body_length check (
    char_length(btrim(body)) between 1 and 2000
  )
);

create index if not exists feed_comments_thread_idx
  on public.feed_comments (post_id, created_at)
  where deleted_at is null;
create index if not exists feed_comments_author_idx
  on public.feed_comments (author_id, created_at desc);

comment on table public.feed_comments is
  'V8-R-FEED-003. Comments on a Feed post, visible to exactly the post''s audience. Soft-deleted so "a failed deletion must not report success" is decidable, and so the read gate closes in the same statement.';

------------------------------------------------------------------------------
-- 3. The one definition of "may this caller see this post"
------------------------------------------------------------------------------

-- ONE PREDICATE, used by the RLS policy AND by every SECURITY DEFINER verb in
-- this file. 0066 records what happens when a visibility rule is written twice:
-- "the rule was written twice and the two disagreed". The definer verbs
-- (`add_feed_comment`, the reporting extension) bypass RLS by construction, so
-- without a shared predicate they would each carry their own copy of the
-- audience gate, and the copies would drift.
--
-- ROUND 9: THE VIEWER IS A PARAMETER NOW, AND THAT IS THE WHOLE FIX.
--
-- Round 8 returned three CRITICALs against three different surfaces — the granted
-- recipient helper, the audience policy's author arm, and the own-tag policy arm —
-- and they were ONE defect. Each of those places needed to know whether SOMEBODY
-- ELSE (or the caller, under a different question) could still see the post, this
-- function could only answer about `auth.uid()`, so each surface re-derived its own
-- partial answer inline and the three answers drifted apart. Adding a `p_viewer`
-- parameter is what lets every one of them ask the same question here instead.
--
-- FOUR FUNCTIONS, ONE RULE. `feed_post_visible_to` is the rule. `can_view_feed_post`
-- is the rule plus that viewer's own hide. The two granted spellings below fill in
-- an identity a party guard has already checked. Nothing re-implements a term.
--
-- WHY THE VIEWER-PARAMETRISED PAIR IS GRANTED TO NOBODY. An RLS policy expression
-- is evaluated with the CALLER's privileges, so anything a policy names must be
-- executable by `authenticated` — and a function taking an arbitrary viewer, if it
-- were, would be a far worse oracle than the one round 8 found: any account could
-- enumerate whether any other account can see, or has reported, any post whose uuid
-- it holds. So the arbitrary-viewer pair stays internal (its callers are SECURITY
-- DEFINER and execute as the owner), and the two granted entry points each carry a
-- party guard that pins the viewer to somebody the caller is entitled to ask about.
--
-- The block is inherited from `is_mutual_friend` (0066 moved it there so every call
-- site gets it) rather than restated. The audience lookup is a direct read of
-- `feed_post_audience`: this function is SECURITY DEFINER, so it reads with RLS
-- bypassed and expands no policy — the same cycle-cutting mechanism the retired
-- `is_feed_post_recipient` provided, without the grant that made it an oracle.
create or replace function public.feed_post_visible_to(
  p_viewer uuid,
  p_post_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- A null viewer is NOT trusted infrastructure here. This predicate answers a
  -- per-viewer question; with no viewer there is no audience to be inside, and
  -- returning true would hand the anonymous role a public Feed — the one thing
  -- V8-R-FEED-006 forbids outright.
  select p_viewer is not null
     and p_post_id is not null
     and exists (
       select 1
         from public.feed_posts p
        where p.id = p_post_id
          and p.deleted_at is null
          and public.feed_post_destination_is_live(p.id)
          and (
            p.author_id = p_viewer
            or (
              public.is_mutual_friend(p_viewer, p.author_id)
              and (
                p.audience = 'friends'
                or exists (
                  select 1
                    from public.feed_post_audience fa
                   where fa.post_id = p.id
                     and fa.profile_id = p_viewer
                )
              )
            )
          )
     );
$$;

comment on function public.feed_post_visible_to(uuid, uuid) is
  'V8-R-FEED-006. THE definition of the Feed audience gate: live post, live media destination, and the viewer is the author or a mutual friend inside the audience. Excludes the reporter hide, which is a per-viewer preference rather than an access rule — can_view_feed_post adds it. Granted to nobody: an arbitrary-viewer answer would be a cross-account oracle.';

revoke all on function public.feed_post_visible_to(uuid, uuid) from public, anon, authenticated;

-- THE GATE PROPER: the audience rule plus that viewer's own hide. Every SELECT
-- policy in section 4 asks this (through the caller-scoped spelling below), so
-- "may I see this post" has exactly one answer on every Feed surface.
create or replace function public.can_view_feed_post(
  p_viewer uuid,
  p_post_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.feed_post_visible_to(p_viewer, p_post_id)
     and not public.feed_post_reported_by(p_viewer, p_post_id);
$$;

comment on function public.can_view_feed_post(uuid, uuid) is
  'V8-R-FEED-006 + V8-R-FEED-010. The one Feed read gate: the audience rule AND this viewer''s own reporter hide. Granted to nobody — the caller-scoped one-argument spelling is the grantable form.';

revoke all on function public.can_view_feed_post(uuid, uuid) from public, anon, authenticated;

-- CALLER-SCOPED SPELLING, and the only one an application role may execute. Same
-- semantics as the two-argument form with the viewer fixed to `auth.uid()`, so the
-- overload can never mean two different things.
create or replace function public.can_view_feed_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_feed_post(auth.uid(), p_post_id);
$$;

comment on function public.can_view_feed_post(uuid) is
  'V8-R-FEED-006. can_view_feed_post(auth.uid(), post) — the caller-scoped spelling the RLS policies and the definer verbs ask. Carries the caller''s reporter hide; the hide-free question is feed_post_visible_to_party.';

revoke all on function public.can_view_feed_post(uuid) from public, anon;
grant execute on function public.can_view_feed_post(uuid) to authenticated;

-- THE HIDE-FREE QUESTION, PARTY-GUARDED — the ONLY grantable hide-free entry
-- point, and it exists for the RLS policies that cannot reach the internal pair.
--
-- WHY IT IS HIDE-FREE. The own-tag policy arms need the audience rule WITHOUT the
-- reporter hide, because your tag row is the consent you revoke and a row you
-- cannot read is a consent you cannot withdraw. Reporting a post must take away
-- the content, not the control.
--
-- AND ONE CALLER NEEDS IT ABOUT SOMEBODY ELSE: the audience policy's author arm has
-- to ask whether the RECIPIENT this row names can still see the post, which is what
-- round 8's second CRITICAL was about, and it must not learn whether that recipient
-- reported it. Hence `p_profile_id` rather than a caller-only form.
--
-- THE PARTY GUARD, NARROWED — round 9 fix round, CRITICAL, codex. The guard used to
-- be "you may ask about yourself, or about anybody if you authored the post", and
-- the self half was too wide: the function is SECURITY DEFINER, granted, takes a
-- caller-supplied post id and deliberately ignores the caller's own report, so ANY
-- authenticated holder of a post uuid could call it about themselves and poll
-- whether a post they had HIDDEN was still live — the same oracle shape this file
-- closed for `feed_post_destination_is_live` and for `is_feed_post_recipient`, in a
-- function added to remove it.
--
-- The self arm now additionally requires a `feed_post_tags` row for (post, caller).
-- That is exactly the population that needs the question — the consent surface —
-- and it makes an arbitrary post uuid answer false. The residual is narrow and it
-- is the point of the function: someone genuinely tagged in a post can still tell
-- that post is live after reporting it, because that is the row they are entitled
-- to withdraw. The tag row is not required to be live: a person who has already
-- withdrawn their tag must still be able to read the row that says so.
--
-- The two SECURITY DEFINER verbs that used to ask through here — `report_content`
-- and `can_view_feed_comment` — now call `feed_post_visible_to` directly. They
-- execute as the owner, so they never needed a granted wrapper, and routing them
-- through one is what made the wide guard look necessary.
create or replace function public.feed_post_visible_to_party(
  p_post_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
           auth.uid() is not null
           and p_post_id is not null
           and p_profile_id is not null
           and (
             public.is_feed_post_author(p_post_id, auth.uid())
             or (
               p_profile_id = auth.uid()
               and exists (
                 select 1
                   from public.feed_post_tags t
                  where t.post_id = p_post_id
                    and t.profile_id = auth.uid()
               )
             )
           )
         )
     and public.feed_post_visible_to(p_profile_id, p_post_id);
$$;

comment on function public.feed_post_visible_to_party(uuid, uuid) is
  'V8-R-FEED-006. feed_post_visible_to, without the reporter hide, for a profile the caller is entitled to ask about: any profile when the caller authored the post, or the caller themselves when they hold a tag row on it. Both halves of that guard are load-bearing — a granted hide-free predicate with a wider guard is a liveness oracle over content the caller has hidden.';

revoke all on function public.feed_post_visible_to_party(uuid, uuid) from public, anon;
grant execute on function public.feed_post_visible_to_party(uuid, uuid) to authenticated;

-- The same question for a comment: a comment is visible exactly while its post
-- is, and while the comment itself is live. Reporting asks through this.
create or replace function public.can_view_feed_comment(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.feed_comments c
     where c.id = p_comment_id
       and c.deleted_at is null
       -- HIDE-FREE ON PURPOSE, which is why this asks the RULE and not
       -- `can_view_feed_post`: the report path asks through here, and a caller who
       -- has already reported the parent post must still pass so that a REPEAT
       -- report returns the existing id instead of raising. `report_content` adds
       -- the parent-post hide itself, where it belongs.
       --
       -- THE INTERNAL SPELLING, not the granted party wrapper. This function is
       -- SECURITY DEFINER and executes as the owner, so it holds EXECUTE on
       -- `feed_post_visible_to` regardless of any grant — it never needed a
       -- grantable entry point, and routing it through one is what forced that
       -- wrapper's guard wide enough to become an oracle (round 9, CRITICAL).
       and public.feed_post_visible_to(auth.uid(), c.post_id)
       -- THE BLOCK IS BETWEEN THE READER AND THE COMMENTER, and it is a SECOND
       -- pair from the one the post gate judges. `can_view_feed_post` asks about
       -- the caller and the post's AUTHOR; a comment introduces a third party.
       -- Without this term, A and C both being mutual friends of author P let A
       -- read C's comment after A blocked C, because no predicate on the path
       -- ever compared A with C. "Blocking PREVENTS VISIBILITY AND INTERACTION
       -- BETWEEN THE AFFECTED USERS ... SERVER-ENFORCED IN BOTH DIRECTIONS"
       -- (V8-R-FEED-009 / D-C-30) is not scoped to the pair that happens to own
       -- the surrounding row.
       and not public.is_blocked_between(auth.uid(), c.author_id)
  );
$$;

comment on function public.can_view_feed_comment(uuid) is
  'V8-R-FEED-003 + V8-R-FEED-009. A comment is visible exactly while it is live, its post is visible to this caller, AND neither the caller nor the commenter has blocked the other — the post gate judges the caller against the post author, so the reader/commenter pair needs its own term. It asks the post gate through feed_post_visible_to, so it omits the reporter hide and a repeat report stays idempotent. Granted to nobody: its only caller is the SECURITY DEFINER report_content.';

-- NOT GRANTED TO `authenticated`, and the omission is the fix (round 9, CRITICAL,
-- codex). Its only caller is `report_content`, which is SECURITY DEFINER and holds
-- EXECUTE as the owner regardless. No policy names it — the comments read policy
-- asks `can_view_feed_post` — and no application code calls it. Granted, it was a
-- liveness oracle of exactly the shape this file closed twice already: SECURITY
-- DEFINER, caller-supplied subject, and deliberately hide-free, so a caller who had
-- REPORTED a comment could still poll whether it was live.
revoke all on function public.can_view_feed_comment(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 4. Row level security
------------------------------------------------------------------------------

alter table public.feed_posts         enable row level security;
alter table public.feed_post_audience enable row level security;
alter table public.feed_post_tags     enable row level security;
alter table public.feed_comments      enable row level security;

-- ONE SELECT POLICY, not the author/audience pair `stories` carries. The pair
-- exists in 0065 because the two branches genuinely differ there (an author's
-- own expiry rule). Feed has no expiry, so the branches collapse, and one policy
-- over one predicate is one place for the rule to live.
drop policy if exists "feed_posts: audience reads" on public.feed_posts;
create policy "feed_posts: audience reads"
  on public.feed_posts for select
  to authenticated
  using (
    -- ONE CALL. The hide used to be a second term here; it is inside the gate now
    -- (round 9), so this policy states the rule exactly once and cannot drift from
    -- the audience, tag and comment policies that ask the same function.
    public.can_view_feed_post(public.feed_posts.id)
  );

-- No INSERT / UPDATE / DELETE policy anywhere in this section: publication and
-- both deletions go through the SECURITY DEFINER verbs in sections 6-8, so
-- server time, the mutuality intersection and the destination retirement cannot
-- be bypassed by writing the table directly.

drop policy if exists "feed_post_audience: parties read" on public.feed_post_audience;
create policy "feed_post_audience: parties read"
  on public.feed_post_audience for select
  to authenticated
  using (
    -- THE CALLER'S OWN GATE, HOISTED. Whoever is reading, they must still be able
    -- to see the post these rows belong to; that is one call, not a term repeated
    -- down each arm. Asking it here does not recurse: `feed_post_visible_to` reads
    -- feed_post_audience directly and is SECURITY DEFINER, so RLS is bypassed and
    -- this policy is not re-entered.
    public.can_view_feed_post(post_id)
    and (
      -- THE RECIPIENT'S OWN ROW. Nothing further to ask: the hoisted gate already
      -- judged R against the post, which is exactly the question. An earlier shape
      -- put `is_blocked_between(auth.uid(), profile_id)` here, where the two sides
      -- are the SAME PERSON — is_blocked_between(R, R) is false, so it gated
      -- nothing.
      auth.uid() = public.feed_post_audience.profile_id
      -- THE AUTHOR READING A RECIPIENT'S ROW. Round 8 (CRITICAL, codex): this arm
      -- asked only "am I the author, and have we not blocked each other", so after
      -- R merely UNFOLLOWED P — no block at all — P kept receiving R's audience
      -- row for a post R can no longer see. The pair term was a partial, inline
      -- restatement of an audience rule that lives somewhere else, and it fell
      -- behind it. It now asks the rule itself, about R: mutuality, the block
      -- inside it, post liveness and destination liveness, in one call.
      --
      -- The PARTY spelling, so R's own reporter hide is NOT consulted — whether R
      -- hid the post is R's business and must not leak to P through the presence
      -- or absence of this row. P's own hide is the hoisted gate above.
      or (
        public.is_feed_post_author(post_id, auth.uid())
        and public.feed_post_visible_to_party(post_id, public.feed_post_audience.profile_id)
      )
    )
  );

drop policy if exists "feed_post_tags: readable with post" on public.feed_post_tags;
create policy "feed_post_tags: readable with post"
  on public.feed_post_tags for select
  to authenticated
  using (
    -- YOUR OWN TAG ROW IS YOUR OWN CONSENT SURFACE, and it stays readable even
    -- after you report the post: the UPDATE policy below is how a tagged person
    -- withdraws the tag, and a row you cannot read is a consent you cannot
    -- revoke. Hiding it would take away the control, not the content. That is why
    -- this arm asks the PARTY spelling — the audience rule without the hide — and
    -- not `can_view_feed_post`.
    --
    -- Round 8 (CRITICAL, codex): the arm used to be a bare `auth.uid() = profile_id`
    -- and asked NOTHING else, so a tagged person kept reading — and, through the
    -- UPDATE policy below, writing — their row after the post was soft-deleted, its
    -- Feed destination retired, the two accounts blocked each other, or they simply
    -- stopped being mutual friends. "Your own row" is an identity, not an
    -- entitlement, and it was standing in for one.
    (auth.uid() = profile_id and public.feed_post_visible_to_party(post_id, auth.uid()))
    or (
      public.can_view_feed_post(post_id)
      -- THE READER/TAGGED-PERSON BLOCK, and it is the SECOND pair on this path
      -- just as it is for comments. `can_view_feed_post` judges the caller against
      -- the post's AUTHOR; a tag introduces a third party, exactly like a comment
      -- does. Without this term, A and C both being mutual friends of author P let
      -- A read C's tag row — and the card then renders C's name in the Tagged chip
      -- — after A blocked C, because nothing on the path ever compared A with C.
      -- 0066 severs only the A-C follow edges, so P-C stays mutual and P may still
      -- tag C. "Blocking PREVENTS VISIBILITY AND INTERACTION BETWEEN THE AFFECTED
      -- USERS ... SERVER-ENFORCED IN BOTH DIRECTIONS" (D-C-30) is not scoped to
      -- the pair that happens to own the surrounding row. The comments policy got
      -- this term in an earlier round; the tags policy is the same shape and was
      -- missed.
      --
      -- NOT on the `auth.uid() = profile_id` arm above: your own tag row is your
      -- own consent surface, and a row you cannot read is a consent you cannot
      -- revoke.
      --
      -- THE REPORTER HIDE is no longer a separate term here either: it lives inside
      -- `can_view_feed_post` as of round 9, so this arm still hides the tag rows of
      -- a post the caller reported ("reporting IMMEDIATELY HIDES the reported
      -- content", V8-R-FEED-010) without restating the veto.
      and not public.is_blocked_between(auth.uid(), public.feed_post_tags.profile_id)
    )
  );

-- A tagged person withdraws THEIR OWN tag. Never the author's call, and never
-- anyone else's. Mirrors `story_tags: subject removes own` (0065).
--
-- Round 8 (CRITICAL, codex) named the WRITE half of the same defect as the read
-- arm above: identity alone let a tagged person keep patching `removed_at` on a
-- post they could no longer see. The gate is the same one, on both USING and WITH
-- CHECK, so the row cannot be moved out of visibility by the update either.
drop policy if exists "feed_post_tags: subject removes own" on public.feed_post_tags;
create policy "feed_post_tags: subject removes own"
  on public.feed_post_tags for update
  to authenticated
  using (
    auth.uid() = profile_id
    and public.feed_post_visible_to_party(post_id, auth.uid())
  )
  with check (
    auth.uid() = profile_id
    and public.feed_post_visible_to_party(post_id, auth.uid())
  );

-- V8-R-FEED-003: "the right to comment is exactly the right to view, and nothing
-- wider" — so the comment gate is the post gate, asked through the same
-- predicate, plus this caller's own two hides.
drop policy if exists "feed_comments: post audience reads" on public.feed_comments;
create policy "feed_comments: post audience reads"
  on public.feed_comments for select
  to authenticated
  using (
    deleted_at is null
    and public.can_view_feed_post(post_id)
    -- The reader/commenter block, applied HERE and not only inside
    -- `can_view_feed_comment`, because this policy is the actual read path: it
    -- asks the POST gate, which compares the caller with the post's author and
    -- never with the person who wrote this row.
    and not public.is_blocked_between(auth.uid(), public.feed_comments.author_id)
    -- The post's own hide is inside `can_view_feed_post` as of round 9; only the
    -- COMMENT's hide is this policy's to add, because no post-level gate can know
    -- about it.
    and not public.feed_comment_reported_by_caller(public.feed_comments.id)
  );

------------------------------------------------------------------------------
-- 5. Grants
------------------------------------------------------------------------------

-- `authenticated` IS REVOKED TOO, and leaving it out was not a harmless omission.
-- Supabase ships `alter default privileges in schema public grant all on tables to
-- anon, authenticated, service_role`, so every table created above arrives with a
-- TABLE-LEVEL ALL grant to `authenticated` already on it. A later
-- `grant update (removed_at)` does not narrow an existing table-level UPDATE — a
-- column grant only ever ADDS — so the column list below was decorative and
-- `authenticated` held UPDATE on every column of all four tables.
--
-- Three of the four were saved by RLS having no INSERT/UPDATE/DELETE policy at all,
-- which denies by default. `feed_post_tags` was not: it HAS an UPDATE policy, and
-- that policy only checks `auth.uid() = profile_id` in both USING and WITH CHECK.
-- A tagged person could therefore PATCH their own row's `post_id` and move their
-- tag onto any post id they know, bypassing publication's audience, mutual-friend
-- and block checks entirely. Revoking first is what makes the column grant real.
--
-- Revoking a privilege that was never granted is not an error, so this is
-- idempotent on a re-run and correct on a database whose defaults were changed.
revoke all on public.feed_posts         from public, anon, authenticated;
revoke all on public.feed_post_audience from public, anon, authenticated;
revoke all on public.feed_post_tags     from public, anon, authenticated;
revoke all on public.feed_comments      from public, anon, authenticated;

grant select on public.feed_posts         to authenticated;
grant select on public.feed_post_audience to authenticated;
grant select on public.feed_post_tags     to authenticated;
grant select on public.feed_comments      to authenticated;

-- The ONLY column-level write grant in this file, and it is the tagged person's
-- consent withdrawal. Everything else is a definer verb.
grant update (removed_at) on public.feed_post_tags to authenticated;

------------------------------------------------------------------------------
-- 6. Publication (V8-R-FEED-001, V8-R-FEED-006)
------------------------------------------------------------------------------

-- THE COMPOSER'S FEED DESTINATION. Modelled on 0066's `publish_story` — the same
-- path lock, the same claim refusal, the same spine row — because a Feed post is
-- a media destination in exactly the sense V8-R-CMP-012 defines, and a second
-- publication verb that took the locks differently would reopen the
-- publish-versus-reclaim race on a new surface.
--
-- THE AUDIENCE RULE, and the difference between the two non-'friends' modes is
-- deliberate:
--
--   * 'custom' is "a CUSTOM MUTUAL-FRIEND SUBSET". The poster names people
--     directly, so naming somebody who is not a mutual friend is an ERROR and is
--     refused — exactly as `publish_story` refuses a custom story recipient.
--
--   * 'group' is "a NAMED MUTUAL-FRIEND GROUP", and D-C-37 settles it in the
--     other direction: "Recipients equal the SELECTED GROUP INTERSECTED WITH the
--     poster's own mutual friends. A group member who is not a mutual friend of
--     the poster is NOT a recipient." A non-mutual member is therefore DROPPED,
--     not an error — the group legitimately contains people the poster is not
--     mutual friends with, and refusing the whole publish would make the mode
--     unusable.
--
-- THE GROUP IS RESOLVED SERVER-SIDE, NOT TAKEN FROM THE CALLER'S LIST. An
-- earlier version of this function argued that trusting `p_audience_ids` was
-- harmless because a liar still reaches only their own mutual friends, "a set
-- they could equally have named as a 'custom' audience". D-C-37 does not say
-- that. It says recipients EQUAL the selected group INTERSECTED WITH the
-- poster's own mutual friends — so a caller naming group G and a mutual friend
-- OUTSIDE G delivered to somebody the group never included, and the post carries
-- `audience_group_id = G` while its audience is not G's. That the recipient was
-- reachable by another mode is beside the point: the recipient, and anyone
-- reading the provenance, is told this went to the group.
--
-- THE CALLER'S LIST IS NOT CONSULTED FOR A GROUP AT ALL, and the earlier version
-- of this file that merely FILTERED it was still wrong. Filtering closed the
-- widening direction only: a caller naming group G and passing one member of G
-- published a one-person post stamped `audience_group_id = G`. D-C-37 says
-- recipients EQUAL the selected group intersected with the poster's mutual
-- friends — an equality, not a ceiling — so the group is enumerated from
-- `public.group_members` and `p_audience_ids` is ignored. A poster who wants to
-- reach some named people has the 'custom' mode for exactly that, and it records
-- no group.
--
-- `public.group_members` belongs to WP6's 0067, which applies before this file.
-- Naming it is safe from a `language plpgsql` body, which PostgreSQL does not
-- resolve at CREATE time, so 0069 still CREATEs cleanly against a schema that
-- lacks it. Membership on that surface IS row existence: there is no
-- accepted/pending column to check, unlike `night_out_members`.
--
-- `public.is_group_member(group, profile)` still has a job, and it is now the
-- load-bearing one: it guards that THE POSTER is in the group before anything
-- enumerates it. This function is SECURITY DEFINER, so the enumeration bypasses
-- `group_members`' RLS; without that guard the definer would resolve a group the
-- caller has no part in. `is_group_member` is itself party-guarded and SECURITY
-- DEFINER does not change `auth.uid()`, so asking it about the poster is the case
-- it always answers.
--
-- FAILS CLOSED. "If the mutual-friend set cannot be resolved the action FAILS
-- CLOSED rather than delivering to the unintersected group" — so an intersection
-- that comes back empty raises, and nothing is published. Publishing a post whose
-- audience table is empty would be a post nobody can read, which reads to the
-- author as delivery.
create or replace function public.publish_feed_post(
  p_media_id uuid,
  p_bar_id text default null,
  p_caption text default null,
  p_night_out_id uuid default null,
  p_audience text default 'friends',
  p_audience_ids uuid[] default '{}',
  p_group_id uuid default null,
  p_tag_ids uuid[] default '{}'
)
returns public.feed_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid := auth.uid();
  v_post public.feed_posts;
  v_id uuid;
  v_bucket text;
  v_path text;
  v_removed timestamptz;
  v_recipients integer;
begin
  if v_author is null then
    raise exception 'publish_feed_post: not authenticated' using errcode = '28000';
  end if;
  if p_media_id is null then
    raise exception 'publish_feed_post: media_id is required' using errcode = '22023';
  end if;
  if p_audience not in ('friends', 'group', 'custom') then
    raise exception 'publish_feed_post: unknown audience %', p_audience
      using errcode = '22023';
  end if;
  if p_audience = 'group' and p_group_id is null then
    raise exception 'publish_feed_post: a group audience needs a group'
      using errcode = '22023';
  end if;
  if p_audience <> 'group' and p_group_id is not null then
    raise exception 'publish_feed_post: only a group audience names a group'
      using errcode = '22023';
  end if;
  -- 'custom' IS a list, so an empty one is an error. 'group' is NOT a list: D-C-37
  -- makes its recipients the GROUP intersected with the poster's mutual friends,
  -- resolved server-side below, so `p_audience_ids` is not consulted for it at all
  -- and requiring one would have been the caller's list creeping back in.
  if p_audience = 'custom'
     and (p_audience_ids is null or array_length(p_audience_ids, 1) is null) then
    raise exception 'publish_feed_post: that audience needs at least one recipient'
      using errcode = '22023';
  end if;
  -- BOUNDS BELONG HERE, not only in the TypeScript caller. This function is
  -- granted to `authenticated`, so it is reachable directly over PostgREST and a
  -- cap that exists only in the app bounds the app's own UI and nothing else.
  -- The table constraint is the backstop; this is the honest error message.
  if p_caption is not null and char_length(p_caption) > 1000 then
    raise exception 'publish_feed_post: that caption is too long'
      using errcode = '22001';
  end if;

  -- THE MEDIA MUST BE THE CALLER'S, AND STILL THERE. Taken in the same order
  -- 0066's publish_story takes it: the PATH lock first (it is the only lock that
  -- exists for an object with no registry row), then the row lock, then the
  -- claim check — so the check is a fact about the present rather than about the
  -- past, and a reclamation sweep cannot commit between the two.
  select m.bucket_id, m.storage_path
    into v_bucket, v_path
    from public.media_objects m
   where m.id = p_media_id
     and m.owner_id = v_author;

  if v_path is null then
    raise exception 'publish_feed_post: that media is not yours to post'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(public.media_path_lock_key(v_bucket, v_path));

  select m.bytes_removed_at into v_removed
    from public.media_objects m
   where m.id = p_media_id
   for update;

  if v_removed is not null then
    raise exception 'publish_feed_post: those bytes have already been reclaimed'
      using errcode = '22023';
  end if;

  -- V8-R-FEED-004: the night has to be one the POSTER belongs to. This is the
  -- same rule `night_outs_select_member` (0044) states, restated because a
  -- SECURITY DEFINER function does not evaluate that policy. Whether the VIEWER
  -- may see the night is a separate decision, made by that policy at read time.
  if p_night_out_id is not null and not exists (
    select 1
      from public.night_outs n
     where n.id = p_night_out_id
       and (
         n.owner_id = v_author
         or exists (
           select 1
             from public.night_out_members nm
            where nm.night_out_id = n.id
              and nm.user_id = v_author
         )
       )
  ) then
    raise exception 'publish_feed_post: that night is not one of yours'
      using errcode = '42501';
  end if;

  -- 'group' — THE POSTER MUST BE IN THE GROUP THEY NAME, checked before anything
  -- reads that group's membership. `publish_feed_post` is SECURITY DEFINER, so the
  -- enumeration below bypasses `group_members`' RLS; this guard is what keeps that
  -- from becoming a way to read, or post into, a group the caller does not belong
  -- to. `is_group_member` is party-guarded and SECURITY DEFINER does not change
  -- `auth.uid()`, so asking it about the poster themselves is the case it always
  -- answers.
  if p_audience = 'group' and not public.is_group_member(p_group_id, v_author) then
    raise exception 'publish_feed_post: that is not a group of yours'
      using errcode = '42501';
  end if;

  -- 'custom' — every named person must be a mutual friend, or nothing is posted.
  if p_audience = 'custom' and exists (
    select 1 from unnest(p_audience_ids) as candidate(id)
     where not public.is_mutual_friend(v_author, candidate.id)
  ) then
    raise exception 'publish_feed_post: every custom recipient must be a mutual friend'
      using errcode = '42501';
  end if;

  -- Tags follow the story rules: friends who follow you back, and inside the
  -- audience when the audience is not everyone. A tag is a write onto somebody
  -- else's consent surface, so it can never reach further than the post does.
  if p_tag_ids is not null and exists (
    select 1 from unnest(p_tag_ids) as candidate(id)
     where candidate.id <> v_author
       and not public.is_mutual_friend(v_author, candidate.id)
  ) then
    raise exception 'publish_feed_post: you can only tag friends who follow you back'
      using errcode = '42501';
  end if;

  insert into public.feed_posts (
    author_id, media_id, bar_id, caption, night_out_id, audience, audience_group_id
  )
  values (
    v_author, p_media_id, p_bar_id, p_caption, p_night_out_id, p_audience, p_group_id
  )
  returning id into v_id;

  -- THE DESTINATION SPINE ROW (V8-R-CMP-012). This is what makes the post a
  -- destination rather than a private copy of a rule: the reference count sees
  -- it, "delete everywhere" clears it, and `remove_media_destination` retires it.
  insert into public.media_destinations (media_id, kind, ref_id)
  values (p_media_id, 'feed', v_id::text)
  on conflict do nothing;

  -- THE INTERSECTION, computed once and stored. The two non-'friends' modes take
  -- their CANDIDATE SET from different places, and that difference is the whole of
  -- D-C-37:
  --
  --   * 'custom' — the candidate set IS the caller's list, because the mode is
  --     defined as "a CUSTOM MUTUAL-FRIEND SUBSET" and the poster naming people is
  --     the point. Every name has already been proved a mutual friend above, so
  --     the filter here is a restatement rather than a second gate.
  --   * 'group' — the candidate set is THE GROUP, read from the server. Filtering
  --     the caller's list by group membership closed the WIDENING direction only:
  --     a caller passing one member of G still published a one-person post stamped
  --     `audience_group_id = G`, and D-C-37 says recipients EQUAL the selected
  --     group intersected with the poster's mutual friends. Nothing the caller
  --     sends narrows it now.
  --
  -- `public.group_members` belongs to WP6's 0067, which applies BEFORE this file;
  -- naming it from a `language plpgsql` body is safe because PostgreSQL does not
  -- resolve those bodies at CREATE time. This function is SECURITY DEFINER, so the
  -- read is not RLS-scoped to the caller — which is exactly what "resolved
  -- server-side" requires, and exactly why the membership guard above is not
  -- optional: without it the definer would happily enumerate a group the poster
  -- does not belong to.
  if p_audience = 'custom' then
    insert into public.feed_post_audience (post_id, profile_id)
      select v_id, ids.distinct_id
        from (select distinct unnest(p_audience_ids) as distinct_id) ids
       where ids.distinct_id <> v_author
         and public.is_mutual_friend(v_author, ids.distinct_id)
      on conflict do nothing;
  elsif p_audience = 'group' then
    -- THE POSTER'S OWN MEMBERSHIP IS RE-ASSERTED INSIDE THIS STATEMENT, and that
    -- is not a duplicate of the guard above. The guard is a separate statement, so
    -- at READ COMMITTED it sees a different snapshot: a poster removed from the
    -- group between the two statements passed the check and then published into a
    -- group they no longer belong to, because the surviving members still resolve.
    -- One statement, one snapshot, so the membership that authorises the post is
    -- the same membership that enumerates the audience. The guard above stays for
    -- the honest error message on the ordinary refusal.
    insert into public.feed_post_audience (post_id, profile_id)
      select distinct v_id, gm.profile_id
        from public.group_members gm
       where gm.group_id = p_group_id
         and gm.profile_id <> v_author
         and public.is_mutual_friend(v_author, gm.profile_id)
         and exists (
           select 1
             from public.group_members me
            where me.group_id = p_group_id
              and me.profile_id = v_author
         )
      on conflict do nothing;
  end if;

  if p_audience <> 'friends' then
    select count(*)::int into v_recipients
      from public.feed_post_audience fa
     where fa.post_id = v_id;

    if v_recipients = 0 then
      -- FAIL CLOSED. Rolls the whole publication back rather than leaving a post
      -- whose audience is nobody, which the author would read as delivered.
      raise exception
        'publish_feed_post: nobody in that audience is both a mutual friend and, for a group, in that group, so nothing was posted'
        using errcode = '42501';
    end if;
  end if;

  if p_tag_ids is not null and array_length(p_tag_ids, 1) is not null then
    -- A tag outside the resolved audience is DROPPED rather than refused, for
    -- the same reason a non-mutual group member is: the poster picked a group,
    -- not a list, and the narrowing is the server's job. Tagging yourself is
    -- always allowed and never needs an audience row.
    -- THE MUTUALITY IS RE-ASSERTED HERE, ONCE, FOR EVERY ARM THAT IS NOT THE
    -- POSTER THEMSELVES.
    --
    -- The guard near the top of this function is a separate statement, so at READ
    -- COMMITTED it sees an earlier snapshot: somebody who blocks or unfriends the
    -- poster while the media lock and the inserts run passed that guard and still
    -- got a tag row written onto their consent surface, which D-C-30 forbids in
    -- both directions.
    --
    -- A previous round put the re-check on the 'friends' arm only, on the
    -- reasoning that 'custom' and 'group' were covered because they test
    -- `feed_post_audience` rows written inside this transaction. That was wrong by
    -- one statement: the audience insert judged mutuality in ITS snapshot, and the
    -- recipient-count SELECT runs between it and this insert, so the window is
    -- open there too. Hoisting the term out of the arms and applying it to all of
    -- them closes the shape rather than the instance — which is what the arm-by-arm
    -- version invited a second time.
    insert into public.feed_post_tags (post_id, profile_id)
      select v_id, ids.distinct_id
        from (select distinct unnest(p_tag_ids) as distinct_id) ids
       where ids.distinct_id = v_author
          or (
            public.is_mutual_friend(v_author, ids.distinct_id)
            and (
              p_audience = 'friends'
              or exists (
                select 1
                  from public.feed_post_audience fa
                 where fa.post_id = v_id
                   and fa.profile_id = ids.distinct_id
              )
            )
          )
      on conflict do nothing;
  end if;

  select * into v_post from public.feed_posts where id = v_id;
  return v_post;
end;
$$;

comment on function public.publish_feed_post(uuid, text, text, uuid, text, uuid[], uuid, uuid[]) is
  'V8-R-FEED-001 / V8-R-FEED-006. Publishes one Feed destination for a registered media object: takes the same path and row locks reclamation takes, and writes the destination spine row. AUDIENCE (D-C-37): a ''custom'' audience is the caller''s named list intersected with the poster''s mutual friends; a ''group'' audience EQUALS that group''s membership — enumerated server-side from public.group_members, with p_audience_ids ignored — intersected with the poster''s mutual friends, and the poster must be a member of the group they name. An empty intersection raises rather than publishing to nobody.';

revoke all on function public.publish_feed_post(uuid, text, text, uuid, text, uuid[], uuid, uuid[]) from public, anon;
grant execute on function public.publish_feed_post(uuid, text, text, uuid, text, uuid[], uuid, uuid[]) to authenticated;

------------------------------------------------------------------------------
-- 7. Author deletion (V8-R-FEED-002, V8-R-FEED-008)
------------------------------------------------------------------------------

-- Author-only soft delete, plus the destination retirement — the same pairing
-- 0066 added to `delete_story`, and for the same reason: retiring the spine row
-- in a DIFFERENT transaction leaves a window in which the post is dead and its
-- reference is live, and every byte removal attempted in that window is refused
-- and orphaned.
--
-- Its comments go with it and no statement here touches `feed_comments`: they
-- are gated on the post, so the read closes for every reader in the same commit.
-- Deleting them as rows would be a second source of truth for one fact.
--
-- Zero rows means the deletion did NOT happen — not the author, already deleted,
-- or never existed. "A failed deletion must not report success."
create or replace function public.delete_feed_post(p_post_id uuid)
returns table (media_id uuid, bucket_id text, storage_path text, reclaimable boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media uuid;
begin
  if auth.uid() is null then
    raise exception 'delete_feed_post: not authenticated' using errcode = '28000';
  end if;

  update public.feed_posts p
     set deleted_at = now()
   where p.id = p_post_id
     and p.author_id = auth.uid()
     and p.deleted_at is null;

  if not found then
    return;
  end if;

  -- Read the media identity in a SEPARATE, fully qualified statement rather than
  -- through `returning media_id`. This function's OUT parameters are named
  -- `media_id`, `bucket_id` and `storage_path`, and 0066 records what an
  -- unqualified column reference costs when it collides with one of them:
  -- "column reference is ambiguous — every time, for every caller", invisible to
  -- six rounds of reading SQL and raised by the first execution.
  select p.media_id into v_media
    from public.feed_posts p
   where p.id = p_post_id;

  update public.media_destinations d
     set removed_at = now()
   where d.kind = 'feed'
     and d.ref_id = p_post_id::text
     and d.removed_at is null;

  return query
    select m.id,
           m.bucket_id,
           m.storage_path,
           public.media_live_reference_count(m.id) = 0
      from public.media_objects m
     where m.id = v_media;
end;
$$;

comment on function public.delete_feed_post(uuid) is
  'V8-R-FEED-002 / V8-R-FEED-008. Author-only soft delete of a Feed post, retiring its media destination in the SAME transaction so the reference count can fall to zero. Its comments close with it through the read gate. Zero rows = nothing was deleted.';

revoke all on function public.delete_feed_post(uuid) from public, anon;
grant execute on function public.delete_feed_post(uuid) to authenticated;

------------------------------------------------------------------------------
-- 8. Comments (V8-R-FEED-003, V8-R-FEED-005, V8-R-FEED-008)
------------------------------------------------------------------------------

-- "ANYONE AUTHORIZED TO VIEW a Feed post may comment on it" — so the write gate
-- is the read gate, asked through the same predicate, plus this caller's own
-- hide. A caller who reported the post has told the product they do not want to
-- see it; letting them keep replying to it would be a surface the hide does not
-- cover.
create or replace function public.add_feed_comment(
  p_post_id uuid,
  p_body text
)
returns public.feed_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_comment public.feed_comments;
begin
  if v_author is null then
    raise exception 'add_feed_comment: not authenticated' using errcode = '28000';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'add_feed_comment: a comment needs some words'
      using errcode = '22023';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'add_feed_comment: that comment is too long'
      using errcode = '22001';
  end if;

  -- The caller's own hide is inside the gate as of round 9, so the second term
  -- this check used to carry is gone rather than lost.
  if not public.can_view_feed_post(p_post_id) then
    raise exception 'add_feed_comment: that post is not yours to reply to'
      using errcode = '42501';
  end if;

  -- A CEILING ON THE THREAD, and it is the same shape as 0066's report cap
  -- because it bounds the same kind of abuse: a surface every mutual friend can
  -- write to, reachable directly over PostgREST, with no queue in front of it.
  -- SERIALIZED PER AUTHOR, because the ceiling is a read-then-insert and two
  -- concurrent comments would each read the count before either committed.
  -- Deliberately generous: a real person writing two hundred comments in a day
  -- is already extraordinary, so it never reaches ordinary use.
  perform pg_advisory_xact_lock(
    hashtextextended('feed_comment_cap:' || v_author::text, 0)
  );

  if (
    select count(*)
      from public.feed_comments c
     where c.author_id = v_author
       and c.created_at > now() - interval '24 hours'
  ) >= 200 then
    raise exception 'add_feed_comment: too many comments from this account today'
      using errcode = '54000';
  end if;

  -- THE AUTHORIZATION IS RE-ASSERTED BY THE INSERT ITSELF, in one statement with
  -- the write.
  --
  -- The check above is a SEPARATE statement, and at READ COMMITTED it sees an
  -- earlier snapshot than the insert does. Worse, the advisory lock sits between
  -- them: a caller that waits on the cap lock can be blocked by the post's author,
  -- or lose sight of the post entirely, while it waits — and the unconditional
  -- insert then committed a comment the caller was no longer entitled to write,
  -- readable by every other audience member. `insert ... select ... where` closes
  -- that: the predicate and the row land on the same snapshot, and zero rows means
  -- the entitlement went away while we waited.
  --
  -- The earlier check is kept because it is the one that produces the honest error
  -- for the ordinary refusal, before the caller queues on a lock for a write that
  -- was never going to be allowed.
  insert into public.feed_comments (post_id, author_id, body)
    select p_post_id, v_author, v_body
     where public.can_view_feed_post(p_post_id)
  returning * into v_comment;

  if not found then
    raise exception 'add_feed_comment: that post is not yours to reply to'
      using errcode = '42501';
  end if;

  return v_comment;
end;
$$;

comment on function public.add_feed_comment(uuid, text) is
  'V8-R-FEED-003 / V8-R-FEED-005. The right to comment is exactly the right to view: the write gate is can_view_feed_post, which carries the caller''s own report hide, and nothing wider.';

revoke all on function public.add_feed_comment(uuid, text) from public, anon;
grant execute on function public.add_feed_comment(uuid, text) to authenticated;

-- V8-R-FEED-008: "A COMMENTER MAY DELETE THEIR OWN comment. THE POST AUTHOR MAY
-- REMOVE comments from their post." Two rights, one verb, and `deleted_by`
-- records which one was exercised.
--
-- Returns false rather than raising when nothing was deleted, so the caller can
-- state an honest failure; "a failed deletion must not report success".
create or replace function public.delete_feed_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'delete_feed_comment: not authenticated' using errcode = '28000';
  end if;

  update public.feed_comments c
     set deleted_at = now(),
         deleted_by = v_caller
   where c.id = p_comment_id
     and c.deleted_at is null
     and (
       c.author_id = v_caller
       or exists (
         select 1
           from public.feed_posts p
          where p.id = c.post_id
            and p.author_id = v_caller
       )
     );

  return found;
end;
$$;

comment on function public.delete_feed_comment(uuid) is
  'V8-R-FEED-008. The commenter or the post author, and nobody else. False when nothing was deleted, so a refused deletion is never reported as one that happened.';

revoke all on function public.delete_feed_comment(uuid) from public, anon;
grant execute on function public.delete_feed_comment(uuid) to authenticated;

------------------------------------------------------------------------------
-- 9. EC-03 — extending V8-R-FEED-010 to 'feed_post' and 'comment'
------------------------------------------------------------------------------

-- THE INVARIANT, restated from 0066 because this is the migration that has to
-- honour it: the CHECK constraint and `report_content` widen TOGETHER, always. A
-- constraint that admits a kind the function refuses, or a function that accepts
-- a kind the constraint rejects, is the exact defect EC-03 exists to prevent.
--
-- 0066 owns the foundation and the 'story' case; WP6's 0067 owns 'group_message';
-- this file owns 'feed_post' and 'comment'. 0069 applies AFTER both, and it
-- CANNOT SEE 0067. So neither half below is written from what 0066 says — both
-- are derived from whatever is actually installed when this file runs.

-- 9a. THE CONSTRAINT, WIDENED FROM WHAT IS THERE rather than restated.
--
-- Restating it as `in ('story','feed_post','comment','group_message')` would be
-- a guess in both directions: it admits 'group_message' even if 0067 never ran
-- (a vocabulary nothing can satisfy — the defect), and it silently drops any
-- kind a later migration added that this file has never heard of. Reading the
-- installed definition and OR-ing this lane's two kinds onto it is exact in every
-- ordering, including the one where 0067 has not been applied at all.
do $ec03_constraint$
declare
  r record;
  v_defs text := null;
begin
  -- Already widened by a previous run of this file: nothing to do, and a second
  -- pass would nest the expression inside itself.
  if exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.content_reports'::regclass
       and c.conname = 'content_reports_subject_kind_0069'
  ) then
    return;
  end if;

  for r in
    select c.conname as conname, pg_get_constraintdef(c.oid) as condef
      from pg_constraint c
     where c.conrelid = 'public.content_reports'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%subject_kind%'
  loop
    -- `pg_get_constraintdef` renders `CHECK (<expr>)`; keep the expression.
    v_defs := case
                when v_defs is null then substring(r.condef from 7)
                else v_defs || ' and ' || substring(r.condef from 7)
              end;
    execute format('alter table public.content_reports drop constraint %I', r.conname);
  end loop;

  execute format(
    'alter table public.content_reports add constraint content_reports_subject_kind_0069 check (%s)',
    case
      when v_defs is null
        then 'subject_kind in (''feed_post'', ''comment'')'
      else '(' || v_defs || ') or subject_kind in (''feed_post'', ''comment'')'
    end
  );
end
$ec03_constraint$;

comment on table public.content_reports is
  'V8-R-FEED-010. Server-owned; no UPDATE or DELETE is granted to any application role. The subject vocabulary is widened by each lane that can RESOLVE a kind: 0066 story, 0067 group_message, 0069 feed_post and comment — constraint and function always together.';

-- 9b. THE RECORD-KEEPING HALF, factored out so this lane's branch cannot drift
-- from 0066's on bounds, normalisation, the anti-flood index or the daily cap.
--
-- NOT GRANTED TO ANY APPLICATION ROLE. It performs no visibility check at all —
-- that is the caller's job and the whole point of splitting them — so a client
-- able to call it directly could file a report about content it has never been
-- shown, which is precisely what `report_content`'s visibility branch prevents.
create or replace function public.record_content_report(
  p_subject_kind text,
  p_subject_ref text,
  p_reason text
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

  -- AND A CEILING ON THE QUEUE, 0066's, verbatim in effect. It applies to NEW
  -- subjects only: re-reporting writes nothing and must keep returning the
  -- existing id, because the caller hides the content on a returned id and only
  -- on a returned id — a rate limit that made the hide fail would punish the
  -- reporter. SERIALIZED PER REPORTER, because the ceiling is a read-then-insert.
  perform pg_advisory_xact_lock(
    hashtextextended('report_cap:' || auth.uid()::text, 0)
  );

  if not exists (
    select 1
      from public.content_reports cr
     where cr.reporter_id = auth.uid()
       and cr.subject_kind = p_subject_kind
       and cr.subject_ref = lower(btrim(p_subject_ref))
  ) and (
    select count(*)
      from public.content_reports cr
     where cr.reporter_id = auth.uid()
       and cr.created_at > now() - interval '24 hours'
  ) >= 50 then
    raise exception 'report_content: too many reports from this account today'
      using errcode = '54000';
  end if;

  -- THE FIRST REPORT IS THE REPORT: a repeat changes nothing about the stored
  -- row, not even a reason left null the first time. `do update set reason =
  -- <itself>` rather than `do nothing` because DO NOTHING returns no row, the id
  -- would come back null, and the caller treats a null id as a FAILED report and
  -- refuses to hide the content.
  --
  -- NORMALISED, because the shape check upstream is case-insensitive while every
  -- hide site compares against `id::text`, which PostgreSQL renders lowercase.
  insert into public.content_reports (reporter_id, subject_kind, subject_ref, reason)
  values (auth.uid(), p_subject_kind, lower(btrim(p_subject_ref)), p_reason)
  on conflict (reporter_id, subject_kind, subject_ref) do update
     set reason = public.content_reports.reason
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_content_report(text, text, text) is
  'V8-R-FEED-010. The record-keeping half of reporting — daily cap, normalisation, idempotent insert — with NO visibility check. Internal to report_content; granted to no application role, because a caller reaching it directly could report content it was never shown.';

revoke all on function public.record_content_report(text, text, text)
  from public, anon, authenticated;

-- 9c. THE FUNCTION, EXTENDED BY DELEGATION.
--
-- The previous implementation is RENAMED, not replaced, and every kind this lane
-- does not own is handed to it unchanged. That is what makes this safe to apply
-- after WP6's 0067 without having seen it: 0067's 'group_message' branch keeps
-- deciding 'group_message', and 0066's 'story' branch keeps deciding 'story',
-- including their bounds, their refusals and their cap. Rewriting the body from
-- 0066's text would silently un-implement whatever 0067 added — the precise
-- failure EC-03 names.
--
-- The signature is the one thing that has to be stable, and it is: 0066 pins
-- `report_content(text, text, text)` and grants exactly that signature.
do $ec03_rename$
begin
  if to_regprocedure('public.report_content_before_0069(text,text,text)') is null
     and to_regprocedure('public.report_content(text,text,text)') is not null then
    alter function public.report_content(text, text, text)
      rename to report_content_before_0069;
  end if;
end
$ec03_rename$;

-- The renamed function keeps the grant it was created with. Withdraw it: it is
-- now an internal step of the function below, and leaving it callable would
-- leave a second reporting entry point that does not know about this lane's two
-- kinds. The new `report_content` is SECURITY DEFINER, so it still reaches this
-- as the function owner.
do $ec03_revoke$
begin
  if to_regprocedure('public.report_content_before_0069(text,text,text)') is not null then
    execute 'revoke all on function public.report_content_before_0069(text, text, text)'
         || ' from public, anon, authenticated';
  end if;
end
$ec03_revoke$;

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
  v_ref text := lower(btrim(coalesce(p_subject_ref, '')));
  v_id uuid;
begin
  -- NOT THIS LANE'S KIND: hand it back to whichever migration last taught this
  -- function about it, with the arguments exactly as received. Every check that
  -- kind needs lives there.
  if p_subject_kind is distinct from 'feed_post'
     and p_subject_kind is distinct from 'comment' then
    if to_regprocedure('public.report_content_before_0069(text,text,text)') is null then
      raise exception 'report_content: % has no reportable subject in this schema yet',
        p_subject_kind
        using errcode = '22023';
    end if;
    return public.report_content_before_0069(p_subject_kind, p_subject_ref, p_reason);
  end if;

  if auth.uid() is null then
    raise exception 'report_content: not authenticated' using errcode = '28000';
  end if;

  -- BOUNDS, restated rather than borrowed: this branch never reaches the
  -- delegate, so it cannot inherit the delegate's checks.
  if char_length(v_ref) = 0 then
    raise exception 'report_content: subject_ref is required' using errcode = '22023';
  end if;
  if char_length(p_subject_ref) > 200 then
    raise exception 'report_content: subject_ref is too long' using errcode = '22001';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'report_content: reason is too long' using errcode = '22001';
  end if;

  -- A SUBJECT REF IS AN ID, NOT A STRING. Accepting arbitrary text would let one
  -- account mint an unlimited number of distinct "subjects" and walk straight
  -- past the one-report-per-subject index, which is the anti-flood measure.
  if v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'report_content: subject_ref is not an id' using errcode = '22023';
  end if;

  -- YOU MAY ONLY REPORT WHAT YOU CAN SEE, evaluated server-side and honouring
  -- blocks (they are inside `is_mutual_friend`). Reporting is an accusation
  -- against a named account attached to a durable, non-withdrawable operator
  -- record, so a caller who cannot reach the content has no business filing one.
  if p_subject_kind = 'feed_post' then
    -- THE HIDE-FREE SPELLING, and it has to be: `can_view_feed_post` carries the
    -- caller's own reporter hide as of round 9, so asking it here would make the
    -- SECOND report of the same post raise instead of returning the existing id,
    -- and the caller — which hides only on a returned id — would fail to hide it.
    --
    -- Asked as the INTERNAL rule rather than the granted party wrapper: this
    -- function is SECURITY DEFINER, so it executes as the owner and needs no grant.
    if not public.feed_post_visible_to(auth.uid(), v_ref::uuid) then
      raise exception 'report_content: that post is not yours to report'
        using errcode = '42501';
    end if;
  else
    -- AND THE PARENT POST'S OWN HIDE COUNTS HERE. `can_view_feed_comment` leaves
    -- the reporter hide out on purpose, so that RE-reporting the same subject stays
    -- idempotent instead of raising on the second attempt. But the comments read
    -- policy vetoes on `feed_post_reported_by_caller` as well as the comment's own
    -- hide, so once this caller has reported the POST, every comment beneath it is
    -- already gone from their Feed — and accepting a fresh, durable accusation
    -- about content they can no longer see is exactly what "you may only report
    -- what you can see" forbids. The comment's own hide is deliberately NOT part of
    -- this term: that is the idempotent repeat, and it must keep returning the
    -- existing id.
    if not public.can_view_feed_comment(v_ref::uuid)
       or exists (
         select 1
           from public.feed_comments c
          where c.id = v_ref::uuid
            and public.feed_post_reported_by_caller(c.post_id)
       ) then
      raise exception 'report_content: that comment is not yours to report'
        using errcode = '42501';
    end if;
  end if;

  v_id := public.record_content_report(p_subject_kind, v_ref, p_reason);

  -- AND THE ENTITLEMENT IS RE-ASSERTED AFTER THE WRITE, because the write is not
  -- in the same statement as the check and cannot be: `record_content_report` is
  -- shared with the branches this file delegates to, and its insert cannot carry a
  -- predicate only this branch knows.
  --
  -- `record_content_report` takes a per-reporter advisory lock, so a caller can
  -- WAIT inside it — and a block, a deletion, or a report of the parent post
  -- committed during that wait would leave a durable, non-withdrawable accusation
  -- filed by somebody who, by the time it landed, could no longer see the subject.
  -- Re-checking on the latest snapshot and raising rolls the whole transaction
  -- back, insert included. It is not atomic, and the residual window between this
  -- check and COMMIT is inherent to READ COMMITTED; what it removes is the long
  -- window, the one with a lock wait in it.
  if p_subject_kind = 'feed_post' then
    -- Hide-free for the same idempotency reason as the pre-write check, and
    -- internal for the same grant reason: the row this transaction just wrote is
    -- the caller's OWN report, and consulting the hide here would make every first
    -- report roll itself back.
    if not public.feed_post_visible_to(auth.uid(), v_ref::uuid) then
      raise exception 'report_content: that post stopped being yours to report'
        using errcode = '42501';
    end if;
  elsif not public.can_view_feed_comment(v_ref::uuid)
     or exists (
       select 1
         from public.feed_comments c
        where c.id = v_ref::uuid
          and public.feed_post_reported_by_caller(c.post_id)
     ) then
    raise exception 'report_content: that comment stopped being yours to report'
      using errcode = '42501';
  end if;

  return v_id;
end;
$$;

comment on function public.report_content(text, text, text) is
  'V8-R-FEED-010, extended by 0069 to feed_post and comment. Every other subject kind is delegated UNCHANGED to the implementation this file renamed, so 0066''s story branch and 0067''s group_message branch keep deciding their own kinds. The caller hides the content ONLY on a returned id.';

revoke all on function public.report_content(text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text) to authenticated;

------------------------------------------------------------------------------
-- 10. The Feed photo has to be signable by its audience
------------------------------------------------------------------------------

-- WITHOUT THIS THE FEED HAS NO PHOTOS FOR ANYONE BUT ITS AUTHOR, and the
-- requirement would be discharged by a card with an empty frame.
--
-- `media_read_window` (0066) is the single authorization the media URL route
-- asks before it mints with service role, and every branch it carries is about
-- STORIES: the owner's own prefix, or a live story whose audience the caller is
-- in. A Feed post is a different destination for the same bytes, so an audience
-- member reading a Feed card is refused — correctly, by a function that has
-- simply never been told Feed exists.
--
-- EXTENDED BY DELEGATION, exactly as section 9c extends reporting, and for the
-- same reason: 0067 may have widened this too, and this file cannot see it. The
-- previous implementation decides first and its answer is final when it says
-- YES; only a refusal falls through to the Feed branch.
--
-- NULL EXPIRY IS CORRECT HERE, not a missing value. V8-R-FEED-002 gives a Feed
-- post no expiry, and `serverTtlSeconds` already reads null as "no expiry of its
-- own, so only the ceiling applies" — the same shape 0066's owner branch returns
-- for an object no story references yet.
do $feed_window_rename$
begin
  if to_regprocedure('public.media_read_window_before_0069(text)') is null
     and to_regprocedure('public.media_read_window(text)') is not null then
    alter function public.media_read_window(text)
      rename to media_read_window_before_0069;
  end if;
end
$feed_window_rename$;

do $feed_window_revoke$
begin
  if to_regprocedure('public.media_read_window_before_0069(text)') is not null then
    execute 'revoke all on function public.media_read_window_before_0069(text)'
         || ' from public, anon, authenticated';
  end if;
end
$feed_window_revoke$;

create or replace function public.media_read_window(p_name text)
returns table (readable boolean, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_prior record;
  v_feed_readable boolean;
begin
  if v_caller is null or p_name is null then
    return query select false, null::timestamptz;
    return;
  end if;

  -- THE FEED ANSWER, COMPUTED ONCE. It is both the fallback branch at the bottom
  -- and the thing the veto below has to consult, and writing it twice is how the
  -- two spellings drift.
  v_feed_readable := exists (
    select 1
      from public.feed_posts p
      join public.media_objects m on m.id = p.media_id
     where m.storage_path = p_name
       and m.bytes_removed_at is null
       -- "Visible AND unreported to this caller" is what `can_view_feed_post` now
       -- means on its own (round 9). The second term this line used to carry was
       -- the same predicate spelled again.
       and public.can_view_feed_post(p.id)
  );

  if to_regprocedure('public.media_read_window_before_0069(text)') is not null then
    select w.readable, w.expires_at
      into v_prior
      from public.media_read_window_before_0069(p_name) w
     limit 1;

    -- A yes is FINAL, with ONE exception this file is entitled to make because
    -- the previous decision could not have made it: 0066 knows nothing about
    -- feed_posts, so its owner branch answers "yes, unbounded" for a FEED-ONLY
    -- media object on the caller's own prefix — that is its upload-before-publish
    -- window, and it cannot tell that the bytes are in fact published to a Feed
    -- post the caller has since REPORTED. 0066 states the rule this restores in
    -- its own words: "THE HIDE APPLIES TO THE AUTHOR TOO ... with no exception
    -- for the reporter also being the author."
    --
    -- The veto is deliberately narrow, so it can never hide a story and never
    -- hides bytes something the caller CAN still see is standing on:
    --   * it requires a live Feed post, still holding its media destination,
    --     naming these bytes, that THIS caller reported;
    --   * it requires that NO OTHER Feed post naming these bytes is visible and
    --     unreported to this caller — the ALL-UNREPORTED half 0066's story
    --     analogue carries. One media object may hold several live Feed
    --     destinations (`media_destinations_live_uniq` is on
    --     (media_id, kind, ref_id)), so reporting post A used to blank post B's
    --     photo for its own owner, and the branch that would have authorised B
    --     sits AFTER this return and could never be reached; and
    --   * it requires that NO live story names these bytes at all; and
    --   * it requires that the prior YES was the UNBOUNDED one.
    -- When a story does name them, 0066 has already applied its own reporter
    -- rule (`media_path_unreported_live_expiry`, plus the all-reported check
    -- below it) and whatever it decided stands untouched.
    --
    -- WHY `v_prior.expires_at IS NULL` AND NOT A LIST OF DESTINATION KINDS.
    -- Three rounds of review found three defects in one term, each a different
    -- kind mis-classified: `kind <> 'feed'` counted an ARCHIVE retention hold as
    -- somewhere the photo is visible; `kind not in ('feed','archive')` counted an
    -- EXPIRED story's spine row, because 0066 never stamps `removed_at` on a story
    -- destination and expresses expiry passively through `expires_at`; and either
    -- form counted a live GROUP destination whose visibility to THIS caller only
    -- WP6 can judge. The cause is not the list. It is that 0069 was trying to
    -- re-derive, from another lane's rows, a question the previous implementation
    -- has already answered.
    --
    -- So ask the previous answer instead. 0066's owner branch returns
    -- `true, NULL` for the upload-before-publish window — an object whose bytes
    -- nothing it knows about is standing on — and returns an EXPIRY whenever the
    -- yes is backed by something live it can see. A null expiry on a readable
    -- prior answer is therefore exactly, and only, the case this file is entitled
    -- to correct: the owner's own unbounded window over bytes whose sole Feed
    -- destination they have reported. Anything with a live backing keeps its
    -- expiry, the veto does not fire, and that surface is left alone.
    --
    -- AND THE DESTINATION TERM IS BACK ALONGSIDE IT, because the discriminator is
    -- necessary and not sufficient. A null expiry says the prior answer was
    -- unbounded; it does NOT say nothing else is standing on the bytes. An owner
    -- whose media is live in a group destination AND in a reported Feed post gets
    -- `(true, null)` from 0066's owner branch, and the discriminator alone would
    -- then blank a group photo they can still legitimately see.
    --
    -- So both, and the destination term now carries 0066's OWN liveness rule
    -- rather than a fourth hand-rolled one: `removed_at is null` is not liveness
    -- for a story, because story expiry is passive and 0066 never stamps
    -- `removed_at` on a story spine row — `media_live_reference_count` compensates
    -- with exactly the `kind <> 'story' or exists (live story)` clause copied here.
    -- 'archive' is excluded because 0066 calls it "a retention HOLD, not a
    -- destination a user can see or remove" and `remove_media_destination` skips
    -- it for that reason.
    --
    -- THE RESIDUAL, STATED PRECISELY, because the previous wording was wrong about
    -- which migrations it concerned and would have pointed the integration check
    -- at the wrong place:
    --   * It is NOT only "a later migration". WP6's 0067 is ALREADY inside the
    --     delegated chain — `media_read_window_before_0069` is whatever 0066 and
    --     0067 installed — and this lane cannot read 0067 to verify what its
    --     branch returns. The discriminator's safety property is verified against
    --     0066's body alone.
    --   * What remains unknowable here: whether a live destination of a kind this
    --     file does not own is VISIBLE TO THIS CALLER. Only that lane can answer
    --     it. The terms below therefore stand the veto down whenever any such
    --     destination is live, which fails OPEN on the hide (the reported post is
    --     hidden regardless; only the bytes stay signable) rather than fails
    --     closed onto a surface 0069 has no authority over.
    -- Both belong in the integration check, against the chain as actually
    -- installed, not against this file.
    if v_prior.readable
       and v_prior.expires_at is null
       and not v_feed_readable
       and exists (
         select 1
           from public.feed_posts p
           join public.media_objects m on m.id = p.media_id
          where m.storage_path = p_name
            and p.deleted_at is null
            -- A post whose Feed destination was already retired through
            -- `remove_media_destination` is not on the Feed any more, so its
            -- report has nothing left to hide and must not veto the owner's own
            -- upload window. `deleted_at` alone missed that whole half.
            and public.feed_post_destination_is_live(p.id)
            and public.feed_post_reported_by_caller(p.id)
       )
       and not exists (
         select 1
           from public.stories s
          where (s.media_path = p_name or s.inset_path = p_name)
            and s.deleted_at is null
            and s.expires_at > now()
       )
       and not exists (
         select 1
           from public.media_destinations d
           join public.media_objects m on m.id = d.media_id
          where m.storage_path = p_name
            and d.kind not in ('feed', 'archive')
            and d.removed_at is null
            -- 0066's own liveness rule, copied rather than re-derived: a story
            -- destination row is never retired, so `removed_at is null` alone
            -- counts an expired story as somewhere the photo still lives.
            -- 0066's own liveness rule, copied rather than re-derived: a story
            -- destination row is never retired, so `removed_at is null` alone
            -- counts an expired story as somewhere the photo still lives.
            and (
              d.kind <> 'story'
              or exists (
                select 1
                  from public.stories s2
                 where s2.id::text = d.ref_id
                   and s2.deleted_at is null
                   and s2.expires_at > now()
              )
            )
       )
    then
      return query select false, null::timestamptz;
      return;
    end if;

    if v_prior.readable then
      return query select v_prior.readable, v_prior.expires_at;
      return;
    end if;
  end if;

  -- THE FEED BRANCH. A live, visible, unreported Feed post whose media object
  -- names these bytes — `v_feed_readable`, computed above. `can_view_feed_post`
  -- is the same predicate the RLS policy uses, so a viewer cannot be shown a
  -- photo for a card they cannot read, and the reporter hide reaches the BYTES as
  -- well as the row — 0066 records why that matters: "hiding the caption while
  -- the image still loads" does not satisfy "reporting IMMEDIATELY HIDES the
  -- reported content".
  if v_feed_readable then
    return query select true, null::timestamptz;
    return;
  end if;

  return query select false, null::timestamptz;
end;
$$;

comment on function public.media_read_window(text) is
  'V8-R-STO-015 / V8-R-FEED-001. 0066''s read decision, extended by 0069 with the Feed destination. The previous implementation is asked FIRST and its yes is final; only its refusal falls through, so no story, block or expiry rule it carries is restated or lost. A Feed post has no expiry, so its window is null — the signed-URL ceiling alone.';

revoke all on function public.media_read_window(text) from public, anon;
grant execute on function public.media_read_window(text) to authenticated;
