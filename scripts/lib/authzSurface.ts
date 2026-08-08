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
 * IT PARSES PER FUNCTION, NOT PER FILE, and that distinction is the whole
 * point. Counting `security definer` and `set search_path` occurrences per
 * file "passes" on this repository while genuinely disagreeing: 0006 has four
 * definer mentions and two search_path lines, 0034 has two and zero. Those
 * gaps are comments and re-grants, not unpinned functions — but a counter
 * cannot tell the difference, and a check that cannot distinguish a comment
 * from a vulnerability is not a check.
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
  /** The `create function` header through to the body delimiter. */
  header: string;
};

export type TableDef = {
  name: string;
  file: string;
};

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
 * Every function definition, with its OWN security attributes.
 *
 * A function's header runs from `create ... function` up to the `as $$`/`as $body$`
 * body delimiter; the attributes we care about (`security definer`,
 * `set search_path`) are declared there. Postgres also allows them AFTER the
 * body, so the trailing segment up to the closing delimiter is included.
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
      // Everything before the body opener, plus the tail after the body closes:
      // Postgres accepts the attributes on either side.
      const bodyOpen = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(segment);
      let attributeText = segment;
      if (bodyOpen) {
        const delimiter = bodyOpen[1];
        const openAt = (bodyOpen.index ?? 0) + bodyOpen[0].length;
        const closeAt = segment.indexOf(delimiter, openAt);
        attributeText =
          segment.slice(0, bodyOpen.index) +
          (closeAt === -1 ? '' : segment.slice(closeAt + delimiter.length));
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
