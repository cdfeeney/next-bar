// Anti-theater detectors for the CEO orchestrator.
//
// A PURE module: every function takes data and returns findings. Nothing here aborts, writes, or
// exits — that is deliberate. These are the checks that tell the orchestrator its own record looks
// like activity rather than progress, and a check that can kill the process is a check people
// route around. decide() decides what to do with what they report.
//
// The failure mode they exist to catch is not malice, it is the very natural drift where a loop
// keeps producing plans, each plan sounds reasonable, and nothing observable ever changes.

import { detectDormantReadiness } from './ceo-modules.mjs';

/** Emitted instead of a new plan. The point is to stop planning, not to plan harder. */
export const DIRECTIVE_STOP_AND_REASSESS = 'STOP_AND_REASSESS';

/**
 * Emitted when the record cannot say whether anything moved, because nothing was measured.
 *
 * This is a SEPARATE directive from STOP_AND_REASSESS on purpose. Both halt, so neither is softer,
 * but the remedies are opposite: STOP_AND_REASSESS means the plans are the problem and a human has
 * to rethink; GO_MEASURE means the plans are unjudgeable and the fix is instrumentation. Collapsing
 * them (the previous behaviour) sent an operator away to rethink a strategy whose only real defect
 * was that nobody had counted anything yet.
 */
export const DIRECTIVE_GO_MEASURE = 'GO_MEASURE';

/**
 * The board reached a verdict the cycle is not entitled to plan past.
 *
 * KILL and RESCOPE are decisions about whether this company continues in its current shape. A
 * cycle that prints one and then recommends a copy tweak underneath it has not delivered a
 * verdict, it has delivered a mood — and the operator's eye goes to the plan, every time.
 */
export const DIRECTIVE_BOARD_KILL = 'BOARD_KILL';
export const DIRECTIVE_BOARD_RESCOPE = 'BOARD_RESCOPE';

/** Every directive that halts a cycle. enterShip refuses all of them. */
export const HALT_DIRECTIVES = Object.freeze([
  DIRECTIVE_STOP_AND_REASSESS,
  DIRECTIVE_GO_MEASURE,
  DIRECTIVE_BOARD_KILL,
  DIRECTIVE_BOARD_RESCOPE,
]);

/**
 * How many consecutive non-improving cycles it takes to stop.
 *
 * Two, not three. At the operator's weekly cadence three cycles is the better part of a month of
 * shipping nothing observable before the alarm sounds — long enough that the detector reports the
 * stall to someone already living in it.
 */
const FLAT_METRIC_WINDOW = 2;

/** How many consecutive draft-without-ship cycles it takes to flag the theater tax. */
const THEATER_TAX_WINDOW = 2;

const BET_VERDICTS = Object.freeze(['hit', 'miss']);

/** A git sha, short or full. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Short enough to be a typo, long enough to be a real event id. */
const MIN_EVENT_ID_LENGTH = 6;

/**
 * What a shipped PR actually was.
 *
 * A sha proves a commit exists. It does not distinguish the PR that shipped the venue-claim
 * surface from the PR that renamed a CSS variable, and an orchestrator that cannot tell them apart
 * will happily log twenty chores as twenty cycles of progress while the detectors stay quiet.
 * The classification is mandatory precisely so that "which was it?" has to be answered.
 */
export const EVIDENCE_CLASSES = Object.freeze(['user_facing', 'chore']);

/** Only this class counts as progress. A chore is real work and is not the thing being measured. */
export const PROGRESS_CLASS = 'user_facing';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// evidence rule
// ---------------------------------------------------------------------------

/**
 * Does this evidence point at something outside the agent's own narration?
 *
 * A PR sha and a user-event id share the property that matters: someone other than the author
 * produced them, and anyone can go look. Prose cannot clear that bar no matter how confident it
 * sounds, so `evidence: 'shipped it'` is rejected as firmly as `evidence: null`.
 *
 * A sha additionally has to say WHICH REPOSITORY it lives in, and that repo has to be the one this
 * state is about. Unscoped, `/^[0-9a-f]{7,40}$/` is satisfied by any hex string from any repo —
 * including a throwaway — so "shipped, sha attached" could be true and mean nothing. The repo is
 * the cheapest thing that makes the reference checkable by someone else, which is the entire
 * property this function exists to test.
 */
export function evidenceIsReal(evidence, { repo } = {}) {
  if (!isPlainObject(evidence)) return false;

  const { kind, ref } = evidence;
  if (typeof ref !== 'string') return false;

  if (kind === 'pr_sha') {
    if (!SHA_PATTERN.test(ref)) return false;
    // Fail closed on an unconfigured repo: an unscoped sha is exactly what this rejects.
    if (typeof repo !== 'string' || repo.trim() === '') return false;
    if (evidence.repo !== repo) return false;
    return EVIDENCE_CLASSES.includes(evidence.class);
  }

  if (kind === 'user_event') return ref.trim().length >= MIN_EVENT_ID_LENGTH;

  // An invented kind is not a third option. Unknown fails closed.
  return false;
}

/**
 * A history entry counts as progress only if it shipped, can prove it, AND the thing it proves is
 * the kind of thing the objective is about.
 *
 * Three halves now. Shipped-without-evidence is a claim; evidenced-but-unshipped is homework; and
 * a merged `chore` is neither — it is real work that moves no user-visible surface, so counting it
 * silences the theater tax with housekeeping.
 */
export function countsAsProgress(entry, { repo } = {}) {
  if (entry?.shipped !== true) return false;
  if (!evidenceIsReal(entry?.evidence, { repo })) return false;
  if (entry.evidence.kind === 'pr_sha' && entry.evidence.class !== PROGRESS_CLASS) return false;
  return true;
}

// ---------------------------------------------------------------------------
// theater tax
// ---------------------------------------------------------------------------

/**
 * Two consecutive cycles that produced nothing provable.
 *
 * Judged with countsAsProgress rather than the raw `shipped` flag, so the tax cannot be dodged by
 * writing `shipped: true` next to no evidence — which is exactly what a loop under pressure to
 * look productive would write.
 *
 * It deliberately does NOT also require `drafted === true`. Review finding C2: gating on drafted
 * meant a cycle that produced nothing at all — no plan, no ship — broke the barren streak and
 * cleared the tax, so the cheapest evasion was to do even less. A cycle with nothing to show is
 * the thing being counted, however little it did.
 *
 * Flags; does not halt. Two barren cycles is a smell, not a verdict.
 */
export function detectTheaterTax(history, { repo } = {}) {
  const entries = asArray(history);
  const recent = entries.slice(-THEATER_TAX_WINDOW);
  const barren =
    recent.length === THEATER_TAX_WINDOW &&
    recent.every((entry) => !countsAsProgress(entry, { repo }));

  return {
    id: 'theater_tax',
    flagged: barren,
    cycles: recent.map((entry) => entry?.cycle ?? null),
    detail: barren
      ? `THEATER TAX: cycles ${recent.map((e) => e?.cycle ?? '?').join(' and ')} both drafted a plan and shipped nothing provable. A third plan is not the fix.`
      : 'No theater tax: the recent record is not two straight cycles of plans without shipping.',
  };
}

// ---------------------------------------------------------------------------
// flat-metric halt
// ---------------------------------------------------------------------------

/**
 * Consecutive cycles where the primary metric did not improve.
 *
 * An unreadable metric counts as not-improved. That is the sharp edge here and it is intended: if
 * it were treated as "unknown, carry on", the cheapest way to never halt would be to stop
 * measuring — which is the exact failure this orchestrator was built to notice.
 *
 * But not-improved and not-measured are different diagnoses, and the previous version returned the
 * same directive for both. It now reports which: a window in which NOTHING was readable emits
 * GO_MEASURE (the plans may be fine; nobody can tell), while a window containing at least one real
 * reading that failed to improve emits STOP_AND_REASSESS (the plans are the problem). Both halt.
 */
/**
 * @param {Array<object>} history
 * @param {{ window?: number, current?: { cycle: number, primary_value: number | null } | null }} [options]
 */
export function detectFlatMetricHalt(history, { window = FLAT_METRIC_WINDOW, current = null } = {}) {
  // The cycle being judged is not in `history` yet — log() appends AFTER decide() runs. Judging the
  // log alone therefore judges the world as of one cycle ago: review found that a history of
  // 10,10,10 plus a fresh reading of 20 still halted with STOP_AND_REASSESS, telling an operator who
  // had just moved the metric to stop and reassess. `current` closes that gap.
  const entries = [...asArray(history), ...(current === null ? [] : [current])];
  const needed = window + 1;
  const recent = entries.slice(-needed);

  if (recent.length < needed) {
    return {
      id: 'flat_metric_halt',
      halt: false,
      directive: null,
      deltas: [],
      detail: `Not enough history to judge: ${recent.length} cycles on record, ${needed} needed for a ${window}-cycle window.`,
    };
  }

  const deltas = [];
  for (let index = 1; index < recent.length; index += 1) {
    const previousEntry = recent[index - 1];
    const currentEntry = recent[index];

    // Review finding H2: the delta has to span ONE cycle. Without this, skipping a cycle in the
    // log turns a two-cycle drift into a single apparent gain, and pacing the logging becomes a
    // way to manufacture improvement out of a stall. A gap is not evidence of movement.
    const consecutive =
      Number.isInteger(previousEntry?.cycle) &&
      Number.isInteger(currentEntry?.cycle) &&
      currentEntry.cycle === previousEntry.cycle + 1;

    const previousValue = previousEntry?.primary_value;
    const currentValue = currentEntry?.primary_value;
    const bothReadable = typeof previousValue === 'number' && typeof currentValue === 'number';

    if (!consecutive) {
      // A gap is not evidence of movement, and it is also not a measurement problem. Review found
      // that fully-measured cycles 1,3,5 reported GO_MEASURE, sending the operator to build
      // instrumentation that already existed; the real defect is the missing log entries.
      deltas.push({ delta: null, reason: 'gap' });
    } else if (!bothReadable) {
      deltas.push({ delta: null, reason: 'unmeasured' });
    } else {
      deltas.push({ delta: currentValue - previousValue, reason: null });
    }
  }

  const halt = deltas.every((d) => d.delta === null || d.delta <= 0);
  // GO_MEASURE only when EVERY non-improving step is non-improving *because nobody measured*. One
  // real reading, or a log gap, makes this a judgement about the record rather than the instruments.
  const unmeasured = halt && deltas.every((d) => d.reason === 'unmeasured');
  const directive = halt
    ? (unmeasured ? DIRECTIVE_GO_MEASURE : DIRECTIVE_STOP_AND_REASSESS)
    : null;

  const rendered = deltas
    .map((d) => (d.delta === null ? (d.reason === 'gap' ? 'log gap' : 'unmeasurable') : d.delta))
    .join(', ');

  return {
    id: 'flat_metric_halt',
    halt,
    unmeasured,
    directive,
    deltas: deltas.map((d) => d.delta),
    reasons: deltas.map((d) => d.reason),
    detail: !halt
      ? `Primary metric moved within the last ${window} cycles (deltas ${rendered}).`
      : unmeasured
        ? `UNMEASURED: ${window} consecutive cycles with nothing readable to compare (deltas ${rendered}). Emitting ${DIRECTIVE_GO_MEASURE} — the remedy is instrumentation, not a better plan.`
        : `FLAT METRIC: ${window} consecutive cycles without demonstrated improvement (deltas ${rendered}). Emitting ${DIRECTIVE_STOP_AND_REASSESS} instead of another plan.`,
  };
}

// ---------------------------------------------------------------------------
// bet closure
// ---------------------------------------------------------------------------

/**
 * A bet may not sail past its review cycle without a hit/miss verdict.
 *
 * Blocking, not merely flagged. An unjudged bet is how a loop accumulates claims it never has to
 * be right about; letting a new recommendation be issued on top of one converts the backlog into
 * permanent amnesty. `pending` is not a verdict — it is the absence of one, spelled confidently.
 */
export function detectBetClosure(activeBets, currentCycle) {
  const bets = asArray(activeBets);
  const overdue = bets.filter(
    (bet) =>
      Number.isInteger(bet?.review_cycle) &&
      currentCycle > bet.review_cycle &&
      !BET_VERDICTS.includes(bet?.verdict),
  );

  return {
    id: 'bet_closure',
    blocking: overdue.length > 0,
    overdue: overdue.map((bet) => bet?.id ?? null),
    detail:
      overdue.length > 0
        ? `UNCLOSED BETS past their review cycle: ${overdue.map((b) => b?.id ?? '?').join(', ')}. Judge them hit or miss before making another.`
        : 'All bets are either not yet due or already judged.',
  };
}

// ---------------------------------------------------------------------------
// runDetectors
// ---------------------------------------------------------------------------

/**
 * Run every detector over a state and summarise.
 *
 * Returns findings for ALL detectors, flagged or not, so a report can honestly say what was
 * checked rather than only what fired.
 */
export function runDetectors(state, context = {}) {
  const history = asArray(state?.history);
  // The repo travels from state, not from the caller: a detector that let its caller choose which
  // repository counts as "ours" would let the caller choose to be satisfied.
  const theater = detectTheaterTax(history, { repo: state?.repo });

  // The freshly measured cycle, shaped like a history entry so the flat detector can see the
  // reading that has not been logged yet. Derived from the assessment the caller computed this
  // cycle — the agent never supplies it.
  const fresh =
    context?.assessment && Number.isInteger(state?.cycle)
      ? { cycle: state.cycle, primary_value: context.assessment.primary_value ?? null }
      : null;
  const flat = detectFlatMetricHalt(history, { current: fresh });
  const bets = detectBetClosure(state?.active_bets, state?.cycle ?? 0);
  // A dormant module reaching its activation condition is news the operator needs and the
  // orchestrator cannot act on — exactly the shape of a preamble line. `context` carries this
  // cycle's freshly computed assessment, because the exit module's trigger is the kill criterion
  // and the stored flag for it is never written by anything.
  const dormant = detectDormantReadiness(state, context);

  const findings = [theater, flat, bets, dormant];
  const halt = flat.halt || bets.blocking;

  // An unclosed bet is a reassess, not a measurement gap — so GO_MEASURE only survives when the
  // flat detector is the ONLY thing halting. A cycle with both problems has the harder one.
  const directive = !halt
    ? null
    : bets.blocking
      ? DIRECTIVE_STOP_AND_REASSESS
      : flat.directive;

  return {
    findings,
    theater,
    flat,
    bets,
    dormant,
    halt,
    directive,
    preamble: findings
      .filter((finding) => finding.flagged || finding.halt || finding.blocking)
      .map((finding) => finding.detail),
  };
}
