/**
 * READ-ONLY. What photo/hours data do the 2107 production bars actually carry, and which rows lack
 * it? Written because phase D3 names scripts/refresh-places.mjs as the tool for "photos/hours on
 * the 851 new rows", and that script does not read this table at all - it walks the STATIC
 * src/lib/bars.*.ts catalog (403 entries) and writes a generated sidecar. Before deciding what
 * D3 should be, measure what is missing and for which rows.
 *
 *   PGSSLROOTCERT=<ca> npx tsx scripts/dev/inspect-bars-media.mts --secrets-file <env>
 */
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
try {
  await client.query('set session characteristics as transaction read only');

  const cols = await client.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'bars' order by ordinal_position`,
  );
  process.stdout.write('public.bars columns:\n');
  for (const c of cols.rows) process.stdout.write(`  ${c.column_name.padEnd(22)}${c.data_type}\n`);

  const names = cols.rows.map((c) => c.column_name);
  // Only ask about columns that exist; this table has been reshaped repeatedly.
  const media = ['photo_url', 'photo_name', 'photos', 'hours', 'opening_hours', 'business_status',
    'last_verified', 'place_id'].filter((c) => names.includes(c));

  process.stdout.write('\ncoverage by source (non-null / total):\n');
  for (const column of media) {
    const q = await client.query<{ source: string; have: number; total: number }>(
      `select coalesce(source, '(null)') source,
              count(*) filter (where "${column}" is not null)::int have,
              count(*)::int total
         from public.bars group by source order by source`,
    );
    const parts = q.rows.map((r) => `${r.source} ${r.have}/${r.total}`);
    process.stdout.write(`  ${column.padEnd(18)}${parts.join('   ')}\n`);
  }
} finally {
  await client.end();
}
