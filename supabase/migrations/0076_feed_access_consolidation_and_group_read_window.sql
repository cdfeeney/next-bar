-- 0076 — the Feed audience consolidation and the group read window, forward.
--
-- WHY A NEW FILE AND NOT AN EDIT. Phase C applied 0033–0074 to production on
-- 2026-08-31, taking each file from `release/v8`. WP5 and WP6 were at that moment
-- inside frozen review cycles that had begun before phase C existed, and both were
-- delivering their last fixes by editing an already-numbered migration in place.
-- Once production applied those files their bytes were fenced by
-- `public.schema_migrations`, and the in-place edit stopped being available. The
-- lanes were entitled to assume 0069 and 0067 had never run anywhere; this file is
-- the same work, stated forward. NOTHING THE LEDGER NAMES IS TOUCHED.
--
-- RELEASE BLOCKER. Production is running the PRE-consolidation Feed policies. The
-- three round-8 CRITICALs WP5 answered in round 9 are live in the production
-- schema; they are not exploitable only because the app is undeployed.
--
-- ============================================================================
-- WHAT THIS FILE CARRIES
--
-- 1. WP5 round 9 — ONE definition of the Feed audience rule (0069's delta).
--    Round 8 returned three CRITICALs against three different Feed surfaces and
--    the operator's directive named them as ONE defect: access was checked
--    per-policy, so each surface re-derived who may see a post and the copies
--    drifted. The consolidation gives the rule a VIEWER PARAMETER — which is what
--    the three surfaces needed and could not express — and retires
--    `is_feed_post_recipient`, a granted SECURITY DEFINER membership oracle.
--
-- 2. WP6 round 9 — a live group message must not hand back a story's clock
--    (0067's delta), PLUS the branch it patches, because that branch is no longer
--    in the applied schema. See the next block: this is a discovery, not scope
--    creep, and it is the one thing here that ADDS a ground to read.
--
-- 0066 NEEDS NOTHING. Its 68-line delta runs the other way — the APPLIED copy is
-- ahead, carrying the 2026-08-28 reorder. Do not "restore" the lane copy.
--
-- ============================================================================
-- DISCOVERED WHILE WRITING THIS FILE — 0068 DELETED 0067'S GROUP BRANCH.
--
-- The goal this file implements describes the 0067 half as a 16-line change to
-- "two terminal branches of `media_read_window`". THOSE BRANCHES DO NOT EXIST IN
-- THE APPLIED SCHEMA. Measured on the committed files:
--
--   0066  defines media_read_window  (stories + owner prefix)
--   0067  REPLACES it, adding the group branch      — 5 uses of v_group_readable
--   0068  REPLACES it from 0066's body + Night Out  — 0 uses of v_group_readable
--   0069  renames it to media_read_window_before_0069 and wraps it for the Feed
--
-- 0068's own header says "REPLACED FORWARD, body preserved. Everything 0066
-- decided is unchanged" — written by a parallel lane that had never read 0067. So
-- since 0068, a group photo is readable by ITS UPLOADER ONLY (through the owner
-- prefix branch, and only while a live story also names the bytes); every other
-- member of the group gets a refusal for a photo sitting in their own thread.
-- V8-R-GRP-002 is currently "members send photos nobody can see".
--
-- The window fix is not expressible without the branch it clamps, so this file
-- carries both. It is stated here rather than buried because it is the only
-- change in this migration that WIDENS access, and a reviewer is entitled to
-- judge it as such. It widens nothing beyond `group_message_is_visible`, which is
-- 0067's own single definition of "this caller may see this group message" and is
-- unchanged by this file.
--
-- ============================================================================
-- SHAPE ONLY. This file has never been executed against any database. Every claim
-- below is about TEXT. The live RLS proof — staging first, then production, each
-- with its own operator consent — belongs to the attended integration gate.
--
-- ROLLBACK. There is no clean revert: 0069's `is_feed_post_recipient` is dropped
-- here and the policies are rewritten over the new gate. To roll back, re-apply
-- 0069's sections 3 and 4 and 0067's section 8 as a new migration numbered above
-- this one, and re-create `is_feed_post_recipient` from 0069. Do not `drop` the
-- functions this file adds while any policy still names them.
-- ============================================================================


------------------------------------------------------------------------------
-- 1. The reporter hide, written once and viewer-parametrised
------------------------------------------------------------------------------
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
------------------------------------------------------------------------------
-- 2. The Feed audience gate: one rule, viewer-parametrised
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


------------------------------------------------------------------------------
-- 3. The hide-free question, party-guarded
------------------------------------------------------------------------------

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


------------------------------------------------------------------------------
-- 4. The comment gate
------------------------------------------------------------------------------

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
-- 5. Row level security — every Feed surface asks the one gate
------------------------------------------------------------------------------

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
-- 6. The retired audience oracle
------------------------------------------------------------------------------

-- LAST, and after every policy above has been redefined: nothing references it
-- by the time this runs. `is_feed_post_recipient` was SECURITY DEFINER, granted to
-- `authenticated`, took a caller-supplied post id, and its only guard was "answer
-- about your own id" — which is not a guard for a MEMBERSHIP question. A recipient
-- who saw a post while authorised keeps its uuid, and after unfollowing the author,
-- being blocked, reporting the post, or the author deleting it, could still call
-- `is_feed_post_recipient(postId, self)` over PostgREST and read `true` off a
-- materialised row no other surface would show them any more (round 8, CRITICAL,
-- codex). Its job moved inside `feed_post_visible_to`, which is granted to nobody,
-- so the function itself goes: what does not exist cannot be granted back.
drop function if exists public.is_feed_post_recipient(uuid, uuid);


------------------------------------------------------------------------------
-- 7. Commenting: the write gate is the read gate
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


------------------------------------------------------------------------------
-- 8. Reporting asks the HIDE-FREE rule, or every first report rolls itself back
------------------------------------------------------------------------------

-- WHY THIS REDEFINES `report_content_before_0075` AND NOT `report_content`.
--
-- 0075 renamed the then-current implementation aside to
-- `report_content_before_0075` and installed a wrapper that answers a REPEAT report
-- from the stored row before delegating everything else. The visibility checks this
-- section corrects live in the renamed implementation, so that is what is replaced;
-- `create or replace`-ing `report_content` here would delete 0075's fix.
--
-- WHAT CHANGES, AND WHY IT IS NOT OPTIONAL. Both checks asked
-- `can_view_feed_post`, which as of section 2 CARRIES the caller's own reporter
-- hide. The post-write re-check runs AFTER `record_content_report` has written the
-- caller's report, so the hide is true by then and EVERY FIRST REPORT WOULD ROLL
-- ITSELF BACK. Both sites now ask `feed_post_visible_to` — the rule without the
-- hide — and they ask the INTERNAL spelling rather than the granted party wrapper,
-- because this function is SECURITY DEFINER and holds EXECUTE as the owner
-- regardless. Routing it through a grantable entry point is exactly what forced
-- that wrapper's guard wide enough to become an oracle (round 9, CRITICAL, codex).
--
-- 0075's repeat short-circuit does NOT cover this: it spares repeats, and the
-- rollback above happens on a FIRST report.
do $ec76_precondition$
begin
  if to_regprocedure('public.report_content_before_0075(text,text,text)') is null then
    raise exception '0076 expects 0075 to have applied first: public.report_content_before_0075 is absent'
      using errcode = '42883';
  end if;
end
$ec76_precondition$;

create or replace function public.report_content_before_0075(
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

comment on function public.report_content_before_0075(text, text, text) is
  'V8-R-FEED-010, extended by 0069 to feed_post and comment, corrected by 0076 to ask the HIDE-FREE rule on both the pre-write and the post-write check. Reached only through the 0075 wrapper, which owns the repeat short-circuit; it is deliberately not granted to any application role.';

-- Not re-granted. 0075 revoked it on purpose: it is an internal step of
-- `report_content`, and a callable copy would be a reporting entry point that
-- skips 0075's repeat check.
revoke all on function public.report_content_before_0075(text, text, text) from public, anon, authenticated;


------------------------------------------------------------------------------
-- 9. The media read window: the Feed hide, and 0067's group branch restored
------------------------------------------------------------------------------

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
  v_group_readable boolean := false;
begin
  if v_caller is null or p_name is null then
    return query select false, null::timestamptz;
    return;
  end if;

  -- THE GROUP ANSWER, COMPUTED ONCE, AND 0067'S BRANCH RESTORED (see this file's
  -- header). 0067 added a group branch to this function; 0068 replaced the whole
  -- function from 0066's body and dropped it, so in the applied schema a group
  -- photo is refused to every member who is not its uploader. The query is 0067's,
  -- verbatim: joined through `media_objects` because `group_messages.media_id` is
  -- a registry id and never a path, and gated by `group_message_is_visible`, which
  -- is 0067's single definition of "this caller may see this group message".
  select exists (
    select 1
      from public.group_messages msg
      join public.media_objects mo on mo.id = msg.media_id
     where mo.storage_path = p_name
       and mo.bucket_id = 'story-media'
       and msg.deleted_at is null
       and public.group_message_is_visible(msg.id)
       -- AND THE MESSAGE'S GROUP DESTINATION MUST NOT HAVE BEEN RETIRED.
       -- 0067's query stopped at `deleted_at is null`, which is the message's
       -- OWN liveness and not the destination's. `remove_media_destination`
       -- (0066) is a second, granted removal path: it stamps `removed_at` on
       -- the kind='group' spine row and — unlike its story branch, which
       -- soft-deletes the story — leaves `group_messages` completely untouched.
       -- So after an owner removes a photo from a group destination, the
       -- message row is still live and still visible to every member, and this
       -- branch would keep minting signed URLs for bytes the owner was told had
       -- been removed. `delete_group_message` and the hard-delete trigger both
       -- stamp the same row, so this term also agrees with them.
       --
       -- Written as "live, or never minted" rather than "a live row exists":
       -- `send_group_message` always writes the spine row, but a message that
       -- predates it — or any row this file cannot see — must not be blanked by
       -- the absence of a destination it never had. Only an actual retirement
       -- withdraws the authorization.
       and (
         not exists (
           select 1
             from public.media_destinations d
            where d.media_id = msg.media_id
              and d.kind = 'group'
              and d.ref_id = msg.id::text
         )
         or exists (
           select 1
             from public.media_destinations d
            where d.media_id = msg.media_id
              and d.kind = 'group'
              and d.ref_id = msg.id::text
              and d.removed_at is null
         )
       )
  ) into v_group_readable;

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
    --     'group' IS NO LONGER ONE OF THOSE KINDS. This function computes the
    --     group answer itself as `v_group_readable`, so for that one kind the
    --     question is not unknowable and the fail-open concession is not owed —
    --     see the exclusion on the destination term and `not v_group_readable`
    --     below, which is the term that actually decides it.
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
            -- 'group' IS EXCLUDED HERE, and it is the one kind whose exclusion
            -- is not a judgement about liveness. The residual stated above —
            -- "whether a live destination of a kind this file does not own is
            -- VISIBLE TO THIS CALLER" — does not apply to 'group', because this
            -- function now computes that exact answer itself, once, as
            -- `v_group_readable`, and the final `and not v_group_readable` term
            -- below is what owns it. Leaving 'group' in this generic list made
            -- that final term UNREACHABLE: any live group spine row stood the
            -- whole veto down before it could be consulted, so an author who had
            -- left the group kept a signable URL for a Feed post they had
            -- reported. Two terms answering the same question, one of them
            -- blind, is how the veto lost the promise it states.
            and d.kind not in ('feed', 'archive', 'group')
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
       -- A GROUP MESSAGE THIS CALLER CAN SEE IS NOT A DESTINATION THIS VETO OWNS.
       -- The destination term above stands the veto down for a live `group` row in
       -- `media_destinations`, but a group message references the media registry
       -- directly and need not have minted a destination row at all. Asking the
       -- group answer itself is the term that cannot be walked around, and it keeps
       -- the veto's stated promise: it may blank the owner's own upload window over
       -- a post they reported, never a surface they can still legitimately see.
       and not v_group_readable
    then
      return query select false, null::timestamptz;
      return;
    end if;

    -- ROUND 9 OF WP6, CARRIED FORWARD HERE: A LIVE GROUP MESSAGE OUTRANKS A
    -- STORY'S CLOCK. 0067 fixed this inside its own two terminal branches, which
    -- 0068 then deleted along with the rest of the branch; on the delegating shape
    -- the same rule is one clamp over the delegate's answer, and it covers every
    -- branch the delegate can return from rather than the two 0067 could reach.
    --
    -- A group destination has no expiry of its own — V8-R-GRP-007's retention is
    -- "messages persist until removed or the group is deleted; there is no
    -- automatic expiry" — so handing back the STORY's expiry capped the signed URL
    -- at whatever the story had left, which is near zero once the story is about to
    -- lapse. The photo then rendered as unavailable in a thread whose retention has
    -- no clock at all. null is how "no expiry of its own" is spelled here.
    if v_prior.readable and v_group_readable then
      return query select true, null::timestamptz;
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

  -- THE GROUP BRANCH. 0067's viewer answer: the read is authorised by the group
  -- message, not by a timestamp, and its window is unbounded. Reached only when the
  -- delegate refused — which is what a member who is not the uploader gets, because
  -- nothing in the delegated chain has known about groups since 0068.
  if v_group_readable then
    return query select true, null::timestamptz;
    return;
  end if;

  return query select false, null::timestamptz;
end;
$$;

comment on function public.media_read_window(text) is
  'V8-R-STO-015 / V8-R-FEED-001 / V8-R-GRP-002. 0066''s read decision, extended by 0069 with the Feed destination and by 0076 with 0067''s group-message destination, which 0068 dropped. The previous implementation is asked FIRST and its yes is final; only its refusal falls through, so no story, block or expiry rule it carries is restated or lost. A Feed post has no expiry, so its window is null — the signed-URL ceiling alone.';

revoke all on function public.media_read_window(text) from public, anon;
grant execute on function public.media_read_window(text) to authenticated;
