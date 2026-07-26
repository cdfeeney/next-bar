// The board. The one part of this system whose job is to fire the operator.
//
// Everything else here helps decide what to do next; this decides whether to keep going at all.
// It is separate from the cycle for the same reason a board is separate from a CEO: the function
// that reports progress must not be the function that judges whether progress was enough.
//
// PURE, like ceo-detectors: takes data, returns a verdict, never writes or exits. It throws only
// on a malformed audit date, because an audit with no date is not a lenient audit — it is one
// whose deadline can never arrive.
//
// The criterion enforced here is the operator's own, quoted verbatim from
// decisions/2026-07-25-next-bar-monetization.md:
//
//   "Abandon Next Bar as a business if, by 2026-12-31, BOTH of these fail — (a) fewer than 50
//    weekly-active users inside ONE chosen NYC neighborhood ... AND (b) fewer than 15
//    self-maintaining claimed venues ... If exactly one passes, do not kill — re-scope to the
//    side that worked."
//
// Two words in that sentence were previously mis-implemented in assess(): BOTH (the old code
// ORed the sides, so one failing half condemned a working one) and ONE NEIGHBORHOOD (the old
// code tested the GLOBAL wau, which a thinly-spread 18-neighbourhood app can clear while every
// individual neighbourhood fails). Both readings ran in the operator's favour in the moment and
// against the operator's actual decision.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The four things the board may say. Nothing else — a verdict the operator has to interpret is a
 * verdict the operator gets to interpret favourably.
 */
export const VERDICTS = Object.freeze({
  KILL: 'KILL',
  RESCOPE: 'RESCOPE',
  CONTINUE: 'CONTINUE',
  UNMEASURABLE: 'UNMEASURABLE',
});

/** The metric the users side of the criterion is actually about: ONE neighbourhood, not the total. */
export const USERS_METRIC = 'max_neighborhood_wau';

/** The metric the venue side is about: venues maintaining themselves, not merely claimed. */
export const VENUES_METRIC = 'self_maintaining_venues';

function assertAuditDate(at) {
  if (typeof at !== 'string' || !DATE_PATTERN.test(at)) {
    throw new TypeError(
      `[ceo-board] audit date must be a YYYY-MM-DD string; got ${JSON.stringify(at ?? null)}. ` +
        'An audit with no date is an audit whose deadline never arrives.',
    );
  }
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Judge one side of the criterion.
 *
 * `failed` is true when the number is below threshold OR cannot be read at all. Unmeasured is a
 * failure at the deadline and nothing softer: if it were "unknown, not yet failed", then never
 * building the measurement would be the cheapest way to never be judged.
 */
function judgeSide(value, threshold) {
  const measurable = value !== null;
  return {
    measurable,
    value,
    threshold,
    failed: !measurable || value < threshold,
  };
}

/**
 * Audit the kill criterion.
 *
 * `at` is supplied by the caller (the measurement envelope's date), never read from a clock —
 * same discipline as the cycle runner, and it is what makes this testable at a future date.
 */
export function auditKill(state, { at } = {}) {
  assertAuditDate(at);

  const deadline = state?.kill_criterion?.deadline ?? null;
  const metrics = state?.metrics ?? {};

  const users = judgeSide(
    numberOrNull(metrics[USERS_METRIC]),
    state?.kill_criterion?.wau_threshold,
  );
  const venues = judgeSide(
    numberOrNull(metrics[VENUES_METRIC]),
    state?.kill_criterion?.venue_threshold,
  );

  // ISO dates compare correctly with >= because YYYY-MM-DD sorts lexicographically. The deadline
  // DAY is due — a criterion that only bites the day after is a criterion with a free extra day.
  const due = typeof deadline === 'string' && at >= deadline;
  const sides = { users, venues };

  if (!due) {
    // Before the deadline the board cannot kill. It can, and must, refuse to bless an unreadable
    // number: CONTINUE means "the numbers say carry on", and no number said anything.
    if (!users.measurable) {
      return {
        verdict: VERDICTS.UNMEASURABLE,
        due: false,
        at,
        deadline,
        sides,
        remedy:
          `Nothing to judge: ${USERS_METRIC} is null. Go measure it. Until then the kill ` +
          'criterion cannot be evaluated, and the clock runs anyway.',
        detail: `Not due until ${deadline}, and ${USERS_METRIC} is unmeasured — no verdict is available.`,
      };
    }

    return {
      verdict: VERDICTS.CONTINUE,
      due: false,
      at,
      deadline,
      sides,
      remedy: null,
      detail:
        `Not due until ${deadline}. Users side ${users.value}/${users.threshold}, ` +
        `venues side ${venues.value ?? 'unmeasured'}/${venues.threshold}.`,
    };
  }

  if (users.failed && venues.failed) {
    return {
      verdict: VERDICTS.KILL,
      due: true,
      at,
      deadline,
      sides,
      remedy: 'Stop. Both halves of the criterion failed on the date the operator chose in advance.',
      detail:
        `KILL: at ${at} (deadline ${deadline}) BOTH sides failed — users ` +
        `${users.measurable ? users.value : 'unmeasured'}/${users.threshold} and venues ` +
        `${venues.measurable ? venues.value : 'unmeasured'}/${venues.threshold}.`,
    };
  }

  if (users.failed || venues.failed) {
    const survivor = users.failed ? 'venues' : 'users';
    const casualty = users.failed ? 'users' : 'venues';
    return {
      verdict: VERDICTS.RESCOPE,
      due: true,
      at,
      deadline,
      sides,
      remedy: `Re-scope onto the ${survivor} side, which passed. Do not kill; do not carry the ${casualty} side unchanged.`,
      detail:
        `RESCOPE: the ${casualty} side failed and the ${survivor} side passed. The operator's ` +
        'criterion says exactly one passing is a re-scope, not a kill.',
    };
  }

  return {
    verdict: VERDICTS.CONTINUE,
    due: true,
    at,
    deadline,
    sides,
    remedy: null,
    detail: `CONTINUE: at ${at} both sides cleared their thresholds (${users.value}/${users.threshold} users, ${venues.value}/${venues.threshold} venues).`,
  };
}
