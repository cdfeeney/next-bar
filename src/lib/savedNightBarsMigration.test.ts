import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * S-08a — the shape of 0083_saved_night_bars.sql, pinned statically: no local
 * gate executes it and the staging apply is the owner's act. The live half is
 * savedNightBars.live.test.ts, which skips until 0083 is applied.
 *
 * The property that matters: archive_night_out is the CURRENT applied body
 * (0068) plus the bar-snapshot insert and nothing else, so its many prior
 * review rounds carry forward. The test proves it the way the generator built
 * it — every line of 0068's archive_night_out survives, in order, in 0083.
 */
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const read = (f: string) => readFileSync(path.join(MIG, f), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('0083_saved_night_bars.sql');

function archiveBody(text: string): string[] {
  const lines = text.split('\n');
  const s = lines.findIndex((l) => /^create or replace function public\.archive_night_out\(/.test(l));
  const e = lines.indexOf('$$;', s + 1);
  if (s < 0 || e < 0) throw new Error('archive_night_out not found');
  return lines.slice(s, e + 1);
}

describe('0083_saved_night_bars.sql shape', () => {
  it('adds the table with own-row RLS, a bar-id and rating check, cascade delete', () => {
    expect(SQL).toMatch(/create table if not exists public\.saved_night_bars \(/);
    expect(SQL).toMatch(/saved_night_id uuid\s+not null references public\.saved_nights\(id\) on delete cascade/);
    expect(SQL).toMatch(/constraint saved_night_bars_rating_check check \(rating is null or rating in \('loved', 'liked', 'pass'\)\)/);
    expect(SQL).toMatch(/constraint saved_night_bars_bar_check check \(bar_id ~ '\^\[a-z0-9-\]\{1,60\}\$'\)/);
    expect(SQL).toMatch(/alter table public\.saved_night_bars enable row level security;/);
    expect(SQL).toMatch(/create policy saved_night_bars_own_row on public\.saved_night_bars/);
    expect(SQL).toMatch(/sn\.owner_id = auth\.uid\(\)/);
  });

  it('archive_night_out is 0068 plus the bar snapshot, nothing else dropped or reordered', () => {
    const body = archiveBody(read('0068_nightout_media_presence.sql'));
    const out = SQL.split('\n');
    let j = 0;
    const missing = body.filter((line) => {
      const k = out.indexOf(line, j);
      if (k < 0) return true;
      j = k + 1;
      return false;
    });
    expect(missing).toEqual([]);
    const fn = SQL.slice(SQL.indexOf('create or replace function public.archive_night_out('));
    // Snapshot from the shortlist, ordered, joined to the owner's ratings, refreshed on re-archive.
    expect(fn).toMatch(/delete from public\.saved_night_bars where saved_night_id = v_saved;/);
    expect(fn).toMatch(/insert into public\.saved_night_bars \(saved_night_id, bar_id, sort_order, rating\)\s+select v_saved,\s+s\.bar_id,\s+\(row_number\(\) over \(order by s\.created_at, s\.bar_id\)\)::integer as sort_order,\s+r\.tier\s+from public\.night_out_suggestions s\s+left join public\.ratings r\s+on r\.user_id = v_uid and r\.bar_id = s\.bar_id\s+where s\.night_out_id = p_night_out;/);
  });

  it('the owner-scoped read returns the ordered stops, granted to authenticated only', () => {
    const g = SQL.slice(SQL.indexOf('create or replace function public.get_saved_night_bars('));
    expect(g).toMatch(/returns table \(bar_id text, sort_order integer, rating text\)/);
    expect(g).toMatch(/join public\.saved_nights sn on sn\.id = b\.saved_night_id\s+where b\.saved_night_id = p_id\s+and sn\.owner_id = auth\.uid\(\)\s+order by b\.sort_order asc/);
    expect(SQL).toMatch(/revoke all on function public\.get_saved_night_bars\(uuid\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.get_saved_night_bars\(uuid\) to authenticated;/);
  });
});
