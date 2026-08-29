/**
 * THE DUMP, AS A FUNCTION THAT TAKES A CERTIFIED TARGET.
 *
 * It used to live only inside `db-dump.mts`, which meant `db:reset-staging` could take its
 * mandatory pre-destruction backup only by SPAWNING that script — a second process that re-read the
 * secrets file and re-decided for itself what it was dumping. Round 4: the parent's certification
 * and the child's connection were two different reads of a mutable file, so the reset could believe
 * it had backed up staging while the child had in fact dumped, or failed to dump, something else.
 *
 * So the target is not a parameter this function resolves. It is HANDED the `CertifiedTarget` the
 * guard produced and connects with exactly that string. There is no path here that reads
 * `process.env`, and none that can be pointed anywhere the caller did not already certify.
 *
 * WHAT IT PRESERVES. Every column verbatim, including `auth.users.id` and `encrypted_password`. A
 * dump that drops the password hashes is not a restore path — the accounts come back unable to sign
 * in, which is indistinguishable from having lost them. Ids are preserved for the same reason:
 * every foreign key in the database points at them.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import type { CertifiedTarget } from './migration-target-guard';

export class DumpRefusal extends Error {}
export class DumpFailure extends Error {}

export interface DumpResult {
  outFile: string;
  takenAt: string;
  tables: Record<string, unknown[]>;
}

/**
 * Writes `<outDir>/<ref>-<ISO>.json` and returns what it wrote.
 *
 * REFUSES TO OVERWRITE. A backup that silently replaces an earlier one can destroy evidence, which
 * is the same class of act it exists to protect against. The check happens BEFORE the read, so a
 * refusal costs nothing and cannot be mistaken for a failed dump.
 */
export async function dumpDatabase(
  certified: CertifiedTarget,
  outDir: string,
): Promise<DumpResult> {
  const takenAt = new Date().toISOString();
  const stamp = takenAt.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  const outFile = path.join(outDir, `${certified.ref}-${stamp}.json`);
  if (existsSync(outFile)) {
    throw new DumpRefusal(`${outFile} already exists — refusing to overwrite a backup`);
  }

  const client = new pg.Client({ connectionString: certified.connectionString });
  try {
    await client.connect();
  } catch (error) {
    throw new DumpFailure(`could not connect: ${(error as Error).message}`);
  }

  const tables: Record<string, unknown[]> = {};
  try {
    // EVERY base table in auth and public, discovered from the catalog rather than listed here: a
    // hand-maintained list silently stops backing up whatever was added since someone last edited
    // it, and nobody notices until a restore.
    const listed = await client.query(
      `select table_schema, table_name
         from information_schema.tables
        where table_schema in ('auth', 'public')
          and table_type = 'BASE TABLE'
        order by table_schema, table_name`,
    );
    for (const row of listed.rows as { table_schema: string; table_name: string }[]) {
      const key = `${row.table_schema}.${row.table_name}`;
      const quoted = `"${row.table_schema}"."${row.table_name}"`;
      try {
        const data = await client.query(`select * from ${quoted}`);
        tables[key] = data.rows;
      } catch (error) {
        // A table that cannot be READ is a failure, never an empty array: "no rows" and "no
        // permission" must never look the same in a backup.
        throw new DumpFailure(`could not read ${key}: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, `${JSON.stringify({ ref: certified.ref, taken_at: takenAt, tables }, null, 0)}\n`);
  return { outFile, takenAt, tables };
}

/** The per-table summary an operator reads, so both callers print it identically. */
export function formatDumpSummary(result: DumpResult): string {
  const entries = Object.entries(result.tables);
  const nonEmpty = entries.filter(([, rows]) => rows.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  const lines = [
    `wrote ${result.outFile}`,
    `tables ${entries.length} (${nonEmpty.length} non-empty)`,
    ...nonEmpty.map(([name, rows]) => `  ${name.padEnd(34)}${rows.length}`),
  ];
  const empty = entries.filter(([, rows]) => rows.length === 0).map(([n]) => n);
  if (empty.length > 0) lines.push(`  empty (${empty.length}): ${empty.join(', ')}`);
  return `${lines.join('\n')}\n`;
}
