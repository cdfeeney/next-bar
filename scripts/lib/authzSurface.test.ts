import { describe, expect, it } from 'vitest';
import {
  SERVICE_ROLE_ONLY_TABLES,
  functionsDefined,
  readMigrations,
  stripSqlComments,
  tableGrants,
  tablesCreated,
  tablesWithRlsEnabled,
  type MigrationFile,
} from './authzSurface';

/**
 * Static authorization checks over `supabase/migrations/*.sql`.
 *
 * READ-ONLY AND OFFLINE BY CONSTRUCTION: these read local files only. They do
 * NOT prove Staging or Production actually enforce any of this — that requires
 * running `docs/SUPABASE-AUTHZ-VERIFICATION-RUNBOOK.md` against a live
 * database, which is an attended operation. What they prove is that the
 * migrations, which are the source of truth the runbook compares against,
 * still say what we think they say.
 */

const files = readMigrations();

/** Build a fake migration set, so the assertions can be shown to actually bite. */
function fake(sql: string): MigrationFile[] {
  return [{ prefix: '9999', name: '9999_fixture.sql', sql }];
}

describe('migration corpus', () => {
  it('finds the real migrations', () => {
    // Guards against a silent empty match set — an assertion over zero files
    // passes forever and proves nothing.
    expect(files.length).toBeGreaterThan(30);
    expect(files.every((f) => /^\d{4}$/.test(f.prefix))).toBe(true);
  });

  it('has no DUPLICATE numeric prefixes', () => {
    // Duplicates are the dangerous case: two files with one number apply in an
    // ambiguous order. Gaps are NOT asserted — 0037..0041 are genuinely absent
    // on this base and live on release branches; the runbook records that as a
    // question for the operator rather than pretending it is an error.
    const seen = new Map<string, string[]>();
    for (const f of files) {
      seen.set(f.prefix, [...(seen.get(f.prefix) ?? []), f.name]);
    }
    const dupes = [...seen.entries()].filter(([, names]) => names.length > 1);
    expect(dupes).toEqual([]);
  });
});

describe('RLS coverage', () => {
  it('every created table has an explicit RLS decision', () => {
    const created = tablesCreated(files);
    const withRls = tablesWithRlsEnabled(files);
    expect(created.length).toBeGreaterThan(15);

    const missing = created
      .filter((t) => !withRls.has(t.name))
      .map((t) => `${t.name} (${t.file})`);
    expect(missing).toEqual([]);
  });

  it('FAILS when a table is created without enabling RLS', () => {
    // Non-vacuity: the check above must actually bite.
    const broken = fake('create table if not exists public.leaky (id uuid);');
    const created = tablesCreated(broken);
    const withRls = tablesWithRlsEnabled(broken);
    expect(created.map((t) => t.name)).toEqual(['leaky']);
    expect(withRls.has('leaky')).toBe(false);
  });
});

describe('SECURITY DEFINER functions', () => {
  const functions = functionsDefined(files);

  it('parses a substantial number of function definitions', () => {
    expect(functions.length).toBeGreaterThan(20);
  });

  it('every SECURITY DEFINER function pins search_path', () => {
    // A definer function runs with the OWNER's privileges. Without a pinned
    // search_path a caller can prepend a schema they control and have the
    // function resolve to their table or operator instead — privilege
    // escalation, not a style nit.
    const unpinned = functions
      .filter((f) => f.isSecurityDefiner && !f.pinsSearchPath)
      .map((f) => `${f.name} (${f.file})`);
    expect(unpinned).toEqual([]);
  });

  it('FAILS on a definer function with no search_path', () => {
    const broken = fake(`
      create or replace function public.escalate(p int)
      returns void
      language plpgsql
      security definer
      as $$ begin perform 1; end; $$;
    `);
    const parsed = functionsDefined(broken);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].isSecurityDefiner).toBe(true);
    expect(parsed[0].pinsSearchPath).toBe(false);
  });

  it('does NOT count a definer mention inside a comment as a definer function', () => {
    // The reason this parses per function rather than counting per file: a
    // file-level count cannot tell a comment from a vulnerability, and this
    // repository has files where those counts genuinely disagree.
    const commented = fake(`
      -- security definer was considered here and rejected
      /* security definer */
      create or replace function public.safe(p int)
      returns void
      language sql
      set search_path = public
      as $$ select 1; $$;
    `);
    const parsed = functionsDefined(commented);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].isSecurityDefiner).toBe(false);
  });

  it('reads attributes declared AFTER the function body too', () => {
    const trailing = fake(`
      create or replace function public.after(p int)
      returns void
      language plpgsql
      as $$ begin perform 1; end; $$
      security definer
      set search_path = public;
    `);
    const parsed = functionsDefined(trailing);
    expect(parsed[0].isSecurityDefiner).toBe(true);
    expect(parsed[0].pinsSearchPath).toBe(true);
  });

  it('does not let one function\'s attributes leak into the next', () => {
    const two = fake(`
      create or replace function public.first(p int)
      returns void language sql security definer set search_path = public
      as $$ select 1; $$;

      create or replace function public.second(p int)
      returns void language sql
      as $$ select 2; $$;
    `);
    const parsed = functionsDefined(two);
    expect(parsed.map((f) => f.name)).toEqual(['first', 'second']);
    expect(parsed[0].isSecurityDefiner).toBe(true);
    expect(parsed[1].isSecurityDefiner).toBe(false);
  });
});

describe('service-role-only tables', () => {
  it('grant nothing to anon or authenticated', () => {
    // These are counters whose only writer is the service role. A grant to a
    // client role would let an anonymous caller read or forge them.
    const offenders = tableGrants(files)
      .filter((g) => SERVICE_ROLE_ONLY_TABLES.includes(g.table))
      .filter((g) => g.roles.some((r) => r === 'anon' || r === 'authenticated'))
      .map((g) => `${g.table} -> ${g.roles.join(',')} (${g.file})`);
    expect(offenders).toEqual([]);
  });

  it('are each actually present in the corpus', () => {
    // Otherwise the assertion above is vacuous: a typo in the table name
    // would make it pass over an empty set forever.
    const created = new Set(tablesCreated(files).map((t) => t.name));
    for (const table of SERVICE_ROLE_ONLY_TABLES) {
      expect(created.has(table)).toBe(true);
    }
  });

  it('FAILS on a grant to anon', () => {
    const broken = fake(
      'grant select on table public.rate_limits to anon, authenticated;',
    );
    const found = tableGrants(broken);
    expect(found).toHaveLength(1);
    expect(found[0].roles).toContain('anon');
  });
});

describe('stripSqlComments', () => {
  it('removes line and block comments without eating real SQL', () => {
    const out = stripSqlComments(
      "select 1; -- grant all to anon\n/* grant all to anon */ select 2;",
    );
    expect(out).toContain('select 1;');
    expect(out).toContain('select 2;');
    expect(out).not.toContain('grant all to anon');
  });
});
