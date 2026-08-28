import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WP5 round-2 fix guard — static assertions over 0069_feed_and_comments.sql.
 *
 * WHY A TEXT TEST AND NOT A LIVE ONE. No gate in this lane executes SQL, and
 * shared-database operations are forbidden in every lane of this run, so 0069
 * has never been applied anywhere. The audience rules it encodes are proven
 * against a real database at the attended integration gate, exactly as
 * `nightOutsRls.live.test.ts` does for 0044. What is mechanically provable HERE
 * is the security SHAPE of the text, and that is what this file pins — the three
 * predicates a round-1 reviewer found missing, each of which was a silent
 * widening that no local check could have caught.
 *
 * Every assertion below fails if its fix is reverted. That is the whole point:
 * this lane has twice shipped a "fix" whose test could not fail, and the
 * archived review note names that as the same defect wearing the repair.
 */

const SQL = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0069_feed_and_comments.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

/** The text of one `create policy` statement, by name. */
function policyBody(name: string): string {
  const start = SQL.indexOf(`create policy "${name}"`);
  expect(start, `policy ${name} is not defined in 0069`).toBeGreaterThan(-1);
  const end = SQL.indexOf(';\n', start);
  expect(end, `policy ${name} is unterminated`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

/**
 * One SQL fragment with its `--` comments removed and every run of whitespace
 * collapsed to a single space.
 *
 * A GROUPING TEST HAS TO SEE THE PARENTHESES. Round 2 found the negative regex
 * below asserting nothing: it looked for the veto immediately after
 * `auth.uid() = profile_id`, so moving the veto OUTSIDE the OR — which is the
 * actual defect, and which takes a tagged reporter's own consent row away from
 * them — slipped between the two anchors and stayed green. Matching the whole
 * normalised expression is the only shape that cannot be walked around: any
 * regrouping changes where the brackets fall.
 */
function sqlShape(fragment: string): string {
  return fragment.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The body of one `create or replace function`, by qualified name. */
function functionBody(signature: string): string {
  const start = SQL.indexOf(`create or replace function ${signature}`);
  expect(start, `${signature} is not defined in 0069`).toBeGreaterThan(-1);
  const end = SQL.indexOf('\n$$;', start);
  expect(end, `${signature} is unterminated`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('0069 — a block is judged between the READER and the COMMENTER', () => {
  // The post gate compares the caller with the post's AUTHOR. A comment adds a
  // third party, so without a second term A could read C's comment on P's post
  // after A blocked C: no predicate on that path ever compared A with C.
  it('the feed_comments read policy compares the caller with the comment author', () => {
    const policy = policyBody('feed_comments: post audience reads');
    expect(policy).toMatch(
      /not public\.is_blocked_between\(\s*auth\.uid\(\),\s*public\.feed_comments\.author_id\s*\)/,
    );
  });

  it('can_view_feed_comment carries the same term, so the report path agrees with the read path', () => {
    const body = functionBody('public.can_view_feed_comment(p_comment_id uuid)');
    expect(body).toMatch(/not public\.is_blocked_between\(\s*auth\.uid\(\),\s*c\.author_id\s*\)/);
  });

  it('the block term is never weakened to a one-directional check', () => {
    // is_blocked_between is symmetric by construction (0066). Asserting the
    // helper is the one asked keeps a future edit from substituting a
    // single-direction lookup, which D-C-30 forbids: blocking is enforced "IN
    // BOTH DIRECTIONS".
    expect(SQL).not.toMatch(/from public\.profile_blocks/);
  });
});

describe('0069 — the reporter hide reaches every surface of the post', () => {
  it('the posts policy vetoes on the caller-scoped report', () => {
    const policy = policyBody('feed_posts: audience reads');
    expect(policy).toMatch(/not public\.feed_post_reported_by_caller\(/);
  });

  it('the tag policy vetoes on it too, so tags do not answer for a hidden post', () => {
    const policy = policyBody('feed_post_tags: readable with post');
    expect(policy).toMatch(/not public\.feed_post_reported_by_caller\(post_id\)/);
  });

  it('a tagged person still reads their OWN tag row, because that is the consent they revoke', () => {
    // The report veto must sit INSIDE the can_view branch, never over the whole
    // policy: hiding your own tag row takes away the control, not the content.
    // Asserted as the whole normalised expression, because the grouping IS the
    // requirement — see `sqlShape`.
    expect(sqlShape(policyBody('feed_post_tags: readable with post'))).toContain(
      'auth.uid() = profile_id'
      + ' or ( public.can_view_feed_post(post_id)'
      + ' and not public.feed_post_reported_by_caller(post_id) )',
    );
  });
});

describe('0069 — a self-reported Feed photo stops signing', () => {
  const body = functionBody('public.media_read_window(p_name text)');

  it('the prior yes is vetoed when the caller reported a live feed post naming these bytes', () => {
    expect(body).toMatch(/public\.feed_post_reported_by_caller\(p\.id\)/);
    // The veto has to be evaluated BEFORE the unconditional pass-through of the
    // prior answer, or it can never run.
    const veto = body.indexOf('feed_post_reported_by_caller(p.id)');
    const passThrough = body.indexOf('return query select v_prior.readable, v_prior.expires_at;');
    expect(veto).toBeGreaterThan(-1);
    expect(passThrough).toBeGreaterThan(-1);
    expect(veto).toBeLessThan(passThrough);
  });

  it('the veto cannot hide a story, because it requires that no live story names the bytes', () => {
    // 0066 already applies its own reporter rule to stories. This file is only
    // entitled to change the answer in the case 0066 could not see: a FEED-ONLY
    // object on the owner's prefix, where 0066's upload-before-publish window
    // says "yes, unbounded".
    expect(body).toMatch(/and not exists \(\s*\n\s*select 1\s*\n\s*from public\.stories s/);
    expect(body).toMatch(/s\.deleted_at is null/);
    expect(body).toMatch(/s\.expires_at > now\(\)/);
  });

  it('the veto stands down when another post on the same bytes is still visible and unreported', () => {
    // Both lanes, round 2: one media object may hold several live Feed
    // destinations, so reporting post A blanked post B's photo for its own
    // owner — and the branch that would have authorised B sits after the veto's
    // `return`, so it could never be reached. The all-unreported term is what
    // 0066's story analogue carries and this one was missing.
    expect(sqlShape(body)).toContain('if v_prior.readable and not v_feed_readable and exists (');
    // ...and that term has to mean the FEED answer, not a constant.
    expect(sqlShape(body)).toContain(
      'v_feed_readable := exists ( select 1 from public.feed_posts p'
      + ' join public.media_objects m on m.id = p.media_id where m.storage_path = p_name'
      + ' and m.bytes_removed_at is null and public.can_view_feed_post(p.id)'
      + ' and not public.feed_post_reported_by_caller(p.id) );',
    );
  });

  it('a report on a post whose Feed destination is already retired vetoes nothing', () => {
    // `deleted_at is null` alone kept vetoing after `remove_media_destination`
    // took the post off the Feed, so a report with nothing left to hide went on
    // hiding the owner's own bytes.
    expect(sqlShape(body)).toContain(
      'and p.deleted_at is null'
      + ' and public.feed_post_destination_is_live(p.id)'
      + ' and public.feed_post_reported_by_caller(p.id)',
    );
  });
});

describe('0069 — a named group is resolved server-side (D-C-37)', () => {
  const body = functionBody('public.publish_feed_post(');

  it('a group audience is enumerated FROM THE GROUP, not filtered from the caller list', () => {
    // Round 2 (HIGH) found the insert filtering the caller's ids by mutual
    // friendship and never resolving p_group_id. Round 3 (HIGH, both lanes) found
    // the repair still wrong in the other direction: filtering the caller's list
    // BY group membership closes only the widening half, and a caller passing one
    // member of G published a one-person post stamped audience_group_id = G.
    // D-C-37 is an EQUALITY — recipients EQUAL the selected group intersected with
    // the poster's mutual friends — so the candidate set has to be the group.
    expect(sqlShape(body)).toContain(
      "elsif p_audience = 'group' then"
      + ' insert into public.feed_post_audience (post_id, profile_id)'
      + ' select distinct v_id, gm.profile_id'
      + ' from public.group_members gm'
      + ' where gm.group_id = p_group_id'
      + ' and gm.profile_id <> v_author'
      + ' and public.is_mutual_friend(v_author, gm.profile_id)',
    );
  });

  it('the caller-supplied list reaches the audience only for a custom audience', () => {
    // p_audience_ids must not appear in the group branch at all. Asserting the
    // custom branch owns it is what makes "ignored for a group" mechanical rather
    // than a claim in a comment.
    expect(sqlShape(body)).toContain(
      "if p_audience = 'custom' then"
      + ' insert into public.feed_post_audience (post_id, profile_id)'
      + ' select v_id, ids.distinct_id'
      + ' from (select distinct unnest(p_audience_ids) as distinct_id) ids',
    );
  });

  it('the poster must be in the group before anything enumerates it', () => {
    // publish_feed_post is SECURITY DEFINER, so the group_members read above
    // bypasses that table's RLS. This guard is the only thing standing between a
    // definer enumeration and a group the caller has no part in.
    expect(sqlShape(body)).toContain(
      "if p_audience = 'group'"
      + ' and not public.is_group_member(p_group_id, v_author) then',
    );
  });

  it('a group audience still cannot be published without a group to resolve', () => {
    // The group branch reads p_group_id, so the guard that makes it non-null for
    // 'group' is load-bearing rather than a message.
    expect(sqlShape(body)).toContain(
      "if p_audience = 'group' and p_group_id is null then");
  });

  it('an empty intersection FAILS CLOSED instead of publishing to nobody', () => {
    // Round 3 (MEDIUM): the suite pinned the intersection and the null-group guard
    // but not the raise, so deleting the whole fail-closed block left every gate
    // green. "If the mutual-friend set cannot be resolved the action FAILS CLOSED
    // rather than delivering to the unintersected group" — a post whose audience
    // table is empty reads to its author as delivered.
    expect(sqlShape(body)).toContain(
      "if p_audience <> 'friends' then"
      + ' select count(*)::int into v_recipients'
      + ' from public.feed_post_audience fa'
      + ' where fa.post_id = v_id;'
      + ' if v_recipients = 0 then',
    );
    expect(body).toMatch(/raise exception\s*\n\s*'publish_feed_post: nobody in that audience/);
  });
});

describe('0069 — the column-scoped tag grant is actually scoped', () => {
  it('authenticated is revoked from every new table before anything is granted back', () => {
    // Round 3 (MEDIUM, codex): Supabase's default privileges grant ALL on new
    // public tables to `authenticated`, and a later `grant update (removed_at)`
    // only ever ADDS to that. Without this revoke the column list was decorative
    // and a tagged person could PATCH their own feed_post_tags row's post_id onto
    // any post id they knew, bypassing publication's audience, mutual-friend and
    // block checks — feed_post_tags being the one of the four tables whose UPDATE
    // policy admits the write at all.
    for (const table of ['feed_posts', 'feed_post_audience', 'feed_post_tags', 'feed_comments']) {
      expect(
        sqlShape(SQL),
        `${table} still leaves authenticated its default table-level grant`,
      ).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
    }
  });

  it('the only write granted on a tag row is the consent withdrawal column', () => {
    expect(SQL).toMatch(
      /grant update \(removed_at\) on public\.feed_post_tags to authenticated;/,
    );
    // No table-wide UPDATE anywhere, which is what the revoke above exists to stop
    // being re-granted by a later edit.
    expect(SQL).not.toMatch(/grant update on public\.feed_post_tags/);
  });
});
