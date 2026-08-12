/**
 * Offline staging catalog EXPANSION PACKET CLI (goal g-779223ab).
 *
 *   npx tsx scripts/expansion-packet-cli.mts [--run <runId>]
 *
 * READ-ONLY. Constructs no database client, opens no socket, makes no network
 * call, runs no migration, writes to no bars table in any environment. Reads a
 * frozen census report + the static in-repo catalog (the offline baseline —
 * NOT the recorded Staging row count), corrects borough-level neighborhood
 * labels with the pure offline nearest-centroid snap from src/lib/geo.ts,
 * re-reconciles with the pure scripts/census/reconcile.ts, and writes
 * expansion-packet.json + expansion-packet.md ADDITIVELY into that run's own
 * output directory. It never rewrites report.json, reconcile.json, or
 * reconcile.md, and never touches scripts/census/apply.ts's write path.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { bars } from '../src/lib/bars';
import { isInServiceArea, snapToNeighborhoodCentroid } from '../src/lib/geo';
import { NEIGHBORHOOD_CENTROIDS } from '../src/lib/constants';
import {
  buildExpansionPacket,
  type Correction,
  type ExplainedReject,
  type SnapFailure,
} from './census/expansion-packet';
import type { BaselineBar } from './census/reconcile';
import type { NormalizedCandidate } from './census/types';
import { flagValue, makeFail, requireSafeRunId, type Fail } from './census/runArgs';

const DEFAULT_RUN_ID = 'run-2026-08-05T00-25-06-752Z';
const OUT_DIR = 'scripts/census/out';
const TARGET_TOTAL = 1200;
/** docs/STAGING-ACCEPTANCE-2026-08-05.md:36 — evidence, not this baseline. */
const RECORDED_STAGING_COUNT = 412;
/** How many named rejects to inline in the markdown before truncating. */
const MD_SAMPLE_LIMIT = 25;

const args = process.argv.slice(2);
// The explicit `: Fail` annotation is load-bearing — see reconcile-preflight.mts.
const fail: Fail = makeFail('expansion-packet');

interface FrozenReport {
  runId: string;
  codeSha?: string;
  configHash?: string;
  generatedAt: string;
  candidates: NormalizedCandidate[];
}

interface PacketOutput {
  runId: string;
  codeSha: string;
  configHash: string | null;
  reportGeneratedAt: string;
  baselineSource: string;
  baselineCount: number;
  recordedStagingCount: number;
  baselineVsStagingDelta: number;
  candidateCount: number;
  neighborhoodCorrected: number;
  snapFailedCount: number;
  newInsertsCount: number;
  idCollisionsCount: number;
  nameHoodCollisionsCount: number;
  validationRejectsCount: number;
  accountedFor: number;
  maxPossibleTotal: number;
  projectedTotal: number;
  priorProjectedTotal: number | null;
  target: number;
  reaches1200: boolean;
  shortfall: number;
  keyDivergence: number;
  corrections: Correction[];
  snapFailed: SnapFailure[];
  newInserts: NormalizedCandidate[];
  idCollisions: ExplainedReject[];
  nameHoodCollisions: ExplainedReject[];
  validationRejects: ExplainedReject[];
  keyDivergenceExamples: unknown;
}

function readJson<T>(path: string, what: string): T {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8')) as T;
  } catch (err) {
    return fail(`${what} at ${path} is not readable/valid JSON: ${err instanceof Error ? err.message : err}`);
  }
}

function main(): void {
  const runId = requireSafeRunId(flagValue(args, '--run', fail) ?? DEFAULT_RUN_ID, fail);
  const runDir = join(OUT_DIR, runId);
  const reportPath = join(runDir, 'report.json');

  if (!fs.existsSync(reportPath)) {
    fail(`report not found at ${reportPath} (run "${runId}" does not exist or was never generated)`);
  }

  const report = readJson<FrozenReport>(reportPath, 'report');
  if (!report.codeSha) {
    fail(`report at ${reportPath} has no codeSha — refusing to build a packet from a report of unknown provenance`);
  }
  if (!Array.isArray(report.candidates)) {
    fail(`report at ${reportPath} has no candidates array — partial/malformed input`);
  }

  // The prior goal's reconcile.json is read purely to print the before/after
  // delta. Absent = the delta is simply unknown; it is never regenerated here.
  const reconcilePath = join(runDir, 'reconcile.json');
  const priorProjectedTotal = fs.existsSync(reconcilePath)
    ? (readJson<{ projectedTotal?: number }>(reconcilePath, 'prior reconcile').projectedTotal ?? null)
    : null;

  const baseline: BaselineBar[] = bars.map((b) => ({
    id: b.id,
    name: b.name,
    neighborhood: b.neighborhood,
  }));

  const result = buildExpansionPacket({
    candidates: report.candidates,
    baseline,
    reportGeneratedAt: report.generatedAt,
    geo: { snapToNeighborhoodCentroid, isInServiceArea },
    knownNeighborhoods: new Set(Object.keys(NEIGHBORHOOD_CENTROIDS)),
  });

  if (result.accountedFor !== result.candidateCount) {
    fail(
      `packet accounting failed: ${result.accountedFor} candidates bucketed but ${result.candidateCount} evaluated — ` +
        'refusing to emit a packet that silently drops candidates',
    );
  }

  const output: PacketOutput = {
    runId: report.runId,
    codeSha: report.codeSha,
    configHash: report.configHash ?? null,
    reportGeneratedAt: report.generatedAt,
    baselineSource: 'src/lib/bars.ts (static in-repo catalog)',
    baselineCount: result.baselineCount,
    recordedStagingCount: RECORDED_STAGING_COUNT,
    baselineVsStagingDelta: RECORDED_STAGING_COUNT - result.baselineCount,
    candidateCount: result.candidateCount,
    neighborhoodCorrected: result.neighborhoodCorrected,
    snapFailedCount: result.snapFailed.length,
    newInsertsCount: result.newInserts.length,
    idCollisionsCount: result.idCollisions.length,
    nameHoodCollisionsCount: result.nameHoodCollisions.length,
    validationRejectsCount: result.validationRejects.length,
    accountedFor: result.accountedFor,
    maxPossibleTotal: result.baselineCount + result.candidateCount,
    projectedTotal: result.projectedTotal,
    priorProjectedTotal,
    target: TARGET_TOTAL,
    reaches1200: result.reaches1200,
    shortfall: Math.max(0, TARGET_TOTAL - result.projectedTotal),
    keyDivergence: result.keyDivergence,
    corrections: result.corrections,
    snapFailed: result.snapFailed,
    newInserts: result.newInserts,
    idCollisions: result.idCollisions,
    nameHoodCollisions: result.nameHoodCollisions,
    validationRejects: result.validationRejects,
    keyDivergenceExamples: result.keyDivergenceExamples,
  };

  fs.writeFileSync(join(runDir, 'expansion-packet.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(join(runDir, 'expansion-packet.md'), renderMarkdown(output));

  console.log(
    `expansion-packet ${runId}: baseline=${output.baselineCount} candidates=${output.candidateCount} ` +
      `corrected=${output.neighborhoodCorrected} snapFailed=${output.snapFailedCount} ` +
      `newInserts=${output.newInsertsCount} projectedTotal=${output.projectedTotal} ` +
      `(prior ${output.priorProjectedTotal ?? 'n/a'}) reaches1200=${output.reaches1200} ` +
      `shortfall=${output.shortfall} accountedFor=${output.accountedFor}`,
  );
  console.log(`wrote ${join(runDir, 'expansion-packet.json')} and ${join(runDir, 'expansion-packet.md')}`);
}

function countBy<T>(items: readonly T[], key: (t: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function sampleTable(rows: readonly ExplainedReject[], heading: string): string {
  if (rows.length === 0) return `### ${heading}\n\nNone.\n`;
  const shown = rows.slice(0, MD_SAMPLE_LIMIT);
  const body = shown
    .map((r) => `| \`${r.externalId}\` | ${r.name} | ${r.neighborhood} | ${r.failedCheck ?? r.reason} |`)
    .join('\n');
  const more =
    rows.length > shown.length
      ? `\n\n_${rows.length - shown.length} further entries omitted here — the complete, unabridged list is in \`expansion-packet.json\`._\n`
      : '\n';
  return `### ${heading} (${rows.length})\n\n| externalId | name | neighborhood | reason |\n|---|---|---|---|\n${body}${more}`;
}

function renderMarkdown(o: PacketOutput): string {
  const delta =
    o.priorProjectedTotal === null
      ? 'n/a (no prior reconcile.json in this run directory)'
      : `${o.projectedTotal - o.priorProjectedTotal >= 0 ? '+' : ''}${o.projectedTotal - o.priorProjectedTotal} vs the preflight's ${o.priorProjectedTotal}`;

  const verdict = o.reaches1200
    ? `\n**Target reached.** Projected total ${o.projectedTotal} meets or exceeds ${o.target}.\n`
    : `\n**Shortfall: ${o.shortfall}.** Projected total ${o.projectedTotal} is ${o.shortfall} short of ${o.target}. ` +
      `Neighborhood correction recovered ${o.neighborhoodCorrected} candidates from the borough-label reject bucket ` +
      `(${delta}), but ${o.idCollisionsCount} id collisions, ${o.nameHoodCollisionsCount} name+neighborhood ` +
      `duplicates, and ${o.validationRejectsCount} remaining validation rejects still keep it below the target. ` +
      `Even with zero further losses this run offers at most ${o.maxPossibleTotal} rows ` +
      `(baseline ${o.baselineCount} + candidates ${o.candidateCount}), so the ceiling is ` +
      `${o.maxPossibleTotal >= o.target ? 'above' : 'below'} ${o.target}. ` +
      `Per this goal's acceptance criterion 9 an honest shortfall is a valid, complete result — it is named here, not worked around.\n`;

  const snapReasons = countBy(o.snapFailed, (s) => s.reason)
    .map(([reason, n]) => `| ${reason} | ${n} |`)
    .join('\n');
  const correctionTargets = countBy(o.corrections, (c) => c.to)
    .map(([hood, n]) => `| ${hood} | ${n} |`)
    .join('\n');
  const validationReasons = countBy(o.validationRejects, (r) => r.failedCheck ?? r.reason)
    .map(([reason, n]) => `| ${reason} | ${n} |`)
    .join('\n');

  return `# Staging catalog expansion packet — ${o.runId}

Read-only, offline. No live apply, no network, no database client constructed, no migration run,
no staging or production contact. Generated by \`scripts/expansion-packet-cli.mts\`.

- **Report:** \`${o.runId}\` (codeSha \`${o.codeSha}\`, generated ${o.reportGeneratedAt})
- **Baseline source:** ${o.baselineSource}
- **Baseline count:** ${o.baselineCount}
- **Recorded Staging count (evidence, not this baseline):** ${o.recordedStagingCount}
- **Baseline vs Staging delta:** ${o.baselineVsStagingDelta} — still a named unknown. Only an attended
  Staging read can confirm whether the static catalog and the live Staging table hold the same rows;
  this packet does not read Staging and does not assume the delta away.

## Result

| Metric | Value |
|---|---|
| Candidates evaluated | ${o.candidateCount} |
| Neighborhoods corrected (offline centroid snap) | ${o.neighborhoodCorrected} |
| Snap failed (needed correction, could not be corrected) | ${o.snapFailedCount} |
| New inserts (would apply) | ${o.newInsertsCount} |
| Id collisions | ${o.idCollisionsCount} |
| Name+neighborhood collisions | ${o.nameHoodCollisionsCount} |
| Validation rejects | ${o.validationRejectsCount} |
| Accounted for (must equal candidates evaluated) | ${o.accountedFor} |
| Projected total (baseline + new inserts) | ${o.projectedTotal} |
| Prior preflight projected total | ${o.priorProjectedTotal ?? 'n/a'} |
| Change from correction | ${delta} |
| Reaches ${o.target}? | ${o.reaches1200 ? 'YES' : 'NO'} |
| Key divergence (census dedupeKey vs apply normalizeLegacy disagree) | ${o.keyDivergence} |
${verdict}
## Neighborhood correction

Candidates already carrying an in-vocabulary neighborhood are left untouched. Candidates carrying a
borough-level or otherwise unknown label are snapped to the nearest neighborhood centroid with
\`snapToNeighborhoodCentroid\` from \`src/lib/geo.ts\` — a pure, offline, already-tested function. No
geocoding API is called. \`externalId\` is carried through unchanged; only \`neighborhood\` is
rewritten, and candidates are copied rather than mutated.

### Corrected into

| neighborhood | count |
|---|---|
${correctionTargets || '| _(none)_ | 0 |'}

### Snap failures by reason

| reason | count |
|---|---|
${snapReasons || '| _(none)_ | 0 |'}

Snap-failed candidates are **not** dropped: they continue through reconciliation carrying their
original label, land in the validation-reject bucket, and are named individually in
\`expansion-packet.json\` under \`snapFailed\`.

## Every candidate is accounted for

${o.accountedFor} bucketed against ${o.candidateCount} evaluated. Each candidate appears in exactly one of
\`newInserts\`, \`idCollisions\`, \`nameHoodCollisions\`, or \`validationRejects\`; the CLI refuses to
emit a packet when those four do not sum to the candidate count.

### Validation rejects by specific failed check

| failed check | count |
|---|---|
${validationReasons || '| _(none)_ | 0 |'}

${sampleTable(o.idCollisions, 'Id collisions')}
${sampleTable(o.nameHoodCollisions, 'Name+neighborhood collisions')}
${sampleTable(o.validationRejects, 'Validation rejects')}
## Dry-run / apply plan

### (a) What this goal produced, offline

The packet above: a corrected candidate set, its reconciliation buckets, every named reject, and the
honest projected total against ${o.target}. Nothing was written outside this run directory's two
additive files plus the new script/test/doc files. No table, in any environment, was read or written.

### (b) What remains for an ATTENDED session — named here, performed nowhere

1. Read the live Staging \`bars\` table to close the ${o.baselineVsStagingDelta}-row baseline delta above.
2. Attended curation of the ${o.newInsertsCount} new-insert candidates: real price tier, blurb, address,
   and \`lastVerified\` (this packet used a neutral price-tier placeholder purely so boundary
   validation was not rejecting on a field real curation would fill in).
3. Reconcile or explicitly accept the ${o.keyDivergence}-candidate key divergence between
   \`dedupe.ts\`'s \`dedupeKey\` and \`apply.ts\`'s \`normalizeLegacy\`.
4. Human review of the centroid-snapped neighborhoods: a nearest-centroid assignment is a
   deterministic approximation, not ground truth, and it is now an ATTRIBUTE OF ROWS THAT WOULD BE
   INSERTED. Spot-check before any apply.
5. Explicit operator authorization, then the actual \`--apply\` invocation against Staging, per the
   sidecar/provenance gate in \`scripts/census/apply.ts\`. Out of scope here; named only.

### (c) Automation boundary

**No step in (b) may be automated by this goal or by any future unattended run.** Each requires a live
read, a human curation judgment, or an explicit operator authorization. An unattended agent must stop
at the packet.

## What this goal did NOT do

- No write to any bars table, in any environment.
- No network call of any kind: no Supabase, Vercel, Staging, Production, Google Places, or geocoding API.
- No migration written, applied, or edited.
- No modification of the frozen report, its sidecar, checkpoints, units, or the prior goal's
  \`reconcile.json\`/\`reconcile.md\`.
- No change to \`reconcile.ts\`, \`apply.ts\`, \`dedupe.ts\`, or \`src/lib/geo.ts\` semantics — they are composed.
- No deployment and no push.
`;
}

main();
