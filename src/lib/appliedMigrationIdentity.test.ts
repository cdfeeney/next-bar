import { describe, expect, it } from 'vitest';

import { migrationChecksum } from './effectiveMigration';

/**
 * A MIGRATION THE LEDGER NAMES IS FROZEN. This file is the guard that says so.
 *
 * Phase C applied 0033–0074 to production on 2026-08-31, taking each file from
 * `release/v8`. From that moment their bytes are described by a checksum row in
 * `public.schema_migrations`, and editing one of them is not a fix — it is a file
 * that no longer matches what ran, on a database nothing will re-run it against.
 * WP5 and WP6 were mid-review when that happened and were still delivering fixes
 * by editing 0069 and 0067 in place; 0076 exists because they could not.
 *
 * WHY IT LIVES NEXT TO `feedMigration.test.ts` RATHER THAN INSIDE IT. That suite
 * now reads 0069 AND 0076 and asserts over the LAST definition of each object, so
 * every one of its cases would stay green if somebody satisfied it by editing
 * 0069 instead of 0076 — which is exactly the move this file forbids. A green
 * feed suite with a changed 0069 is a FAILED run, and only a checksum can tell
 * the difference.
 *
 * THE VALUES ARE THE APPLIED ONES, and that is checkable rather than asserted:
 * three of them appear in the goal record that commissioned 0076, measured
 * against the production ledger with the ledger's own algorithm —
 *   0069  a4ee3d8b91a3aed8...   0067  6b0a219646d16f05...   0066  10aed3c67ad56531...
 * — and they are the first sixteen characters of the three entries below.
 *
 * `migrationChecksum` is the ledger's algorithm, not a hash of the raw bytes:
 * CRLF folded to LF, then whitespace stripped from the END OF THE FILE. Hashing
 * raw bytes on a `core.autocrlf` checkout reports drift for every multi-line file
 * and has already cost this project one false alarm (CLAUDE.md, 2026-08-16 vs
 * 2026-08-19). Do not re-derive these with `sha256sum`.
 *
 * WHEN THIS FAILS: do not update the constant. The file was edited; put the
 * change in a NEW migration numbered above the ledger head.
 */
const APPLIED = {
  '0066_media_boundary.sql':
    '10aed3c67ad56531680b556283e2705955c5e608726c068a2c8d1954e8196fdc',
  '0067_groups.sql':
    '6b0a219646d16f0542e3b33ec048aafd73bab4b2cd2be19557ec3a986ef0d8db',
  '0068_nightout_media_presence.sql':
    'ae812018e5e477da525ee50be09c9ace99e4e79897f17afae90e9b3bf7e934a0',
  '0069_feed_and_comments.sql':
    'a4ee3d8b91a3aed8b2d430cd41d760be18ab42f2d0cc2d09b749446baed72711',
  '0070_ratings_server_ownership.sql':
    'd7a7098960cc91fc8b0e8434b64a7379a89bdd27f29f70fd4cb0a8031c1db9a3',
  '0071_story_media_legacy_policy_removal.sql':
    '964933ecd10cf4a9f9aa1eec668f00ab2376bad8751b3fcf5f310399fd9ec8d8',
  '0074_waitlist_reconcile.sql':
    'da108d6583b5d0fa0dbc1a717ebaff4a0ab7ebd6db2ec9850d5328c08beaab28',
} as const;

describe('an applied migration is frozen by the ledger', () => {
  for (const [file, checksum] of Object.entries(APPLIED)) {
    it(`${file} still hashes to the value the ledger recorded`, () => {
      expect(
        migrationChecksum(file),
        `${file} has been edited. It is applied — its bytes are described by a `
        + 'schema_migrations row and nothing will re-run it. Revert this file and '
        + 'put the change in a new migration numbered above the ledger head.',
      ).toBe(checksum);
    });
  }
});
