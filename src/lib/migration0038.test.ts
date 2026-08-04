import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Guards for DRAFT migration 0038 (venue pins — g-31f36bf8).
 *
 * Static assertions, same as 0033/0034/0035: authored-but-UNAPPLIED, no
 * test database exists in this environment. What is pinned here is the
 * T0 authorization/privacy contract of the draft itself:
 *
 *   - the read predicate requires a MUTUAL follows edge (both
 *     directions) — the one-way get_circle_rsvps audience is NOT enough
 *     for live presence;
 *   - no coordinate/accuracy column exists anywhere in the schema;
 *   - server-side 6:00 AM America/New_York expiry on BOTH read and
 *     write paths;
 *   - one pin per user/night is declarative (PK), moves are upserts;
 *   - all writes serialize under one per-user advisory lock;
 *   - client roles get NO table grants; anon/public get nothing;
 *   - account deletion cascades.
 *
 * The live two-user authorization proof runs at the attended apply
 * session; until then these assertions plus review are the gate.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/drafts/0038_venue_pins.sql'),
  'utf8',
);

/** Statement bodies only — prose in comments would false-match. */
const STATEMENTS = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('draft 0038 — mutual-only read authorization (criteria 14–15)', () => {
  test('the gated read requires BOTH follow directions', () => {
    const gate = STATEMENTS.match(/with gated as materialized[\s\S]*?\)\s*select/);
    expect(gate).not.toBeNull();
    const body = gate?.[0] ?? '';
    // Direction 1: caller follows the pin owner.
    expect(body).toMatch(
      /f\.follower_id = auth\.uid\(\)\s+and f\.followee_id = v\.user_id/,
    );
    // Direction 2: pin owner follows the caller back.
    expect(body).toMatch(
      /f2\.follower_id = v\.user_id\s+and f2\.followee_id = auth\.uid\(\)/,
    );
    // Both EXISTS are conjoined — a one-way edge must not pass.
    expect(body).toMatch(/exists[\s\S]*?\)\s*and exists/);
  });

  test('own rows are readable without any edge', () => {
    expect(STATEMENTS).toMatch(/v\.user_id = auth\.uid\(\)/);
  });

  test('the gated CTE is MATERIALIZED (leakproof-pushdown side-channel fence)', () => {
    expect(STATEMENTS).toMatch(/with gated as materialized/);
  });
});

describe('draft 0038 — no coordinates, ever (criterion 5)', () => {
  test.each([
    'lat',
    'lng',
    'lon',
    'latitude',
    'longitude',
    'accuracy',
    'geography',
    'geometry',
    'point',
    'coords',
  ])('schema and functions never mention %s', (word) => {
    expect(STATEMENTS.toLowerCase()).not.toMatch(
      new RegExp(`\\b${word}\\b`, 'i'),
    );
  });

  test('the table has exactly the four expected columns', () => {
    const create = STATEMENTS.match(
      /create table if not exists public\.venue_pins \(([\s\S]*?)\);/,
    );
    expect(create).not.toBeNull();
    const cols = (create?.[1] ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('primary key'))
      .map((l) => l.split(/\s+/)[0]);
    expect(cols).toEqual(['user_id', 'bar_id', 'night', 'pinned_at']);
  });
});

describe('draft 0038 — 6:00 AM America/New_York expiry (criterion 10)', () => {
  test('the READ path bounds rows to the unexpired night', () => {
    expect(STATEMENTS).toMatch(
      /now\(\) < timezone\('America\/New_York',\s*\(v\.night \+ 1\)::timestamp \+ interval '6 hours'\)/,
    );
  });

  test('the WRITE path refuses pins for an already-ended night', () => {
    expect(STATEMENTS).toMatch(
      /now\(\) >= timezone\('America\/New_York',\s*\(night \+ 1\)::timestamp \+ interval '6 hours'\)/,
    );
  });
});

describe('draft 0038 — one pin per night, move semantics (criteria 7–8)', () => {
  test('(user_id, night) is the PRIMARY KEY — declaratively one pin/night', () => {
    expect(STATEMENTS).toMatch(/primary key \(user_id, night\)/);
  });

  test('pinning conflicts UPDATE the row (move), via ON CONSTRAINT', () => {
    expect(STATEMENTS).toMatch(
      /on conflict on constraint venue_pins_pkey\s+do update set bar_id = excluded\.bar_id/,
    );
  });
});

describe('draft 0038 — write serialization and validation (0012/0013 lessons)', () => {
  test('both write RPCs take the SAME per-user advisory lock', () => {
    const locks = STATEMENTS.match(
      /pg_advisory_xact_lock\(hashtextextended\('venue_pins:' \|\| uid::text, 0\)\)/g,
    );
    expect(locks).toHaveLength(2);
  });

  test('bar ids are validated against the shared slug pattern', () => {
    expect(STATEMENTS).toMatch(/bar !~ '\^\[a-z0-9-\]\{1,60\}\$'/);
  });

  test('nights are bounded to current_date ± 2 in both RPCs', () => {
    const bounds = STATEMENTS.match(
      /night < \(current_date - 2\) or night > \(current_date \+ 2\)/g,
    );
    expect(bounds).toHaveLength(2);
  });
});

describe('draft 0038 — grants (criterion 15: nothing for anon/public)', () => {
  test('client roles get NO table access at all', () => {
    expect(STATEMENTS).toMatch(
      /revoke all on table public\.venue_pins from public, anon, authenticated;/,
    );
    // And no grant on the table ever follows the revoke.
    expect(STATEMENTS).not.toMatch(/grant .* on table public\.venue_pins/);
  });

  test('RLS is enabled', () => {
    expect(STATEMENTS).toMatch(
      /alter table public\.venue_pins enable row level security;/,
    );
  });

  test.each([
    ['pin_venue', /revoke all on function public\.pin_venue\(text, date\) from public, anon;/],
    ['unpin_venue', /revoke all on function public\.unpin_venue\(date\) from public, anon;/],
    ['get_friend_pins', /revoke all on function public\.get_friend_pins\(date\) from public, anon;/],
  ])('%s is revoked from public/anon and granted to authenticated only', (name, revoke) => {
    expect(STATEMENTS).toMatch(revoke);
    const grants = STATEMENTS.match(
      new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to (\\w+);`, 'g'),
    );
    expect(grants).toHaveLength(1);
    expect(grants?.[0]).toMatch(/to authenticated;/);
  });

  test('every function pins search_path and is SECURITY DEFINER', () => {
    const definers = STATEMENTS.match(/security definer/g);
    const searchPaths = STATEMENTS.match(/set search_path = public/g);
    expect(definers).toHaveLength(3);
    expect(searchPaths).toHaveLength(3);
  });
});

describe('draft 0038 — account deletion (criterion 17)', () => {
  test('user_id cascades from profiles', () => {
    expect(STATEMENTS).toMatch(
      /user_id uuid not null references public\.profiles\(id\) on delete cascade/,
    );
  });
});

describe('draft 0038 — additive only (criterion 18: rsvp surface untouched)', () => {
  test('the draft never touches bar_rsvps or its RPCs', () => {
    expect(STATEMENTS).not.toMatch(/bar_rsvps|rsvp_bar|unrsvp_bar|get_circle_rsvps/);
  });

  test('drafts/ is invisible to the runner (top-level *.sql only)', () => {
    const runner = readFileSync(
      join(process.cwd(), 'scripts/apply-migrations.ts'),
      'utf8',
    );
    // The runner lists the directory non-recursively and filters .sql
    // files; assert both halves so a future recursive glob is caught.
    expect(runner).toMatch(/readdirSync\(migrationsDir\)/);
    expect(runner).not.toMatch(/recursive:\s*true/);
  });
});
