import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Guards for migration 0033 (vibe_profiles — G1 profile persistence).
 *
 * Like 0028/0029 this is authored-but-UNAPPLIED, so nothing exercises it until
 * someone runs it deliberately. These assertions are static — there is no test
 * database — but the failure modes they pin are the ones that would silently
 * expose one user's data to another, and all of them are visible in the SQL
 * text. A privacy regression here is not something to discover in production.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0033_vibe_profiles.sql'),
  'utf8',
);

describe('migration 0033 — table shape', () => {
  test('creates vibe_profiles idempotently', () => {
    expect(SQL).toMatch(/create table if not exists public\.vibe_profiles/);
  });

  test('user_id is the primary key and cascades from auth.users', () => {
    // The cascade is the retention/deletion path: deleting the auth user
    // removes the vibe profile with no extra trigger to maintain.
    expect(SQL).toMatch(
      /user_id\s+uuid primary key references auth\.users\(id\) on delete cascade/,
    );
  });

  test('saved_at is NOT NULL — it is the conflict-resolution key', () => {
    expect(SQL).toMatch(/saved_at\s+timestamptz not null/);
  });

  test('profile is constrained to a json object', () => {
    expect(SQL).toMatch(/jsonb_typeof\(profile\) = 'object'/);
  });
});

describe('migration 0033 — row level security', () => {
  test('RLS is enabled', () => {
    expect(SQL).toMatch(/alter table public\.vibe_profiles enable row level security/);
  });

  test('every policy is owner-scoped via auth.uid() = user_id', () => {
    const policies = [...SQL.matchAll(/create policy "([^"]+)"[\s\S]*?;/g)].map((m) => m[0]);
    expect(policies.length).toBe(4); // select, insert, update, delete
    for (const policy of policies) {
      expect(policy).toMatch(/auth\.uid\(\) = user_id/);
    }
  });

  test('there is NO public/anon read policy', () => {
    // A vibe profile is private user data, unlike the bars catalog. Any
    // policy granting `true`, `anon`, or `public` read would be the exact
    // cross-account exposure this table exists to avoid.
    expect(SQL).not.toMatch(/using \(true\)/);
    expect(SQL).not.toMatch(/to anon/);
    expect(SQL).not.toMatch(/to public/);
  });

  test('the update policy carries BOTH using and with check', () => {
    // `using` alone would let an owner rewrite the row's user_id and hand it
    // to another account; `with check` is what pins the post-image.
    const update = SQL.match(/create policy "vibe_profiles: owner can update own"[\s\S]*?;/);
    expect(update).not.toBeNull();
    expect(update?.[0]).toMatch(/using \(auth\.uid\(\) = user_id\)/);
    expect(update?.[0]).toMatch(/with check \(auth\.uid\(\) = user_id\)/);
  });

  test('an owner-scoped DELETE policy exists', () => {
    // Required, not optional: Settings has a "Clear your saved vibe profile"
    // control. Without a server delete the local clear is undone by the next
    // sign-in hydrate, so the button silently lies and the data is retained
    // with no way to remove it. Three independent reviewers flagged this.
    const del = SQL.match(/create policy "vibe_profiles: owner can delete own"[\s\S]*?;/);
    expect(del).not.toBeNull();
    expect(del?.[0]).toMatch(/for delete/);
    expect(del?.[0]).toMatch(/using \(auth\.uid\(\) = user_id\)/);
  });

  test('policies are dropped before creation so the file is re-runnable', () => {
    const drops = SQL.match(/drop policy if exists/g) ?? [];
    expect(drops.length).toBe(4);
  });
});

describe('migration 0033 — LWW guard', () => {
  test('ties LOSE, matching the ratings_lww rule from 0005', () => {
    // `<=` not `<`. If ties won, the client's tie-goes-to-server rule in
    // vibeProfileSync would disagree with the database and the client would
    // believe it stored a row the trigger silently dropped.
    expect(SQL).toMatch(/new\.saved_at <= old\.saved_at/);
    expect(SQL).toMatch(/return null;/);
  });

  test('a null saved_at is rejected rather than treated as newest', () => {
    expect(SQL).toMatch(/new\.saved_at is null or/);
  });

  test('the guard function pins search_path', () => {
    // A SECURITY-relevant habit: this function is reachable via a trigger on a
    // user-writable table, so an attacker-controlled search_path must not be
    // able to shadow what it resolves.
    const fn = SQL.match(/create or replace function public\.vibe_profiles_lww_guard[\s\S]*?\$\$;/);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/set search_path = ''/);
  });

  test('the trigger is dropped before creation and fires BEFORE UPDATE', () => {
    expect(SQL).toMatch(/drop trigger if exists vibe_profiles_lww on public\.vibe_profiles/);
    expect(SQL).toMatch(/before update on public\.vibe_profiles/);
  });
});

describe('migration 0033 — blast radius', () => {
  test('touches ONLY the new table — no ALTER on profiles or any existing table', () => {
    // The whole point of a separate table was to keep public.profiles (and
    // the SECURITY DEFINER handle lookup that reads it) untouched.
    const alters = [...SQL.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(alters)).toEqual(new Set(['vibe_profiles']));
  });

  test('documents its rollback, per repository convention', () => {
    expect(SQL).toMatch(/Rollback \(in comments, per convention\)/);
    expect(SQL).toMatch(/drop table if exists public\.vibe_profiles/);
  });
});
