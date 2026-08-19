/**
 * Backfill `public.bars.tags` to the V8 PRD contract: every bar carries at
 * least one tag, no bar carries more than five, and both are decided by
 * `src/lib/venueTags.ts` — a pure function of the row.
 *
 * Measured on staging 2026-08-19: 1667 rows, 132 with no tags, 100 over the
 * five-tag cap (max cardinality 7).
 *
 * NO MIGRATION. This is a data pass over existing rows; the 0019 schema
 * already holds `tags text[] not null default '{}'` and the vocabulary is
 * deliberately app-side (see 0019's closing note). Adding DDL here would also
 * have meant minting a migration number while a concurrent lane is minting
 * one, which is how this repo got its duplicate 0020/0021.
 *
 * DETERMINISTIC AND IDEMPOTENT: the second run over unchanged rows writes
 * nothing. Only rows whose computed tags DIFFER from the stored ones are
 * updated, so the ~1,400 already-correct rows are never touched (and their
 * `updated_at` never churns — the 0019 trigger bumps it on any update).
 *
 * STAGING ONLY. The target check reuses the audited fail-closed guard from
 * scripts/apply-migration-target-guard.ts.
 *
 * usage: npx tsx scripts/backfill-venue-tags.mts [--apply] [--limit N]
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { refuseIfUnattended } from './loop-guard.mjs';
import { checkMigrationTarget } from './apply-migration-target-guard';
import { venueTags, MAX_VENUE_TAGS } from '../src/lib/venueTags';

refuseIfUnattended('bars tag backfill');
dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

// --limit is the only thing bounding the blast radius of a write, so it fails
// CLOSED. `indexOf('--limit')` alone missed the `--limit=25` spelling entirely
// and silently ran unlimited; an unrecognised flag is refused for the same
// reason, since a typo'd limit is an unlimited run.
const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith('-'));
const limitIndex = args.indexOf('--limit');
const limitEquals = args.find((arg) => arg.startsWith('--limit='));
const rawLimit = limitIndex !== -1
  ? args[limitIndex + 1]
  : limitEquals?.slice('--limit='.length);
const unknown = flags.filter((flag) => flag !== '--apply' && flag !== '--limit'
  && !flag.startsWith('--limit='));
if (unknown.length > 0) {
  console.error(`unknown option(s): ${unknown.join(' ')}`);
  process.exit(1);
}
// `--limit` with no value must not read as "no limit": Number(undefined) is
// NaN and NaN fails the check below, so a valueless flag refuses.
const hasLimit = limitIndex !== -1 || limitEquals !== undefined;
const LIMIT = hasLimit ? Number(rawLimit) : Infinity;
if (hasLimit && (!Number.isInteger(LIMIT) || LIMIT < 1)) {
  console.error('--limit takes a positive integer (--limit 25 or --limit=25)');
  process.exit(1);
}

// Node's global kill switch turns tls.connect's default verification off for
// the whole process, so HTTPS below would prove nothing about the peer holding
// the service-role key. Same refusal, and the same reasoning, as
// authorizeMigrationTarget() in scripts/apply-migration-target-guard.ts.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.error('[target] refused: NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate '
    + 'verification for the whole process, so the Supabase host cannot be authenticated. '
    + 'Unset it and re-run.');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error('need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

/**
 * The REST endpoint carries the project ref in its HOSTNAME
 * (`<ref>.supabase.co`), not in a pooler username, so resolveProjectRef —
 * which is pooler-specific — does not apply. Anything that is not exactly
 * that shape resolves to '' and the guard below refuses it: an unverifiable
 * target is never assumed safe.
 *
 * The hostname alone is NOT enough. `http://<allowlisted-ref>.supabase.co`
 * names a permitted project and still ships the service-role key in clear
 * text to whoever answers on port 80, with no certificate proving the host
 * is the project it claims to be. The transport is part of the identity, so
 * anything but HTTPS on the default port resolves to '' and is refused.
 */
function refFromRestUrl(rest: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rest);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:') return '';
  if (parsed.port !== '' && parsed.port !== '443') return '';
  const match = /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(parsed.hostname.toLowerCase());
  return match ? match[1] : '';
}

// Same decision function the migration appliers use. Its messages name
// DATABASE_URL; here the ref came from NEXT_PUBLIC_SUPABASE_URL, which the
// prefix below says. The RULE is what matters and is identical: production is
// refused, and a target that cannot be proven to be an allowlisted staging
// project is refused too.
const refusal = checkMigrationTarget({
  env: 'staging',
  ref: refFromRestUrl(url),
  productionRef: process.env.NEXT_BAR_PRODUCTION_PROJECT_REF ?? '',
  stagingRefs: (process.env.NEXT_BAR_STAGING_PROJECT_REFS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean),
});
if (refusal) {
  console.error(`[target] refused (ref resolved from NEXT_PUBLIC_SUPABASE_URL): ${refusal}`);
  process.exit(1);
}

type BarRow = {
  id: string;
  name: string;
  blurb: string | null;
  price_tier: number | null;
  tags: string[] | null;
};

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// PAGINATED: PostgREST caps every response at 1,000 rows, SILENTLY, and this
// table already holds 1,667. An unpaginated read would report the backfill
// complete having never seen the last third of the catalog.
const rows: BarRow[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .from('bars')
    .select('id,name,blurb,price_tier,tags')
    .order('id', { ascending: true })
    .range(from, from + 999);
  if (error || !data) {
    console.error('read failed:', error?.message);
    process.exit(1);
  }
  rows.push(...(data as BarRow[]));
  if (data.length < 1000) break;
}

const sameTags = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((tag, i) => tag === b[i]);

// One derivation per row, reused by the report, the invariant check and the
// write. Computing it twice would let the report and the write disagree if the
// function ever stopped being pure — the one property everything here rests on.
const computed = rows.map((row) => {
  const before = row.tags ?? [];
  return {
    id: row.id,
    before,
    after: venueTags({
      name: row.name,
      blurb: row.blurb,
      priceTier: row.price_tier,
      tags: before,
    }),
  };
});

type Change = { id: string; before: string[]; after: string[]; reason: string };
const changes: Change[] = [];
let unchanged = 0;
for (const { id, before, after } of computed) {
  if (sameTags(before, after)) {
    unchanged++;
    continue;
  }
  const reason = before.length === 0
    ? 'untagged'
    : before.length > MAX_VENUE_TAGS
      ? 'over cap'
      : 'invalid or duplicate tag words';
  changes.push({ id, before, after, reason });
}

const targets = changes.slice(0, LIMIT === Infinity ? changes.length : LIMIT);
const byReason = new Map<string, number>();
for (const change of changes) byReason.set(change.reason, (byReason.get(change.reason) ?? 0) + 1);

console.log(`${rows.length} bars read; ${unchanged} already correct, ${changes.length} to change`);
for (const [reason, count] of [...byReason].sort()) console.log(`  ${reason}: ${count}`);
console.log(`processing ${targets.length} [${APPLY ? '--apply' : 'dry-run'}]`);
for (const change of targets) {
  console.log(`  ${change.id} (${change.reason}) [${change.before.join(' ')}] -> [${change.after.join(' ')}]`);
}

// The invariant the PRD actually asks for, asserted over the WHOLE table and
// not just the rows we happened to touch. A violation here means the derivation
// is wrong, so the run stops before writing rather than after.
const violations = computed.filter(
  ({ after }) => after.length < 1 || after.length > MAX_VENUE_TAGS,
);
if (violations.length > 0) {
  console.error(`ABORT: ${violations.length} rows would still violate 1..${MAX_VENUE_TAGS} tags`);
  for (const violation of violations.slice(0, 10)) console.error(`  ${violation.id}`);
  process.exit(1);
}

if (!APPLY) {
  console.log('(dry-run) pass --apply to write.');
  process.exit(0);
}
if (targets.length === 0) {
  console.log('nothing to write.');
  process.exit(0);
}

// Row-by-row: each row gets a different value, so there is no batch form that
// does not also risk overwriting columns this pass has no business touching.
let written = 0;
const failures: Array<{ id: string; reason: string }> = [];
for (const change of targets) {
  const { error } = await admin.from('bars').update({ tags: change.after }).eq('id', change.id);
  if (error) failures.push({ id: change.id, reason: error.message });
  else written++;
}
console.log(`\nWROTE ${written}/${targets.length} rows.`);
// ANY failure is a failed run. `written === 0` let 99-of-100 failed updates
// exit 0, so a wrapper or a `&&` chain read a half-applied table as done.
for (const failure of failures) console.error(`  FAILED ${failure.id}: ${failure.reason}`);
if (failures.length > 0) {
  console.error(`${failures.length}/${targets.length} rows still violate the tag contract.`);
  process.exit(1);
}
console.log('Re-run without --apply to confirm a zero-change second pass.');
