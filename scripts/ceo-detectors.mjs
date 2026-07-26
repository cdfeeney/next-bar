// Anti-theater detectors for the CEO orchestrator.
//
// A PURE module: every function takes data and returns findings. Nothing here aborts, writes, or
// exits — that is deliberate. These are the checks that tell the orchestrator its own record looks
// like activity rather than progress, and a check that can kill the process is a check people
// route around. decide() decides what to do with what they report.
//
// The failure mode they exist to catch is not malice, it is the very natural drift where a loop
// keeps producing plans, each plan sounds reasonable, and nothing observable ever changes.

/** Emitted instead of a new plan. The point is to stop planning, not to plan harder. */
export const DIRECTIVE_STOP_AND_REASSESS = 'STOP_AND_REASSESS';

/** How many consecutive non-improving cycles it takes to stop. */
const FLAT_METRIC_WINDOW = 3;

/** How many consecutive draft-without-ship cycles it takes to flag the theater tax. */
const THEATER_TAX_WINDOW = 2;

const BET_VERDICTS = Object.freeze(['hit', 'miss']);

/** A git sha, short or full. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Short enough to be a typo, long enough to be a real event id. */
const MIN_EVENT_ID_LENGTH = 6;

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
 */
export function evidenceIsReal(evidence) {
  if (!isPlainObject(evidence)) return false;

  const { kind, ref } = evidence;
  if (typeof ref !== 'string') return false;

  if (kind === 'pr_sha') return SHA_PATTERN.test(ref);
  if (kind === 'user_event') return ref.trim().length >= MIN_EVENT_ID_LENGTH;

  // An invented kind is not a third option. Unknown fails closed.
  return false;
}

/**
 * A history entry counts as progress only if it shipped AND can prove it.
 *
 * Both halves are load-bearing. Shipped-without-evidence is a claim; evidenced-but-unshipped is
 * homework.
 */
export function countsAsProgress(entry) {
  return entry?.shipped === true && evidenceIsReal(entry?.evidence);
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
export function detectTheaterTax(history) {
  const entries = asArray(history);
  const recent = entries.slice(-THEATER_TAX_WINDOW);
  const barren =
    recent.length === THEATER_TAX_WINDOW && recent.every((entry) => !countsAsProgress(entry));

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
 * Three consecutive cycles where the primary metric did not improve.
 *
 * An unreadable metric counts as not-improved. That is the sharp edge here and it is intended: if
 * it were treated as "unknown, carry on", the cheapest way to never halt would be to stop
 * measuring — which is the exact failure this orchestrator was built to notice. Three cycles of
 * "we cannot tell" is three cycles of no demonstrated progress, and it stops.
 */
export function detectFlatMetricHalt(history, { window = FLAT_METRIC_WINDOW } = {}) {
  const entries = asArray(history);
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

    const previous = previousEntry?.primary_value;
    const current = currentEntry?.primary_value;

    deltas.push(
      consecutive && typeof previous === 'number' && typeof current === 'number'
        ? current - previous
        : null,
    );
  }

  const halt = deltas.every((delta) => delta === null || delta <= 0);

  return {
    id: 'flat_metric_halt',
    halt,
    directive: halt ? DIRECTIVE_STOP_AND_REASSESS : null,
    deltas,
    detail: halt
      ? `FLAT METRIC: ${window} consecutive cycles without demonstrated improvement (deltas ${deltas.map((d) => (d === null ? 'unmeasurable' : d)).join(', ')}). Emitting ${DIRECTIVE_STOP_AND_REASSESS} instead of another plan.`
      : `Primary metric moved within the last ${window} cycles (deltas ${deltas.join(', ')}).`,
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
export function runDetectors(state) {
  const history = asArray(state?.history);
  const theater = detectTheaterTax(history);
  const flat = detectFlatMetricHalt(history);
  const bets = detectBetClosure(state?.active_bets, state?.cycle ?? 0);

  const findings = [theater, flat, bets];
  const halt = flat.halt || bets.blocking;

  return {
    findings,
    theater,
    flat,
    bets,
    halt,
    directive: halt ? DIRECTIVE_STOP_AND_REASSESS : null,
    preamble: findings
      .filter((finding) => finding.flagged || finding.halt || finding.blocking)
      .map((finding) => finding.detail),
  };
}
