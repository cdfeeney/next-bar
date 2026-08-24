import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { definingMigration, migrationView } from './effectiveMigration';

/**
 * 0064's security SHAPE, read from the committed SQL.
 *
 * The authoritative control is `friendScoreRls.live.test.ts`, which asks a real
 * database whether it denies anyone. This file is the half that runs everywhere
 * — including CI, which has no credentials — and it guards the two things text
 * can actually settle: that the widened function is the one the stream ends on,
 * and that what widened is the COLUMN LIST and not the audience.
 *
 * Everything is read through `sqlView().code`, so prose in a migration header
 * quoting a grant is not a grant.
 */

const FRIEND_FN = 'get_friend_ratings';

function migrationCode(file: string): string {
  return migrationView(file).code;
}

/** Comments AND string literals blanked — for "this word appears nowhere executable". */
function migrationSkeleton(file: string): string {
  return migrationView(file).skeleton;
}

describe('0064 — the numeric score across the friend boundary', () => {
  const defining = definingMigration(FRIEND_FN);

  it('is the migration that currently states get_friend_ratings', () => {
    // Derived, never hard-coded to 0064: if a later migration re-states the
    // function, this suite follows it there rather than guarding dead text.
    expect(defining, 'no committed migration defines get_friend_ratings').not.toBeNull();
    expect(defining).toBe('0064_friend_ratings_score.sql');
  });

  it('returns the numeric score alongside the columns 0007 already returned', () => {
    const code = migrationCode(defining as string);
    expect(code).toMatch(
      /returns\s+table\s*\(\s*user_id\s+uuid\s*,\s*bar_id\s+text\s*,\s*tier\s+text\s*,\s*score\s+numeric\s*,\s*rated_at\s+timestamptz\s*\)/,
    );
    expect(code, 'the score is declared but never selected').toMatch(/select\s+r\.user_id\s*,\s*r\.bar_id\s*,\s*r\.tier::text\s*,\s*r\.score\s*,\s*r\.rated_at/);
  });

  it('widens the columns WITHOUT widening the audience', () => {
    const code = migrationCode(defining as string);
    // 0007's edge, unchanged: rows only for accounts the caller FOLLOWS.
    expect(code).toMatch(/from\s+public\.follows\s+f\b/);
    expect(code).toMatch(/f\.follower_id\s*=\s*auth\.uid\(\)/);
    expect(code).toMatch(/f\.followee_id\s*=\s*r\.user_id/);
    // A pending request is not a follow. If a future edit gates on this table
    // instead, criterion 4c is gone and this fails before anyone runs a
    // database.
    expect(code, 'the gate now reads follow_requests').not.toMatch(/follow_requests/);
    // The reverse edge would hand scores to accounts the owner follows but who
    // never followed back — a wider audience than the one that was approved.
    expect(code, 'the gate now also matches the reverse follow edge')
      .not.toMatch(/f\.followee_id\s*=\s*auth\.uid\(\)/);
  });

  it('keeps the MATERIALIZED fence that stops the side-channel', () => {
    // uuid `=` is LEAKPROOF, so without this the planner pushes a caller's
    // `where user_id = X` below the EXISTS gate — a timing oracle over
    // unfollowed users. Carrying a second column makes that worse, not better.
    expect(migrationCode(defining as string)).toMatch(/with\s+gated\s+as\s+materialized/);
  });

  it('leaves EXECUTE revoked from public and anon', () => {
    const code = migrationCode(defining as string);
    expect(code).toMatch(/revoke\s+all\s+on\s+function\s+public\.get_friend_ratings\(\)\s+from\s+public\s*,\s*anon/);
    expect(code).toMatch(/grant\s+execute\s+on\s+function\s+public\.get_friend_ratings\(\)\s+to\s+authenticated/);
    expect(code, '0064 grants the function to a role beyond authenticated')
      .not.toMatch(/grant\s+execute[\s\S]*?to\s+(?:public|anon)\b/);
  });

  it('is security definer with a pinned search_path, as 0007 was', () => {
    const code = migrationCode(defining as string);
    expect(code).toMatch(/security\s+definer/);
    expect(code).toMatch(/set\s+search_path\s*=\s*public/);
  });

  it('does not edit the applied 0007 file that the ledger checksums', () => {
    // 0064 supersedes 0007's "never add score" rule in prose; editing 0007
    // would change the checksum public.schema_migrations already recorded.
    const code = migrationCode('0007_follows.sql');
    expect(code).toMatch(/returns\s+table\s*\(\s*user_id\s+uuid\s*,\s*bar_id\s+text\s*,\s*tier\s+text\s*,\s*rated_at\s+timestamptz\s*\)/);
  });

  it('UPDATEs no rows, so 0005\'s silent ratings_lww trigger cannot apply', () => {
    // ratings_lww RETURNS NULL — skipping the row and reporting success — for
    // any update that does not bump updated_at. The goal asks for this to be
    // confirmed rather than assumed.
    const code = migrationSkeleton(defining as string);
    expect(code, '0064 now writes rows and must handle the lww trigger')
      .not.toMatch(/\b(update|insert\s+into|delete\s+from|truncate)\b/);
  });
});

describe('the anonymous surfaces stay tier-only (criterion 5)', () => {
  // RETIRED BY 0066 (EC-04), so these guard its ABSENCE rather than its shape.
  //
  // get_public_ratings returned the legacy Loved/Liked/Pass tier over a
  // shares_list_publicly opt-in. V8 uses numeric scores; V8-R-RNK-001 excludes tiers
  // as "legacy implementation concepts, not the V8 model", and the founder-approved
  // 3.1.0 ledger mentions neither the RPC, the flag, nor a public list. No
  // replacement is approved. Guarding the SHAPE of a dead surface is part of what
  // made it look maintained; the invariant that matters is that nothing brings it back.
  it('get_public_ratings is retired by a forward migration', () => {
    expect(
      migrationCode('0066_media_boundary.sql'),
      '0066 must retire get_public_ratings',
    ).toMatch(/drop\s+function\s+if\s+exists\s+public\.get_public_ratings/);
  });

  it('no migration re-states get_public_ratings after its retirement', () => {
    // 0015 is history and is never rewritten, so it may still define it. Anything
    // NEWER defining it would be a reintroduction of a superseded surface.
    const defining = definingMigration('get_public_ratings');
    expect(
      defining === null || defining === '0015_public_shared_list.sql',
      `get_public_ratings is redefined by ${defining}, after 0066 retired it`,
    ).toBe(true);
  });

  it('0016 shared nights carries no score', () => {
    expect(migrationSkeleton('0016_shared_nights.sql')).not.toMatch(/\bscore\b/);
  });

  // The caller is GONE, not merely score-free. publicList.server.ts wrapped the
  // retired get_public_ratings, had no importers anywhere in the tree, and was
  // deleted by EC-04. Asserting a deleted file "handles no score" would pass
  // vacuously forever; asserting its absence is what stops it coming back.
  it('the public list server path no longer exists', () => {
    expect(
      existsSync(path.join(__dirname, 'publicList.server.ts')),
      'publicList.server.ts is back — it wraps a retired tier-bearing surface',
    ).toBe(false);
  });
});
