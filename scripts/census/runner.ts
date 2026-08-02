import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  configHashOf,
  loadCheckpoint,
  saveCheckpoint,
  sha256Of,
  validateCheckpoint,
  writeFileAtomic,
  type Checkpoint,
} from './checkpoint';
import { RunDeduper, splitAgainstCatalog } from './dedupe';
import { googleAdapter } from './providers/google';
import { osmAdapter } from './providers/osm';
import { slaAdapter } from './providers/sla';
import { urlSeedAdapter } from './providers/urlSeed';
import { userSubmissionAdapter } from './providers/userSubmission';
import type {
  CensusContext,
  Evidence,
  NormalizedCandidate,
  ProviderAdapter,
  Transport,
} from './types';

/**
 * Census runner (goal g-4531bbf0). DRY-RUN BY DEFAULT: the only artifacts are
 * files under outDir/<runId>/ — per-unit candidate files (overwritten, never
 * appended, so a re-run after a crash cannot duplicate), provider
 * checkpoints, the assembled report, and an apply-sidecar that binds the
 * exact reviewed payload (sha256 + configHash + codeSha) for a future
 * ATTENDED --apply. Budget is reconstructed from checkpoint callCounts on
 * resume — never a fresh in-memory counter (design review: deterministic
 * across crashes).
 */

export interface RunCensusOptions {
  boroughs: string[];
  sources: string[];
  budget: number;
  outDir: string;
  codeSha: string;
  dataVersion: string;
  now: () => Date;
  transport: Transport;
  readTextFile: (path: string) => string;
  catalog: Array<{ name: string; neighborhood: string }>;
  resumeRunId?: string;
  seedFile?: string;
  submissionsFile?: string;
}

export interface RunCensusResult {
  runId: string;
  configHash: string;
  stopped: 'complete' | 'budget_exhausted' | 'incomplete_units';
  checkpoints: Record<string, Checkpoint>;
  incompleteUnits: string[];
  reportPath: string;
}

function adaptersFor(opts: RunCensusOptions): ProviderAdapter[] {
  const registry: Record<string, () => ProviderAdapter> = {
    google: () => googleAdapter(),
    osm: () => osmAdapter(),
    sla: () => slaAdapter(),
    'url-seed': () => urlSeedAdapter(opts.seedFile ?? 'scripts/census/seeds/url-seed.json'),
    'user-submission': () =>
      userSubmissionAdapter(opts.submissionsFile ?? 'scripts/census/seeds/user-submissions.json'),
  };
  const unknown = opts.sources.filter((s) => !(s in registry));
  if (unknown.length > 0) throw new Error(`unknown sources: ${unknown.join(', ')}`);
  return opts.sources.map((s) => registry[s]());
}

function unitSlug(provider: string, unit: string): string {
  return `${provider}__${unit.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

function partialPath(unitsDir: string, provider: string, unit: string): string {
  return join(unitsDir, `${unitSlug(provider, unit)}.partial.json`);
}

export async function runCensus(opts: RunCensusOptions): Promise<RunCensusResult> {
  // ORDER IS SEMANTIC, deliberately not sorted (Codex round-2): resume
  // arithmetic is positional over boroughs×sources, so a reordered
  // invocation must be a config_hash REFUSAL, not a silent pass that skips
  // units in the reordered list.
  const configHash = configHashOf({
    boroughs: opts.boroughs,
    sources: opts.sources,
    dataVersion: opts.dataVersion,
  });
  const runId = opts.resumeRunId ?? `run-${opts.now().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = join(opts.outDir, runId);
  const unitsDir = join(runDir, 'units');
  mkdirSync(unitsDir, { recursive: true });

  // Run-level identity manifest, written BEFORE any unit executes (Codex
  // round-3: a crash after the first unit file but before the first
  // checkpoint left a run with artifacts and NO validatable identity — a
  // resume under a different config then failed open and rebound the old
  // unit files). Resume REQUIRES and validates this manifest even when no
  // checkpoint exists yet.
  const manifestFile = join(runDir, 'run.json');
  if (opts.resumeRunId) {
    if (!existsSync(manifestFile)) {
      throw new Error(`run ${runId} has no run.json manifest; refusing to resume (missing_run_manifest)`);
    }
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
      configHash: string;
      codeSha: string;
    };
    if (manifest.configHash !== configHash) {
      throw new Error(`run manifest is stale (config_hash); refusing to resume run ${runId}`);
    }
    if (manifest.codeSha !== opts.codeSha) {
      throw new Error(`run manifest is stale (code_sha); refusing to resume run ${runId}`);
    }
  } else {
    writeFileAtomic(
      manifestFile,
      JSON.stringify(
        {
          version: 1,
          runId,
          configHash,
          codeSha: opts.codeSha,
          dataVersion: opts.dataVersion,
          boroughs: opts.boroughs,
          sources: opts.sources,
          startedAt: opts.now().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  const adapters = adaptersFor(opts);
  const checkpoints: Record<string, Checkpoint> = {};

  // Load + validate EVERY checkpoint present in the run directory when
  // resuming — not only the ones for currently-selected adapters (Codex
  // round-2: resuming a google run with sources=osm found no osm checkpoint
  // to validate, silently rebound the old google unit files to the new
  // config, and failed open). A stale hash anywhere is a typed REFUSAL
  // before any unit executes — never "probably fine".
  if (opts.resumeRunId && existsSync(runDir)) {
    for (const f of readdirSync(runDir)) {
      const m = /^checkpoint\.(.+)\.json$/.exec(f);
      if (!m) continue;
      const cp = loadCheckpoint(join(runDir, f));
      const v = validateCheckpoint(cp, { configHash, codeSha: opts.codeSha });
      if (!v.ok) {
        throw new Error(
          `checkpoint for ${m[1]} is stale (${v.reason}); refusing to resume run ${runId}`,
        );
      }
      checkpoints[m[1]] = cp;
    }
  }

  // Budget already spent is the SUM of checkpointed callCounts.
  let callsSpent = Object.values(checkpoints).reduce((n, cp) => n + cp.callCount, 0);
  let stopped: RunCensusResult['stopped'] = 'complete';

  outer: for (const adapter of adapters) {
    const cpFile = join(runDir, `checkpoint.${adapter.name}.json`);
    const allUnits = opts.boroughs.flatMap((b) => adapter.units(b));
    const prior = checkpoints[adapter.name];
    let cp: Checkpoint =
      prior ??
      ({
        version: 1,
        runId,
        provider: adapter.name,
        coverageUnit: '',
        cursor: null,
        callCount: 0,
        configHash,
        codeSha: opts.codeSha,
        dataVersion: opts.dataVersion,
        lastSuccessfulUnit: null,
      } as Checkpoint);

    // Per-provider call accounting (Codex round-2: storing the GLOBAL
    // counter in every provider's checkpoint double-counted on resume —
    // summing google's 4 and osm's copied 4 reconstructed 8 spent from 4
    // real calls). Each checkpoint carries only ITS provider's calls; the
    // global spend is the sum.
    let providerCalls = cp.callCount;

    // Resume from the unit AFTER the last fully-successful one; a unit that
    // was interrupted mid-pagination (paused OR failed) re-enters at its
    // saved position — the presence of a partial file, not a non-null
    // cursor, is what marks an in-flight unit (santa round-1: a failed
    // first page has cursor null but must still be re-entered, not skipped).
    let startIndex = 0;
    if (cp.lastSuccessfulUnit) {
      const idx = allUnits.indexOf(cp.lastSuccessfulUnit);
      startIndex = idx === -1 ? 0 : idx + 1;
    }
    if (cp.coverageUnit) {
      const midIdx = allUnits.indexOf(cp.coverageUnit);
      const partialExists = existsSync(partialPath(unitsDir, adapter.name, cp.coverageUnit));
      if (midIdx !== -1 && (cp.cursor !== null || partialExists)) startIndex = midIdx;
    }

    for (let i = startIndex; i < allUnits.length; i++) {
      const unit = allUnits[i];
      const unitCandidates: NormalizedCandidate[] = [];
      const unitEvidence: Evidence[] = [];
      let cursor: string | null = unit === cp.coverageUnit ? cp.cursor : null;
      const pPath = partialPath(unitsDir, adapter.name, unit);
      const finalPath = join(unitsDir, `${unitSlug(adapter.name, unit)}.json`);

      // A final unit file is written ONLY on saturation, atomically, with
      // the unit's full content — its existence proves the unit completed
      // even when the crash landed before the completion checkpoint (Codex
      // round-3: the old blind sweep deleted a VALID partial in exactly
      // that window and then resumed into a suffix-only overwrite). Trust
      // the file, repair the checkpoint, and move on.
      if (existsSync(finalPath)) {
        if (existsSync(pPath)) rmSync(pPath);
        if (cp.lastSuccessfulUnit !== unit || cp.cursor !== null) {
          // Recover the completion-time call total recorded IN the final
          // file — the stale checkpoint predates the final page's charge
          // (Codex confirm pass). Older files without the field fall back
          // to the checkpoint (documented one-page undercount).
          const finalMeta = JSON.parse(readFileSync(finalPath, 'utf8')) as {
            providerCallsAtCompletion?: number;
          };
          const recovered = Math.max(
            cp.callCount,
            finalMeta.providerCallsAtCompletion ?? cp.callCount,
          );
          providerCalls = Math.max(providerCalls, recovered);
          callsSpent += recovered - cp.callCount;
          cp = {
            ...cp,
            coverageUnit: unit,
            cursor: null,
            callCount: recovered,
            lastSuccessfulUnit: unit,
          };
          saveCheckpoint(cpFile, cp);
          checkpoints[adapter.name] = cp;
        }
        continue;
      }

      // Reload pages already PAID FOR before an interruption (santa
      // round-1 CRITICAL: they were fetched, budget-charged, and then
      // silently dropped — the partial file is how they survive a pause).
      // UNCONDITIONAL on partial existence, not gated on the checkpointed
      // coverageUnit (GLM round-3 BLOCK, verified): a crash between the
      // partial write and its checkpoint save leaves the partial one unit
      // AHEAD of the checkpoint, and the old `unit === cp.coverageUnit`
      // gate discarded exactly the page the partial existed to preserve.
      // The partial is the source of truth for within-unit position; the
      // checkpoint only chooses which unit to enter.
      if (existsSync(pPath)) {
        const partial = JSON.parse(readFileSync(pPath, 'utf8')) as {
          cursor: string | null;
          candidates: NormalizedCandidate[];
          evidence: Evidence[];
        };
        unitCandidates.push(...partial.candidates);
        unitEvidence.push(...partial.evidence);
        cursor = partial.cursor;
      }

      const persistPartial = (atCursor: string | null): void => {
        writeFileAtomic(
          pPath,
          JSON.stringify(
            { unit, provider: adapter.name, cursor: atCursor, candidates: unitCandidates, evidence: unitEvidence },
            null,
            2,
          ),
        );
      };

      let saturated = false;
      while (!saturated) {
        if (opts.budget - callsSpent <= 0) {
          // Persist position AND the pages already fetched, then stop.
          persistPartial(cursor);
          cp = { ...cp, coverageUnit: unit, cursor, callCount: providerCalls };
          saveCheckpoint(cpFile, cp);
          checkpoints[adapter.name] = cp;
          stopped = 'budget_exhausted';
          break outer;
        }
        const ctx: CensusContext = {
          transport: opts.transport,
          readTextFile: opts.readTextFile,
          budgetLeft: opts.budget - callsSpent,
        };
        const result = await adapter.fetchUnit(unit, cursor, ctx);
        callsSpent += result.callsUsed;
        providerCalls += result.callsUsed;
        unitCandidates.push(...result.candidates);
        unitEvidence.push(...result.evidence);
        if (result.retry.attempts > 0) {
          // Failed page: persist what was paid for, keep the checkpoint
          // pointed at THIS unit, and STOP THIS ADAPTER — advancing to the
          // next unit would let a later success overwrite the checkpoint's
          // memory of the failure and skip this unit forever (santa
          // round-1 CRITICAL). Other adapters still run.
          persistPartial(result.nextCursor);
          cp = { ...cp, coverageUnit: unit, cursor: result.nextCursor, callCount: providerCalls };
          saveCheckpoint(cpFile, cp);
          checkpoints[adapter.name] = cp;
          continue outer;
        }
        cursor = result.nextCursor;
        saturated = result.saturated;
        if (!saturated) {
          // Per-page durability (Codex round-3): without this, a hard
          // crash between pages lost every fetched page AND its call
          // accounting — the budget could then be overrun by a whole
          // unit's worth of re-spend on resume. Now the surviving drift
          // is at most the single in-flight page.
          persistPartial(cursor);
          cp = { ...cp, coverageUnit: unit, cursor, callCount: providerCalls };
          saveCheckpoint(cpFile, cp);
          checkpoints[adapter.name] = cp;
        }
      }

      // OVERWRITE (atomic) per unit — a crash-and-rerun replaces, never
      // appends, so duplicates cannot accumulate across resumes. ORDER
      // MATTERS (Codex round-2): unit file, then checkpoint, then partial
      // delete — deleting the partial before the checkpoint is durable
      // opened a crash window where resume re-entered the unit with an
      // empty prefix and overwrote the complete file with a suffix. The
      // reverse crash window (checkpoint saved, partial survives) is
      // handled by the stale-partial sweep at adapter start.
      writeFileAtomic(
        join(unitsDir, `${unitSlug(adapter.name, unit)}.json`),
        JSON.stringify(
          {
            unit,
            provider: adapter.name,
            candidates: unitCandidates,
            evidence: unitEvidence,
            // Cumulative provider calls AT completion — lets the crash
            // repair recover the final page's cost exactly (Codex confirm
            // pass: the completion checkpoint is the only place that page
            // was charged, and a crash before it undercounted the budget).
            providerCallsAtCompletion: providerCalls,
          },
          null,
          2,
        ),
      );
      cp = {
        ...cp,
        coverageUnit: unit,
        cursor: null,
        callCount: providerCalls,
        lastSuccessfulUnit: unit,
      };
      saveCheckpoint(cpFile, cp);
      checkpoints[adapter.name] = cp;
      if (existsSync(pPath)) rmSync(pPath);
    }
  }

  // A unit with a surviving partial file was interrupted by a FAILURE (a
  // budget pause is already labeled). The run must not present itself as
  // cleanly complete when coverage has holes (santa round-1). But a partial
  // sitting NEXT TO its final unit file is crash-window litter, not a hole
  // — the final file is only ever written complete (Codex round-3); sweep
  // it here too, since resume skips units before lastSuccessfulUnit and the
  // in-loop repair never visits them.
  const incompleteUnits: string[] = [];
  if (existsSync(unitsDir)) {
    for (const f of readdirSync(unitsDir)) {
      if (!f.endsWith('.partial.json')) continue;
      const finalName = f.replace(/\.partial\.json$/, '.json');
      if (existsSync(join(unitsDir, finalName))) {
        rmSync(join(unitsDir, f));
        continue;
      }
      incompleteUnits.push(f.replace(/\.partial\.json$/, ''));
    }
  }
  if (stopped === 'complete' && incompleteUnits.length > 0) stopped = 'incomplete_units';

  const reportPath = assembleReport(runDir, unitsDir, {
    runId,
    configHash,
    codeSha: opts.codeSha,
    dataVersion: opts.dataVersion,
    boroughs: opts.boroughs,
    sources: opts.sources,
    budgetTotal: opts.budget,
    budgetUsed: callsSpent,
    stopped,
    incompleteUnits,
    generatedAt: opts.now().toISOString(),
    catalog: opts.catalog,
  });

  return { runId, configHash, stopped, checkpoints, incompleteUnits, reportPath };
}

/**
 * --report: rebuild report.json/report.md/apply-sidecar from an existing
 * run's unit files without any fetching. Metadata carries over from the
 * prior report; only generatedAt (and the reassembled candidate set) change.
 */
export function reassembleReport(outDir: string, runId: string, now: () => Date): string {
  const runDir = join(outDir, runId);
  const prior = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')) as ReportMeta;
  const unitsDir = join(runDir, 'units');
  const incompleteUnits = existsSync(unitsDir)
    ? readdirSync(unitsDir)
        .filter((f) => f.endsWith('.partial.json'))
        .map((f) => f.replace(/\.partial\.json$/, ''))
    : [];
  return assembleReport(runDir, unitsDir, {
    runId,
    configHash: prior.configHash,
    codeSha: prior.codeSha,
    dataVersion: prior.dataVersion,
    boroughs: prior.boroughs,
    sources: prior.sources,
    budgetTotal: prior.budgetTotal,
    budgetUsed: prior.budgetUsed,
    stopped: prior.stopped,
    incompleteUnits,
    generatedAt: now().toISOString(),
    catalog: [],
  });
}

interface ReportMeta {
  runId: string;
  configHash: string;
  codeSha: string;
  dataVersion: string;
  boroughs: string[];
  sources: string[];
  budgetTotal: number;
  budgetUsed: number;
  stopped: string;
  incompleteUnits: string[];
  generatedAt: string;
  catalog: Array<{ name: string; neighborhood: string }>;
}

function assembleReport(runDir: string, unitsDir: string, meta: ReportMeta): string {
  const deduper = new RunDeduper();
  const candidates: NormalizedCandidate[] = [];
  const evidence: Evidence[] = [];
  const files = existsSync(unitsDir) ? readdirSync(unitsDir).sort() : [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    // Partial files are interrupted units — surfaced via incompleteUnits,
    // never silently merged into the report as if their unit were covered.
    if (f.endsWith('.partial.json')) continue;
    const parsed = JSON.parse(readFileSync(join(unitsDir, f), 'utf8')) as {
      candidates: NormalizedCandidate[];
      evidence: Evidence[];
    };
    for (const c of parsed.candidates) {
      if (deduper.add(c)) candidates.push(c);
    }
    evidence.push(...parsed.evidence);
  }

  const { fresh, existing } = splitAgainstCatalog(candidates, meta.catalog);
  const evidenceBacked = fresh.filter((c) => c.evidenceIds.length > 0);
  const noEvidence = fresh.filter((c) => c.evidenceIds.length === 0);

  const report = {
    ...meta,
    catalog: undefined,
    counts: {
      raw: candidates.length,
      fresh: fresh.length,
      alreadyInCatalog: existing.length,
      evidenceBacked: evidenceBacked.length,
      missingEvidence: noEvidence.length,
    },
    candidates: fresh,
    alreadyInCatalog: existing.map((c) => c.externalId),
    evidence,
  };
  const reportPath = join(runDir, 'report.json');
  writeFileAtomic(reportPath, JSON.stringify(report, null, 2));

  const md = [
    `# Census report — ${meta.runId}`,
    '',
    `- Generated: ${meta.generatedAt}  ·  stopped: ${meta.stopped}`,
    ...(meta.incompleteUnits.length > 0
      ? [`- INCOMPLETE units (failed/paused mid-fetch, NOT covered): ${meta.incompleteUnits.join(', ')}`]
      : []),
    `- Boroughs: ${meta.boroughs.join(', ')}  ·  sources: ${meta.sources.join(', ')}`,
    `- Budget: ${meta.budgetUsed}/${meta.budgetTotal} network calls`,
    `- Fresh candidates: ${fresh.length} (${evidenceBacked.length} evidence-backed, ${noEvidence.length} missing evidence → permanently unverified until curated)`,
    `- Already in catalog: ${existing.length}`,
    '',
    '| name | neighborhood | provider | evidence |',
    '|---|---|---|---|',
    ...fresh.map(
      (c) => `| ${c.name} | ${c.neighborhood} | ${c.provider} | ${c.evidenceIds.length > 0 ? 'yes' : 'NONE'} |`,
    ),
  ].join('\n');
  writeFileAtomic(join(runDir, 'report.md'), md);

  // Sidecar: binds this exact payload to this config+code for a future
  // ATTENDED --apply. Enforced refusals: payload sha256 (tamper), codeSha
  // vs current HEAD (generation-logic drift; --allow-code-drift overrides
  // attended), generatedAt staleness. configHash is provenance metadata —
  // it is already bound into the payload identity and has no independent
  // apply-time counterpart (santa round-2 honesty fix).
  writeFileAtomic(
    join(runDir, 'apply-sidecar.json'),
    JSON.stringify(
      {
        runId: meta.runId,
        payloadSha256: sha256Of(JSON.stringify(report.candidates)),
        configHash: meta.configHash,
        codeSha: meta.codeSha,
        generatedAt: meta.generatedAt,
      },
      null,
      2,
    ),
  );

  return reportPath;
}
