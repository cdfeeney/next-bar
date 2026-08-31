/**
 * db:load-bars — load a curated catalog payload into a target, skipping venues it already has.
 *
 * This is the phase D write path, rehearsed on staging first. It exists because the v7 script that
 * produced the Manhattan payload (`finalize-apply-manhattan-staging.mts`) cannot be reused: it
 * hard-asserts a 412-row starting state at line 61, has no dry-run/apply split, and its
 * `EXPECTED_INSERTS = 1255` arithmetic describes the v7 staging database rather than the target
 * phase D actually has. THERE IS NO BASELINE ASSERTION HERE, deliberately — the plan is derived
 * from what the target contains right now.
 *
 * DEDUPE IS BY placeId, which is the venue's identity. Google's place id is the only stable handle
 * across the two catalogs; matching on name would merge two bars that share one, and matching on
 * the payload's own `id` would insert every row because those ids were minted for the payload.
 *
 * IT WILL NOT RUN AGAINST PRODUCTION BY ACCIDENT. The target is certified before a socket opens,
 * the production ref requires an explicit `--production` flag, and `--execute` additionally requires
 * `HARNESS_DB_WRITE_OK` to name the resolved ref — snapshotted from the SHELL at module load, so a
 * `--secrets-file` cannot grant its own consent.
 *
 * Usage:
 *   npx tsx scripts/db-load-bars.mts --payload <json> [--secrets-file <p>]        # DRY RUN
 *   HARNESS_DB_WRITE_OK=<ref> npx tsx scripts/db-load-bars.mts \
 *     --payload <json> --secrets-file <p> --execute
 *
 * Against PRODUCTION (phase D) the --production flag is required as well, on the dry run and
 * on the load:
 *   HARNESS_DB_WRITE_OK=<prod-ref> npx tsx scripts/db-load-bars.mts \
 *     --payload <json> --secrets-file <p> --production --execute
 *
 * Exit codes: 0 planned or loaded · 1 a step failed · 2 refused (identity, consent, or payload)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { readClassification } from './lib/classification';
import type { CuratedCandidate } from './census/apply';
import { TargetRefusal } from './lib/migration-target-guard';
import { certify, readCounts, WhoamiConnectionError } from './lib/whoami';

/** Snapshotted before any dotenv load — a secrets file must not be able to consent for itself. */
const SHELL_WRITE_CONSENT = (process.env.HARNESS_DB_WRITE_OK ?? '').trim().toLowerCase();

const EXECUTE = process.argv.includes('--execute');

/** Phase D's explicit intent flag. Production is opt-in; see the refusal in main(). */
const PRODUCTION_INTENT = process.argv.includes('--production');

function fail(message: string, code: number): never {
  process.stderr.write(`[db:load-bars] ${message}\n`);
  process.exit(code);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

/** The payload's shape, mapped onto the columns `public.bars` actually has. */
function toRow(c: CuratedCandidate): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    tags: c.tags ?? [],
    neighborhood: c.neighborhood,
    price_tier: c.priceTier,
    blurb: c.blurb ?? '',
    address: c.address ?? '',
    source: 'census',
    place_id: c.placeId ?? null,
    business_status: c.businessStatus ?? null,
    last_verified: c.lastVerified,
  };
}

async function main(): Promise<void> {
  const payloadPath = arg('--payload');
  const secretsFile = arg('--secrets-file');
  const outDir = arg('--out') ?? path.join('docs', 'release-artifacts', 'staging-bars-rehearsal-2026-08-29');
  if (!payloadPath) fail('--payload <path> is required', 2);
  if (!existsSync(payloadPath)) fail(`--payload ${payloadPath} does not exist`, 2);

  // ── IDENTITY, BEFORE ANY SOCKET ──────────────────────────────────────────────────────────────
  const productionRef = readClassification().productionRef as string;
  const identity = await certify(secretsFile);
  if (identity.refusals.length > 0) {
    for (const reason of identity.refusals) process.stderr.write(`[db:load-bars] ${reason}\n`);
    fail('the target was refused — nothing is loaded into an unidentified database', 2);
  }
  const { certified, ref, label } = identity;

  // PRODUCTION IS OPT-IN, NOT FORBIDDEN. This file was written for the staging rehearsal and
  // refused the production ref outright, on the note that "the phase D run against production is a
  // separate, attended act". That act is phase D itself, so a blanket refusal would mean either
  // editing this guard under time pressure on the day or growing a second, less-reviewed copy of
  // the loader. Neither is better than a flag that has to be typed.
  //
  // What the flag does NOT relax: --execute still requires HARNESS_DB_WRITE_OK to name this exact
  // ref, snapshotted from the shell before dotenv runs. Production therefore needs TWO deliberate
  // acts (this flag and the operator's consent variable) where staging needs one, and a dry run
  // against production needs neither because it only reads.
  if (ref === productionRef && !PRODUCTION_INTENT) {
    fail(
      `REFUSED: ${ref} is the PRODUCTION project and --production was not given. This loader `
      + 'writes rows. If you mean phase D, say so explicitly with --production, and note that '
      + '--execute will still require HARNESS_DB_WRITE_OK to name this ref.',
      2,
    );
  }
  if (PRODUCTION_INTENT && ref !== productionRef) {
    // The flag is an assertion about the target, so a mismatch is a mistake worth stopping for and
    // not a harmless extra argument.
    fail(
      `REFUSED: --production was given but the target is ${ref} (${label}), not the declared `
      + `production ref ${productionRef}.`,
      2,
    );
  }
  if (EXECUTE && SHELL_WRITE_CONSENT !== ref) {
    fail(
      SHELL_WRITE_CONSENT
        ? `REFUSED: HARNESS_DB_WRITE_OK is "${SHELL_WRITE_CONSENT}" but the target is ${ref}.`
        : `REFUSED: --execute requires HARNESS_DB_WRITE_OK=${ref} in the shell. The operator types it, per act.`,
      2,
    );
  }

  const raw = readFileSync(payloadPath);
  const payloadSha256 = createHash('sha256').update(raw).digest('hex');
  const payload = JSON.parse(raw.toString('utf8')) as CuratedCandidate[];
  if (!Array.isArray(payload) || payload.length === 0) fail('payload is not a non-empty array', 2);
  const missingPlaceId = payload.filter((c) => !c.placeId);
  if (missingPlaceId.length > 0) {
    fail(
      `${missingPlaceId.length} payload row(s) have no placeId, so they cannot be deduplicated `
      + 'against the target. Refusing rather than inserting possible duplicates.',
      2,
    );
  }

  process.stdout.write(`payload : ${payloadPath}\n`);
  process.stdout.write(`        : ${payload.length} rows, sha256 ${payloadSha256}\n`);
  process.stdout.write(`target  : ${ref} (${label})\n\n`);

  const client = new pg.Client({ connectionString: certified.connectionString });
  try {
    await client.connect();
  } catch (error) {
    fail(`could not connect: ${(error as Error).message}`, 1);
  }

  try {
    // WHAT THE TARGET ALREADY HAS. Read once, compared in memory: the plan must describe the
    // database as it is now, not as a recorded baseline says it was.
    const existing = await client.query<{ place_id: string }>(
      'select place_id from public.bars where place_id is not null',
    );
    const have = new Set(existing.rows.map((r) => r.place_id));
    const beforeCount = (await client.query<{ n: number }>('select count(*)::int n from public.bars'))
      .rows[0]?.n ?? 0;

    const planned = payload.filter((c) => !have.has(c.placeId as string));
    const skipped = payload.length - planned.length;

    process.stdout.write(`target holds ${beforeCount} bars, ${have.size} with a place_id\n\n`);
    process.stdout.write(`planned inserts : ${planned.length}\n`);
    process.stdout.write(`skipped (already present by placeId) : ${skipped}\n\n`);
    process.stdout.write('sample of what would be inserted:\n');
    for (const c of planned.slice(0, 5)) {
      process.stdout.write(`  ${c.name} — ${c.neighborhood}\n`);
    }

    if (!EXECUTE) {
      // Echo back a command that RUNS. Reconstructed from the flags actually resolved, so it
      // carries --production and --out when they apply; a hint that gets refused when pasted is
      // worse than none, because it reads as the tool disagreeing with itself.
      const flags = [
        `--payload ${payloadPath}`,
        secretsFile ? `--secrets-file ${secretsFile}` : '',
        PRODUCTION_INTENT ? '--production' : '',
        `--out ${outDir}`,
        '--execute',
      ].filter(Boolean).join(' ');
      process.stdout.write(
        `\nDRY RUN — nothing was written.\n`
        + `To load:  HARNESS_DB_WRITE_OK=${ref} npx tsx scripts/db-load-bars.mts ${flags}\n`,
      );
      return;
    }

    if (planned.length === 0) {
      process.stdout.write('\nnothing to insert — every payload venue is already present.\n');
      return;
    }

    // ── LOAD ─────────────────────────────────────────────────────────────────────────────────
    // ONE TRANSACTION. A half-loaded catalog is worse than none, because it looks finished.
    const rows = planned.map(toRow);
    const columns = Object.keys(rows[0]);
    const columnList = columns.map((c) => `"${c}"`).join(', ');
    await client.query('begin');
    let inserted = 0;
    try {
      for (const row of rows) {
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const result = await client.query(
          `insert into public.bars (${columnList}) values (${placeholders})`,
          columns.map((c) => row[c] ?? null),
        );
        inserted += result.rowCount ?? 0;
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }

    const after = await readCounts(identity);
    const afterCount = (await client.query<{ n: number }>('select count(*)::int n from public.bars'))
      .rows[0]?.n ?? 0;
    const ledgerHead = (await client.query<{ name: string }>(
      'select name from public.schema_migrations order by name desc limit 1',
    )).rows[0]?.name ?? null;

    process.stdout.write(`\ninserted ${inserted}\n`);
    process.stdout.write(`${after.line}\n`);

    // THE ARTIFACT. Every database write in this repo leaves one — payload identity, target
    // identity, and the counts either side, so the run can be audited without the terminal.
    const artifact = {
      tool: 'scripts/db-load-bars.mts',
      ran_at: new Date().toISOString(),
      target_ref: ref,
      target_label: label,
      payload_path: payloadPath,
      payload_sha256: payloadSha256,
      payload_rows: payload.length,
      planned: planned.length,
      skipped_already_present: skipped,
      inserted,
      bars_before: beforeCount,
      bars_after: afterCount,
      ledger_head: ledgerHead,
    };
    mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `load-bars-${ref}-${artifact.ran_at.replace(/[:.]/g, '-')}.json`);
    writeFileSync(outFile, `${JSON.stringify(artifact, null, 2)}\n`);
    process.stdout.write(`artifact ${outFile}\n`);
  } finally {
    await client.end();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof WhoamiConnectionError) fail(error.message, 1);
  if (error instanceof TargetRefusal) fail(`REFUSED: ${error.message}`, 2);
  throw error;
}
