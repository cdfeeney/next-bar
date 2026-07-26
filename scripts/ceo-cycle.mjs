// CEO cycle runner — measure -> assess -> decide -> draft -> log, over ceo/state.json.
//
// Two properties matter more than anything the report says:
//
//  1. It cannot enter SHIP without a REVIEW pass. Shipping is a separate, explicitly reviewed
//     step; the runner never crosses that line on its own.
//  2. Metrics never travel the agent path. An agent that writes its own numbers can silence the
//     kill criterion without touching the field the guard watches, so measurement gets its own
//     door (assertMeasurementUpdate) and the agent door refuses to open for it.
//
// The runner is offline and clock-free: every timestamp arrives inside the measurement envelope,
// so the same input always renders the same report. That is what makes it testable at all.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCeoState } from '../ceo/state.schema.mjs';
import {
  assertActionAllowed,
  assertMeasurementUpdate,
  assertStateMutationAllowed,
} from './ceo-guard.mjs';

export class CeoCycleAbort extends Error {
  constructor(message) {
    super(message);
    this.name = 'CeoCycleAbort';
  }
}

/**
 * Halt, twice over — same shape as ceo-guard's abort, and for the same reason: a harness that
 * stubs process.exit must not let execution fall through into the thing we just refused.
 */
function abort(detail) {
  const message = `[ceo-cycle] ${detail} Aborting.`;
  console.error(message);
  process.exit(1);
  throw new CeoCycleAbort(message);
}

/**
 * Every action the runner performs, by stage.
 *
 * Declaring them here (rather than inline) is what lets the suite assert that the runner cannot
 * perform an action the guard has not allowlisted. A new stage means a new entry here AND a
 * deliberate addition to ceo-guard's ALLOWED — the cost is the point.
 */
export const CYCLE_ACTIONS = Object.freeze({
  measure: Object.freeze({ capability: 'RESEARCH', action: 'read_metrics' }),
  assess: Object.freeze({ capability: 'RESEARCH', action: 'run_analysis' }),
  decide: Object.freeze({ capability: 'DRAFT', action: 'write_draft' }),
  draft: Object.freeze({ capability: 'DRAFT', action: 'write_report' }),
  write_report_file: Object.freeze({ capability: 'MUTATE_BRANCH', action: 'write_repo_file' }),
  log: Object.freeze({ capability: 'DRAFT', action: 'update_state' }),
  ship: Object.freeze({ capability: 'MUTATE_BRANCH', action: 'open_pull_request' }),
});

/** Verbatim, and asserted verbatim by the suite. A cycle report that omits it is not a report. */
export const SELF_AUDIT_LINE =
  "Did last cycle's recommendation produce a measurable change in WAU or shares? " +
  'If not, why read this one?';

/** The metric the objective is actually judged on. */
const PRIMARY_METRIC = 'wau';

/** The report ceiling. Prose that cannot fit is prose nobody reads. */
export const REPORT_WORD_LIMIT = 400;

/** Only these may appear on a measurement envelope. Anything else is a smuggled operator edit. */
const MEASUREMENT_ENVELOPE_KEYS = ['at', 'source', 'metrics'];

/**
 * Where a measurement is allowed to have come from.
 *
 * Review finding F1 (CRITICAL): separating the measurement path from the agent path buys nothing
 * if the agent simply authors the measurement. `assertMeasurementUpdate` polices WHICH FIELDS may
 * change, never WHERE THE NUMBERS CAME FROM — so an agent handing itself `wau: 999999` sails
 * through, and the kill criterion never trips.
 *
 * Provenance is therefore checked here, and the CLI reads the measurement from a different file
 * than the candidates so the two inputs cannot be authored in one breath.
 *
 * This is an honesty rail, not cryptography: it stops the agent from inventing a source, not a
 * determined human from writing a false one. Signed measurements are the real answer once an
 * event stream exists to sign.
 */
export const TRUSTED_MEASUREMENT_SOURCES = Object.freeze([
  'manual_count', // an operator counted it by hand — legitimate, and the only one available today
  'analytics_rollup', // the event pipeline, once it exists (blocked on the vendor decision)
]);

/**
 * Identities whose REVIEW pass counts (finding F4).
 *
 * The previous check accepted any non-empty string, so `reviewer: 'me'` cleared the gate — an
 * unattributed self-approval wearing a name tag. An allowlist of independent identities is the
 * proportionate fix at this scale; a signed review token is the real one, and is worth building
 * the day a review can authorise something more expensive than opening a PR.
 */
export const INDEPENDENT_REVIEWERS = Object.freeze([
  'human-operator', 'deepseek', 'glm', 'codex', 'opus-agent',
]);

/** Who authors recommendations. A reviewer may never be this. */
export const AUTHOR_IDENTITY = 'ceo-orchestrator';

/** Only these may be supplied alongside a history entry by the caller. */
const LOG_EXTRA_KEYS = ['report_path', 'evidence'];

function act(stage) {
  const descriptor = CYCLE_ACTIONS[stage];
  if (descriptor === undefined) {
    abort(`stage ${JSON.stringify(stage)} declares no action.`);
  }
  assertActionAllowed(descriptor);
}

function assertValidOrAbort(state, where) {
  const result = validateCeoState(state);
  if (!result.valid) {
    abort(`${where} produced an invalid state: ${result.errors.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// measure
// ---------------------------------------------------------------------------

/**
 * Fold an externally-produced measurement into state.
 *
 * The measurement does not come from the agent. It arrives as a closed envelope, and any field
 * outside that envelope means someone tried to ride operator-owned state in on the metrics path.
 */
export function measure(state, measurement) {
  act('measure');

  if (measurement === null || typeof measurement !== 'object' || Array.isArray(measurement)) {
    abort('measurement must be an object.');
  }

  for (const key of Object.keys(measurement)) {
    if (!MEASUREMENT_ENVELOPE_KEYS.includes(key)) {
      abort(
        `measurement envelope carries unknown field ${JSON.stringify(key)}; ` +
          `permitted: [${MEASUREMENT_ENVELOPE_KEYS.join(', ')}].`,
      );
    }
  }

  if (typeof measurement.at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(measurement.at)) {
    abort(`measurement.at must be a YYYY-MM-DD string; got ${JSON.stringify(measurement.at ?? null)}.`);
  }
  if (!TRUSTED_MEASUREMENT_SOURCES.includes(measurement.source)) {
    abort(
      `measurement.source ${JSON.stringify(measurement.source ?? null)} is not a trusted source; ` +
        `permitted: [${TRUSTED_MEASUREMENT_SOURCES.join(', ')}]. ` +
        'Numbers the agent authored are not measurements.',
    );
  }

  const next = {
    ...structuredClone(state),
    cycle: state.cycle + 1,
    metrics: structuredClone(measurement.metrics),
  };

  assertValidOrAbort(next, 'measurement');
  assertMeasurementUpdate(state, next);

  return next;
}

// ---------------------------------------------------------------------------
// assess
// ---------------------------------------------------------------------------

/**
 * Read the state and say what is true — including, loudly, when the primary metric is unknown.
 *
 * "Unmeasurable" is not a soft caveat here. It changes what decide() is permitted to recommend.
 */
export function assess(state, measurement) {
  act('assess');

  const primaryValue = state.metrics[PRIMARY_METRIC];
  const measurable = primaryValue !== null;
  const at = typeof measurement?.at === 'string' ? measurement.at : null;
  const { deadline, wau_threshold: wauThreshold, venue_threshold: venueThreshold } =
    state.kill_criterion;

  return {
    cycle: state.cycle,
    at,
    primary_metric: PRIMARY_METRIC,
    primary_value: primaryValue,
    measurable,
    bottleneck: state.bottleneck,
    kill: {
      deadline,
      wau_threshold: wauThreshold,
      venue_threshold: venueThreshold,
      // A criterion you cannot evaluate has not been met and has not been missed. Saying so is
      // the difference between an honest dashboard and a green light nobody earned.
      evaluable: measurable,
      // Finding F3: `measurable && ...` meant a null metric held `tripped` at false FOREVER, so
      // never building analytics was indistinguishable from passing. Arriving at the deadline
      // unable to measure is not a pending result — it is the failure. It trips.
      // ISO dates compare correctly with >= because YYYY-MM-DD sorts lexicographically.
      tripped:
        at !== null && at >= deadline
          ? !measurable ||
            primaryValue < wauThreshold ||
            state.metrics.self_maintaining_venues < venueThreshold
          : false,
    },
    open_bets: state.active_bets.length,
  };
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

function assertCandidateShape(candidate, index) {
  const where = `candidate[${index}]`;

  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    abort(`${where} must be an object.`);
  }
  for (const key of ['id', 'statement', 'rationale']) {
    if (typeof candidate[key] !== 'string' || candidate[key].length === 0) {
      abort(`${where}.${key} must be a non-empty string.`);
    }
  }
  if (!Number.isFinite(candidate.operator_hours) || candidate.operator_hours < 0) {
    abort(`${where}.operator_hours must be a non-negative number — an unpriced ask is not a plan.`);
  }

  const lift = candidate.expected_lift;
  if (lift === null || typeof lift !== 'object' || Array.isArray(lift)) {
    abort(`${where}.expected_lift is required — a recommendation with no expected lift is a wish.`);
  }
  if (typeof lift.metric !== 'string' || lift.metric.length === 0) {
    abort(`${where}.expected_lift.metric must name a metric.`);
  }
  if (!Number.isFinite(lift.delta)) {
    abort(`${where}.expected_lift.delta must be a finite number.`);
  }
  if (typeof lift.unit !== 'string' || lift.unit.length === 0) {
    abort(`${where}.expected_lift.unit must name a unit.`);
  }
}

/**
 * Lift per operator hour. Free work that actually helps sorts first.
 *
 * Finding F2: the unconditional Infinity meant a zero-hour candidate won on cost alone — including
 * one promising a NEGATIVE lift, which beat every real improvement that cost an hour. Free is only
 * infinitely efficient if it moves the metric the right way; otherwise it is just free.
 */
function score(candidate) {
  const { delta } = candidate.expected_lift;
  if (candidate.operator_hours === 0) {
    return delta > 0 ? Number.POSITIVE_INFINITY : delta;
  }
  return delta / candidate.operator_hours;
}

/** Locale-independent (finding F6): localeCompare varies by runtime locale, so runs could diverge. */
function byId(a, b) {
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

/**
 * Choose exactly ONE recommendation.
 *
 * Two eligibility rules, both hard:
 *  - it must fit inside the operator hours actually available;
 *  - while the primary metric is unmeasurable, only work that RESTORES measurement is eligible.
 *
 * The second is the anti-theater rule. Recommending growth work whose effect nobody can observe
 * generates activity and no information, and it does it while sounding productive.
 */
export function decide(state, assessment, candidates) {
  act('decide');

  if (!Array.isArray(candidates)) {
    abort('candidates must be an array.');
  }
  candidates.forEach(assertCandidateShape);

  const hoursAvailable = state.metrics.operator_hours_available;
  const affordable = candidates.filter((c) => c.operator_hours <= hoursAvailable);
  const eligible = assessment.measurable
    ? affordable
    : affordable.filter((c) => c.restores_measurement === true);

  if (eligible.length === 0) {
    abort(
      'no eligible candidate: ' +
        `${candidates.length} offered, ${affordable.length} within ${hoursAvailable} operator hours` +
        (assessment.measurable
          ? '.'
          : `, and while ${PRIMARY_METRIC} is unmeasurable only measurement-restoring work is eligible.`),
    );
  }

  // Deterministic: score descending, then id ascending. No ambient randomness, no clock.
  const ranked = [...eligible].sort((a, b) => score(b) - score(a) || byId(a, b));
  const [recommendation, ...runnersUp] = ranked;

  return {
    recommendation,
    assessment,
    considered: candidates.length,
    dropped: [
      ...runnersUp.map((c) => c.id),
      ...candidates.filter((c) => !eligible.includes(c)).map((c) => c.id),
    ],
  };
}

// ---------------------------------------------------------------------------
// draft
// ---------------------------------------------------------------------------

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function formatMetric(value) {
  return value === null ? 'not measured' : String(value);
}

/**
 * Answer the self-audit for real, or say plainly that there is nothing to answer yet.
 *
 * The failure mode this guards against is a retrospective invented to fill the section.
 */
function selfAuditAnswer(state, assessment) {
  const prior = state.history[state.history.length - 1];

  if (prior === undefined) {
    return 'No prior cycle — nothing has been recommended yet, so nothing can have moved. Cycle 2 answers this for real.';
  }
  if (prior.shipped !== true) {
    return `No. Cycle ${prior.cycle} drafted "${prior.recommendation_id}" and never shipped it, so it cannot have moved anything. Drafting is not doing.`;
  }
  if (prior.primary_value === null || assessment.primary_value === null) {
    return `Unknown. Cycle ${prior.cycle} shipped "${prior.recommendation_id}", but ${PRIMARY_METRIC} is not measurable, so its effect is unobservable. Read this cycle only if it fixes that.`;
  }

  const delta = assessment.primary_value - prior.primary_value;
  if (delta === 0) {
    return `No. Cycle ${prior.cycle} shipped "${prior.recommendation_id}" and ${PRIMARY_METRIC} is unchanged at ${assessment.primary_value}.`;
  }
  return `Yes. Cycle ${prior.cycle} shipped "${prior.recommendation_id}" and ${PRIMARY_METRIC} moved ${delta > 0 ? '+' : ''}${delta} to ${assessment.primary_value}.`;
}

/** Render the cycle report. Capped, so it cannot grow into something nobody reads. */
export function draft(state, assessment, decision, measurement) {
  act('draft');

  const { recommendation } = decision;
  const lift = recommendation.expected_lift;
  const metrics = state.metrics;

  const lines = [
    `# CEO cycle ${state.cycle}`,
    '',
    `**Self-audit.** ${SELF_AUDIT_LINE}`,
    '',
    selfAuditAnswer(state, assessment),
    '',
    `## Measurement (${measurement.at}, ${measurement.source})`,
    '',
    `- ${PRIMARY_METRIC}: ${formatMetric(metrics.wau)}`,
    `- max neighborhood ${PRIMARY_METRIC}: ${formatMetric(metrics.max_neighborhood_wau)}`,
    `- claimed venues: ${metrics.claimed_venues} (${metrics.self_maintaining_venues} self-maintaining)`,
    `- operator hours available: ${metrics.operator_hours_available}`,
    '',
    '## Assessment',
    '',
    assessment.measurable
      ? `Primary metric ${PRIMARY_METRIC} reads ${assessment.primary_value}. Bottleneck: ${assessment.bottleneck}.`
      : `Primary metric ${PRIMARY_METRIC} is UNMEASURABLE. Bottleneck: ${assessment.bottleneck}. Until this is fixed, no growth claim on this project is checkable.`,
    assessment.kill.evaluable
      ? `Kill criterion (${assessment.kill.deadline}, ${assessment.kill.wau_threshold} ${PRIMARY_METRIC} / ${assessment.kill.venue_threshold} venues): ${assessment.kill.tripped ? 'TRIPPED' : 'not tripped'}.`
      : `Kill criterion (${assessment.kill.deadline}) cannot be evaluated — the metric it tests is null. The clock runs anyway.`,
    '',
    '## Recommendation',
    '',
    recommendation.statement,
    '',
    `- Expected lift: ${lift.delta >= 0 ? '+' : ''}${lift.delta} ${lift.unit} (${lift.metric})`,
    `- Operator cost: ${plural(recommendation.operator_hours, 'operator hour')}`,
    `- Why this one: ${recommendation.rationale}`,
    '',
    '## Not recommended this cycle',
    '',
    decision.dropped.length === 0
      ? 'Nothing else was on the table.'
      : `${plural(decision.dropped.length, 'candidate')} dropped: ${decision.dropped.join(', ')}.`,
  ];

  const report = lines.join('\n') + '\n';
  const words = report.split(/\s+/).filter((word) => word.length > 0).length;
  if (words > REPORT_WORD_LIMIT) {
    abort(`report is ${words} words, over the ${REPORT_WORD_LIMIT}-word ceiling.`);
  }

  return report;
}

// ---------------------------------------------------------------------------
// log
// ---------------------------------------------------------------------------

/**
 * Append the cycle to history, through the AGENT door.
 *
 * `shipped: false` and `evidence: null` are the honest defaults: a cycle that has only been
 * drafted has produced no evidence, and saying otherwise is the exact self-deception the
 * anti-theater detectors exist to catch.
 */
export function log(state, decision, extras = {}) {
  act('log');

  for (const key of Object.keys(extras)) {
    if (!LOG_EXTRA_KEYS.includes(key)) {
      abort(
        `log entry carries unknown field ${JSON.stringify(key)}; ` +
          `permitted: [${LOG_EXTRA_KEYS.join(', ')}]. Metrics never travel the agent path.`,
      );
    }
  }

  // Finding F5: `drafted: true` used to be hardcoded, so a caller could skip draft() entirely and
  // still write "drafted" into permanent history. history is not a guard-protected field, so
  // nothing else would have caught it. The claim is now derived from the artifact that proves it.
  const reportPath = extras.report_path ?? null;
  const drafted = reportPath !== null && existsSync(reportPath);

  const entry = {
    cycle: state.cycle,
    recommendation_id: decision.recommendation.id,
    drafted,
    shipped: false,
    evidence: extras.evidence ?? null,
    report_path: reportPath,
    primary_metric: decision.assessment.primary_metric,
    primary_value: decision.assessment.primary_value,
  };

  const next = { ...structuredClone(state), history: [...state.history, entry] };

  assertValidOrAbort(next, 'log');
  assertStateMutationAllowed(state, next);

  return next;
}

// ---------------------------------------------------------------------------
// ship
// ---------------------------------------------------------------------------

/**
 * The SHIP gate.
 *
 * A cycle record may not become shipped without a REVIEW pass that names its reviewer. An
 * unattributed pass is the model approving its own work, which is the failure this whole
 * orchestrator is built around; it is refused as hard as a missing review.
 *
 * The branch check that follows is ceo-guard's, not ours — SHIP is still an ordinary gated
 * action and gets no exemption for having been reviewed.
 */
export function enterShip(record, { branch } = {}) {
  const review = record?.review;

  if (review === null || review === undefined || typeof review !== 'object') {
    abort(`cannot enter SHIP without a REVIEW pass; cycle ${record?.cycle ?? '?'} carries no review.`);
  }
  if (review.verdict !== 'pass') {
    abort(
      `cannot enter SHIP without a REVIEW pass; verdict is ${JSON.stringify(review.verdict ?? null)}.`,
    );
  }
  if (typeof review.reviewer !== 'string' || review.reviewer.length === 0) {
    abort('cannot enter SHIP: the REVIEW pass names no reviewer, so it is a self-approval.');
  }
  if (review.reviewer === AUTHOR_IDENTITY) {
    abort(`cannot enter SHIP: ${AUTHOR_IDENTITY} cannot review its own recommendation.`);
  }
  if (!INDEPENDENT_REVIEWERS.includes(review.reviewer)) {
    // Finding F4: any non-empty string used to clear this gate, so `reviewer: 'me'` was a pass.
    abort(
      `cannot enter SHIP: reviewer ${JSON.stringify(review.reviewer)} is not an independent ` +
        `reviewer; permitted: [${INDEPENDENT_REVIEWERS.join(', ')}].`,
    );
  }

  // Not act('ship') — open_pull_request is branch-scoped, so the branch has to travel with the
  // action. Gating it branchless would abort every ship, including the legitimate ones.
  assertActionAllowed({ ...CYCLE_ACTIONS.ship, branch });

  return { ...structuredClone(record), shipped: true };
}

// ---------------------------------------------------------------------------
// runCycle
// ---------------------------------------------------------------------------

/**
 * One full pass. Deliberately stops at log() — shipping is a separate, reviewed call.
 */
export function runCycle({ state, measurement, candidates, reportsDir }) {
  const measured = measure(state, measurement);
  const assessment = assess(measured, measurement);
  const decision = decide(measured, assessment, candidates);
  const report = draft(measured, assessment, decision, measurement);

  act('write_report_file');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `cycle-${measured.cycle}.md`);
  writeFileSync(reportPath, report, 'utf8');

  const nextState = log(measured, decision, { report_path: reportPath });

  return {
    state: nextState,
    assessment,
    decision,
    report,
    reportPath,
    record: nextState.history[nextState.history.length - 1],
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/ceo-cycle.mjs [options]

  --state <path>        CEO state to read     (default ceo/state.json)
  --measurement <path>  OPERATOR-owned counts (default ceo/measurements/latest.json)
  --candidates <path>   AGENT-authored options(default ceo/fixtures/candidates.json)
  --reports <dir>       report output dir     (default ceo/reports)
  --commit              write the next state back to --state (default: dry run)

Measurement and candidates are deliberately SEPARATE files. The agent proposes candidates; it does
not get to also report the numbers it will be judged against. See TRUSTED_MEASUREMENT_SOURCES.

Offline by design: no network, no clock. Every timestamp comes from the measurement file.`;

function parseArgs(argv) {
  const options = {
    state: 'ceo/state.json',
    measurement: 'ceo/measurements/latest.json',
    candidates: 'ceo/fixtures/candidates.json',
    reports: 'ceo/reports',
    commit: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--commit') {
      options.commit = true;
      continue;
    }
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    const key = flag.replace(/^--/, '');
    if (!flag.startsWith('--') || !Object.hasOwn(options, key) || key === 'commit') {
      abort(`unknown argument ${JSON.stringify(flag)}.\n${USAGE}`);
    }
    index += 1;
    if (index >= argv.length) {
      abort(`${flag} requires a value.`);
    }
    options[key] = argv[index];
  }

  return options;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    abort(`could not read ${label} at ${filePath}: ${error.message}`);
  }
}

function main(argv) {
  const options = parseArgs(argv);
  const state = readJson(options.state, 'state');
  const measurementFile = readJson(options.measurement, 'measurement');
  const candidatesFile = readJson(options.candidates, 'candidates');

  const result = runCycle({
    state,
    measurement: measurementFile.measurement,
    candidates: candidatesFile.candidates,
    reportsDir: options.reports,
  });

  if (options.commit) {
    // Not gated behind LOOP_UNATTENDED: this writes a local JSON file on a feature branch, which
    // is the same blast radius as any other repo edit. Landing it is still a reviewed PR.
    writeFileSync(options.state, JSON.stringify(result.state, null, 2) + '\n', 'utf8');
  }

  console.log(result.report);
  console.log(`report:  ${result.reportPath}`);
  console.log(
    `state:   ${options.commit ? `updated ${options.state}` : 'unchanged (dry run — pass --commit to persist)'}`,
  );
  console.log(`shipped: ${result.record.shipped} — SHIP requires a separate reviewed enterShip() call`);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && path.resolve(entrypoint) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
