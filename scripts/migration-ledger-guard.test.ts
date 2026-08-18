import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ledgerHead, migrationNumber, findUnappliable, describeUnappliable } from './migration-ledger-guard';

// The live ledger as read on 2026-08-17 (read-only query recorded in the goal):
// head 0059, real gaps at 0038-0040, and 0055/0056 reserved by another branch
// and applied nowhere. Truncated to the rows the assertions actually need.
const LIVE_LEDGER = [
  '0000_init.sql',
  '0036_protect_schema_migrations.sql',
  '0037_something.sql',
  '0041_something.sql',
  '0052_night_outs_my_invites.sql',
  '0059_whatever.sql',
];

describe('migrationNumber', () => {
  it('reads the numeric prefix', () => {
    expect(migrationNumber('0052_night_outs_my_invites.sql')).toBe(52);
  });

  it('ignores files that are not numbered migrations', () => {
    expect(migrationNumber('README.md')).toBeNull();
    expect(migrationNumber('night_outs.sql')).toBeNull();
  });
});

describe('ledgerHead', () => {
  // Criterion 3: head is the max numeric prefix present, never a count and
  // never a contiguity assumption. The live ledger genuinely has holes.
  it('is the max numeric prefix, not the row count', () => {
    expect(ledgerHead(LIVE_LEDGER)).toBe(59);
  });

  it('is unaffected by gaps', () => {
    expect(ledgerHead(['0041_a.sql', '0059_b.sql'])).toBe(59);
  });

  it('cannot be established from an empty ledger', () => {
    expect(ledgerHead([])).toBeNull();
  });
});

describe('findUnappliable', () => {
  // Criterion 1: below-or-equal head AND absent from the ledger. Both required.
  it('flags a migration at or below head that the ledger does not know', () => {
    const found = findUnappliable(['0045_forked_before_trunk_advanced.sql'], LIVE_LEDGER);
    expect(found).toEqual([{ name: '0045_forked_before_trunk_advanced.sql', number: 45, head: 59 }]);
  });

  it('flags a migration numbered exactly at head', () => {
    expect(findUnappliable(['0059_collides_with_head.sql'], LIVE_LEDGER)).toHaveLength(1);
  });

  // Criterion 2: the normal state of every historical migration. 0052 is the
  // regression fixture — it is below head and it is applied, so it must pass.
  it('passes a below-head migration that IS in the ledger', () => {
    expect(findUnappliable(['0052_night_outs_my_invites.sql'], LIVE_LEDGER)).toEqual([]);
  });

  it('passes a migration numbered above head', () => {
    expect(findUnappliable(['0060_next_one.sql'], LIVE_LEDGER)).toEqual([]);
  });

  // Criterion 3 again, from the file side: a file sitting in a ledger gap is
  // still a violation, but only because it is absent — not because of the gap.
  it('does not treat a ledger gap as an error by itself', () => {
    expect(findUnappliable([], LIVE_LEDGER)).toEqual([]);
  });

  it('ignores unnumbered files in the migrations directory', () => {
    expect(findUnappliable(['README.md'], LIVE_LEDGER)).toEqual([]);
  });

  // Criterion 7: the fixture fails before renumbering and passes after.
  it('passes the same fixture once it is renumbered above head', () => {
    expect(findUnappliable(['0045_forked.sql'], LIVE_LEDGER)).toHaveLength(1);
    expect(findUnappliable(['0060_forked.sql'], LIVE_LEDGER)).toEqual([]);
  });
});

describe('describeUnappliable', () => {
  // Criterion 4: name the file, the head it lost to, and the remedy.
  it('names the file, the head, and the remedy', () => {
    const [offender] = findUnappliable(['0045_forked.sql'], LIVE_LEDGER);
    const message = describeUnappliable(offender);
    expect(message).toContain('0045_forked.sql');
    expect(message).toContain('0059');
    expect(message).toMatch(/renumber/i);
  });
});

describe('the real supabase/migrations directory', () => {
  const files = readdirSync(join(process.cwd(), 'supabase', 'migrations'));

  // Criterion 2's regression fixture, run against the actual on-disk filename
  // rather than a string typed into this test. 0052 is below head 0059 and IS
  // applied, so it must never be flagged.
  it('does not flag 0052_night_outs_my_invites.sql against head 0059', () => {
    expect(files).toContain('0052_night_outs_my_invites.sql');
    const ledger = [...files, '0059_head_from_another_branch.sql'];
    expect(findUnappliable(files, ledger)).toEqual([]);
  });

  // Criterion 1 end-to-end over the real file list: drop one applied row out of
  // the ledger and that file — and only that file — becomes unappliable.
  it('flags a real migration once the ledger stops knowing about it', () => {
    const ledger = [...files, '0059_head_from_another_branch.sql']
      .filter((name) => name !== '0052_night_outs_my_invites.sql');
    expect(findUnappliable(files, ledger)).toEqual([
      { name: '0052_night_outs_my_invites.sql', number: 52, head: 59 },
    ]);
  });
});
