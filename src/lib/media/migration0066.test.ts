import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Two of this lane's requirements are discharged ENTIRELY in SQL, and nothing
 * in the local gate executes SQL — typecheck, vitest and the Playwright release
 * run are all green over a migration that never parsed, which is the exact
 * failure `scripts/migration-dollar-quote.test.ts` was written for after 0065.
 *
 * So these are text assertions, and they are deliberately narrow: each one pins
 * a clause that, if it were dropped, would silently un-implement a requirement
 * while every other check stayed green.
 *
 *   V8-R-CMP-012  bytes are not removable while a live reference exists
 *   V8-R-STO-016  audience and tag metadata stop being queryable after deletion
 *   V8-R-FEED-009 the block check is bidirectional
 *   V8-R-FEED-010 the report record is server-owned
 *
 * A text scan is not a substitute for applying the migration against a
 * database. It is the strongest check available in a lane that is forbidden
 * from touching a shared one.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '0066_media_boundary.sql'),
  'utf8',
);

/**
 * Comments are STRIPPED before anything below is asserted.
 *
 * This file's header comments quote the requirements verbatim, so a scan of the
 * raw text matches its own prose: the first version of the grant assertion
 * below failed on "...no write grant... a client that can insert its own media
 * row... on public.media_objects", which is a sentence, not a statement. That
 * cuts both ways and the false-negative was the lucky half — every positive
 * assertion here would equally have passed on a comment that merely DESCRIBED
 * the clause, so a migration could have lost a policy and stayed green.
 *
 * No string literal in this migration contains `--`, so a line-wise strip is
 * exact rather than approximate.
 */
const STATEMENTS = SQL
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

/** Collapse whitespace so an assertion is about the clause, not its wrapping. */
const FLAT = STATEMENTS.replace(/\s+/g, ' ');

describe('0066 — V8-R-CMP-012 bytes outlive nothing but their last reference', () => {
  it('gates the storage DELETE policy on the reference count', () => {
    expect(FLAT).toContain(
      'and not public.media_path_has_live_reference(\'story-media\', name)',
    );
  });

  it('keeps 0065 prefix scoping, so a delete cannot reach another user', () => {
    expect(FLAT).toContain('(storage.foldername(name))[1] = auth.uid()::text');
  });

  it('counts references with a definer function, not through the caller\'s RLS', () => {
    // A caller-visible count reports zero for references it merely cannot see,
    // and zero is what authorizes destroying the bytes.
    expect(FLAT).toMatch(
      /create or replace function public\.media_live_reference_count\(p_media_id uuid\).*?security definer/i,
    );
  });

  it('locks the media row before counting, so a concurrent add cannot be missed', () => {
    expect(FLAT).toContain('for update of m');
  });

  it('leaves archive holds standing when deleting everywhere', () => {
    // V8-R-CMP-016: bytes are reclaimed only if no Saved Nights Out archive
    // still references them.
    expect(FLAT).toContain("and d.kind <> 'archive'");
  });

  // A hold the owner can strip is not a hold. Without this clause the owner
  // reads the archive row's id through the owner SELECT policy, passes it to
  // remove_media_destination, and reclaims the bytes V8-R-CMP-016 retains.
  it('refuses to remove an archive hold through the single-destination verb', () => {
    expect(FLAT).toContain(
      "where d.id = p_destination_id and d.kind <> 'archive' and m.owner_id = auth.uid()",
    );
  });

  // Nothing retires a story destination when the story EXPIRES — delete_story
  // covers deletion only. Counting the row itself would hold expired bytes
  // forever AND make the DELETE policy refuse the cleanup meant to free them.
  it('does not count a story destination whose story is dead or expired', () => {
    expect(FLAT).toContain(
      "d.kind <> 'story' or exists ( select 1 from public.stories s"
      + ' where s.id::text = d.ref_id and s.deleted_at is null and s.expires_at > now() )',
    );
  });

  // A LIVE STORY IS A DESTINATION. Retiring only the spine row left the story
  // showing the photo, its audience and tag rows queryable against
  // V8-R-STO-016, and the reference count permanently above zero — a delete
  // that cannot complete rather than a partial delete honestly reported.
  // Author-scoped: both verbs already established the caller owns the media.
  it('closes the story destination itself, not just its spine row', () => {
    expect(FLAT).toContain(
      'update public.stories s set deleted_at = now() from public.media_objects m'
      + ' where m.id = v_media and s.author_id = auth.uid()',
    );
    expect(FLAT).toContain(
      'update public.stories s set deleted_at = now() from public.media_destinations d'
      + " where d.id = p_destination_id and d.kind = 'story'",
    );
  });

  // publish_story predates this spine and still does not write to it, so for
  // every story published outside the media route the spine is EMPTY. A
  // spine-only count reads zero for a photo two live stories are showing, and
  // zero is the licence to destroy the bytes.
  it('counts a live story that references the object without a spine row', () => {
    expect(FLAT).toContain(
      'join public.stories s on (s.media_path = m.storage_path'
      + ' or s.inset_path = m.storage_path)',
    );
    expect(FLAT).toContain(
      "p_bucket = 'story-media' and exists ( select 1 from public.stories s"
      + ' where (s.media_path = p_name or s.inset_path = p_name)',
    );
  });
});

describe('0066 — V8-R-STO-014/015 the client cannot reach the bucket directly', () => {
  // While 0065's INSERT policy stood, a modified client uploaded EXIF-bearing
  // bytes straight into its own prefix and published them; the server re-encode
  // was optional, and an optional strip is not a trust boundary.
  it('revokes the authenticated write grant on story-media', () => {
    expect(FLAT).toContain(
      'drop policy if exists "story-media: owner writes own prefix" on storage.objects',
    );
    expect(FLAT).not.toMatch(
      /create policy "story-media: owner writes own prefix"/i,
    );
  });

  // While SELECT stood, any authorised viewer called createSignedUrl(path,
  // 86400) for themselves and the route's server-decided TTL was a suggestion.
  it('revokes both authenticated read grants on story-media', () => {
    expect(FLAT).toContain(
      'drop policy if exists "story-media: owner reads own prefix" on storage.objects',
    );
    expect(FLAT).toContain(
      'drop policy if exists "story-media: audience reads referenced" on storage.objects',
    );
    expect(FLAT).not.toMatch(/create policy "story-media: owner reads own prefix"/i);
    expect(FLAT).not.toMatch(/create policy "story-media: audience reads referenced"/i);
  });

  // The read decision the dropped policies made has to survive somewhere, or
  // the route mints with service role for anyone who reaches it.
  it('moves the read decision into a definer function the route must ask', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.media_read_window\(p_name text\).*?security definer/i,
    );
    expect(FLAT).toContain(
      'grant execute on function public.media_read_window(text) to authenticated',
    );
  });

  it('keeps 0065\'s rule that an author cannot sign their own dead media', () => {
    expect(FLAT).toContain('if public.story_media_is_dead(p_name) then');
  });

  it('carries the audience terms the dropped viewer policy had', () => {
    expect(FLAT).toContain('public.is_mutual_friend(v_caller, s.author_id)');
    expect(FLAT).toContain(
      "s.audience = 'friends' or public.is_story_recipient(s.id, v_caller)",
    );
  });

  // The window and the permission have to come from the SAME rows. Computed
  // apart, a viewer authorised through a story with two minutes left could be
  // handed a lifetime borrowed from a destination they cannot read at all.
  it('returns the window with the permission, from the rows that granted it', () => {
    expect(FLAT).toContain('returns table (readable boolean, expires_at timestamptz)');
    expect(FLAT).toContain('return query select v_expiry is not null, v_expiry');
  });

  // publish_story writes no spine row and upload-before-publish cannot name a
  // story that does not exist yet, so a window read from media_destinations is
  // empty for every normally published and every legacy story photo.
  it('reads the window from stories, which is where the expiry actually lives', () => {
    expect(FLAT).toContain(
      'select max(s.expires_at) into v_expiry from public.stories s'
      + ' where (s.media_path = p_name or s.inset_path = p_name)',
    );
  });
});

describe('0066 — V8-R-STO-016 deletion clears metadata too', () => {
  it('gates story_audience reads on the story still being live', () => {
    expect(FLAT).toContain('and public.is_story_live(story_id)');
  });

  it('gates story_tags reads on the story still being live', () => {
    expect(FLAT).toContain(
      'create policy "story_tags: readable with story" on public.story_tags for select using ( public.is_story_live(story_id)',
    );
  });

  // is_story_live is SECURITY DEFINER, so on its own it is true for every
  // authenticated caller. Liveness had to be ADDED to 0065's audience-scoped
  // test, not substituted for it, or the migration meant to narrow tag reads
  // would have published every live private story's tag list.
  it('keeps the caller-scoped audience term on story_tags, not liveness alone', () => {
    expect(FLAT).toContain(
      'using ( public.is_story_live(story_id) and ( auth.uid() = profile_id'
      + ' or exists (select 1 from public.stories s where s.id = story_id) ) )',
    );
  });

  it('replaces both 0065 policies rather than adding a second, weaker one', () => {
    expect(FLAT).toContain('drop policy if exists "story_audience: parties read"');
    expect(FLAT).toContain('drop policy if exists "story_tags: readable with story"');
  });

  it('checks liveness with a definer helper, avoiding 0065\'s recursion trap', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.is_story_live\(p_story_id uuid\).*?security definer/i,
    );
  });

  it('retires story destinations inside delete_story, not in a client', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.delete_story.*?update public\.media_destinations d set removed_at = now\(\) where d\.kind = 'story'/i,
    );
  });
});

describe('0066 — V8-R-FEED-009 blocking is enforced both ways', () => {
  it('matches a block in either direction', () => {
    expect(FLAT).toContain(
      'where (pb.blocker_id = a and pb.blocked_id = b) or (pb.blocker_id = b and pb.blocked_id = a)',
    );
  });

  // "SERVER-ENFORCED IN BOTH DIRECTIONS" needs a consumer. A helper that
  // nothing calls is a recorded intention: a blocked viewer holding an audience
  // row kept passing the friendship check and kept receiving signed URLs.
  // Enforcement lives in the SHARED predicate. Blocking deletes no follows
  // edge, so every rule 0065 keyed on mutuality kept passing for a blocked
  // pair: the stories SELECT policy still returned the blocker's metadata, and
  // publish_story still let either party name or TAG the other. Putting the
  // term inside is_mutual_friend fixes all four call sites at once, and the
  // fifth somebody adds later.
  it('makes a blocked pair fail the mutual-friend predicate everything asks', () => {
    expect(FLAT).toContain('and not public.is_blocked_between(a, b)');
    expect(FLAT).toMatch(
      /create or replace function public\.is_mutual_friend\(a uuid, b uuid\).*?security definer/i,
    );
  });

  it('answers as definer, so the blocked party cannot read past it', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.is_blocked_between\(a uuid, b uuid\).*?security definer/i,
    );
  });

  // SECURITY DEFINER is exactly what lets this function see a row the policy
  // hides, so without a caller check it is a pairwise oracle over private block
  // data. 0065 gave is_mutual_friend the same guard for the same reason.
  it('refuses a caller asking about two other people', () => {
    expect(FLAT).toContain(
      "raise exception 'is_blocked_between: a caller may only ask about itself'",
    );
    expect(FLAT).toContain('if v_caller is not null and v_caller <> a and v_caller <> b then');
  });

  // is_mutual_friend covers everything that reads or publishes a story, but
  // follow_user (0008) never asks it — it checks the rate cap and the privacy
  // flag and inserts. A blocked user could still follow, or raise a follow
  // request against, the person who blocked them.
  it('guards the edge tables themselves, not only the story predicates', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.forbid_blocked_edge\(\) returns trigger/i,
    );
    expect(FLAT).toContain(
      'create trigger follows_blocked_guard before insert on public.follows',
    );
    expect(FLAT).toContain(
      'create trigger follow_requests_blocked_guard before insert on public.follow_requests',
    );
    expect(FLAT).toContain(
      "raise exception 'blocked: no new connection between these accounts'",
    );
  });

  // The trigger can fire under a writer that is neither party (a migration, a
  // server-side job), and is_blocked_between refuses exactly that caller. A
  // table invariant must not depend on who is asking.
  it('inlines the block lookup in the trigger rather than calling the guarded helper', () => {
    expect(FLAT).toContain(
      'if exists ( select 1 from public.profile_blocks pb'
      + ' where (pb.blocker_id = v_a and pb.blocked_id = v_b)'
      + ' or (pb.blocker_id = v_b and pb.blocked_id = v_a) ) then',
    );
  });
});

describe('0066 — V8-R-FEED-010 the report record is server-owned', () => {
  it('grants the reporter SELECT and nothing else on content_reports', () => {
    expect(FLAT).toContain('grant select on public.content_reports to authenticated');
    // No UPDATE and no DELETE anywhere: that absence IS the requirement that a
    // reporter cannot edit or withdraw a report into invisibility.
    expect(FLAT).not.toMatch(/grant[^;]*update[^;]*on public\.content_reports/i);
    expect(FLAT).not.toMatch(/grant[^;]*delete[^;]*on public\.content_reports/i);
  });

  it('has no UPDATE or DELETE policy on content_reports', () => {
    expect(FLAT).not.toMatch(/create policy[^;]*on public\.content_reports for update/i);
    expect(FLAT).not.toMatch(/create policy[^;]*on public\.content_reports for delete/i);
  });

  it('writes the report through a definer function that stamps the reporter', () => {
    expect(FLAT).toContain(
      'values (auth.uid(), p_subject_kind, btrim(p_subject_ref), p_reason)',
    );
  });

  // The record is server-OWNED. `set reason = excluded.reason` handed the edit
  // straight back to the reporter, who could rewrite what the operator reads
  // simply by re-reporting the same subject.
  it('leaves the stored reason untouched on a repeat report', () => {
    // Not even a coalesce that FILLS a null: that still let the reporter decide
    // after the fact what the operator reads. The update is a deliberate no-op
    // rather than DO NOTHING, because DO NOTHING returns no row and the caller
    // reads a null id as a failed report and refuses to hide the content.
    expect(FLAT).toContain('set reason = public.content_reports.reason');
    expect(FLAT).not.toContain('set reason = coalesce(');
  });

  // "Reporting IMMEDIATELY HIDES the content FOR THE REPORTER" needs a READ
  // path that honours it. reportContent returned hideForReporter:true and
  // listReportedSubjects offered the hide set, but no policy and no production
  // caller consulted either, so the reported story stayed visible and the
  // requirement was discharged by a boolean nobody read.
  it('hides a reported story in the audience gate, not just in a return value', () => {
    expect(FLAT).toContain(
      'and not exists ( select 1 from public.content_reports cr'
      + " where cr.reporter_id = auth.uid() and cr.subject_kind = 'story'"
      + ' and cr.subject_ref = public.stories.id::text )',
    );
    expect(FLAT).toContain(
      'drop policy if exists "stories: audience reads unexpired" on public.stories',
    );
  });

  // A report hides content for the person who reported it and for nobody else.
  // It is not a moderation action and must not behave like one.
  it('scopes the hide to the reporter own rows', () => {
    expect(FLAT).not.toMatch(/from public\.content_reports cr where cr\.subject_kind/i);
  });

  // report_content is granted to `authenticated` and is therefore callable
  // directly over PostgREST. A cap that lives only in reports.ts bounds the
  // app's own UI and nothing else.
  it('bounds subject_ref and reason server-side, not only in the TypeScript caller', () => {
    expect(FLAT).toContain('if length(p_subject_ref) > 200 then');
    expect(FLAT).toContain('if p_reason is not null and length(p_reason) > 1000 then');
    expect(FLAT).toContain(
      'if p_subject_ref is null or length(btrim(p_subject_ref)) = 0 then',
    );
  });
});

describe('0066 — the media registry is not client-writable', () => {
  it('grants only SELECT on media_objects and media_destinations', () => {
    expect(FLAT).toContain('grant select on public.media_objects to authenticated');
    expect(FLAT).toContain('grant select on public.media_destinations to authenticated');
    // A client that can insert its own media row declares its own content_type,
    // which defeats V8-R-STO-014's server-side verification.
    expect(FLAT).not.toMatch(/grant[^;]*insert[^;]*on public\.media_objects/i);
    expect(FLAT).not.toMatch(/grant[^;]*insert[^;]*on public\.media_destinations/i);
  });

  it('enables row level security on every table it creates', () => {
    for (const table of [
      'media_objects',
      'media_destinations',
      'profile_blocks',
      'content_reports',
    ]) {
      expect(FLAT).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i'),
      );
    }
  });
});

describe('0066 — idempotency', () => {
  it('creates every table with if not exists', () => {
    const creates = STATEMENTS.match(/create table[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const statement of creates) {
      expect(statement.toLowerCase()).toContain('if not exists');
    }
  });

  it('drops each policy before creating it', () => {
    const created = [...STATEMENTS.matchAll(/create policy\s+"([^"]+)"/gi)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      expect(
        SQL,
        `policy ${name} is created without a preceding drop policy if exists`,
      ).toContain(`drop policy if exists "${name}"`);
    }
  });

  it('creates every index with if not exists', () => {
    const creates = STATEMENTS.match(/create (unique )?index[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const statement of creates) {
      expect(statement.toLowerCase()).toContain('if not exists');
    }
  });
});
