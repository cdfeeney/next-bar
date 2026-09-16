import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * S-06c — the shape of 0082_night_out_cover_media.sql, pinned statically: no
 * local gate executes it and the staging apply is the owner's act. The live
 * half is nightOutCoverMedia.live.test.ts, which skips until 0082 is applied.
 *
 * The property that matters most: each replaced function is the CURRENT applied
 * body (0066 / 0076 / 0078) plus the cover additions and nothing else, so the
 * security decisions those files made are carried forward byte for byte. The
 * test proves it the same way the generator built it — every line of each
 * source function must appear, in order, in the new file.
 */
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const read = (f: string) => readFileSync(path.join(MIG, f), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('0082_night_out_cover_media.sql');

function functionLines(text: string, start: RegExp): string[] {
  const lines = text.split('\n');
  const s = lines.findIndex((l) => start.test(l));
  const e = lines.indexOf('$$;', s + 1);
  if (s < 0 || e < 0) throw new Error(`function not found: ${start}`);
  return lines.slice(s, e + 1);
}

function survivesInOrder(source: string[], target: string, allowedDrops: string[]): string[] {
  const out = target.split('\n');
  let j = 0;
  const missing: string[] = [];
  for (const line of source) {
    const k = out.indexOf(line, j);
    if (k < 0) missing.push(line);
    else j = k + 1;
  }
  return missing.filter((m) => !allowedDrops.includes(m));
}

describe('0082_night_out_cover_media.sql shape', () => {
  it('changes no schema, drops nothing, grants nothing new — three replacements under existing signatures', () => {
    expect(SQL).not.toMatch(/\balter table\b/i);
    expect(SQL).not.toMatch(/\bdrop (table|column|index|function|policy)\b/i);
    expect(SQL).not.toMatch(/\bcreate table\b/i);
    expect(SQL).toMatch(/create or replace function public\.media_live_reference_count\(p_media_id uuid\)/);
    expect(SQL).toMatch(/create or replace function public\.media_read_window\(p_name text\)/);
    expect(SQL).toMatch(/create or replace function public\.set_night_out_cover\(/);
    // No media_destinations row is minted for a cover: the plan row is the reference.
    expect(SQL).not.toMatch(/insert into public\.media_destinations/);
    // The only grant lines are 0078's, restated.
    expect(SQL.match(/^grant .*$/gm) ?? []).toEqual([
      'grant execute on function public.set_night_out_cover(uuid, text) to authenticated;',
    ]);
  });

  it('media_live_reference_count is 0066 plus ONE term: a non-cancelled plan whose cover names the object', () => {
    const src = functionLines(read('0066_media_boundary.sql'), /^create or replace function public\.media_live_reference_count\(/);
    expect(survivesInOrder(src, SQL, ['        )));'])).toEqual([]);
    const fn = SQL.slice(SQL.indexOf('create or replace function public.media_live_reference_count('));
    expect(fn).toMatch(/from public\.night_outs n\s+where n\.cover = 'media:' \|\| p_media_id::text\s+and n\.status <> 'cancelled'\)\);/);
  });

  it('media_read_window is 0076 plus the cover answer, the veto exclusion, the clock clamp and the terminal branch', () => {
    const src = functionLines(read('0076_feed_access_consolidation_and_group_read_window.sql'), /^create or replace function public\.media_read_window\(/);
    expect(survivesInOrder(src, SQL, [])).toEqual([]);
    const fn = SQL.slice(SQL.indexOf('create or replace function public.media_read_window('));
    expect(fn).toMatch(/v_cover_readable boolean := false;/);
    // R-04... audience is night_outs_select_member (owner or ANY membership row),
    // matching the plan's own read policy, NOT accepted-only night_out_role.
    expect(fn).toMatch(/where mo\.storage_path = p_name\s+and mo\.bucket_id = 'story-media'\s+and mo\.bytes_removed_at is null\s+and n\.status <> 'cancelled'/);
    expect(fn).toMatch(/and \(n\.owner_id = auth\.uid\(\)\s+or exists \(\s+select 1\s+from public\.night_out_members m\s+where m\.night_out_id = n\.id\s+and m\.user_id = auth\.uid\(\)\s+\)\)\s+\) into v_cover_readable;/);
    expect(fn).not.toMatch(/night_out_role\(n\.id\) is not null\s+\) into v_cover_readable;/);
    expect(fn).toMatch(/and not v_group_readable\n(?:\s+--.*\n)*\s+and not v_cover_readable\n\s+then/);
    expect(fn).toMatch(/if v_prior\.readable and v_cover_readable then\s+return query select true, null::timestamptz;/);
    expect(fn).toMatch(/if v_cover_readable then\s+return query select true, null::timestamptz;\s+return;\s+end if;\s+(?:--.*\s+)*return query select false, null::timestamptz;/);
    expect((fn.match(/v_cover_readable/g) ?? []).length).toBe(5);
  });

  it('set_night_out_cover is 0078 with the media shape and an ownership check; owner-only and draft/open stay', () => {
    const src = functionLines(read('0078_night_out_cover.sql'), /^create or replace function public\.set_night_out_cover\(/);
    expect(survivesInOrder(src, SQL, ["  if p_cover is not null and p_cover !~ '^template:[a-z0-9-]{1,40}$' then"])).toEqual([]);
    const fn = SQL.slice(SQL.indexOf('create or replace function public.set_night_out_cover('));
    expect(fn).toMatch(/\^\(template:\[a-z0-9-\]\{1,40\}\|media:\[0-9a-f-\]\{36\}\)\$/);
    // R-04... the media check takes the row lock (for update), so a concurrent
    // claim_media_for_removal cannot reclaim the bytes between check and write.
    expect(fn).toMatch(/perform 1\s+from public\.media_objects mo\s+where mo\.id::text = substring\(p_cover from 7\)\s+and mo\.owner_id = v_uid\s+and mo\.bucket_id = 'story-media'\s+and mo\.bytes_removed_at is null\s+for update;\s+if not found then\s+return false;/);
    expect(fn).toMatch(/owner_id = v_uid/);
    expect(fn).toMatch(/status in \('draft', 'open'\)/);
    expect(SQL).toMatch(/revoke all on function public\.set_night_out_cover\(uuid, text\) from public, anon;/);
  });
});
