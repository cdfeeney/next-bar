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
  /**
   * Whether the function's BODY references `auth.uid()`.
   *
   * A SECURITY DEFINER function reaches past RLS by design, so the body's own
   * caller check is the only remaining gate. Most derive the acting user from
   * `auth.uid()`; a few legitimately do not (a trigger, an opt-in-gated public
   * read, an opaque-id lookup). The runbook needs the distinction per function,
   * because telling an operator "every definer must use auth.uid()" makes the
   * legitimate exceptions look like defects.
   */
  usesAuthUid: boolean;
  /**
   * `returns trigger`. A trigger function cannot be called over PostgREST — it
   * is only reachable as a trigger — so an `EXECUTE` grant on it is not an
   * anonymous entry point in the way an RPC's would be.
   */
  returnsTrigger: boolean;
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
  /**
   * Columns named in a column-scoped grant, e.g.
   * `grant update (display_name, is_private) on table public.profiles`.
   * Empty for an ordinary table-level statement.
   *
   * This distinction is not cosmetic. Column-level privileges live in
   * `pg_attribute.attacl` and surface in `information_schema.role_column_grants`
   * — NOT in `role_table_grants`. Folding them into the table-level set makes
   * the runbook promise an operator a row that their query can never return.
   */
  columns: string[];
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

export const LEGACY_SCHEMA_FILE = path.resolve(process.cwd(), 'supabase', 'schema.sql');

/**
 * The v0.1 objects a PRE-MIGRATION database still holds.
 *
 * `supabase/schema.sql` is the v0.1 schema. Migration 0000 does NOT drop those
 * tables — it **renames** them to `*_v01_legacy` "so nothing is destroyed even
 * if this assumption is ever wrong" (0000:11-12), and deliberately leaves
 * `waitlist` alone because `/api/waitlist` still writes to it (0000:7-8).
 *
 * So the expected surface is NOT the same in every environment:
 *   - a FRESH database (Staging rebuilt from migrations) holds only the 22
 *     tables the migrations create;
 *   - a v0.1-DERIVED database (Production) additionally holds `waitlist` and
 *     the four renamed legacy tables, with their v0.1 policies and the
 *     Supabase default-era grants that came with them.
 *
 * Omitting them made Checks 1-3 false on Production: ~27 tables instead of 22,
 * ~15 extra policies where a higher count is stop-and-escalate, and an `anon`
 * grant on `waitlist` that the grant check would have escalated. Every one of
 * those is a manufactured incident on a HEALTHY database.
 */
export function legacySchemaTables(schemaSql: string, files: MigrationFile[]): string[] {
  const created = tablesCreated([
    { prefix: '0000', name: 'schema.sql', sql: schemaSql },
  ]).map((t) => t.name);
  const renames = legacyRenames(files);
  return [...new Set(created.map((t) => renames.get(t) ?? t))].sort();
}

/** `alter table public.X rename to Y` from the migrations, as a map X -> Y. */
export function legacyRenames(files: MigrationFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)\s+rename\s+to\s+([a-z0-9_]+)/gi,
    )) {
      out.set(m[1].toLowerCase(), m[2].toLowerCase());
    }
  }
  return out;
}

/** Net v0.1 policies, keyed by the table's POST-rename name. */
export function legacySchemaPolicies(
  schemaSql: string,
  files: MigrationFile[],
): Map<string, string[]> {
  const renames = legacyRenames(files);
  const byTable = policiesByTable([
    { prefix: '0000', name: 'schema.sql', sql: schemaSql },
  ]);
  return new Map(
    [...byTable.entries()]
      .map(([table, names]) => [renames.get(table) ?? table, names] as [string, string[]])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Tables present on a v0.1-derived database and on no fresh one. Reviewed
 * intent; the tests assert it equals the derived set so a change to
 * `schema.sql` or to 0000's renames cannot silently invalidate the runbook.
 */
export const V01_LEGACY_TABLES = [
  'bars_v01_legacy',
  'profiles_v01_legacy',
  'saves_v01_legacy',
  'visits_v01_legacy',
  'waitlist',
];

/**
 * Column-scoped grants across the whole corpus, as
 * `table -> role -> columns`. Declared so the runbook's "exactly three rows
 * and nothing else" for the column-ACL query is guarded corpus-wide, not just
 * for `profiles`.
 */
export const COLUMN_SCOPED_GRANTS: Record<string, Record<string, string[]>> = {
  profiles: {
    authenticated: ['display_name', 'is_private', 'shares_list_publicly'],
  },
};

/**
 * Object forms the runbook states an expectation about but this module does
 * NOT parse, found in live (non-comment) SQL.
 *
 * The runbook says "expected: zero views" and "`rls_forced` false everywhere".
 * Nothing derives either, so a future migration legitimately adding a view or
 * `force row level security` would leave the document asserting
 * stop-and-escalate on a healthy database — the exact drift the generated
 * expectations exist to prevent, reappearing in the two places that are still
 * hand-stated. Failing the build is the cheap fix: whoever adds one must update
 * the runbook in the same change.
 */
export function unmodelledObjectStatements(
  files: MigrationFile[],
): { file: string; statement: string }[] {
  const out: { file: string; statement: string }[] = [];
  const patterns = [
    /\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\b[^;]*/gi,
    /\balter\s+table\s+[^;]*\bforce\s+row\s+level\s+security\b[^;]*/gi,
  ];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        out.push({ file: file.name, statement: m[0].replace(/\s+/g, ' ').trim().slice(0, 120) });
      }
    }
  }
  return out;
}

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
      let bodyText = '';
      if (bodyOpen) {
        const delimiter = bodyOpen[1];
        const openAt = (bodyOpen.index ?? 0) + bodyOpen[0].length;
        const closeAt = segment.indexOf(delimiter, openAt);
        const tail = closeAt === -1 ? '' : segment.slice(closeAt + delimiter.length);
        bodyText = closeAt === -1 ? segment.slice(openAt) : segment.slice(openAt, closeAt);
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
        usesAuthUid: /\bauth\.uid\s*\(/i.test(bodyText),
        returnsTrigger: /\breturns\s+trigger\b/i.test(attributeText),
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
 * The function definitions a deployed database actually HOLDS, after replaying
 * every `create` and `drop function` in order — last definition wins.
 *
 * `functionsDefined` returns every definition ever written, which is the wrong
 * set to reason about deployed state. `pending_change_count` is the case that
 * proves it: 0020:179 defines `pending_change_count(p_user uuid)` with no
 * caller check, and 0021:26 DROPS it and recreates `pending_change_count()`
 * gated on `auth.uid()`. Reading the raw list reports the function as having no
 * caller check — describing a version that no longer exists, and, worse,
 * turning the reviewed-exception list into a licence for exactly the regression
 * 0021 was written to fix.
 *
 * Keyed by NAME, matching the rest of this module (the runbook's expectations
 * are per name). `liveFunctionOverloadConflicts` guards the assumption.
 */
export function liveFunctions(files: MigrationFile[]): FunctionDef[] {
  const live = new Map<string, FunctionDef>();
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    const events: { at: number; kind: 'create' | 'drop'; name: string }[] = [];
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi,
    )) {
      events.push({ at: m.index ?? 0, kind: 'create', name: m[1].toLowerCase() });
    }
    for (const m of sql.matchAll(
      /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi,
    )) {
      events.push({ at: m.index ?? 0, kind: 'drop', name: m[1].toLowerCase() });
    }
    events.sort((a, b) => a.at - b.at);
    const defsInFile = functionsDefined([file]);
    const byNameQueue = new Map<string, FunctionDef[]>();
    for (const d of defsInFile) {
      byNameQueue.set(d.name, [...(byNameQueue.get(d.name) ?? []), d]);
    }
    for (const ev of events) {
      if (ev.kind === 'drop') {
        live.delete(ev.name);
      } else {
        const next = byNameQueue.get(ev.name)?.shift();
        if (next) live.set(ev.name, next);
      }
    }
  }
  return [...live.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Function names that still have MORE THAN ONE definition live at the end of
 * the corpus — i.e. real overloads, where keying by name loses information.
 * Empty here; asserted so `liveFunctions`' name-keying stays honest.
 */
export function liveFunctionOverloadConflicts(files: MigrationFile[]): string[] {
  const dropped = new Set<string>();
  for (const file of files) {
    for (const m of stripSqlComments(file.sql).matchAll(
      /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(([^)]*)\)/gi,
    )) {
      dropped.add(`${m[1].toLowerCase()}(${m[2].replace(/\s+/g, ' ').trim()})`);
    }
  }
  const signatures = new Map<string, Set<string>>();
  for (const file of files) {
    for (const m of stripSqlComments(file.sql).matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([^)]*)\)/gi,
    )) {
      const name = m[1].toLowerCase();
      const args = m[2].replace(/\s+/g, ' ').trim();
      const set = signatures.get(name) ?? new Set<string>();
      set.add(args);
      signatures.set(name, set);
    }
  }
  return [...signatures.entries()]
    .filter(([name, args]) => {
      const surviving = [...args].filter((a) => {
        // Compare on the argument TYPES, which is what identifies an overload.
        const types = a.replace(/\b\w+\s+(?=\w)/g, '').trim();
        return !dropped.has(`${name}(${a})`) && !dropped.has(`${name}(${types})`);
      });
      return surviving.length > 1;
    })
    .map(([name]) => name)
    .sort();
}

/**
 * Functions with no `revoke ... from public` anywhere in the corpus.
 *
 * Postgres grants `EXECUTE` **to `PUBLIC` by default** on every new function.
 * The RPCs here all revoke it; these do not, so a deployed database legitimately
 * shows a `PUBLIC` row for each. The runbook has to say so, or its
 * anonymous-entry-point check cries wolf on every healthy run — and a check
 * that cries wolf is a check the operator learns to skip.
 */
export function functionsWithoutPublicRevoke(files: MigrationFile[]): string[] {
  const revoked = new Set<string>();
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    const re =
      /revoke\s+[^;]*?\s+on\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\([^)]*\)\s+from\s+([^;]+?);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      if (parseRoles(m[2]).includes('public')) revoked.add(m[1].toLowerCase());
    }
  }
  return liveFunctions(files)
    .map((f) => f.name)
    .filter((n) => !revoked.has(n))
    .sort();
}

/**
 * The eight functions above, every one of them a TRIGGER function.
 *
 * A trigger function has no PostgREST route and cannot be called as an RPC, so
 * the default `EXECUTE to PUBLIC` on them is not an anonymous entry point —
 * which is why they were never revoked and why leaving them is acceptable. A
 * NON-trigger function joining this list would be a genuine anonymous entry
 * point, so the test asserts both the membership and the returns-trigger
 * property.
 */
export const FUNCTIONS_WITHOUT_PUBLIC_REVOKE = [
  'account_content_state_clock_guard',
  'account_content_state_lww_guard',
  'bars_touch_updated_at',
  'handle_new_user',
  'photo_permissions_immutable',
  'ratings_lww_guard',
  'touch_updated_at',
  'vibe_profiles_lww_guard',
];

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
        columns: parseGrantedColumns(m[2]),
        table: m[3].toLowerCase(),
        roles: parseRoles(m[4]),
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

/** The column names inside any `(...)` of a column-scoped grant. */
function parseGrantedColumns(raw: string): string[] {
  return [...raw.matchAll(/\(([^)]*)\)/g)]
    .flatMap((m) => m[1].split(','))
    .map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/**
 * Role list of a grant/revoke.
 *
 * Strips `with grant option` / `with admin option` and surrounding double
 * quotes. Without this, `to anon with grant option` parses as a role literally
 * named `anon with grant option` and `to "anon"` as `"anon"` — in both cases a
 * real grant to `anon` is recorded under a name nothing matches, so the
 * anon-grant assertion passes while anonymous access was widened. That is a
 * fail-OPEN, which is the only kind that matters here.
 */
function parseRoles(raw: string): string[] {
  return raw
    .replace(/\bwith\s+(?:grant|admin)\s+option\b/gi, ' ')
    .split(',')
    .map((r) => r.trim().toLowerCase().replace(/^"|"$/g, ''))
    .filter(Boolean);
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
  return replayTablePrivileges(files);
}

/**
 * The same replay for COLUMN-scoped grants, which `role_table_grants` cannot
 * show. Kept separate so the runbook can point the operator at
 * `role_column_grants` for these instead of promising a row that will never
 * appear.
 */
export function netColumnPrivileges(
  files: MigrationFile[],
): Map<string, Map<string, string[]>> {
  const state = new Map<string, Map<string, Set<string>>>();
  for (const st of privilegeStatements(files)) {
    const byRole = state.get(st.table) ?? new Map<string, Set<string>>();
    for (const role of st.roles) {
      const held = byRole.get(role) ?? new Set<string>();
      if (st.action === 'grant') {
        for (const column of st.columns) held.add(column);
      } else {
        // `revoke all on table` also removes column-level privileges.
        if (st.columns.length === 0) held.clear();
        else for (const column of st.columns) held.delete(column);
      }
      byRole.set(role, held);
    }
    state.set(st.table, byRole);
  }
  return sortPrivilegeState(state);
}

function replayTablePrivileges(
  files: MigrationFile[],
): Map<string, Map<string, string[]>> {
  const state = new Map<string, Map<string, Set<string>>>();
  for (const st of privilegeStatements(files)) {
    const byRole = state.get(st.table) ?? new Map<string, Set<string>>();
    for (const role of st.roles) {
      const held = byRole.get(role) ?? new Set<string>();
      for (const priv of st.privileges) {
        // A column-scoped GRANT confers no table-level privilege, so it must
        // not enter this set; a REVOKE of any shape does clear table-level.
        if (st.action === 'grant') {
          if (st.columns.length === 0) held.add(priv);
        } else held.delete(priv);
      }
      byRole.set(role, held);
    }
    state.set(st.table, byRole);
  }
  return sortPrivilegeState(state);
}

function sortPrivilegeState(
  state: Map<string, Map<string, Set<string>>>,
): Map<string, Map<string, string[]>> {
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
      // Drop tables left holding nothing, so "is this table in the map" means
      // "does any role hold a privilege on it". `bar_rsvps` is exactly this
      // case: 0012 grants delete, 0014 revokes it, net nothing.
      .filter(([, byRole]) => byRole.size > 0)
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
  // A PARTIAL revoke does not clear Supabase's default `grant all`, so it must
  // not count. `revoke update on table public.profiles from public, anon,
  // authenticated` (0006:82) leaves every other default privilege in place;
  // treating it as revoke-first would certify a table that still relies on the
  // defaults, and the runbook would then present its grant matrix as an exact
  // expectation when the deployed state can legitimately hold much more.
  // Both anon and authenticated must be covered: revoking from one leaves the
  // other's defaults intact.
  const revokedAll = new Map<string, Set<string>>();
  for (const st of privilegeStatements(files)) {
    if (st.action !== 'revoke') continue;
    if (st.columns.length > 0) continue;
    const isAllPrivileges = TABLE_PRIVILEGES.every((p) => st.privileges.includes(p));
    if (!isAllPrivileges) continue;
    const roles = revokedAll.get(st.table) ?? new Set<string>();
    for (const role of st.roles) roles.add(role);
    revokedAll.set(st.table, roles);
  }
  return tablesCreated(files)
    .map((t) => t.name)
    .filter((t, i, all) => all.indexOf(t) === i)
    .filter((t) => {
      const roles = revokedAll.get(t);
      return !(roles?.has('anon') && roles.has('authenticated'));
    })
    .sort();
}

/**
 * Grant forms this module CANNOT model, found in live (non-comment) SQL.
 *
 * `grant ... on all tables in schema public to anon` and
 * `alter default privileges ... grant ... to anon` widen anonymous access
 * without naming a table, so every table-level parser here is blind to them.
 * Being blind fails OPEN — the suite would report `anon` reaching two tables
 * while it reaches all of them — so their presence must break the build rather
 * than be silently skipped.
 *
 * Both appear in this repository today ONLY inside explanatory comments
 * (0034:13, 0019:79), which `stripSqlComments` removes before this runs.
 */
export function unmodelableGrantStatements(
  files: MigrationFile[],
): { file: string; statement: string }[] {
  const out: { file: string; statement: string }[] = [];
  const patterns = [
    /\b(?:grant|revoke)\b[^;]*\bon\s+all\s+(?:tables|sequences|routines|functions)\s+in\s+schema\b[^;]*/gi,
    /\balter\s+default\s+privileges\b[^;]*/gi,
  ];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        out.push({ file: file.name, statement: m[0].replace(/\s+/g, ' ').trim() });
      }
    }
  }
  return out;
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

/**
 * `SECURITY DEFINER` functions whose body does NOT reference `auth.uid()`.
 *
 * Each is a reviewed exception, not an oversight. A definer function bypasses
 * RLS, so if it neither derives the acting user from `auth.uid()` nor is gated
 * some other way, it is an unauthenticated door into the data:
 *   handle_new_user        AFTER INSERT trigger on auth.users; the row IS the
 *                          identity, and no caller exists to check
 *   get_public_ratings     anon-executable; gated on the owner's
 *                          `shares_list_publicly` opt-in instead
 *   get_shared_night       anon-executable; gated on an opaque share id
 *
 * Derived from `liveFunctions`, NOT from every definition ever written. That
 * distinction is load-bearing: `pending_change_count` was on this list while it
 * was read from the raw definitions, because 0020 defined an ungated
 * `pending_change_count(uuid)`. 0021 drops that and recreates the function
 * gated on `auth.uid()`, so the entry described a version no database holds —
 * and would have licensed a dashboard edit back to the ungated form as "the
 * reviewed expectation".
 *
 * The test asserts derived == declared, so a NEW definer function without a
 * caller check fails the suite and has to be justified here before it ships.
 */
export const DEFINERS_WITHOUT_AUTH_UID = [
  'get_public_ratings',
  'get_shared_night',
  'handle_new_user',
];

/**
 * The full text of every net-live `create policy` statement.
 *
 * Policy NAMES and COUNTS are metadata; what a policy actually permits lives in
 * its `using` / `with check` expressions. A deployed policy can carry the
 * expected name and count while its `using` clause has been edited to
 * `using (true)` — every name-and-count check passes and the table is wide
 * open. That is worse than no check, because the runbook then supplies
 * positive assurance at a layer it never inspected. Emitting the expected
 * expressions gives the operator something concrete to diff against
 * `pg_policies.qual` / `.with_check`.
 */
export function policyDefinitions(
  files: MigrationFile[],
): { table: string; policy: string; file: string; sql: string }[] {
  const live = policiesByTable(files);
  const out: { table: string; policy: string; file: string; sql: string }[] = [];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    const re =
      /\bcreate\s+policy\s+("[^"]*"|[a-z0-9_]+)\s+on\s+(?:public\.)?([a-z0-9_]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const raw = m[1];
      const policy = raw.startsWith('"') ? raw.slice(1, -1) : raw.toLowerCase();
      const table = m[2].toLowerCase();
      // Only policies that survive every later `drop policy`.
      if (!live.get(table)?.includes(policy)) continue;
      const from = m.index ?? 0;
      const statement = endOfStatement(sql.slice(from));
      out.push({
        table,
        policy,
        file: file.name,
        sql: statement.replace(/\s+/g, ' ').trim(),
      });
    }
  }
  // A policy can be created, dropped and re-created across migrations
  // (0020 then 0021 for bar_change_queue_insert_own). Only the LAST create is
  // what a deployed database holds; emitting both would hand the operator two
  // conflicting "expected" expressions for one policy.
  const lastWins = new Map<string, (typeof out)[number]>();
  for (const p of out) lastWins.set(`${p.table} ${p.policy}`, p);
  return [...lastWins.values()].sort(
    (a, b) => a.table.localeCompare(b.table) || a.policy.localeCompare(b.policy),
  );
}
