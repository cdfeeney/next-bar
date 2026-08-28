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
    const policy = policyBody('feed_post_tags: readable with post');
    expect(policy).toMatch(/auth\.uid\(\) = profile_id/);
    // The report veto must sit inside the can_view branch, never over the whole
    // policy: hiding your own tag row takes away the control, not the content.
    expect(policy).not.toMatch(
      /auth\.uid\(\) = profile_id\s*\)?\s*and not public\.feed_post_reported_by_caller/,
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
});
