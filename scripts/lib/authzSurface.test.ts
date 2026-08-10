import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANON_EXECUTABLE_FUNCTIONS,
  ANON_READABLE_TABLES,
  COLUMN_SCOPED_GRANTS,
  LEGACY_SCHEMA_FILE,
  TRUE_PREDICATE_POLICIES,
  TRUE_PREDICATE_POLICIES_V01,
  V01_LEGACY_TABLES,
  policiesWithTruePredicate,
  legacyRenames,
  legacySchemaPolicies,
  legacySchemaTables,
  DEFINERS_WITHOUT_AUTH_UID,
  FUNCTIONS_WITHOUT_PUBLIC_REVOKE,
  POLICY_LESS_BY_DESIGN,
  RUNNER_MANAGED_TABLES,
  SERVICE_ROLE_ONLY_TABLES,
  anonTableGrants,
  expectedPublicTables,
  functionGrants,
  functionsDefined,
  functionsWithoutPublicRevoke,
  liveFunctionOverloadConflicts,
  liveFunctions,
  netColumnPrivileges,
  netTablePrivileges,
  policiesByTable,
  policyDefinitions,
  policyLessTables,
  policyStatements,
  privilegeStatements,
  readMigrations,
  stripSqlComments,
  tableGrants,
  tablesCreated,
  tablesRelyingOnDefaultGrants,
  tablesWithRlsEnabled,
  unmodelableGrantStatements,
  unmodelledObjectStatements,
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
 *
 * Every assertion over the real corpus is paired with (a) a guard that the
 * match set is non-empty, so it cannot pass vacuously, and (b) a fixture that
 * exercises the FAILING direction, so it is shown to actually bite.
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

  it('every RLS-enabled table is either created by a migration or a known runner table', () => {
    // The inverse gap, and the reason the runbook's table count was wrong:
    // `schema_migrations` is hardened by 0036 but CREATED by the runner
    // (MIGRATION_LEDGER_DDL in scripts/lib/migrationLedger.ts), so it shows up
    // in the RLS scan and not in the `create table` scan. Any OTHER name
    // appearing here is a table nobody in this repository creates.
    const created = new Set(tablesCreated(files).map((t) => t.name));
    const orphans = [...tablesWithRlsEnabled(files)].filter((t) => !created.has(t)).sort();
    expect(orphans).toEqual([...RUNNER_MANAGED_TABLES].sort());
  });

  it('counts the runner-managed table in the expected public schema', () => {
    const expected = expectedPublicTables(files);
    const created = [...new Set(tablesCreated(files).map((t) => t.name))];
    expect(expected).toContain('schema_migrations');
    expect(expected.length).toBe(created.length + RUNNER_MANAGED_TABLES.length);
  });
});

describe('SECURITY DEFINER functions', () => {
  const functions = functionsDefined(files);

  it('parses a substantial number of function definitions', () => {
    expect(functions.length).toBeGreaterThan(20);
    expect(functions.filter((f) => f.isSecurityDefiner).length).toBeGreaterThan(20);
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

  it('does not let a LATER statement pin an unpinned definer function', () => {
    // The attribute tail is bounded at the statement's semicolon. Reading to
    // the start of the next function instead would let this unrelated
    // `alter function` mark `victim` as pinned when it is not — a false
    // "all definers are pinned" on the single highest-value check here.
    const trailingAlter = fake(`
      create or replace function public.victim(p int)
      returns void
      language plpgsql
      security definer
      as $$ begin perform 1; end; $$;

      alter function public.unrelated(int) set search_path = public;

      create or replace function public.other(p int)
      returns void language sql set search_path = public
      as $$ select 1; $$;
    `);
    const parsed = functionsDefined(trailingAlter);
    const victim = parsed.find((f) => f.name === 'victim');
    expect(victim?.isSecurityDefiner).toBe(true);
    expect(victim?.pinsSearchPath).toBe(false);
  });
});

describe('policies', () => {
  const byTable = policiesByTable(files);
  const allPolicies = [...byTable.values()].flat();

  it('finds the policies at all', () => {
    // Non-vacuity, and a real trap: EVERY `create policy` in this corpus puts
    // its `on public.<table>` on the NEXT line, so a line-oriented match finds
    // zero policies and reports all 22 tables as policy-less. That mistake was
    // made while verifying this module by hand.
    expect(allPolicies.length).toBeGreaterThan(20);
    expect(policyStatements(files).length).toBeGreaterThan(30);
  });

  it('parses QUOTED policy names containing colons and spaces', () => {
    // "profiles: owner can read own" — the colon is what broke the ad-hoc
    // character class that started this.
    const quoted = allPolicies.filter((p) => p.includes(': '));
    expect(quoted.length).toBeGreaterThan(10);
    expect(byTable.get('profiles')).toContain('profiles: owner can read own');
  });

  it('finds a policy whose target table is on the following line', () => {
    const wrapped = fake(`
      create policy "widgets: owner can read own"
        on public.widgets for select
        using (auth.uid() = user_id);
    `);
    expect(policiesByTable(wrapped).get('widgets')).toEqual([
      'widgets: owner can read own',
    ]);
  });

  it('replays drops, so a dropped policy is NOT counted', () => {
    // 0012 creates bar_rsvps_delete_own and 0014 drops it with no replacement.
    // Counting `create policy` alone would claim bar_rsvps has a policy.
    expect(byTable.get('bar_rsvps') ?? []).toEqual([]);

    const dropped = fake(`
      create policy gone on public.widgets for select using (true);
      drop policy if exists gone on public.widgets;
    `);
    expect(policiesByTable(dropped).get('widgets')).toEqual([]);
  });

  it('a drop followed by a re-create leaves the policy present', () => {
    // The house idempotency pattern; getting the order wrong would report
    // every re-created policy as absent.
    const recreated = fake(`
      drop policy if exists "widgets: read" on public.widgets;
      create policy "widgets: read" on public.widgets for select using (true);
    `);
    expect(policiesByTable(recreated).get('widgets')).toEqual(['widgets: read']);
  });
});

describe('policy-less tables (RLS on, zero policies)', () => {
  it('the DERIVED set matches the reviewed declaration exactly', () => {
    // RLS with no policy is default-deny: correct and deliberate for counters
    // and internal ledgers, indistinguishable from a forgotten policy
    // otherwise. Asserting derived === declared means a new policy-less table
    // cannot appear without a human deciding it is intentional, and a
    // policy-less table cannot silently gain a policy either.
    const derived = policyLessTables(files);
    expect(derived.length).toBeGreaterThan(5);
    expect(derived).toEqual([...POLICY_LESS_BY_DESIGN].sort());
  });

  it('every service-role-only table is policy-less', () => {
    for (const t of SERVICE_ROLE_ONLY_TABLES) {
      expect(POLICY_LESS_BY_DESIGN).toContain(t);
    }
  });

  it('FAILS to list a table that has a policy, and lists one that does not', () => {
    const mixed = fake(`
      create table if not exists public.guarded (id uuid);
      alter table public.guarded enable row level security;
      create policy guarded_read on public.guarded for select using (true);

      create table if not exists public.bare (id uuid);
      alter table public.bare enable row level security;
    `);
    expect(policyLessTables(mixed)).toEqual(['bare']);
  });
});

describe('table grants', () => {
  it('finds the grants at all', () => {
    // Corpus-level non-vacuity: without this, every grant assertion below
    // could pass over an empty match set forever.
    expect(tableGrants(files).length).toBeGreaterThan(10);
    expect(privilegeStatements(files).length).toBeGreaterThan(20);
    expect(privilegeStatements(files).filter((s) => s.action === 'revoke').length)
      .toBeGreaterThan(10);
  });

  it('service-role-only tables grant nothing to anon or authenticated', () => {
    // These are counters whose only writer is the service role. A grant to a
    // client role would let an anonymous caller read or forge them.
    const offenders = tableGrants(files)
      .filter((g) => SERVICE_ROLE_ONLY_TABLES.includes(g.table))
      .filter((g) => g.roles.some((r) => r === 'anon' || r === 'authenticated'))
      .map((g) => `${g.table} -> ${g.roles.join(',')} (${g.file})`);
    expect(offenders).toEqual([]);
  });

  it('service-role-only tables are each actually present in the corpus', () => {
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

  it('the DERIVED anon-readable table set matches the reviewed allowlist', () => {
    // Generated, not hand-written. A spot check on two named tables cannot see
    // a `grant ... to anon` appearing on a THIRD table, which is the failure
    // it is supposed to prevent.
    const derived = anonTableGrants(files);
    expect(derived.map((g) => g.table).sort()).toEqual([...ANON_READABLE_TABLES].sort());
    // Anonymous access is READ-ONLY: catalog data, never a write path.
    for (const g of derived) expect(g.privileges).toEqual(['select']);
  });

  it('FAILS when a new table is granted to anon', () => {
    const broken = fake(`
      create table if not exists public.secrets (id uuid);
      alter table public.secrets enable row level security;
      revoke all on table public.secrets from public, anon, authenticated;
      grant select on table public.secrets to anon;
    `);
    expect(anonTableGrants(broken).map((g) => g.table)).toEqual(['secrets']);
  });

  it('replays revoke-then-grant to get the NET privilege set', () => {
    const replayed = fake(`
      grant all on table public.widgets to authenticated;
      revoke all on table public.widgets from public, anon, authenticated;
      grant select, insert on table public.widgets to authenticated;
    `);
    const net = netTablePrivileges(replayed);
    expect(net.get('widgets')?.get('authenticated')).toEqual(['insert', 'select']);
    expect(net.get('widgets')?.get('anon')).toBeUndefined();
  });

  it('reads a column-scoped grant as the privilege, not the column list', () => {
    // `grant update (display_name, is_private) on table public.profiles`
    // (0006/0034) — the column list must not be parsed as privilege names.
    const scoped = fake(
      'grant update (display_name, is_private) on table public.profiles to authenticated;',
    );
    expect(privilegeStatements(scoped)[0].privileges).toEqual(['update']);
  });

  it('does NOT read a function grant as a table grant', () => {
    // `grant execute on function public.get_public_ratings(text) to anon` is a
    // different surface. Counting it as an anonymous TABLE grant would raise a
    // false alarm on a healthy database.
    const fnGrant = fake(
      'grant execute on function public.get_public_ratings(text) to anon, authenticated;',
    );
    expect(privilegeStatements(fnGrant)).toEqual([]);
    expect(tableGrants(fnGrant)).toEqual([]);
  });

  it('every created table is revoke-first', () => {
    // The house pattern (0019:80). It matters for reading Check 3: on a
    // revoke-first table the deployed grants should match the migrations
    // exactly, because Supabase's default `grant all ... to anon,
    // authenticated` has been taken away. A table that never revoked could
    // legitimately show more than the migrations say.
    expect(tablesRelyingOnDefaultGrants(files)).toEqual([]);
  });

  it('FAILS to call a table revoke-first when it never revoked', () => {
    const lazy = fake(`
      create table if not exists public.inherited (id uuid);
      alter table public.inherited enable row level security;
    `);
    expect(tablesRelyingOnDefaultGrants(lazy)).toEqual(['inherited']);
  });

  it('does NOT accept a PARTIAL revoke as revoke-first', () => {
    // `revoke update ... ` leaves every other Supabase default privilege in
    // place, so the table still relies on the defaults. Accepting it would
    // certify the table and let the runbook present its grant matrix as an
    // exact expectation when the deployed state can hold far more.
    // This is the shape of 0006:82 on `profiles`, before 0034 added the full
    // revoke.
    const partial = fake(`
      create table if not exists public.halfway (id uuid);
      alter table public.halfway enable row level security;
      revoke update on table public.halfway from public, anon, authenticated;
      grant update (label) on table public.halfway to authenticated;
    `);
    expect(tablesRelyingOnDefaultGrants(partial)).toEqual(['halfway']);
  });

  it('does NOT accept a revoke that misses one client role', () => {
    // Revoking from anon alone leaves `authenticated`'s defaults intact.
    const oneRole = fake(`
      create table if not exists public.lopsided (id uuid);
      alter table public.lopsided enable row level security;
      revoke all on table public.lopsided from anon;
    `);
    expect(tablesRelyingOnDefaultGrants(oneRole)).toEqual(['lopsided']);
  });

  it('reads a role through "with grant option" and through quotes', () => {
    // Both forms are valid SQL. Parsed naively they produce roles named
    // `anon with grant option` and `"anon"`, neither of which matches `anon`,
    // so a real widening of anonymous access records under a name nothing
    // checks. That failure is silent and fails OPEN.
    const awkward = fake(`
      revoke all on table public.widgets from public, anon, authenticated;
      grant select on table public.widgets to anon with grant option;
      grant insert on table public.gadgets to "anon";
    `);
    const net = netTablePrivileges(awkward);
    expect(net.get('widgets')?.get('anon')).toEqual(['select']);
    expect(net.get('gadgets')?.get('anon')).toEqual(['insert']);
  });

  it('separates COLUMN-scoped grants from table-level ones', () => {
    // A column-scoped grant confers no table-level privilege and does not
    // appear in role_table_grants, so folding it in makes the runbook promise
    // a row the operator's query can never return.
    const scoped = fake(`
      revoke all on table public.profiles from public, anon, authenticated;
      grant select on table public.profiles to authenticated;
      grant update (display_name) on table public.profiles to authenticated;
    `);
    expect(netTablePrivileges(scoped).get('profiles')?.get('authenticated')).toEqual([
      'select',
    ]);
    expect(netColumnPrivileges(scoped).get('profiles')?.get('authenticated')).toEqual([
      'display_name',
    ]);
  });

  it('the corpus contains NO grant form this module cannot model', () => {
    // `grant ... on all tables in schema public to anon` and
    // `alter default privileges` widen anonymous access without naming a
    // table, so every parser here is blind to them — and being blind fails
    // OPEN. Today both appear only inside comments (0034:13, 0019:79), which
    // stripSqlComments removes. If one ever lands in live SQL this fails
    // rather than silently under-reporting.
    expect(unmodelableGrantStatements(files)).toEqual([]);
  });

  it('FLAGS an unmodelable grant when one appears in live sql', () => {
    const blind = fake('grant select on all tables in schema public to anon;');
    expect(unmodelableGrantStatements(blind)).toHaveLength(1);
    expect(unmodelableGrantStatements(blind)[0].statement).toContain('all tables in schema');
  });

  it('the corpus contains no view or force-RLS the runbook does not expect', () => {
    // The runbook states "expected: zero views" and "rls_forced false
    // everywhere" — two hand-stated expectations with no derivation behind
    // them. A future migration adding either would leave the document
    // demanding stop-and-escalate on a healthy database.
    expect(unmodelledObjectStatements(files)).toEqual([]);
  });

  it('FLAGS a view or a force-RLS statement in live sql', () => {
    const withView = fake('create view public.leaky_view as select * from public.profiles;');
    expect(unmodelledObjectStatements(withView)).toHaveLength(1);

    const forced = fake('alter table public.widgets force row level security;');
    expect(unmodelledObjectStatements(forced)).toHaveLength(1);

    const commented = fake('-- create view public.someday as select 1;');
    expect(unmodelledObjectStatements(commented)).toEqual([]);
  });

  it('ignores an unmodelable grant that is only mentioned in a comment', () => {
    const commented = fake(`
      -- Supabase's default is: grant all on all tables in schema public to anon;
      revoke all on table public.widgets from public, anon, authenticated;
    `);
    expect(unmodelableGrantStatements(commented)).toEqual([]);
  });
});

describe('SECURITY DEFINER caller checks', () => {
  it('the DERIVED set of definers without auth.uid() matches the declaration', () => {
    // A definer function bypasses RLS, so its body IS the last gate. Three
    // legitimately have no auth.uid() (a trigger and two anon-gated readers).
    // A FOURTH is an unauthenticated door and must be justified before it ships.
    const derived = [
      ...new Set(
        liveFunctions(files)
          .filter((f) => f.isSecurityDefiner && !f.usesAuthUid)
          .map((f) => f.name),
      ),
    ].sort();
    expect(derived).toEqual([...DEFINERS_WITHOUT_AUTH_UID].sort());
  });

  it('resolves pending_change_count to the GATED 0021 definition', () => {
    // 0020:179 defines pending_change_count(p_user uuid) with no caller check;
    // 0021:26 drops it and recreates pending_change_count() gated on
    // auth.uid(). Reading every definition ever written reports the dropped
    // version's properties as current — which would put the function on the
    // reviewed-exception list and licence a rollback to the 0020 defect.
    const raw = functionsDefined(files).filter((f) => f.name === 'pending_change_count');
    expect(raw.length).toBeGreaterThan(1);
    expect(raw.some((f) => !f.usesAuthUid)).toBe(true); // the stale one is in there

    const live = liveFunctions(files).filter((f) => f.name === 'pending_change_count');
    expect(live).toHaveLength(1);
    expect(live[0].usesAuthUid).toBe(true);
    expect(live[0].file).toBe('0021_provenance_hardening.sql');
  });

  it('replays drop function so the LAST definition wins', () => {
    const replaced = fake(`
      create or replace function public.thing(p uuid)
      returns void language plpgsql security definer set search_path = public
      as $$ begin perform 1; end; $$;

      drop function if exists public.thing(uuid);

      create or replace function public.thing()
      returns void language plpgsql security definer set search_path = public
      as $$ begin perform auth.uid(); end; $$;
    `);
    const live = liveFunctions(replaced);
    expect(live).toHaveLength(1);
    expect(live[0].usesAuthUid).toBe(true);
  });

  it('drops a function that is dropped and never re-created', () => {
    const gone = fake(`
      create or replace function public.doomed()
      returns void language sql set search_path = public as $$ select 1; $$;
      drop function if exists public.doomed();
    `);
    expect(liveFunctions(gone)).toEqual([]);
  });

  it('has no live function name carrying two overloads', () => {
    // liveFunctions keys by NAME, which is what the runbook's expectations do
    // too. If a real overload pair ever survives, that keying silently loses
    // one of them and this assertion is the warning.
    expect(liveFunctionOverloadConflicts(files)).toEqual([]);
  });
});

describe('functions reachable by PUBLIC', () => {
  it('the DERIVED no-public-revoke set matches the declaration', () => {
    // Postgres grants EXECUTE to PUBLIC by default. These were never revoked,
    // so a healthy database shows a PUBLIC row for each — the runbook has to
    // say so or its anonymous-entry-point check cries wolf every run.
    expect(functionsWithoutPublicRevoke(files)).toEqual(
      [...FUNCTIONS_WITHOUT_PUBLIC_REVOKE].sort(),
    );
  });

  it('every one of them returns trigger', () => {
    // This is the whole safety argument: a trigger function has no PostgREST
    // route, so a default PUBLIC execute grant on it is not an anonymous entry
    // point. A NON-trigger function joining that list would be one.
    const live = liveFunctions(files);
    const nonTrigger = functionsWithoutPublicRevoke(files).filter(
      (n) => !live.find((f) => f.name === n)?.returnsTrigger,
    );
    expect(nonTrigger).toEqual([]);
  });

  it('FLAGS a non-trigger function that was never revoked from public', () => {
    const leaky = fake(`
      create or replace function public.rpc_without_revoke(p uuid)
      returns integer language sql security definer set search_path = public
      as $$ select 1; $$;
    `);
    expect(functionsWithoutPublicRevoke(leaky)).toEqual(['rpc_without_revoke']);
    expect(liveFunctions(leaky)[0].returnsTrigger).toBe(false);
  });

  it('does not flag a function that IS revoked from public', () => {
    const tidy = fake(`
      create or replace function public.tidy_rpc(p uuid)
      returns integer language sql security definer set search_path = public
      as $$ select 1; $$;
      revoke all on function public.tidy_rpc(uuid) from public, anon;
    `);
    expect(functionsWithoutPublicRevoke(tidy)).toEqual([]);
  });

  it('detects auth.uid() in a body and its absence', () => {
    const pair = fake(`
      create or replace function public.gated(p int)
      returns void language plpgsql security definer set search_path = public
      as $$ begin if auth.uid() is null then raise exception 'no'; end if; end; $$;

      create or replace function public.ungated(p int)
      returns void language plpgsql security definer set search_path = public
      as $$ begin perform 1; end; $$;
    `);
    const parsed = functionsDefined(pair);
    expect(parsed.find((f) => f.name === 'gated')?.usesAuthUid).toBe(true);
    expect(parsed.find((f) => f.name === 'ungated')?.usesAuthUid).toBe(false);
  });

  it('does not credit an auth.uid() that sits OUTSIDE the body', () => {
    // Attribute text is not body text; a comment or a neighbouring statement
    // mentioning auth.uid() must not count as a caller check.
    const outside = fake(`
      create or replace function public.sneaky(p int)
      returns void language plpgsql security definer set search_path = public
      as $$ begin perform 1; end; $$;
      -- auth.uid() is checked by the caller, honest
    `);
    expect(functionsDefined(outside)[0].usesAuthUid).toBe(false);
  });
});

describe('v0.1 legacy objects (present on a Production-lineage database)', () => {
  const schemaSql = readFileSync(LEGACY_SCHEMA_FILE, 'utf8');

  it('derives the legacy table set from schema.sql plus 0000 renames', () => {
    // Migration 0000 RENAMES the v0.1 tables rather than dropping them and
    // leaves `waitlist` alone because /api/waitlist still writes to it. A
    // v0.1-derived database therefore holds five tables no migration creates.
    // Omitting them made Checks 1-3 false on Production.
    expect(legacySchemaTables(schemaSql, files)).toEqual([...V01_LEGACY_TABLES].sort());
  });

  it('reads 0000 rename map from the migration, not a hardcoded list', () => {
    const renames = legacyRenames(files);
    expect(renames.get('profiles')).toBe('profiles_v01_legacy');
    expect(renames.get('bars')).toBe('bars_v01_legacy');
    expect(renames.get('saves')).toBe('saves_v01_legacy');
    expect(renames.get('visits')).toBe('visits_v01_legacy');
    // waitlist is deliberately NOT renamed.
    expect(renames.has('waitlist')).toBe(false);
  });

  it('counts the legacy policies that travel with the rename', () => {
    const byTable = legacySchemaPolicies(schemaSql, files);
    const total = [...byTable.values()].reduce((n, names) => n + names.length, 0);
    expect(total).toBe(15);
    expect(byTable.get('waitlist')).toEqual([
      'waitlist anyone insert',
      'waitlist service role select',
    ]);
    expect(byTable.get('profiles_v01_legacy')).toHaveLength(4);
  });

  it('keeps the legacy tables disjoint from the migration-created ones', () => {
    // If a name ever collided, the runbook's two expected sets would overlap
    // and the operator could not tell which lineage produced a row.
    const fresh = new Set(expectedPublicTables(files));
    for (const t of legacySchemaTables(schemaSql, files)) {
      expect(fresh.has(t), `${t} is in BOTH the fresh and legacy sets`).toBe(false);
    }
  });

  it('FAILS to treat a renamed table as still carrying its old name', () => {
    const renamed = fake('alter table public.old_name rename to new_name;');
    expect(legacyRenames(renamed).get('old_name')).toBe('new_name');
  });
});

describe('column-scoped grants, corpus-wide', () => {
  it('the DERIVED column-ACL map matches the declaration exactly', () => {
    // The runbook's Check 3b says "exactly three rows and nothing else". Only
    // the profiles entry was guarded, so a column grant added on ANY other
    // table would falsify that sentence with the suite green.
    const derived: Record<string, Record<string, string[]>> = {};
    for (const [table, byRole] of netColumnPrivileges(files)) {
      for (const [role, columns] of byRole) {
        derived[table] = { ...(derived[table] ?? {}), [role]: columns };
      }
    }
    expect(derived).toEqual(COLUMN_SCOPED_GRANTS);
  });

  it('FAILS when a column grant appears on another table', () => {
    const extra = fake(`
      grant update (secret_col) on table public.widgets to authenticated;
    `);
    const derived: Record<string, Record<string, string[]>> = {};
    for (const [table, byRole] of netColumnPrivileges(extra)) {
      for (const [role, columns] of byRole) {
        derived[table] = { ...(derived[table] ?? {}), [role]: columns };
      }
    }
    expect(derived).not.toEqual(COLUMN_SCOPED_GRANTS);
    expect(derived.widgets.authenticated).toEqual(['secret_col']);
  });
});

describe('policies with a literal-true predicate', () => {
  it('derives the migration-lineage set and matches the declaration', () => {
    // "qual = true is stop-and-escalate" is wrong unconditionally: public data
    // legitimately has one. Asserting the exception set means a NEW literal-true
    // policy fails the build instead of hiding among the documented ones.
    expect(policiesWithTruePredicate(policyDefinitions(files))).toEqual(
      [...TRUE_PREDICATE_POLICIES].sort(),
    );
  });

  it('derives the v0.1-lineage set and matches the declaration', () => {
    const schemaSql = readFileSync(LEGACY_SCHEMA_FILE, 'utf8');
    const legacyDefs = policyDefinitions([
      { prefix: '0000', name: 'schema.sql', sql: schemaSql },
    ]);
    expect(policiesWithTruePredicate(legacyDefs)).toEqual(
      [...TRUE_PREDICATE_POLICIES_V01].sort(),
    );
  });

  it('FLAGS a new literal-true policy', () => {
    const broken = fake(`
      create policy wide_open on public.widgets for select using (true);
      create policy scoped on public.widgets for select using (auth.uid() = user_id);
    `);
    expect(policiesWithTruePredicate(policyDefinitions(broken))).toEqual(['wide_open']);
  });

  it('catches a literal-true with_check as well as a using', () => {
    const broken = fake(
      'create policy anyone_writes on public.widgets for insert with check ( true );',
    );
    expect(policiesWithTruePredicate(policyDefinitions(broken))).toEqual(['anyone_writes']);
  });

  it('catches the true-EQUIVALENT forms the runbook names, not just the token', () => {
    // The doc calls `1 = 1` and `auth.uid() is not null` as dangerous as
    // `true`. A guard that only saw `true` would let the subtlest one ship
    // unjustified — and the "except where expected" clause would then tell the
    // operator that wide-open predicate is expected.
    const broken = fake(`
      create policy tautology on public.widgets for select using (1 = 1);
      create policy authed_only on public.gadgets for select using (auth.uid() is not null);
      create policy parenthesised on public.doodads for select using ((true));
      create policy scoped on public.things for select using (auth.uid() = user_id);
    `);
    expect(policiesWithTruePredicate(policyDefinitions(broken))).toEqual([
      'authed_only',
      'parenthesised',
      'tautology',
    ]);
  });

  it('does not flag a predicate that merely MENTIONS auth.uid()', () => {
    const scoped = fake(
      'create policy fine on public.widgets for select using (auth.uid() = owner_id);',
    );
    expect(policiesWithTruePredicate(policyDefinitions(scoped))).toEqual([]);
  });
});

describe('policy definitions', () => {
  it('emits one expected expression per live policy', () => {
    // The operator diffs these against pg_policies.qual/.with_check. Name and
    // count matching proves nothing about what a policy PERMITS.
    const defs = policyDefinitions(files);
    const live = [...policiesByTable(files).values()].flat();
    expect(defs.length).toBe(live.length);
    const keys = defs.map((d) => `${d.table} ${d.policy}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps only the LAST create when a policy is re-created', () => {
    // 0020 creates bar_change_queue_insert_own and 0021 drops and re-creates it
    // with a different predicate. Emitting both would hand the operator two
    // conflicting "expected" expressions for one deployed policy.
    const recreated = fake(`
      create policy p on public.widgets for select using (old_predicate);
      drop policy if exists p on public.widgets;
      create policy p on public.widgets for select using (new_predicate);
    `);
    const defs = policyDefinitions(recreated);
    expect(defs).toHaveLength(1);
    expect(defs[0].sql).toContain('new_predicate');
    expect(defs[0].sql).not.toContain('old_predicate');
  });

  it('omits a policy that was dropped and never re-created', () => {
    const dropped = fake(`
      create policy gone on public.widgets for select using (true);
      drop policy if exists gone on public.widgets;
    `);
    expect(policyDefinitions(dropped)).toEqual([]);
  });
});

describe('function grants', () => {
  it('the DERIVED anon-executable function set matches the reviewed allowlist', () => {
    const derived = [
      ...new Set(
        functionGrants(files)
          .filter((g) => g.roles.includes('anon'))
          .map((g) => g.function),
      ),
    ].sort();
    expect(derived.length).toBeGreaterThan(0);
    expect(derived).toEqual([...ANON_EXECUTABLE_FUNCTIONS].sort());
  });

  it('FAILS when a new function is granted to anon', () => {
    const broken = fake(
      'grant execute on function public.leak_everything(uuid) to anon;',
    );
    const found = functionGrants(broken).filter((g) => g.roles.includes('anon'));
    expect(found.map((g) => g.function)).toEqual(['leak_everything']);
  });

  it('every anon-executable function is a SECURITY DEFINER function', () => {
    // An anonymous entry point that is NOT definer would run as `anon` and hit
    // RLS anyway; one that IS definer is deliberately reaching past RLS and
    // must gate internally. Either way the operator needs to know which.
    const definers = new Set(
      functionsDefined(files).filter((f) => f.isSecurityDefiner).map((f) => f.name),
    );
    for (const name of ANON_EXECUTABLE_FUNCTIONS) {
      expect(definers.has(name)).toBe(true);
    }
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

  it('keeps a commented-out rollback grant out of the surface', () => {
    // Every migration ends with a commented rollback block that often reads
    // `grant all on table public.x to anon, authenticated;`. Counting those
    // would report an anonymous grant on almost every table.
    const withRollback = fake(`
      revoke all on table public.widgets from public, anon, authenticated;
      -- Rollback:
      --   grant all on table public.widgets to anon, authenticated;
    `);
    expect(anonTableGrants(withRollback)).toEqual([]);
  });

  it('does NOT let a line comment mentioning a block-open swallow real SQL', () => {
    // Round-1 review, DeepSeek lane. Two independent passes — block comments
    // first, line comments second — let the `/*` inside one line comment pair
    // with the `*/` inside a later one and delete everything between them.
    // The victim here is a SECURITY DEFINER function with NO pinned
    // search_path: precisely the object the whole runbook exists to count.
    const sql = `
      create or replace function public.first_fn() returns void as $$
      begin perform 1; end;
      $$ language plpgsql security definer set search_path = public;

      -- historical note: the old /* wrapper is gone
      create or replace function public.later_fn() returns void as $$
      begin perform 2; end;
      $$ language plpgsql security definer;
      -- end of file marker */
    `;
    expect(stripSqlComments(sql)).toContain('later_fn');

    const parsed = functionsDefined(fake(sql));
    expect(parsed.map((f) => f.name)).toEqual(['first_fn', 'later_fn']);
    // And it is still visible as the unpinned definer that it is.
    const later = parsed.find((f) => f.name === 'later_fn');
    expect(later?.isSecurityDefiner).toBe(true);
    expect(later?.pinsSearchPath).toBe(false);
  });

  it('treats `--` and `/*` inside a string literal as data, not a comment', () => {
    const sql = `
      create or replace function public.quoted_fn() returns void as $$
      begin
        execute 'select ''a--b'', ''c/*d'';
      end;
      $$ language plpgsql security definer set search_path = public;
    `;
    const [fn] = functionsDefined(fake(sql));
    expect(fn?.isSecurityDefiner).toBe(true);
    expect(fn?.pinsSearchPath).toBe(true);
  });
});

describe('parser fail-closed guarantees (round-1 review)', () => {
  it('THROWS on a dollar-quoted body that is never closed', () => {
    // DeepSeek lane. This used to be the derivation's worst failure mode: the
    // unterminated body absorbed the trailing attributes, so a definer function
    // with an unpinned search_path was reported as NEITHER a definer NOR
    // unpinned — it left the census entirely instead of raising an alarm.
    const sql = `
      create or replace function public.truncated() returns void as $$
      begin perform 1; end;
      language plpgsql security definer set search_path = public;
    `;
    expect(() => functionsDefined(fake(sql))).toThrow(/never closed/);
  });

  it('parses nested dollar-quote tags without losing the trailing attributes', () => {
    const sql = `
      create or replace function public.nested() returns void as $outer$
      begin
        execute $inner$ select 1 $inner$;
      end;
      $outer$ language plpgsql security definer set search_path = public;
    `;
    const [fn] = functionsDefined(fake(sql));
    expect(fn?.isSecurityDefiner).toBe(true);
    expect(fn?.pinsSearchPath).toBe(true);
  });

  it('sees quoted, mixed-case and non-public function names', () => {
    // These matched nothing at all before, so a definer function could enter
    // the schema without ever appearing in a count.
    const names = (sql: string) => functionsDefined(fake(sql)).map((f) => f.name);
    expect(names(`
      create or replace function "mixedCase"() returns void as $$
      begin perform 1; end;
      $$ language plpgsql security definer;
    `)).toEqual(['mixedCase']);
    expect(names(`
      create or replace function app.helper() returns void as $$
      begin perform 1; end;
      $$ language plpgsql security definer;
    `)).toEqual(['helper']);
    expect(names(`
      create or replace function "public"."someFunc"() returns void as $$
      begin perform 1; end;
      $$ language plpgsql security definer;
    `)).toEqual(['someFunc']);
  });

  it('FLAGS a function recreated after a drop without its revoke replayed', () => {
    // Claude lane. `DROP FUNCTION` takes the ACL with it, so the recreated
    // function is executable by PUBLIC again. Treating the original revoke as
    // permanent made this guard fail open through the drop-and-recreate pattern
    // the corpus already uses.
    const files: MigrationFile[] = [
      {
        prefix: '9998',
        name: '9998_create.sql',
        sql: `
          create or replace function public.rpc_fn() returns void as $$
          begin perform 1; end;
          $$ language plpgsql security definer set search_path = public;
          revoke execute on function public.rpc_fn() from public;
        `,
      },
      {
        prefix: '9999',
        name: '9999_recreate.sql',
        sql: `
          drop function if exists public.rpc_fn();
          create or replace function public.rpc_fn() returns void as $$
          begin perform 2; end;
          $$ language plpgsql security definer set search_path = public;
        `,
      },
    ];
    expect(functionsWithoutPublicRevoke(files)).toEqual(['rpc_fn']);
  });

  it('still clears a function whose revoke IS replayed after the drop', () => {
    // The other direction, so the guard above cannot pass by flagging everything.
    const files: MigrationFile[] = [
      {
        prefix: '9998',
        name: '9998_create.sql',
        sql: `
          create or replace function public.rpc_fn() returns void as $$
          begin perform 1; end;
          $$ language plpgsql security definer set search_path = public;
          revoke execute on function public.rpc_fn() from public;
        `,
      },
      {
        prefix: '9999',
        name: '9999_recreate.sql',
        sql: `
          drop function if exists public.rpc_fn();
          create or replace function public.rpc_fn() returns void as $$
          begin perform 2; end;
          $$ language plpgsql security definer set search_path = public;
          revoke execute on function public.rpc_fn() from public;
        `,
      },
    ];
    expect(functionsWithoutPublicRevoke(files)).toEqual([]);
  });
});
