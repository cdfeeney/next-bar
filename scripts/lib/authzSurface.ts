/**
 * Derive the app's expected AUTHORIZATION SURFACE from the SQL migrations
 * (Item 11).
 *
 * The 2026-08-07 audit closed every gap it could reach locally and left one it
 * could not: nobody has evidence that Staging and Production actually enforce
 * the RLS, grants and SECURITY DEFINER protections the migrations describe.
 * This module is half of the answer — it turns `supabase/migrations/*.sql`
 * into a structured expectation that both the verification runbook and the
 * static tests read from, so the two cannot drift apart. The other half is
 * running the runbook, which is an ATTENDED operation against a live
 * database and is deliberately not performed here.
 *
 * IT PARSES PER STATEMENT, NOT PER FILE OR PER LINE, and that distinction is
 * the whole point. Two demonstrations from this repository:
 *
 *   - Counting `security definer` and `set search_path` occurrences per file
 *     "passes" here while genuinely disagreeing: 0006 has four definer
 *     mentions and two search_path lines, 0034 has two and zero. Those gaps
 *     are comments and re-grants, not unpinned functions — but a counter
 *     cannot tell the difference, and a check that cannot distinguish a
 *     comment from a vulnerability is not a check.
 *   - EVERY `create policy` in this corpus puts its `on public.<table>` on the
 *     FOLLOWING line, and policy names are quoted and contain colons
 *     ("profiles: owner can read own"). A line-oriented grep for
 *     `policy ... on public.x` therefore finds zero of them and reports every
 *     table as policy-less. That exact mistake was made while verifying this
 *     module, which is why the policy and grant expectations are GENERATED
 *     here rather than written by hand in the runbook.
 *
 * Read-only. This module never opens a network connection.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const MIGRATIONS_DIR = path.resolve(
  process.cwd(),
  'supabase',
  'migrations',
);

export type MigrationFile = {
  /** e.g. '0043' */
  prefix: string;
  name: string;
  sql: string;
};

export type FunctionDef = {
  name: string;
  file: string;
  isSecurityDefiner: boolean;
  pinsSearchPath: boolean;
  /** The attribute text of THIS function: header plus its own post-body tail. */
  header: string;
};

export type TableDef = {
  name: string;
  file: string;
};

export type PolicyStatement = {
  action: 'create' | 'drop';
  /** Quoted names keep their case, as Postgres does; bare ones fold to lower. */
  policy: string;
  table: string;
  file: string;
};

/** The table-level privileges Postgres can grant, used to expand `all`. */
export const TABLE_PRIVILEGES = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
] as const;

export type PrivilegeStatement = {
  action: 'grant' | 'revoke';
  privileges: string[];
  table: string;
  roles: string[];
  file: string;
};

/**
 * Tables that exist in a healthy `public` schema but are created by the
 * migration RUNNER, not by any numbered migration, so no parser reading
 * `supabase/migrations/*.sql` can see them.
 *
 * `schema_migrations` is created by MIGRATION_LEDGER_DDL in
 * `scripts/lib/migrationLedger.ts`, which creates it and hardens it in one
 * atomic batch before the runner reads or writes its first ledger row.
 * Migration 0036 then re-applies that hardening so already-created databases
 * are repaired too — which is why the table DOES appear in the RLS scan but
 * NOT in the `create table` scan. An operator counting tables on a healthy
 * deployment sees this one as well; omitting it makes the runbook's expected
 * table count off by one and turns a healthy database into a false mismatch.
 */
export const RUNNER_MANAGED_TABLES = ['schema_migrations'];

/** Strip `--` line comments and block comments so they cannot mask or fake a match. */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

export function readMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      prefix: /^(\d+)_/.exec(name)?.[1] ?? '',
      name,
      sql: readFileSync(path.join(dir, name), 'utf8'),
    }));
}

/** Every `create table [if not exists] public.<name>` across the migrations. */
export function tablesCreated(files: MigrationFile[]): TableDef[] {
  const out: TableDef[] = [];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      out.push({ name: m[1].toLowerCase(), file: file.name });
    }
  }
  return out;
}

/** Every table given `enable row level security` anywhere in the migrations. */
export function tablesWithRlsEnabled(files: MigrationFile[]): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    const re =
      /alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) out.add(m[1].toLowerCase());
  }
  return out;
}

/**
 * Every table an operator should expect to find in a healthy `public` schema:
 * the ones the migrations create, plus the ones the runner creates.
 */
export function expectedPublicTables(files: MigrationFile[]): string[] {
  return [
    ...new Set([
      ...tablesCreated(files).map((t) => t.name),
      ...RUNNER_MANAGED_TABLES,
    ]),
  ].sort();
}

/**
 * Every function definition, with its OWN security attributes.
 *
 * A function's header runs from `create ... function` up to the `as $$`/`as $body$`
 * body delimiter; the attributes we care about (`security definer`,
 * `set search_path`) are declared there. Postgres also allows them AFTER the
 * body, so the tail is included — but ONLY up to the statement's terminating
 * semicolon. Reading to the start of the next function instead would let an
 * unrelated later statement (`alter function other() set search_path = public;`)
 * mark THIS function as pinned when it is not.
 */
export function functionsDefined(files: MigrationFile[]): FunctionDef[] {
  const out: FunctionDef[] = [];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    // Split on each function definition start, keeping what follows.
    const starts = [
      ...sql.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi,
      ),
    ];
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i];
      const from = start.index ?? 0;
      const to = i + 1 < starts.length ? (starts[i + 1].index ?? sql.length) : sql.length;
      const segment = sql.slice(from, to);
      const bodyOpen = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(segment);
      let attributeText: string;
      if (bodyOpen) {
        const delimiter = bodyOpen[1];
        const openAt = (bodyOpen.index ?? 0) + bodyOpen[0].length;
        const closeAt = segment.indexOf(delimiter, openAt);
        const tail = closeAt === -1 ? '' : segment.slice(closeAt + delimiter.length);
        attributeText = segment.slice(0, bodyOpen.index) + endOfStatement(tail);
      } else {
        // No dollar-quoted body found; bound at the statement terminator so a
        // following statement cannot be attributed to this function either.
        attributeText = endOfStatement(segment);
      }
      out.push({
        name: start[1].toLowerCase(),
        file: file.name,
        header: attributeText,
        isSecurityDefiner: /security\s+definer/i.test(attributeText),
        pinsSearchPath: /set\s+search_path\s*(?:=|to)/i.test(attributeText),
      });
    }
  }
  return out;
}

/** The text up to (not including) the first `;` — i.e. this statement only. */
function endOfStatement(text: string): string {
  const end = text.indexOf(';');
  return end === -1 ? text : text.slice(0, end);
}

/**
 * Every `create policy` / `drop policy` statement, in application order.
 *
 * Deliberately multi-line: in this corpus the `on public.<table>` clause is on
 * the line AFTER `create policy "<name>"` every single time, so any
 * line-oriented match finds none of them.
 */
export function policyStatements(files: MigrationFile[]): PolicyStatement[] {
  const out: PolicyStatement[] = [];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    const re =
      /\b(create|drop)\s+policy\s+(?:if\s+(?:not\s+)?exists\s+)?("[^"]*"|[a-z0-9_]+)\s+on\s+(?:public\.)?([a-z0-9_]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const raw = m[2];
      out.push({
        action: m[1].toLowerCase() as 'create' | 'drop',
        // Postgres preserves the case of a quoted identifier and folds a bare
        // one; policy names here are quoted AND contain colons and spaces.
        policy: raw.startsWith('"') ? raw.slice(1, -1) : raw.toLowerCase(),
        table: m[3].toLowerCase(),
        file: file.name,
      });
    }
  }
  return out;
}

/**
 * The NET policy set per table after replaying every create/drop in order.
 *
 * The replay is load-bearing rather than decorative: 0012 creates
 * `bar_rsvps_delete_own` and 0014 drops it without a replacement, so
 * `bar_rsvps` ends with zero policies. A parser that only counted
 * `create policy` would claim it has one and make a healthy deployment look
 * wrong.
 */
export function policiesByTable(files: MigrationFile[]): Map<string, string[]> {
  const live = new Map<string, Set<string>>();
  for (const st of policyStatements(files)) {
    const set = live.get(st.table) ?? new Set<string>();
    if (st.action === 'create') set.add(st.policy);
    else set.delete(st.policy);
    live.set(st.table, set);
  }
  return new Map(
    [...live.entries()]
      .map(([table, set]) => [table, [...set].sort()] as [string, string[]])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Tables that have RLS enabled and, by design, NO policy at all.
 *
 * RLS with no policy is default-deny for every client role; only a
 * BYPASSRLS role (service_role) can reach the rows. That is a deliberate
 * pattern here, not an oversight — but it is indistinguishable from "someone
 * forgot the policy" unless it is written down, which is what
 * POLICY_LESS_BY_DESIGN is for.
 */
export function policyLessTables(files: MigrationFile[]): string[] {
  const policies = policiesByTable(files);
  const rls = tablesWithRlsEnabled(files);
  return expectedPublicTables(files)
    .filter((t) => rls.has(t))
    .filter((t) => (policies.get(t)?.length ?? 0) === 0)
    .sort();
}

/**
 * Tables that are RLS-enabled, policy-less, and reachable only by the service
 * role. Reviewed intent, asserted against the DERIVED set in the tests so that
 * a new policy-less table cannot be added without a human noticing.
 *
 * Not a design smell — each is either a counter or an internal ledger with no
 * client read path:
 *   analytics_events, rate_limits          service-role counters (0018, 0043)
 *   follow_attempts, handle_claim_attempts,
 *   handle_search_attempts                 rate-limit counters behind definer RPCs
 *   shared_nights, photo_permissions       written only by definer RPCs / service role
 *   bar_rsvps                              0014 drops its last policy on purpose
 *   schema_migrations                      runner-internal ledger (0036)
 */
export const POLICY_LESS_BY_DESIGN = [
  'analytics_events',
  'bar_rsvps',
  'follow_attempts',
  'handle_claim_attempts',
  'handle_search_attempts',
  'photo_permissions',
  'rate_limits',
  'schema_migrations',
  'shared_nights',
];

/**
 * Tables the design says NO client role may touch directly. Both are
 * service-role-only counters whose migrations revoke everything from
 * anon/authenticated and add no policies on purpose; a grant appearing here
 * would hand an anonymous caller the ability to read or forge counters.
 */
export const SERVICE_ROLE_ONLY_TABLES = ['analytics_events', 'rate_limits'];

/** Grants of the form `grant ... on table public.<name> to <role>`. */
export function tableGrants(
  files: MigrationFile[],
): { table: string; roles: string[]; file: string }[] {
  const out: { table: string; roles: string[]; file: string }[] = [];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    const re =
      /grant\s+[^;]*?\s+on\s+(?:table\s+)?public\.([a-z0-9_]+)\s+to\s+([^;]+);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      out.push({
        table: m[1].toLowerCase(),
        roles: m[2]
          .split(',')
          .map((r) => r.trim().toLowerCase())
          .filter(Boolean),
        file: file.name,
      });
    }
  }
  return out;
}

/**
 * Every table-level `grant`/`revoke`, in application order.
 *
 * Function grants (`grant execute on function public.f(text) to anon`) are
 * deliberately NOT matched: `on function public.` does not satisfy
 * `on [table] public.`. They are a separate surface with a separate check —
 * conflating them would report `get_public_ratings` as an anonymous TABLE
 * grant, which is exactly the kind of false alarm that trains an operator to
 * ignore the runbook.
 */
export function privilegeStatements(files: MigrationFile[]): PrivilegeStatement[] {
  const out: PrivilegeStatement[] = [];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    const re =
      /\b(grant|revoke)\s+([^;]*?)\s+on\s+(?:table\s+)?public\.([a-z0-9_]+)\s+(?:to|from)\s+([^;]+?);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      out.push({
        action: m[1].toLowerCase() as 'grant' | 'revoke',
        privileges: parsePrivileges(m[2]),
        table: m[3].toLowerCase(),
        roles: m[4]
          .split(',')
          .map((r) => r.trim().toLowerCase())
          .filter(Boolean),
        file: file.name,
      });
    }
  }
  return out;
}

/** `update (display_name, is_private)` -> ['update']; `all privileges` -> every verb. */
function parsePrivileges(raw: string): string[] {
  const withoutColumns = raw.replace(/\([^)]*\)/g, ' ');
  const parts = withoutColumns
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.some((p) => p === 'all' || p === 'all privileges')) {
    return [...TABLE_PRIVILEGES];
  }
  return parts.map((p) => p.split(/\s+/)[0]).filter(Boolean);
}

/**
 * Replay every grant/revoke to get the net privileges each role holds on each
 * table ACCORDING TO THE MIGRATIONS.
 *
 * This is an expectation, not a prediction of the deployed state, and the
 * difference matters when reading the results: Supabase issues a default
 * `grant all on all tables in schema public to anon, authenticated`, so a
 * deployed table whose migration never revoked can legitimately show
 * privileges no migration granted. `tablesRelyingOnDefaultGrants` names those.
 */
export function netTablePrivileges(
  files: MigrationFile[],
): Map<string, Map<string, string[]>> {
  const state = new Map<string, Map<string, Set<string>>>();
  for (const st of privilegeStatements(files)) {
    const byRole = state.get(st.table) ?? new Map<string, Set<string>>();
    for (const role of st.roles) {
      const held = byRole.get(role) ?? new Set<string>();
      for (const priv of st.privileges) {
        if (st.action === 'grant') held.add(priv);
        else held.delete(priv);
      }
      byRole.set(role, held);
    }
    state.set(st.table, byRole);
  }
  return new Map(
    [...state.entries()]
      .map(
        ([table, byRole]) =>
          [
            table,
            new Map(
              [...byRole.entries()]
                .filter(([, held]) => held.size > 0)
                .map(([role, held]) => [role, [...held].sort()] as [string, string[]])
                .sort(([a], [b]) => a.localeCompare(b)),
            ),
          ] as [string, Map<string, string[]>],
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Tables the migrations grant to `anon`, with the privileges granted. */
export function anonTableGrants(files: MigrationFile[]): { table: string; privileges: string[] }[] {
  const out: { table: string; privileges: string[] }[] = [];
  for (const [table, byRole] of netTablePrivileges(files)) {
    const privileges = byRole.get('anon');
    if (privileges?.length) out.push({ table, privileges });
  }
  return out;
}

/**
 * Anonymous table read is deliberate for exactly these, and nothing else:
 * the bar catalog and its approved photos are public data — the product works
 * signed out (0019:88-90, 0020:137). Any other table appearing here means a
 * migration opened anonymous access to user data.
 */
export const ANON_READABLE_TABLES = ['bar_photos', 'bars'];

/**
 * Tables created by a migration that never revokes from `anon`/`authenticated`.
 *
 * These are the tables where the deployed grant state may legitimately EXCEED
 * what the migrations say, because Supabase's default privileges already
 * granted the browser roles access when the table was created. On those,
 * "deployed shows more than expected" is not by itself drift; on a
 * revoke-first table it is.
 */
export function tablesRelyingOnDefaultGrants(files: MigrationFile[]): string[] {
  const revoked = new Set(
    privilegeStatements(files)
      .filter((s) => s.action === 'revoke')
      .filter((s) => s.roles.some((r) => r === 'anon' || r === 'authenticated' || r === 'public'))
      .map((s) => s.table),
  );
  return tablesCreated(files)
    .map((t) => t.name)
    .filter((t, i, all) => all.indexOf(t) === i)
    .filter((t) => !revoked.has(t))
    .sort();
}

/** Grants of the form `grant execute on function public.<name>(...) to <role>`. */
export function functionGrants(
  files: MigrationFile[],
): { function: string; roles: string[]; file: string }[] {
  const out: { function: string; roles: string[]; file: string }[] = [];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    const re =
      /grant\s+[^;]*?\s+on\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\([^)]*\)\s+to\s+([^;]+?);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      out.push({
        function: m[1].toLowerCase(),
        roles: m[2]
          .split(',')
          .map((r) => r.trim().toLowerCase())
          .filter(Boolean),
        file: file.name,
      });
    }
  }
  return out;
}

/**
 * The only functions anonymous callers may execute. Both are SECURITY DEFINER
 * read paths that gate internally on an explicit opt-in or an unguessable id:
 *   get_public_ratings(text)  returns rows only where the owner set
 *                             shares_list_publicly (0015)
 *   get_shared_night(uuid)    keyed by an opaque share id (0016)
 * A third name appearing here is a new anonymous entry point into the
 * database and is stop-and-escalate.
 */
export const ANON_EXECUTABLE_FUNCTIONS = ['get_public_ratings', 'get_shared_night'];
