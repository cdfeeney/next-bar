/**
 * RESTORE MIGRATIONS 0020–0032 FROM GIT, PROVEN AGAINST PRODUCTION'S OWN LEDGER.
 *
 * WHY. B3 — the first attempt anywhere to build an empty database from this branch — stopped at
 * `bootstrap inventory: required migration is missing: 0026_clear_misresolved_place_ids.sql`. The
 * bootstrap's catalog fixture PARSES 0026–0032 to derive the venue rows it installs, and this
 * branch never carried 0020–0032 at all. The runner is right; the set was incomplete, and nothing
 * caught it because nothing had ever bootstrapped from zero.
 *
 * THE RULE, and it is the whole point of this script: a file is restored ONLY if its content hashes
 * to the checksum production's ledger already records for that name. Picking "the newest blob with
 * the right filename" would restore a file that was edited after it was applied, and the ledger
 * would then describe text that never ran. The checksum is the identity; the filename is a label.
 *
 * WHERE THE LEDGER COMES FROM. A LOCAL DUMP FILE, not a connection — this branch's work is under a
 * "nothing touches production" instruction, and a dump taken earlier today already contains
 * `public.schema_migrations` verbatim. No database is opened by this script.
 *
 * The checksum is `checksumOfSql` — the caller-holds-the-bytes variant — never `migrationChecksum`,
 * which re-reads from its own module-relative directory. We hold blob bytes from git; there is no
 * file to re-read, and a second read would be a second snapshot regardless.
 *
 * Usage:
 *   npx tsx scripts/dev/restore-migrations.mts --dump <path>            # report only
 *   npx tsx scripts/dev/restore-migrations.mts --dump <path> --write    # write the files
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { checksumOfSql } from '../../src/lib/effectiveMigration';

const WRITE = process.argv.includes('--write');
const dumpIndex = process.argv.indexOf('--dump');
const DUMP = dumpIndex >= 0 ? process.argv[dumpIndex + 1] ?? '' : '';
if (!DUMP) throw new Error('--dump <path to a production dump json> is required');

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
/** The contiguous range B3 needs. 0026–0032 are what the fixture parses; the rest complete the set. */
const WANTED = /^00(2[0-9]|3[0-2])_/;

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Every distinct blob ever committed at this path, across every ref. */
function blobsFor(file: string): string[] {
  const rel = `supabase/migrations/${file}`;
  const commits = git(['log', '--all', '--format=%H', '--', rel]).split('\n').filter(Boolean);
  const seen = new Set<string>();
  for (const commit of commits) {
    try {
      const blob = git(['rev-parse', `${commit}:${rel}`]).trim();
      if (blob) seen.add(blob);
    } catch {
      // The path does not exist in that commit (a deletion, or a rename boundary). Not an error.
    }
  }
  return [...seen];
}

const dump = JSON.parse(
  execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))', DUMP], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  }),
) as { ref: string; taken_at: string; tables: Record<string, { name: string; checksum: string }[]> };

const ledger = (dump.tables['public.schema_migrations'] ?? []).filter((row) => WANTED.test(row.name));
console.log(`ledger source: ${dump.ref} @ ${dump.taken_at}`);
console.log(`rows in range: ${ledger.length}\n`);

let restored = 0;
let already = 0;
const failures: string[] = [];

for (const row of ledger.sort((a, b) => a.name.localeCompare(b.name))) {
  const target = path.join(MIGRATIONS_DIR, row.name);
  const candidates = blobsFor(row.name);
  const match = candidates.find((blob) => checksumOfSql(git(['cat-file', 'blob', blob])) === row.checksum);

  if (!match) {
    failures.push(`${row.name}: no blob among ${candidates.length} matches ledger checksum ${row.checksum.slice(0, 12)}`);
    console.log(`  ✗ ${row.name.padEnd(46)} ${candidates.length} blob(s), NONE match`);
    continue;
  }

  const sql = git(['cat-file', 'blob', match]);
  if (existsSync(target)) {
    const same = checksumOfSql(
      execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))', target], { encoding: 'utf8' }),
    ) === row.checksum;
    console.log(`  ${same ? '=' : '!'} ${row.name.padEnd(46)} already present${same ? ', matches' : ', DIFFERS'}`);
    if (same) already += 1;
    else failures.push(`${row.name}: present on disk but does not match the ledger`);
    continue;
  }

  if (WRITE) writeFileSync(target, sql);
  restored += 1;
  console.log(`  ${WRITE ? '+' : '·'} ${row.name.padEnd(46)} blob ${match.slice(0, 12)} matches ledger`);
}

console.log(`\n${WRITE ? 'restored' : 'would restore'} ${restored}, already correct ${already}, failures ${failures.length}`);
for (const f of failures) console.log(`  ${f}`);
if (failures.length > 0) process.exit(1);
