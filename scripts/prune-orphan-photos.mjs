/**
 * Report (and optionally delete) photo files in public/bar-photos/ that no live
 * venue can ever request.
 *
 * WHY THIS EXISTS AS A SCRIPT. 49 files were deleted on 2026-07-29 by an
 * uncommitted session script, which left the destructive pass unreviewable and
 * un-repeatable — santa-loop flagged exactly that. Dry-run by default; deletion
 * needs --apply.
 *
 * THE ID RULE, AND THE NEAR MISS THAT PRODUCED IT. A first attempt derived a
 * venue id by stripping any trailing `-<digits>` as a carousel suffix. That
 * misclassified every live venue whose id ends in a number — sunswick-3535,
 * studio-151, dive-75, bar-54, terminal-5 — and would have deleted their photos.
 * It was caught before running, but only by chance.
 *
 * So the rule never guesses. barVisual.ts builds every reachable URL as
 * `/bar-photos/<bar.id>.webp` or `/bar-photos/<bar.id>-<n>.webp` from a live
 * venue's own id, so a file is reachable if and only if:
 *   - its basename IS a known venue id, or
 *   - its basename is `<known-id>-<n>` where the PREFIX is itself a known id and
 *     n is a real carousel index (2..MAX_PHOTO_INDEX).
 * Exact match is tried first; the suffix rule only ever applies to a prefix that
 * is already known. Anything else is unreachable.
 *
 * Known ids are the union of the hand-authored catalog files and the bars table,
 * so a DB-only venue is not mistaken for an orphan.
 *
 * USAGE:
 *   node scripts/prune-orphan-photos.mjs             # report only
 *   node scripts/prune-orphan-photos.mjs --apply     # delete, after a backup
 *   node scripts/prune-orphan-photos.mjs --apply --backup-dir <path>
 */
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { refuseIfUnattended } from './loop-guard.mjs';

loadEnv({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
if (APPLY) refuseIfUnattended('orphan photo deletion');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PHOTO_DIR = path.join(REPO, 'public/bar-photos');
const BACKUP_ARG = process.argv.indexOf('--backup-dir');
const BACKUP_DIR =
  BACKUP_ARG !== -1 ? process.argv[BACKUP_ARG + 1] : path.join(REPO, '.orphan-photo-backup');

/** Highest carousel index the ingest ever writes. photo_count maxes at 3 today. */
const MAX_PHOTO_INDEX = 8;
const CATALOG_FILES = [
  'bars.core.ts',
  'bars.extra.ts',
  'bars.expansion.ts',
  'bars.expansion2.ts',
  'bars.expansion3.ts',
  'bars.expansion4.ts',
  'bars.expansion5.ts',
  'bars.expansion6.ts',
];

function catalogIds() {
  const ids = new Set();
  for (const file of CATALOG_FILES) {
    const p = path.join(REPO, 'src/lib', file);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/id:\s*'([a-z0-9-]+)'\s*,/g)) {
      ids.add(m[1]);
    }
  }
  return ids;
}

async function dbIds() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Refusing to run: without the bars table, every DB-only ' +
        "venue's photos would look like orphans.",
    );
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query('select id from public.bars');
    return new Set(rows.map((r) => r.id));
  } finally {
    await client.end();
  }
}

/** Reachable iff the basename is a known id, or a carousel photo of a known id. */
export function isReachable(basename, known, maxIndex = MAX_PHOTO_INDEX) {
  if (known.has(basename)) return true;
  const m = /^(.*)-(\d+)$/.exec(basename);
  if (!m) return false;
  const n = Number(m[2]);
  return known.has(m[1]) && n >= 2 && n <= maxIndex;
}

async function main() {
  const known = new Set([...catalogIds(), ...(await dbIds())]);
  const files = fs.readdirSync(PHOTO_DIR);
  const orphans = files.filter(
    (f) => !isReachable(f.replace(/\.(webp|jpe?g|png)$/i, ''), known),
  );

  console.log(`known venue ids: ${known.size}`);
  console.log(`photo files: ${files.length} | reachable: ${files.length - orphans.length} | ORPHAN: ${orphans.length}`);
  if (orphans.length > 0) console.log('\n' + orphans.sort().join('\n'));

  if (!APPLY) {
    console.log('\n(dry-run) nothing deleted. Re-run with --apply to delete after a backup.');
    return;
  }
  if (orphans.length === 0) return;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let bytes = 0;
  for (const f of orphans) {
    const src = path.join(PHOTO_DIR, f);
    bytes += fs.statSync(src).size;
    fs.copyFileSync(src, path.join(BACKUP_DIR, f));
  }
  console.log(`\nbacked up ${orphans.length} files (${(bytes / 1024).toFixed(0)} KB) to ${BACKUP_DIR}`);
  for (const f of orphans) fs.unlinkSync(path.join(PHOTO_DIR, f));
  console.log(`deleted ${orphans.length} files; ${fs.readdirSync(PHOTO_DIR).length} remain`);
}

await main();
