import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteServerVibeProfile } from './vibeProfile.server';

/**
 * Migration 0033 is authored but deliberately UNAPPLIED, so in every current
 * environment `public.vibe_profiles` does not exist. That makes the
 * missing-table case the DEFAULT path today, not an edge case — and the
 * Settings "Clear your saved vibe profile" button refuses to clear locally when
 * this returns false, so getting it wrong breaks a control that worked before
 * this feature existed.
 */

function stubDelete(error: { code?: string; message?: string } | null) {
  const eq = vi.fn(async () => ({ error }));
  const client = {
    from: vi.fn(() => ({ delete: vi.fn(() => ({ eq })) })),
  } as unknown as SupabaseClient;
  return client;
}

describe('deleteServerVibeProfile', () => {
  it('succeeds on a clean delete', async () => {
    expect(await deleteServerVibeProfile(stubDelete(null), 'user-a')).toBe(true);
  });

  it('treats a MISSING TABLE as "nothing to delete" (42P01)', async () => {
    // No table means no server row, so there is nothing that could later
    // re-hydrate — clearing locally is correct and must not be blocked.
    const client = stubDelete({
      code: '42P01',
      message: 'relation "public.vibe_profiles" does not exist',
    });
    expect(await deleteServerVibeProfile(client, 'user-a')).toBe(true);
  });

  it('treats the PostgREST schema-cache miss as missing too (PGRST205)', async () => {
    const client = stubDelete({
      code: 'PGRST205',
      message: "Could not find the table 'public.vibe_profiles' in the schema cache",
    });
    expect(await deleteServerVibeProfile(client, 'user-a')).toBe(true);
  });

  it('recognises a missing table from the message alone when no code is given', async () => {
    const client = stubDelete({ message: 'relation "vibe_profiles" does not exist' });
    expect(await deleteServerVibeProfile(client, 'user-a')).toBe(true);
  });

  it('FAILS on a genuine transport error — a live row must never be orphaned', async () => {
    // This is the half that preserves the round-1 fix: if the table exists and
    // the delete really failed, the caller must NOT clear locally, or the
    // surviving server row re-hydrates the profile the user just cleared.
    const client = stubDelete({ code: '08006', message: 'connection failure' });
    expect(await deleteServerVibeProfile(client, 'user-a')).toBe(false);
  });

  it('FAILS on an RLS/permission denial', async () => {
    const client = stubDelete({ code: '42501', message: 'permission denied for table vibe_profiles' });
    expect(await deleteServerVibeProfile(client, 'user-a')).toBe(false);
  });
});
