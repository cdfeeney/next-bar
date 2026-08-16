// The growth function — the only module besides `tech` that is active, and until now the only one
// with nothing behind it.
//
// What this replaces: the cycle read `ceo/fixtures/candidates.json`, a hand-written list. So the
// orchestrator only ever chose among the operator's own ideas, and the "decide" stage was really an
// arithmetic sort over a file a tired person wrote on a Sunday.
//
// What this is NOT: a muse. It does not ask a model what would be clever. A generator that invents
// plausible plans is the exact failure the anti-theater detectors exist to catch, and it would put a
// non-deterministic call on the cycle path, which is offline and clock-free by design. So this runs
// SEPARATELY, writes a file, and the cycle reads it — the same shape as the measurement envelope,
// and for the same reason: two inputs that must not be authored in one breath.
//
// What it actually does is enforce an ORDER. The operator's own decision doc
// (decisions/2026-07-26-next-bar-gtm-sequence.md) commits to a sequence, and the failure mode for a
// solo founder is not running out of ideas — it is doing step four because it is more fun than step
// two. So the sequence is machine-checkable, and work that jumps it is refused rather than ranked.

import { readFileSync } from 'node:fs';

export class CeoGrowthAbort extends Error {
  constructor(message) {
    super(message);
    this.name = 'CeoGrowthAbort';
  }
}

function abort(detail) {
  const message = `[ceo-growth] ${detail} Aborting.`;
  console.error(message);
  process.exit(1);
  throw new CeoGrowthAbort(message);
}

function metric(state, key) {
  const value = state?.metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The sequence, in order, from the operator's decision doc.
 *
 * Every `satisfied` predicate is a number someone could check without asking the orchestrator's
 * opinion — the same bar the dormant-module wake triggers have to clear. "When the app feels ready"
 * is not a step boundary.
 *
 * The doc's first move — narrow 18 neighbourhoods to one — is deliberately NOT here. It is a
 * judgement a person makes once, not a threshold, and encoding it as a metric would invite someone
 * to satisfy it by editing a number. It belongs in the doc, and the doc is where it stays.
 */
export const SEQUENCE = Object.freeze([
  Object.freeze({
    id: 'first_claims',
    intent:
      'Get the first venues to claim their page, in person. This is the step most likely to be ' +
      'skipped, because it is the only one that cannot be done from a laptop at 11pm.',
    satisfied: (state) => (metric(state, 'claimed_venues') ?? 0) >= 5,
    boundary: '5 claimed venues',
  }),
  Object.freeze({
    id: 'restore_measurement',
    intent:
      'Make the objective observable. While the primary metric is null, every growth claim on this ' +
      'project is unfalsifiable and the kill criterion cannot be evaluated.',
    satisfied: (state) =>
      metric(state, 'wau') !== null && metric(state, 'max_neighborhood_wau') !== null,
    boundary: 'wau and max_neighborhood_wau both readable',
  }),
  Object.freeze({
    id: 'venues_self_maintain',
    intent:
      'Turn claims into a habit. A venue that claimed once and never returned is a signature, not ' +
      'a relationship, and the whole wedge is a bet on the relationship.',
    satisfied: (state) => (metric(state, 'venue_active_maintainers') ?? 0) >= 5,
    boundary: '5 venues maintaining their own listing',
  }),
  Object.freeze({
    id: 'neighborhood_users',
    intent:
      'Grow weekly-active users inside the ONE chosen neighbourhood, which is the side of the kill ' +
      'criterion this step is judged by.',
    satisfied: (state) => (metric(state, 'max_neighborhood_wau') ?? 0) >= 50,
    boundary: '50 weekly-active users in one neighbourhood',
  }),
]);

const STEP_IDS = Object.freeze(SEQUENCE.map((step) => step.id));

/**
 * The earliest unsatisfied step, or null when the sequence is complete.
 *
 * Earliest, not "furthest along": a step that regresses becomes current again. Five venues that
 * stopped maintaining their listings is a step-three problem no matter how many users arrived.
 */
export function currentStep(state) {
  return SEQUENCE.find((step) => !step.satisfied(state)) ?? null;
}

/**
 * The declared playbook: what may be proposed at each step.
 *
 * A fixed catalogue rather than free generation, for the same reason ceo-guard is an allowlist:
 * the set of things this system may suggest should be reviewable by a human reading one file, and
 * adding to it should cost a code change someone made on purpose.
 *
 * `operator_hours` are honest estimates in the operator's real budget (8/week). `restores_measurement`
 * is only true where the work genuinely makes an unreadable metric readable.
 */
export const PLAYBOOK = Object.freeze({
  first_claims: Object.freeze([
    Object.freeze({
      id: 'walk-in-claims-one-neighborhood',
      statement:
        'Walk the chosen neighbourhood on a weekday evening and hand-claim 5 venues at the bar.',
      expected_lift: { metric: 'claimed_venues', delta: 5, unit: 'venues' },
      operator_hours: 4,
      restores_measurement: false,
      rationale:
        'The documented first move for a local marketplace is founder-led, in-person supply ' +
        'recruitment. It is also the cheapest possible test of whether this wedge needs a ' +
        'salesperson the company does not have.',
    }),
    Object.freeze({
      id: 'claim-surface-minimum',
      statement:
        'Ship the smallest claim surface a bartender can use on a phone behind the bar: claim, fix ' +
        'hours, done.',
      expected_lift: { metric: 'claimed_venues', delta: 3, unit: 'venues' },
      operator_hours: 6,
      restores_measurement: false,
      rationale:
        'The walk-in has nothing to hand over without it. Anything beyond claim-and-fix-hours is ' +
        'a feature for venues that do not exist yet.',
    }),
  ]),
  restore_measurement: Object.freeze([
    Object.freeze({
      id: 'share-funnel-analytics',
      statement:
        'Ship share_clicked / share_landed / signup_from_share and a WAU rollup, so the ' +
        "objective's primary metric stops being null.",
      expected_lift: { metric: 'wau', delta: 0, unit: 'users' },
      operator_hours: 3,
      restores_measurement: true,
      rationale:
        'Every other candidate claims a lift nobody can currently observe. This one buys the ' +
        'ability to check them, and it is what cycle 1 already concluded.',
    }),
    Object.freeze({
      id: 'neighborhood-wau-rollup',
      statement:
        'Break the WAU rollup down by neighbourhood, so the number the kill criterion actually ' +
        'tests can be read.',
      expected_lift: { metric: 'max_neighborhood_wau', delta: 0, unit: 'users' },
      operator_hours: 2,
      restores_measurement: true,
      rationale:
        'The criterion is about ONE neighbourhood. A global total is the more flattering number ' +
        'and the wrong one.',
    }),
  ]),
  venues_self_maintain: Object.freeze([
    Object.freeze({
      id: 'specials-post-flow',
      statement: "Let a claimed venue post tonight's special in under 30 seconds from a phone.",
      expected_lift: { metric: 'venue_active_maintainers', delta: 3, unit: 'venues' },
      operator_hours: 6,
      restores_measurement: false,
      rationale:
        'Daily operational value is the Untappd mechanism, and the only reason a venue would come ' +
        'back unprompted.',
    }),
    Object.freeze({
      id: 'stale-hours-nudge',
      statement:
        'Ask a claimed venue to confirm its hours when they have not been touched in 14 days.',
      expected_lift: { metric: 'venue_active_maintainers', delta: 2, unit: 'venues' },
      operator_hours: 3,
      restores_measurement: false,
      rationale: 'Self-maintaining is defined as a 14-day habit, so the nudge is on the same clock.',
    }),
  ]),
  neighborhood_users: Object.freeze([
    Object.freeze({
      id: 'recipient-vote-before-signup',
      statement: 'Let a signed-out recipient cast one 0-10 vote on a shared bar before any auth wall.',
      expected_lift: { metric: 'max_neighborhood_wau', delta: 9, unit: 'users' },
      operator_hours: 6,
      restores_measurement: false,
      rationale:
        'The vote IS the onboarding; a signup wall in front of it spends the one moment of intent ' +
        'the share bought.',
    }),
    Object.freeze({
      id: 'share-cta-copy',
      statement: "Rewrite the share CTA to name the recipient's benefit rather than the sender's action.",
      expected_lift: { metric: 'max_neighborhood_wau', delta: 6, unit: 'users' },
      operator_hours: 1,
      restores_measurement: false,
      rationale: 'Measured CTR is 1.485%; the click, not the landing, is the funnel\'s narrow point.',
    }),
  ]),
});

/**
 * Propose the candidates for wherever the sequence currently is.
 *
 * Deterministic: same state in, same list out, no clock and no model. The cycle still does the
 * choosing — this decides what is even on the table.
 */
export function proposeCandidates(state) {
  const step = currentStep(state);
  if (step === null) {
    return { step: null, candidates: [], detail: 'Every step of the sequence is satisfied. Write a new one.' };
  }

  const candidates = PLAYBOOK[step.id].map((candidate) => ({ ...candidate, step: step.id }));
  return {
    step: step.id,
    boundary: step.boundary,
    intent: step.intent,
    candidates,
    detail: `Step ${step.id} is current (boundary: ${step.boundary}). ${candidates.length} candidates on the table.`,
  };
}

/**
 * Refuse work that jumps the queue.
 *
 * This is the rail, and it is pointed at the operator as much as at any model. The failure mode for
 * a solo founder with a demanding job is not a shortage of ideas — it is doing step four on a
 * Saturday because it is more interesting than step two, and every step-four task is genuinely
 * useful work, which is what makes it so easy to justify.
 *
 * Behind is fine: an earlier step regressing is exactly when you should be allowed to go back.
 */
export function assertCandidateInSequence(candidate, state, index = 0) {
  const where = `candidate[${index}]`;
  const step = currentStep(state);

  if (typeof candidate?.step !== 'string' || !STEP_IDS.includes(candidate.step)) {
    abort(
      `${where}.step must name a sequence step; got ${JSON.stringify(candidate?.step ?? null)}. ` +
        `Permitted: [${STEP_IDS.join(', ')}]. Work with no place in the sequence is work nobody ` +
        'decided to do.',
    );
  }
  if (step === null) return;

  const proposed = STEP_IDS.indexOf(candidate.step);
  const current = STEP_IDS.indexOf(step.id);

  if (proposed > current) {
    abort(
      `${where} (${candidate.id}) belongs to step ${candidate.step}, but the sequence is at ` +
        `${step.id} — boundary: ${step.boundary}. ${step.intent} Later work is not better work, ` +
        'and it is the work most likely to feel more appealing than what is actually next.',
    );
  }
}

/** Gate a whole proposal file at once. */
export function assertCandidatesInSequence(candidates, state) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    abort('a proposal must carry at least one candidate.');
  }
  candidates.forEach((candidate, index) => assertCandidateInSequence(candidate, state, index));
}

/** Render the proposal file the cycle reads. Same envelope shape as the hand-written fixture. */
export function renderProposal(state) {
  const proposed = proposeCandidates(state);
  return {
    _comment:
      'AGENT-AUTHORED by scripts/ceo-growth.mjs. Regenerate; do not hand-edit. The agent proposes ' +
      'the work and does NOT report the numbers it will be judged against — measurements arrive ' +
      'separately in ceo/measurements/, and the cycle refuses any candidate that jumps the ' +
      'sequence in decisions/2026-07-26-next-bar-gtm-sequence.md.',
    step: proposed.step,
    boundary: proposed.boundary ?? null,
    candidates: proposed.candidates,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/ceo-growth.mjs [options]

  --state <path>   CEO state to read (default ceo/state.json)
  --json           print the proposal as JSON (default: a human summary)

Writes nothing. Redirect the JSON to ceo/candidates/proposed.json when you want the cycle to read
it — the write is deliberately the operator's keystroke, not this script's.`;

function main(argv) {
  let statePath = 'ceo/state.json';
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') { json = true; continue; }
    if (flag === '--help' || flag === '-h') { console.log(USAGE); return; }
    if (flag === '--state') {
      index += 1;
      if (index >= argv.length) abort('--state requires a value.');
      statePath = argv[index];
      continue;
    }
    abort(`unknown argument ${JSON.stringify(flag)}.\n${USAGE}`);
  }

  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (error) {
    abort(`could not read state at ${statePath}: ${error.message}`);
  }

  const proposal = renderProposal(state);
  if (json) {
    console.log(JSON.stringify(proposal, null, 2));
    return;
  }

  const step = currentStep(state);
  console.log(step === null
    ? 'Sequence complete — every step is satisfied. Write a new sequence.'
    : `Current step: ${step.id}\nBoundary:     ${step.boundary}\nWhy:          ${step.intent}\n`);
  for (const candidate of proposal.candidates) {
    console.log(`- ${candidate.id} (${candidate.operator_hours}h) — ${candidate.statement}`);
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && entrypoint.endsWith('ceo-growth.mjs')) {
  main(process.argv.slice(2));
}
