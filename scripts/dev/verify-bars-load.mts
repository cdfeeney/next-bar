/**
 * READ-ONLY verification of the phase D1 bars load. Read only at the server, so it cannot write.
 *
 * The loader reported "inserted 851" and the count moved 1256 -> 2107. That is arithmetic, not
 * integrity: it says as much about a load that inserted 851 duplicates as about a correct one.
 * This asks the questions the count cannot.
 *
 *   PGSSLROOTCERT=<ca> npx tsx scripts/dev/verify-bars-load.mts --secrets-file <env>
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

const problems: string[] = [];
const client = new pg.Client({ connectionString: identity.certified.connectionString });
await client.connect();
try {
  await client.query('set session characteristics as transaction read only');

  const total = await client.query<{ n: number }>('select count(*)::int n from public.bars');
  process.stdout.write(`bars total            : ${total.rows[0]?.n}\n`);

  // 1. DEDUPE ACTUALLY HELD. place_id is the venue's identity and the only thing the loader
  //    deduplicated on; a duplicate here means the skip list was wrong.
  const dupes = await client.query<{ place_id: string; n: number }>(
    `select place_id, count(*)::int n from public.bars
      where place_id is not null group by place_id having count(*) > 1 order by n desc limit 10`,
  );
  process.stdout.write(`duplicate place_ids   : ${dupes.rowCount}\n`);
  for (const r of dupes.rows) process.stdout.write(`  ${r.place_id} x${r.n}\n`);
  if (dupes.rowCount !== 0) problems.push(`${dupes.rowCount} place_id(s) appear more than once`);

  // 2. Duplicate primary keys are impossible, but duplicate NAMES within a neighbourhood would
  //    suggest the catalog overlapped the existing rows under a different place_id.
  const nameDupes = await client.query<{ name: string; neighborhood: string; n: number }>(
    `select name, neighborhood, count(*)::int n from public.bars
      group by name, neighborhood having count(*) > 1 order by n desc, name limit 10`,
  );
  process.stdout.write(`duplicate name+hood   : ${nameDupes.rowCount}\n`);
  for (const r of nameDupes.rows) process.stdout.write(`  ${r.name} / ${r.neighborhood} x${r.n}\n`);

  // 3. The new rows are identifiable and countable.
  const bySource = await client.query<{ source: string; n: number }>(
    `select coalesce(source, '(null)') source, count(*)::int n from public.bars
      group by source order by n desc`,
  );
  process.stdout.write('\nby source:\n');
  for (const r of bySource.rows) process.stdout.write(`  ${r.source.padEnd(14)}${r.n}\n`);

  // 4. Nothing arrived without the fields the app reads.
  const nulls = await client.query<{ no_name: number; no_latlng: number; no_hood: number }>(
    `select
       count(*) filter (where name is null or name = '')::int no_name,
       count(*) filter (where lat is null or lng is null)::int no_latlng,
       count(*) filter (where neighborhood is null or neighborhood = '')::int no_hood
     from public.bars`,
  );
  const n = nulls.rows[0]!;
  process.stdout.write(`\nrows missing name     : ${n.no_name}\n`);
  process.stdout.write(`rows missing lat/lng  : ${n.no_latlng}\n`);
  process.stdout.write(`rows missing hood     : ${n.no_hood}\n`);
  if (n.no_name > 0) problems.push(`${n.no_name} bars have no name`);
  if (n.no_latlng > 0) problems.push(`${n.no_latlng} bars have no coordinates`);

  // 5. WHAT D2 STILL HAS TO FIX. The PRD contract is at least one tag and at most five.
  const tags = await client.query<{ untagged: number; over_cap: number; max_tags: number }>(
    `select
       count(*) filter (where tags is null or cardinality(tags) = 0)::int untagged,
       count(*) filter (where cardinality(tags) > 5)::int over_cap,
       coalesce(max(cardinality(tags)), 0)::int max_tags
     from public.bars`,
  );
  const t = tags.rows[0]!;
  process.stdout.write(`\nD2 scope - untagged   : ${t.untagged}\n`);
  process.stdout.write(`D2 scope - over 5 tags: ${t.over_cap} (max ${t.max_tags})\n`);
} finally {
  await client.end();
}

if (problems.length > 0) {
  process.stderr.write('\n[verify] PROBLEMS:\n');
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.exit(2);
}
process.stdout.write('\n[verify] the load is sound: no duplicate place_ids, no rows missing name or coordinates.\n');
