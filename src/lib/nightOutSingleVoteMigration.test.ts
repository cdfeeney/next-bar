import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * S-07b — the shape of 0079_night_out_single_vote.sql, pinned statically: no
 * local gate executes it and the staging apply is the owner's act. The live
 * half is nightOutSingleVote.live.test.ts, which skips until 0079 is applied.
 */
const SQL = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0079_night_out_single_vote.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('0079_night_out_single_vote.sql shape', () => {
  it('reconciles to one row per member per plan, then makes it structural — idempotently', () => {
    expect(SQL).toMatch(/row_number\(\) over \(\s*partition by night_out_id, user_id\s*order by created_at desc, bar_id asc/);
    expect(SQL).toMatch(/create unique index if not exists night_out_votes_one_per_member\s+on public\.night_out_votes \(night_out_id, user_id\);/);
    expect(SQL).not.toMatch(/\bdrop (table|column|function|index)\b/i);
  });

  it('the voter MOVES the caller’s vote inside the same lock and guards', () => {
    const voter = SQL.slice(SQL.indexOf('create or replace function public.vote_night_out_bar('), SQL.indexOf('create or replace function public.unvote_night_out_bar('));
    expect(voter).toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\('night_out_shortlist:' \|\| p_night_out::text, 0\)\)/);
    expect(voter).toMatch(/if not public\.night_out_voting_open\(p_night_out\) then/);
    expect(voter).toMatch(/if public\.night_out_role\(p_night_out\) is null then/);
    expect(voter).toMatch(/delete from public\.night_out_votes\s+where night_out_id = p_night_out\s+and user_id = v_uid\s+and bar_id <> p_bar;/);
    expect(voter).toMatch(/on conflict on constraint night_out_votes_pkey do nothing;/);
    expect(voter).toMatch(/revoke all on function public\.vote_night_out_bar\(uuid, text\) from public, anon, authenticated;/);
    expect(voter).toMatch(/grant execute on function public\.vote_night_out_bar\(uuid, text\) to authenticated;/);
  });

  it('the unvoter clears only the caller’s own vote while voting is open, and is closed to anon', () => {
    const unvoter = SQL.slice(SQL.indexOf('create or replace function public.unvote_night_out_bar('));
    expect(unvoter).toMatch(/security definer/);
    expect(unvoter).toMatch(/if not public\.night_out_voting_open\(p_night_out\) then/);
    expect(unvoter).toMatch(/delete from public\.night_out_votes\s+where night_out_id = p_night_out\s+and bar_id = p_bar\s+and user_id = v_uid;\s+return found;/);
    expect(unvoter).toMatch(/revoke all on function public\.unvote_night_out_bar\(uuid, text\) from public, anon;/);
    expect(unvoter).toMatch(/grant execute on function public\.unvote_night_out_bar\(uuid, text\) to authenticated;/);
  });
});
