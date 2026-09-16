import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * G-01 — the shape of 0080_anon_rsvp_guest_name.sql, pinned statically: no
 * local gate executes it and the staging apply is the owner's act. The live
 * half is anonGuestName.live.test.ts, which skips until 0080 is applied.
 */
const SQL = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0080_anon_rsvp_guest_name.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('0080_anon_rsvp_guest_name.sql shape', () => {
  it('adds ONE nullable column, idempotently, with no default and no backfill', () => {
    expect(SQL).toMatch(/alter table public\.night_out_anon_rsvps\s+add column if not exists guest_name text;/);
    expect(SQL).not.toMatch(/add column if not exists guest_name text\s+(not null|default)/i);
    expect(SQL).not.toMatch(/\bdrop (table|column|index)\b/i);
  });

  it('replaces the bearer writer with the optional name, and keeps the token / cap rules', () => {
    // The 3-arg signature goes so PostgREST has exactly one candidate.
    expect(SQL).toMatch(/drop function if exists public\.rsvp_night_out_by_token\(uuid, uuid, text\);/);
    const w = SQL.slice(SQL.indexOf('create or replace function public.rsvp_night_out_by_token('));
    expect(w).toMatch(/p_guest_name text default null/);
    expect(w).toMatch(/security definer/);
    expect(w).toMatch(/night_out_invite_live\(n\.id\)/);
    expect(w).toMatch(/anon_rsvp_cap constant integer := 100;/);
    // Going / Maybe need a name — typed now or already on the row.
    expect(w).toMatch(/if p_response in \('going', 'maybe'\) and v_name is null and coalesce\(v_has_name, false\) = false then\s+return false;/);
    // A name is trimmed, bounded, and never erased by a later nameless answer.
    expect(w).toMatch(/v_name := nullif\(btrim\(p_guest_name\), ''\);/);
    expect(w).toMatch(/char_length\(v_name\) > 40/);
    expect(w).toMatch(/guest_name = coalesce\(v_name, guest_name\)/);
    expect(SQL).toMatch(/grant execute on function public\.rsvp_night_out_by_token\(uuid, uuid, text, text\) to anon, authenticated;/);
  });

  it('members read named guests; anon loses the attendee names', () => {
    const g = SQL.slice(SQL.indexOf('create or replace function public.get_night_out_anon_guests('));
    expect(g).toMatch(/night_out_role\(p_night_out\) is not null/);
    expect(g).toMatch(/r\.guest_name is not null/);
    expect(SQL).toMatch(/revoke all on function public\.get_night_out_anon_guests\(uuid\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.get_night_out_anon_guests\(uuid\) to authenticated;/);
    // The funnel: names are what the account is for.
    expect(SQL).toMatch(/revoke execute on function public\.preview_night_out_attendees\(uuid\) from anon;/);
  });
});
