/**
 * READ-ONLY. Why 0034 failed on production: it grants on public.profiles columns that the live
 * table does not have, even though the ledger says the migration that added them ran.
 *
 * Opens the session read only at the server, like db-precheck-prod does, so this cannot write.
 * Point it at either project with --secrets-file; it prints the same facts for both so they can
 * be diffed.
 *
 *   PGSSLROOTCERT=<ca> npx tsx scripts/dev/inspect-profiles-drift.mts --secrets-file <env>
 */
import pg from 'pg';

import { certify } from '../lib/whoami';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

/** The columns 0034 grants update on, plus the ones 0015 is supposed to have added. */
const EXPECTED = ['display_name', 'is_private', 'shares_list_publicly'];

const identity = await certify(arg('--secrets-file'));
if (identity.refusals.length > 0) {
  for (const reason of identity.refusals) process.stderr.write(`${reason}\n`);
  process.exit(2);
}
process.stdout.write(`target : ${identity.ref} (${identity.label})\n\n`);

const client = new pg.Client({ connectionString: identity.certified.connectionString });
await client.connect();
try {
  await client.query('set session characteristics as transaction read only');

  const cols = await client.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' order by ordinal_position`,
  );
  process.stdout.write(`public.profiles has ${cols.rows.length} columns:\n`);
  for (const c of cols.rows) process.stdout.write(`  ${c.column_name.padEnd(28)}${c.data_type}\n`);

  const live = cols.rows.map((c) => c.column_name);
  const missing = EXPECTED.filter((c) => !live.includes(c));
  process.stdout.write(`\n0034 grants update on: ${EXPECTED.join(', ')}\n`);
  process.stdout.write(`MISSING here         : ${missing.join(', ') || '(none)'}\n`);

  // Does the ledger claim the migration that adds the column ran?
  const ledger = await client.query<{ name: string; applied_at: string }>(
    `select name, applied_at::text from public.schema_migrations
      where name like '0015%' or name like '0034%' order by name`,
  );
  process.stdout.write('\nledger rows for 0015 / 0034:\n');
  if (ledger.rows.length === 0) process.stdout.write('  (none)\n');
  for (const r of ledger.rows) process.stdout.write(`  ${r.name.padEnd(34)}${r.applied_at}\n`);
} finally {
  await client.end();
}
