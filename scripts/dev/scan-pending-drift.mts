/**
 * READ-ONLY static drift scan: which columns do the 32 pending migrations REFERENCE that the live
 * database does not have and no earlier file in the set creates?
 *
 * WHY. 0034 failed on production because it grants update on public.profiles(shares_list_publicly),
 * a column 0015 added, the ledger says 0015 ran, and the live table does not have. Nothing in the
 * migration set removes it, so it was removed by hand, outside the ledger. Finding the REST of that
 * class one failed transaction at a time costs an operator-consented production run per column.
 *
 * WHAT IT IS AND IS NOT. It reads the live catalog once (read only at the server) and then walks the
 * pending files IN APPLY ORDER, tracking columns each file creates so a later file referencing an
 * earlier file's column is not a false positive. It only understands `grant <privs> (cols) on
 * <table>` and `alter table <t> add column [if not exists] <c>` plus `create table` column lists.
 * IT DOES NOT PARSE FUNCTION BODIES, so a column referenced only inside a plpgsql body is invisible
 * to it. A clean report here is evidence, not proof; the transaction is still the real gate.
 *
 *   PGSSLROOTCERT=<ca> npx tsx scripts/dev/scan-pending-drift.mts --secrets-file <env>
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { certify } from '../lib/whoami';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

const identity = await certify(arg('--secrets-file'));
if (identity.refusals.length > 0) {
  for (const reason of identity.refusals) process.stderr.write(`${reason}\n`);
  process.exit(2);
}
process.stdout.write(`target : ${identity.ref} (${identity.label})\n\n`);

const client = new pg.Client({ connectionString: identity.certified.connectionString });
await client.connect();

/** table -> set of columns, as the database actually is right now. */
const live = new Map<string, Set<string>>();
let pending: string[] = [];
try {
  await client.query('set session characteristics as transaction read only');

  const cols = await client.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public'`,
  );
  for (const r of cols.rows) {
    if (!live.has(r.table_name)) live.set(r.table_name, new Set());
    live.get(r.table_name)!.add(r.column_name);
  }

  const ledger = await client.query<{ name: string }>('select name from public.schema_migrations');
  const applied = new Set(ledger.rows.map((r) => r.name));
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  pending = (await import('node:fs')).readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && !applied.has(f)).sort();
} finally {
  await client.end();
}

process.stdout.write(`live public tables: ${live.size}\npending files     : ${pending.length}\n\n`);

const dir = path.join(process.cwd(), 'supabase', 'migrations');
const problems: string[] = [];

for (const file of pending) {
  const sql = readFileSync(path.join(dir, file), 'utf8')
    // Strip line comments so a column named only in prose is not treated as a reference.
    .replace(/^\s*--.*$/gm, '');

  // Columns this file CREATES, so later files referencing them are not false positives.
  for (const m of sql.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?[\s\S]*?add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi,
  )) {
    const [, table, column] = m;
    if (!live.has(table)) live.set(table, new Set());
    live.get(table)!.add(column);
  }
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\);/gi)) {
    const [, table, body] = m;
    if (!live.has(table)) live.set(table, new Set());
    for (const line of body.split('\n')) {
      const col = line.match(/^\s*"?(\w+)"?\s+(?:uuid|text|boolean|int|integer|bigint|smallint|numeric|jsonb|json|timestamptz|timestamp|date|real|double)/i);
      if (col) live.get(table)!.add(col[1]);
    }
  }

  // What this file REFERENCES by column list: `grant update (a, b) on public.t`.
  for (const m of sql.matchAll(
    /grant\s+[\w\s,]+?\s*\(([^)]*)\)\s*\n?\s*on\s+(?:table\s+)?(?:public\.)?"?(\w+)"?/gi,
  )) {
    const [, columnList, table] = m;
    const known = live.get(table);
    if (!known) {
      problems.push(`${file}: grants on public.${table}, which does not exist and no earlier file creates`);
      continue;
    }
    for (const raw of columnList.split(',')) {
      const column = raw.trim().replace(/"/g, '');
      if (column && !known.has(column)) {
        problems.push(`${file}: grants on public.${table}(${column}) - MISSING`);
      }
    }
  }
}

if (problems.length === 0) {
  process.stdout.write('no missing column references found in grant statements.\n');
} else {
  process.stdout.write(`${problems.length} problem(s):\n`);
  for (const p of problems) process.stdout.write(`  ${p}\n`);
}
process.stdout.write('\nReminder: function bodies are NOT parsed. The transaction is the real gate.\n');
