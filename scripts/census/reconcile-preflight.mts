/**
 * Offline staging catalog reconciliation preflight (goal g-25eaf18d).
 *
 *   npx tsx scripts/census/reconcile-preflight.mts [--run <runId>]
 *
 * READ-ONLY. Constructs no database client, opens no socket, makes no
 * network call. Reads a frozen census report + the static in-repo catalog
 * (the offline baseline — NOT the recorded Staging row count; see the
 * baseline caveat in the emitted doc), reconciles them with the pure
 * scripts/census/reconcile.ts, and writes reconcile.json + reconcile.md
 * into that run's own output directory. Never touches
 * scripts/census/apply.ts's write path.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { bars } from '../../src/lib/bars';
import { reconcile, type BaselineBar } from './reconcile';
import type { NormalizedCandidate } from './types';
import { flagValue, makeFail, requireSafeRunId, type Fail } from './runArgs';

const DEFAULT_RUN_ID = 'run-2026-08-05T00-25-06-752Z';
const OUT_DIR = 'scripts/census/out';
const TARGET_TOTAL = 1200;

const args = process.argv.slice(2);
// Hardening (safe run-id, no duplicate/empty --run, reserved Windows device
// names) now lives in ./runArgs so expansion-packet-cli.mts reuses the exact
// same reviewed parser rather than re-inventing a weaker one.
// The explicit `: Fail` annotation is load-bearing: TypeScript only treats a
// call to a const-bound function as never-returning (so `report` is definitely
// assigned after a `fail(...)` branch) when the const carries an explicit type.
const fail: Fail = makeFail('reconcile-preflight');

interface FrozenReport {
  runId: string;
  codeSha?: string;
  configHash?: string;
  generatedAt: string;
  candidates: NormalizedCandidate[];
}

interface ReconcileOutput {
  runId: string;
  codeSha: string;
  configHash: string | null;
  reportGeneratedAt: string;
  baselineSource: string;
  baselineCount: number;
  recordedStagingCount: number;
  baselineVsStagingDelta: number;
  candidateCount: number;
  newInsertsCount: number;
  idCollisionsCount: number;
  nameHoodCollisionsCount: number;
  validationRejectsCount: number;
  maxPossibleTotal: number;
  projectedTotal: number;
  target: number;
  reaches1200: boolean;
  keyDivergence: number;
  newInserts: unknown;
  idCollisions: unknown;
  nameHoodCollisions: unknown;
  validationRejects: unknown;
  keyDivergenceExamples: unknown;
}

function main(): void {
  // No path separators or ".." survive requireSafeRunId, so join(OUT_DIR,
  // runId) below can never resolve outside OUT_DIR.
  const runId = requireSafeRunId(flagValue(args, '--run', fail) ?? DEFAULT_RUN_ID, fail);
  const runDir = join(OUT_DIR, runId);
  const reportPath = join(runDir, 'report.json');

  if (!fs.existsSync(reportPath)) {
    fail(`report not found at ${reportPath} (run "${runId}" does not exist or was never generated)`);
  }

  let report: FrozenReport;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as FrozenReport;
  } catch (err) {
    fail(`report at ${reportPath} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }

  if (!report.codeSha) {
    fail(`report at ${reportPath} has no codeSha — refusing to reconcile from a report of unknown provenance`);
  }
  if (!Array.isArray(report.candidates)) {
    fail(`report at ${reportPath} has no candidates array — partial/malformed input`);
  }

  const baseline: BaselineBar[] = bars.map((b) => ({
    id: b.id,
    name: b.name,
    neighborhood: b.neighborhood,
  }));

  const result = reconcile({
    candidates: report.candidates,
    baseline,
    reportGeneratedAt: report.generatedAt,
  });

  const baselineSource = 'src/lib/bars.ts (static in-repo catalog)';
  const RECORDED_STAGING_COUNT = 412;

  const output = {
    runId: report.runId,
    codeSha: report.codeSha,
    configHash: report.configHash ?? null,
    reportGeneratedAt: report.generatedAt,
    baselineSource,
    baselineCount: result.baselineCount,
    recordedStagingCount: RECORDED_STAGING_COUNT,
    baselineVsStagingDelta: RECORDED_STAGING_COUNT - result.baselineCount,
    candidateCount: result.candidateCount,
    newInsertsCount: result.newInserts.length,
    idCollisionsCount: result.idCollisions.length,
    nameHoodCollisionsCount: result.nameHoodCollisions.length,
    validationRejectsCount: result.validationRejects.length,
    maxPossibleTotal: result.baselineCount + result.candidateCount,
    projectedTotal: result.projectedTotal,
    target: TARGET_TOTAL,
    reaches1200: result.reaches1200,
    keyDivergence: result.keyDivergence,
    newInserts: result.newInserts,
    idCollisions: result.idCollisions,
    nameHoodCollisions: result.nameHoodCollisions,
    validationRejects: result.validationRejects,
    keyDivergenceExamples: result.keyDivergenceExamples,
  };

  fs.writeFileSync(join(runDir, 'reconcile.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(join(runDir, 'reconcile.md'), renderMarkdown(output));

  console.log(
    `reconcile-preflight ${runId}: baseline=${result.baselineCount} candidates=${result.candidateCount} ` +
      `newInserts=${result.newInserts.length} projectedTotal=${result.projectedTotal} ` +
      `reaches1200=${result.reaches1200} keyDivergence=${result.keyDivergence}`,
  );
  console.log(`wrote ${join(runDir, 'reconcile.json')} and ${join(runDir, 'reconcile.md')}`);
}

function renderMarkdown(o: ReconcileOutput): string {
  const shortfallLines = o.reaches1200
    ? ''
    : o.maxPossibleTotal < o.target
      ? `\n**Shortfall:** projected total ${o.projectedTotal} is ${o.target - o.projectedTotal} short of ${o.target}. ` +
        `Even with zero dedupe/validation losses, this run has only ${o.maxPossibleTotal} candidates available ` +
        `(baseline ${o.baselineCount} + candidates ${o.candidateCount}) — ${o.target - o.maxPossibleTotal} short of ` +
        `${o.target} regardless of losses. This run does not have enough distinct candidates to close the gap.\n`
      : `\n**Shortfall:** projected total ${o.projectedTotal} is ${o.target - o.projectedTotal} short of ${o.target}. ` +
        `Of ${o.candidateCount} candidates, ${o.idCollisionsCount} were dropped as id collisions, ` +
        `${o.nameHoodCollisionsCount} as name+neighborhood duplicates, and ${o.validationRejectsCount} failed ` +
        `boundary validation — those losses, not a shortage of candidates, are why the target is not reached.\n`;
  return `# Staging catalog reconciliation preflight — ${o.runId}

Read-only. No live apply, no network, no database client constructed.

- **Report:** \`${o.runId}\` (codeSha \`${o.codeSha}\`, generated ${o.reportGeneratedAt})
- **Baseline source:** ${o.baselineSource}
- **Baseline count:** ${o.baselineCount}
- **Recorded Staging count (evidence, not this baseline):** ${o.recordedStagingCount}
- **Baseline vs Staging delta:** ${o.baselineVsStagingDelta} — a named unknown; only an attended Staging
  read can confirm whether the static catalog and the live Staging table hold the same rows.

## Result

| Metric | Value |
|---|---|
| Candidates evaluated | ${o.candidateCount} |
| New inserts (would apply) | ${o.newInsertsCount} |
| Id collisions | ${o.idCollisionsCount} |
| Name+neighborhood collisions | ${o.nameHoodCollisionsCount} |
| Validation rejects | ${o.validationRejectsCount} |
| Projected total (baseline + new inserts) | ${o.projectedTotal} |
| Reaches 1,200? | ${o.reaches1200 ? 'YES' : 'NO'} |
| Key divergence (census dedupeKey vs apply normalizeLegacy disagree) | ${o.keyDivergence} |
${shortfallLines}
## Key divergence

\`scripts/census/dedupe.ts\`'s \`dedupeKey\` and \`scripts/census/apply.ts\`'s \`normalizeLegacy\` are
different functions guarding the same table (case handling, diacritics, and "and"/"the" stripping
all differ). ${o.keyDivergence} of ${o.candidateCount} candidates are classified differently by the
two — the dry-run "fresh" count does not predict what an attended apply would actually reject or
accept. Fixing the divergence is out of scope for this preflight; this number is the quantification.

## Attended gates still outstanding before any apply

1. Read the live Staging \`bars\` table to close the ${o.baselineVsStagingDelta}-row baseline delta above.
2. Attended curation: assign real price tiers, blurbs, addresses, and \`lastVerified\` dates to
   candidates in the new-inserts bucket (this preflight used a neutral price-tier placeholder to
   evaluate boundary validation, per \`scripts/census/reconcile.ts\`).
3. Reconcile or explicitly accept the ${o.keyDivergence}-candidate key divergence before trusting a
   real apply's fresh/existing split.
4. Explicit operator authorization to run \`--apply\` against Staging, per the sidecar/provenance
   gate in \`scripts/census/apply.ts\`.
5. Whether to pursue further coverage (more boroughs/sources, possible paid spend) to close any
   remaining gap to 1,200 is an operator decision outside this preflight.
`;
}

main();
