import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * S-06b — the shape of 0078_night_out_cover.sql, pinned statically because no
 * local gate executes it and the staging apply is the owner's act.
 *
 * The one that matters most is the column GRANT: 0047 revoked the table-level
 * SELECT on night_outs and re-granted an explicit column list so that a new
 * column stays unreadable until someone grants it on purpose. Round-1 panel
 * (Fable, HIGH) caught the file without it — every client read of `cover`
 * would have been refused with 42501 while the definer write kept succeeding.
 */
const SQL = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0078_night_out_cover.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('0078_night_out_cover.sql shape', () => {
  it('adds ONE nullable column, idempotently, with no default and no backfill', () => {
    expect(SQL).toMatch(/alter table public\.night_outs\s+add column if not exists cover text;/);
    // The column definition itself carries no DEFAULT / NOT NULL (the prose may say the word).
    expect(SQL).not.toMatch(/add column if not exists cover text\s+(not null|default)/i);
    expect(SQL).not.toMatch(/\bupdate public\.night_outs\s+set cover\s*=\s*'/i);
    expect(SQL).not.toMatch(/\bdrop (column|table|function)\b/i);
  });

  it('grants the column read to authenticated — 0047 made new columns unreadable on purpose', () => {
    expect(SQL).toMatch(/grant select \(cover\) on table public\.night_outs to authenticated;/);
  });

  it('adds the owner-only writer with the template shape check, and closes it to anon', () => {
    expect(SQL).toMatch(/create or replace function public\.set_night_out_cover\(/);
    expect(SQL).toMatch(/security definer/);
    expect(SQL).toMatch(/owner_id = v_uid/);
    expect(SQL).toMatch(/status in \('draft', 'open'\)/);
    expect(SQL).toMatch(/\^template:\[a-z0-9-\]\{1,40\}\$/);
    expect(SQL).toMatch(/revoke all on function public\.set_night_out_cover\(uuid, text\) from public, anon;/);
    expect(SQL).toMatch(/grant execute on function public\.set_night_out_cover\(uuid, text\) to authenticated;/);
  });
});
