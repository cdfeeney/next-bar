import { describe, expect, it } from 'vitest';
import {
  assertAuthenticatedE2eConfigured,
  authenticatedE2eSkipAllowed,
  resolveSupabaseUrl,
} from './authenticatedE2eConfig';

/**
 * Criterion 5 — "authenticated e2e tests either run or fail loudly, they never
 * silently skip when config is present in the environment."
 *
 * This is the regression test Codex filed as missing in round 2. Its whole
 * value is being inside the DEFAULT gate: the guard it covers lives in a
 * Playwright spec that `npm test` never loads, so before this file a revert to
 * the fail-open behaviour would have been invisible to every check that runs
 * by default.
 */

describe('resolveSupabaseUrl — the environment is read FIRST', () => {
  it('prefers the process environment over .env.local', () => {
    expect(
      resolveSupabaseUrl('https://from-env.supabase.co', 'NEXT_PUBLIC_SUPABASE_URL=https://from-file.supabase.co'),
    ).toBe('https://from-env.supabase.co');
  });

  it('falls back to .env.local when the environment is unset', () => {
    expect(
      resolveSupabaseUrl(undefined, 'NEXT_PUBLIC_SUPABASE_URL=https://from-file.supabase.co'),
    ).toBe('https://from-file.supabase.co');
  });

  it('treats an empty or whitespace environment value as absent', () => {
    expect(resolveSupabaseUrl('   ', 'NEXT_PUBLIC_SUPABASE_URL=https://from-file.supabase.co'))
      .toBe('https://from-file.supabase.co');
  });

  it('returns null when neither source has it', () => {
    expect(resolveSupabaseUrl(undefined, null)).toBeNull();
    expect(resolveSupabaseUrl(undefined, 'SOMETHING_ELSE=x')).toBeNull();
  });

  it('ignores a key that merely ends with the name', () => {
    expect(resolveSupabaseUrl(undefined, 'PREFIXED_NEXT_PUBLIC_SUPABASE_URL=https://wrong.example'))
      .toBeNull();
  });
});

describe('the guard fails LOUDLY rather than skipping', () => {
  it('throws when the URL is missing outside CI', () => {
    expect(() => assertAuthenticatedE2eConfigured(null, false, 'night-out.spec.ts')).toThrow(
      /was NOT exercised/,
    );
  });

  it('allows the skip only when CI explicitly acknowledges it', () => {
    expect(() => assertAuthenticatedE2eConfigured(null, true, 'night-out.spec.ts')).not.toThrow();
  });

  it('does not throw when the URL is present', () => {
    expect(() =>
      assertAuthenticatedE2eConfigured('https://x.supabase.co', false, 'night-out.spec.ts'),
    ).not.toThrow();
  });

  it('recognises only the exact CI acknowledgements', () => {
    expect(authenticatedE2eSkipAllowed({ CI: 'true' })).toBe(true);
    expect(authenticatedE2eSkipAllowed({ CI: '1' })).toBe(true);
    expect(authenticatedE2eSkipAllowed({ CI: 'false' })).toBe(false);
    expect(authenticatedE2eSkipAllowed({ CI: '0' })).toBe(false);
    expect(authenticatedE2eSkipAllowed({})).toBe(false);
  });
});
