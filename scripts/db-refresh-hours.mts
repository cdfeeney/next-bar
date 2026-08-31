/**
 * db:refresh-hours — fetch opening hours from Google Place Details for bars in the DATABASE that
 * have a place_id but no hours, and write them back.
 *
 * WHY THIS EXISTS RATHER THAN scripts/refresh-places.mjs. That script is named by the phase D work
 * order, and it cannot do this job: it walks the STATIC catalog (`BAR_FILES` at :95 — bars.core.ts,
 * bars.expansion*.ts, 403 entries) and writes a generated sidecar `src/lib/bars.places.ts`. It
 * never reads `public.bars`, where the 851 rebuilt rows live, and the live app reads the DATABASE
 * (`src/components/CatalogRefresh.tsx` pages `.from('bars')`). Pointing it at this problem would
 * have spent Google quota refreshing the wrong 403 bars.
 *
 * IT SPENDS MONEY, SO THE DRY RUN IS THE POINT. A dry run makes ZERO API calls and prints the exact
 * number of calls a real run would make, and the SKU they bill under, so the bill is approved as a
 * NUMBER before a cent is spent. Nothing here is authorized by the dry run itself.
 *
 * THE TEXT SEARCH STEP IS SKIPPED, and that is most of the saving. refresh-places.mjs spends a
 * `places:searchText` call per bar just to RESOLVE a place id. Every row this tool targets already
 * has one, so it goes straight to Place Details: ONE call per bar, not two.
 *
 * BILLING. The field mask requests `regularOpeningHours`, which puts each Place Details call in
 * Google's ENTERPRISE SKU (Codex cost review 2026-07-24, recorded in refresh-places.mjs). That SKU
 * carries roughly a 1,000-call monthly free allowance ACROSS THE WHOLE PROJECT — so "851 calls is
 * under 1,000" only holds if nothing else has drawn on it this month. This tool cannot see that
 * meter; check the Google Cloud console if the number matters.
 *
 * THE TARGET IS EXPLICIT, NEVER AMBIENT — the same three properties as db-load-bars.mts:
 *   --production      opt-in, and an ASSERTION about the target: given while pointed elsewhere it
 *                     is also refused.
 *   --secrets-file    which env file names the target, rather than whichever .env.local the
 *                     current directory happens to offer.
 *   HARNESS_DB_WRITE_OK  must name the resolved ref before --apply writes, snapshotted from the
 *                     SHELL at module load so a secrets file cannot grant its own consent.
 *
 * NOT ATOMIC, and idempotent for that reason. Rows are written one at a time as their call
 * returns, so a failure part way leaves earlier rows written — which is survivable only because a
 * re-run re-selects on `hours is null` and finishes the job. On failure, RE-RUN; do not hand-repair.
 *
 * Usage:
 *   npx tsx scripts/db-refresh-hours.mts --secrets-file <p> --production            # DRY RUN
 *   HARNESS_DB_WRITE_OK=<ref> npx tsx scripts/db-refresh-hours.mts \
 *     --secrets-file <p> --production --apply [--limit N]
 *
 * Exit codes: 0 planned or written · 1 a step failed · 2 refused
 */
import { existsSync } from 'node:fs';

import * as dotenv from 'dotenv';
import pg from 'pg';

import { readClassification } from './lib/classification';
import { certify, WhoamiConnectionError } from './lib/whoami';
import { TargetRefusal } from './lib/migration-target-guard';

/** Snapshotted before any dotenv load: a secrets file must not grant its own consent. */
const SHELL_WRITE_CONSENT = (process.env.HARNESS_DB_WRITE_OK ?? '').trim().toLowerCase();

const APPLY = process.argv.includes('--apply');
const PRODUCTION_INTENT = process.argv.includes('--production');

/** The Enterprise SKU's approximate monthly free allowance, for the estimate printed below. */
const ENTERPRISE_FREE_CALLS_PER_MONTH = 1000;

/** Politeness gap between calls. Google's per-minute quota is far higher; this is not the limit. */
const CALL_SPACING_MS = 120;

function fail(message: string, code: number): never {
  process.stderr.write(`[db:refresh-hours] ${message}\n`);
  process.exit(code);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

type Window = { open: string; close: string };
type WeeklyHours = Record<string, Window[]>;

/**
 * Google periods -> the WeeklyHours shape ALREADY STORED in this column and already read by
 * src/lib/openNow.ts: keys "0".."6" with 0=Sunday, "HH:MM" strings, an overnight window expressed
 * as close < open, and a missing close meaning open-all-day.
 *
 * Ported deliberately from toWeeklyHours() in scripts/refresh-places.mjs rather than reinvented:
 * two functions producing the same column in different shapes is how a reader ends up unable to
 * trust either. Verified against live rows before writing this (e.g. the-double-windsor stores
 * {"0":[{"open":"12:00","close":"02:00"}],...}).
 */
function toWeeklyHours(regularOpeningHours: unknown): WeeklyHours | undefined {
  const periods = (regularOpeningHours as { periods?: unknown } | undefined)?.periods;
  if (!Array.isArray(periods)) return undefined;
  const hours: WeeklyHours = {};
  for (const raw of periods) {
    const p = raw as { open?: { day?: number; hour?: number; minute?: number };
      close?: { hour?: number; minute?: number } };
    if (!p.open || typeof p.open.day !== 'number') continue;
    const day = String(p.open.day);
    const open = `${pad(p.open.hour ?? 0)}:${pad(p.open.minute ?? 0)}`;
    const close = p.close ? `${pad(p.close.hour ?? 0)}:${pad(p.close.minute ?? 0)}` : '24:00';
    (hours[day] ||= []).push({ open, close });
  }
  return Object.keys(hours).length > 0 ? hours : undefined;
}

async function main(): Promise<void> {
  const secretsFile = arg('--secrets-file');
  if (secretsFile !== null) {
    if (secretsFile === '') fail('--secrets-file needs a path', 2);
    if (!existsSync(secretsFile)) fail(`--secrets-file ${secretsFile} does not exist`, 2);
    dotenv.config({ path: secretsFile, override: true });
  }
  dotenv.config({ path: '.env.local' });

  const rawLimit = arg('--limit');
  const LIMIT = rawLimit === null ? Infinity : Number(rawLimit);
  if (rawLimit !== null && (!Number.isInteger(LIMIT) || LIMIT < 1)) {
    fail('--limit takes a positive integer', 2);
  }

  // ── IDENTITY, BEFORE ANY SOCKET ──────────────────────────────────────────────────────────────
  const productionRef = readClassification().productionRef as string;
  const identity = await certify(secretsFile);
  if (identity.refusals.length > 0) {
    for (const reason of identity.refusals) process.stderr.write(`[db:refresh-hours] ${reason}\n`);
    fail('the target was refused — nothing is read from an unidentified database', 2);
  }
  const { certified, ref, label } = identity;

  if (ref === productionRef && !PRODUCTION_INTENT) {
    fail(
      `REFUSED: ${ref} is the PRODUCTION project and --production was not given.`,
      2,
    );
  }
  if (PRODUCTION_INTENT && ref !== productionRef) {
    fail(
      `REFUSED: --production was given but the target is ${ref} (${label}), not the declared `
      + `production ref ${productionRef}.`,
      2,
    );
  }
  if (APPLY && SHELL_WRITE_CONSENT !== ref) {
    fail(
      SHELL_WRITE_CONSENT
        ? `REFUSED: HARNESS_DB_WRITE_OK is "${SHELL_WRITE_CONSENT}" but the target is ${ref}.`
        : `REFUSED: --apply requires HARNESS_DB_WRITE_OK=${ref} in the shell. The operator types `
          + 'it, per act.',
      2,
    );
  }

  // Checked even on a dry run: discovering a missing key AFTER the operator approves a bill is a
  // worse moment to discover it. Presence only — validating it would cost a call.
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) fail('GOOGLE_MAPS_API_KEY is not set (presence is checked even in a dry run)', 2);

  process.stdout.write(`target : ${ref} (${label})\n\n`);

  const client = new pg.Client({ connectionString: certified.connectionString });
  try {
    await client.connect();
  } catch (error) {
    fail(`could not connect: ${(error as Error).message}`, 1);
  }

  try {
    if (!APPLY) await client.query('set session characteristics as transaction read only');

    const { rows: targets } = await client.query<{ id: string; name: string; place_id: string }>(
      `select id, name, place_id from public.bars
        where hours is null and place_id is not null and place_id <> ''
        order by id`,
    );
    const { rows: totals } = await client.query<{ total: number; with_hours: number; no_place: number }>(
      `select count(*)::int total,
              count(*) filter (where hours is not null)::int with_hours,
              count(*) filter (where place_id is null or place_id = '')::int no_place
         from public.bars`,
    );
    const t = totals[0]!;

    const planned = targets.slice(0, LIMIT === Infinity ? targets.length : LIMIT);

    process.stdout.write(`bars total                    : ${t.total}\n`);
    process.stdout.write(`  already have hours          : ${t.with_hours}\n`);
    process.stdout.write(`  no place_id (unreachable)   : ${t.no_place}\n`);
    process.stdout.write(`  MISSING hours, have place_id: ${targets.length}\n\n`);

    // ── THE BILL, AS A NUMBER, BEFORE ANY CALL ─────────────────────────────────────────────────
    process.stdout.write('THE BILL, if this runs:\n');
    process.stdout.write(`  API calls               : ${planned.length}  (one Place Details per bar)\n`);
    process.stdout.write('  endpoint                : GET places.googleapis.com/v1/places/{id}\n');
    process.stdout.write('  field mask              : id,regularOpeningHours\n');
    process.stdout.write('  SKU                     : Place Details ENTERPRISE (regularOpeningHours\n');
    process.stdout.write('                            is what puts it in that tier)\n');
    process.stdout.write(`  free allowance          : ~${ENTERPRISE_FREE_CALLS_PER_MONTH}/month, SHARED across this\n`);
    process.stdout.write('                            Google project - this tool cannot read the meter\n');
    const over = planned.length - ENTERPRISE_FREE_CALLS_PER_MONTH;
    process.stdout.write(
      over > 0
        ? `  VERDICT                 : ${over} calls BEYOND the free allowance even if nothing\n`
          + '                            else used it this month. Expect a charge.\n'
        : `  VERDICT                 : fits the monthly allowance with ${-over} to spare, IF nothing\n`
          + '                            else has drawn on it this month. Then $0.\n',
    );
    process.stdout.write('  text search calls       : 0 (every target already has a place_id, so the\n');
    process.stdout.write('                            resolve step refresh-places.mjs pays for is skipped)\n\n');

    process.stdout.write('first 5 that would be fetched:\n');
    for (const row of planned.slice(0, 5)) {
      process.stdout.write(`  ${row.id.padEnd(38)}${row.name}\n`);
    }

    if (!APPLY) {
      process.stdout.write(
        `\nDRY RUN — no API call was made and nothing was written.\n`
        + `To run:  HARNESS_DB_WRITE_OK=${ref} npx tsx scripts/db-refresh-hours.mts`
        + `${secretsFile ? ` --secrets-file ${secretsFile}` : ''}`
        + `${PRODUCTION_INTENT ? ' --production' : ''}`
        + `${rawLimit !== null ? ` --limit ${rawLimit}` : ''} --apply\n`,
      );
      return;
    }
    if (planned.length === 0) {
      process.stdout.write('\nnothing to fetch.\n');
      return;
    }

    // ── FETCH AND WRITE, ONE ROW AT A TIME ─────────────────────────────────────────────────────
    process.stdout.write(`\nfetching ${planned.length}...\n`);
    let written = 0;
    let noHours = 0;
    const failures: Array<{ id: string; reason: string }> = [];

    for (const [index, row] of planned.entries()) {
      try {
        const res = await fetch(`https://places.googleapis.com/v1/places/${row.place_id}`, {
          headers: {
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'id,regularOpeningHours',
          },
        });
        if (!res.ok) {
          failures.push({ id: row.id, reason: `HTTP ${res.status} ${(await res.text()).slice(0, 120)}` });
          continue;
        }
        const body = await res.json() as { regularOpeningHours?: unknown };
        const hours = toWeeklyHours(body.regularOpeningHours);
        if (!hours) {
          // Google has no hours for this venue. Leaving the column NULL is the honest record:
          // openNow.ts renders nothing for null and "closed" for an empty object.
          noHours += 1;
        } else {
          await client.query(
            `update public.bars
                set hours = $1::jsonb, hours_source = 'google', hours_confidence = 'unverified',
                    hours_verified_at = now()
              where id = $2`,
            [JSON.stringify(hours), row.id],
          );
          written += 1;
        }
      } catch (error) {
        failures.push({ id: row.id, reason: (error as Error).message });
      }
      if ((index + 1) % 50 === 0) {
        process.stdout.write(`  ${index + 1}/${planned.length} (written ${written}, no hours ${noHours}, failed ${failures.length})\n`);
      }
      await new Promise((resolve) => { setTimeout(resolve, CALL_SPACING_MS); });
    }

    process.stdout.write(`\ncalls made : ${planned.length}\n`);
    process.stdout.write(`written    : ${written}\n`);
    process.stdout.write(`no hours at Google : ${noHours}\n`);
    process.stdout.write(`failed     : ${failures.length}\n`);
    for (const failure of failures.slice(0, 20)) {
      process.stderr.write(`  FAILED ${failure.id}: ${failure.reason}\n`);
    }
    // ANY failure is a failed run: a wrapper reading exit 0 would call a partial pass done.
    if (failures.length > 0) {
      fail(`${failures.length}/${planned.length} failed. Re-run — the pass re-selects on hours is null.`, 1);
    }
    process.stdout.write('\nRe-run without --apply to confirm the remaining count.\n');
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
