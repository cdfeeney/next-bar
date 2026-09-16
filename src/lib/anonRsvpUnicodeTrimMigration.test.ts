import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R-04 — the shape of 0081_anon_rsvp_unicode_trim.sql, pinned statically: no
 * local gate executes it and the staging apply is the owner's act. The live
 * half is in anonGuestName.live.test.ts, which skips until 0081 is applied.
 */
const SQL = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0081_anon_rsvp_unicode_trim.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('0081_anon_rsvp_unicode_trim.sql shape', () => {
  it('changes no schema and drops nothing — two replacements under the 0080 signatures', () => {
    expect(SQL).not.toMatch(/\balter table\b/i);
    expect(SQL).not.toMatch(/\bdrop (table|column|index|function)\b/i);
    expect(SQL).toMatch(/create or replace function public\.rsvp_night_out_by_token\(\s*p_token\s+uuid,\s*p_key\s+uuid,\s*p_response\s+text,\s*p_guest_name text default null\s*\)/);
    expect(SQL).toMatch(/create or replace function public\.get_night_out_anon_guests\(p_night_out uuid\)\s+returns table \(guest_name text, response text\)/);
  });

  it('trims the name the way String.trim() does — Unicode space plus U+FEFF, not an ASCII list', () => {
    const w = SQL.slice(SQL.indexOf('create or replace function public.rsvp_night_out_by_token('));
    expect(w).toMatch(/v_name := nullif\(regexp_replace\(p_guest_name, '\^\[\\s\\ufeff\]\+\|\[\\s\\ufeff\]\+\$', '', 'g'\), ''\);/);
    expect(w).not.toMatch(/btrim\(/);
    // Everything else 0080 established still holds.
    expect(w).toMatch(/security definer/);
    expect(w).toMatch(/night_out_invite_live\(n\.id\)/);
    expect(w).toMatch(/anon_rsvp_cap constant integer := 100;/);
    expect(w).toMatch(/char_length\(v_name\) > 40/);
    expect(w).toMatch(/if p_response in \('going', 'maybe'\) and v_name is null and coalesce\(v_has_name, false\) = false then\s+return false;/);
    expect(w).toMatch(/guest_name = coalesce\(v_name, guest_name\)/);
    expect(SQL).toMatch(/revoke all on function public\.rsvp_night_out_by_token\(uuid, uuid, text, text\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.rsvp_night_out_by_token\(uuid, uuid, text, text\) to anon, authenticated;/);
  });

  it('the guests read returns every reply from one snapshot, members only, and keeps its grants', () => {
    const g = SQL.slice(SQL.indexOf('create or replace function public.get_night_out_anon_guests('));
    expect(g).toMatch(/night_out_role\(p_night_out\) is not null/);
    // The nameless rows now come too — the client no longer subtracts a
    // second read's counts from these.
    expect(g).not.toMatch(/r\.guest_name is not null/);
    expect(g).toMatch(/order by r\.updated_at asc/);
    expect(SQL).toMatch(/revoke all on function public\.get_night_out_anon_guests\(uuid\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.get_night_out_anon_guests\(uuid\) to authenticated;/);
  });
});
