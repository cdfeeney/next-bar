import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Two of this lane's requirements are discharged ENTIRELY in SQL, and nothing
 * in the local gate executes SQL — typecheck, vitest and the Playwright release
 * run are all green over a migration that never parsed, which is the exact
 * failure `scripts/migration-dollar-quote.test.ts` was written for after 0065.
 *
 * So these are text assertions, and they are deliberately narrow: each one pins
 * a clause that, if it were dropped, would silently un-implement a requirement
 * while every other check stayed green.
 *
 *   V8-R-CMP-012  bytes are not removable while a live reference exists
 *   V8-R-STO-016  audience and tag metadata stop being queryable after deletion
 *   V8-R-FEED-009 the block check is bidirectional
 *   V8-R-FEED-010 the report record is server-owned
 *
 * A text scan is not a substitute for applying the migration against a
 * database. It is the strongest check available in a lane that is forbidden
 * from touching a shared one.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '0066_media_boundary.sql'),
  'utf8',
);

/**
 * Comments are STRIPPED before anything below is asserted.
 *
 * This file's header comments quote the requirements verbatim, so a scan of the
 * raw text matches its own prose: the first version of the grant assertion
 * below failed on "...no write grant... a client that can insert its own media
 * row... on public.media_objects", which is a sentence, not a statement. That
 * cuts both ways and the false-negative was the lucky half — every positive
 * assertion here would equally have passed on a comment that merely DESCRIBED
 * the clause, so a migration could have lost a policy and stayed green.
 *
 * No string literal in this migration contains `--`, so a line-wise strip is
 * exact rather than approximate.
 */
const STATEMENTS = SQL
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

/** Collapse whitespace so an assertion is about the clause, not its wrapping. */
const FLAT = STATEMENTS.replace(/\s+/g, ' ');

describe('0066 — V8-R-CMP-012 bytes outlive nothing but their last reference', () => {
  it('gates the storage DELETE policy on the reference count', () => {
    expect(FLAT).toContain(
      'and not public.media_path_has_live_reference(\'story-media\', name)',
    );
  });

  it('keeps 0065 prefix scoping, so a delete cannot reach another user', () => {
    expect(FLAT).toContain('(storage.foldername(name))[1] = auth.uid()::text');
  });

  it('counts references with a definer function, not through the caller\'s RLS', () => {
    // A caller-visible count reports zero for references it merely cannot see,
    // and zero is what authorizes destroying the bytes.
    expect(FLAT).toMatch(
      /create or replace function public\.media_live_reference_count\(p_media_id uuid\).*?security definer/i,
    );
  });

  it('locks the media row before counting, so a concurrent add cannot be missed', () => {
    expect(FLAT).toContain('for update of m');
  });

  it('leaves archive holds standing when deleting everywhere', () => {
    // V8-R-CMP-016: bytes are reclaimed only if no Saved Nights Out archive
    // still references them.
    expect(FLAT).toContain("and d.kind <> 'archive'");
  });
});

describe('0066 — V8-R-STO-016 deletion clears metadata too', () => {
  it('gates story_audience reads on the story still being live', () => {
    expect(FLAT).toContain('and public.is_story_live(story_id)');
  });

  it('gates story_tags reads on the story still being live', () => {
    expect(FLAT).toContain(
      'create policy "story_tags: readable with story" on public.story_tags for select using (public.is_story_live(story_id))',
    );
  });

  it('replaces both 0065 policies rather than adding a second, weaker one', () => {
    expect(FLAT).toContain('drop policy if exists "story_audience: parties read"');
    expect(FLAT).toContain('drop policy if exists "story_tags: readable with story"');
  });

  it('checks liveness with a definer helper, avoiding 0065\'s recursion trap', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.is_story_live\(p_story_id uuid\).*?security definer/i,
    );
  });

  it('retires story destinations inside delete_story, not in a client', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.delete_story.*?update public\.media_destinations d set removed_at = now\(\) where d\.kind = 'story'/i,
    );
  });
});

describe('0066 — V8-R-FEED-009 blocking is enforced both ways', () => {
  it('matches a block in either direction', () => {
    expect(FLAT).toContain(
      'where (pb.blocker_id = a and pb.blocked_id = b) or (pb.blocker_id = b and pb.blocked_id = a)',
    );
  });

  it('answers as definer, so the blocked party cannot read past it', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.is_blocked_between\(a uuid, b uuid\).*?security definer/i,
    );
  });
});

describe('0066 — V8-R-FEED-010 the report record is server-owned', () => {
  it('grants the reporter SELECT and nothing else on content_reports', () => {
    expect(FLAT).toContain('grant select on public.content_reports to authenticated');
    // No UPDATE and no DELETE anywhere: that absence IS the requirement that a
    // reporter cannot edit or withdraw a report into invisibility.
    expect(FLAT).not.toMatch(/grant[^;]*update[^;]*on public\.content_reports/i);
    expect(FLAT).not.toMatch(/grant[^;]*delete[^;]*on public\.content_reports/i);
  });

  it('has no UPDATE or DELETE policy on content_reports', () => {
    expect(FLAT).not.toMatch(/create policy[^;]*on public\.content_reports for update/i);
    expect(FLAT).not.toMatch(/create policy[^;]*on public\.content_reports for delete/i);
  });

  it('writes the report through a definer function that stamps the reporter', () => {
    expect(FLAT).toContain('values (auth.uid(), p_subject_kind, p_subject_ref, p_reason)');
  });
});

describe('0066 — the media registry is not client-writable', () => {
  it('grants only SELECT on media_objects and media_destinations', () => {
    expect(FLAT).toContain('grant select on public.media_objects to authenticated');
    expect(FLAT).toContain('grant select on public.media_destinations to authenticated');
    // A client that can insert its own media row declares its own content_type,
    // which defeats V8-R-STO-014's server-side verification.
    expect(FLAT).not.toMatch(/grant[^;]*insert[^;]*on public\.media_objects/i);
    expect(FLAT).not.toMatch(/grant[^;]*insert[^;]*on public\.media_destinations/i);
  });

  it('enables row level security on every table it creates', () => {
    for (const table of [
      'media_objects',
      'media_destinations',
      'profile_blocks',
      'content_reports',
    ]) {
      expect(FLAT).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i'),
      );
    }
  });
});

describe('0066 — idempotency', () => {
  it('creates every table with if not exists', () => {
    const creates = STATEMENTS.match(/create table[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const statement of creates) {
      expect(statement.toLowerCase()).toContain('if not exists');
    }
  });

  it('drops each policy before creating it', () => {
    const created = [...STATEMENTS.matchAll(/create policy\s+"([^"]+)"/gi)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      expect(
        SQL,
        `policy ${name} is created without a preceding drop policy if exists`,
      ).toContain(`drop policy if exists "${name}"`);
    }
  });

  it('creates every index with if not exists', () => {
    const creates = STATEMENTS.match(/create (unique )?index[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const statement of creates) {
      expect(statement.toLowerCase()).toContain('if not exists');
    }
  });
});
