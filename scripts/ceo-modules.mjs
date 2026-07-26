// Dormant-module inertness for the CEO orchestrator.
//
// ceo/state.json declares six modules, four of them dormant. Declared and unbacked is the worst
// of both worlds: the spec reads complete, and `venue_sales` is a word in a JSON file. This makes
// the dormant half real in the only way that matters for something that is supposed to be inert —
// each module REFUSES to run, and says what would wake it.
//
// The trigger is the load-bearing part. "Dormant" without one is indistinguishable from forgotten,
// and a module nobody can say the activation condition for will either never activate or activate
// because someone felt like it.
//
// Note what is deliberately absent: nothing here can activate anything. `modules` is on
// ceo-guard's AGENT_PROTECTED_FIELDS, so the orchestrator cannot flip its own scope — an agent
// that could would simply grant itself the capability it wanted. A met trigger is a message to
// the operator.

/** Halt, twice over — house convention, and the throw matters when process.exit is stubbed. */
function abort(detail) {
  const message = `[ceo-modules] ${detail} Aborting.`;
  console.error(message);
  process.exit(1);
  throw new Error(message);
}

function metric(state, key) {
  const value = state?.metrics?.[key];
  return typeof value === 'number' ? value : null;
}

/**
 * The module registry.
 *
 * Every trigger is a condition someone could check without asking the orchestrator's opinion.
 * "When it feels right" is not a trigger; "revenue is above zero" is.
 */
export const MODULES = Object.freeze({
  growth: Object.freeze({
    dormant: false,
    trigger: 'Active — this is the whole job until the objective is met.',
    isTriggered: () => true,
  }),

  tech: Object.freeze({
    dormant: false,
    trigger: 'Active — the product has to keep working.',
    isTriggered: () => true,
  }),

  venue_sales: Object.freeze({
    dormant: true,
    trigger:
      'WAKES WHEN: 5 or more venues have claimed their page. Demand has to exist before there ' +
      'is anything to sell; selling into no demand is how you learn nothing expensively.',
    isTriggered: (state) => (metric(state, 'claimed_venues') ?? 0) >= 5,
  }),

  hiring: Object.freeze({
    dormant: true,
    trigger:
      'WAKES WHEN: operator hours available reach zero — the operator is the binding constraint, ' +
      'not the ideas. Hiring before that buys capacity for work nobody has demand for.',
    // `<= 0`, not `=== 0` (review F2): an over-committed operator is the situation this module
    // exists for, and an exact-zero test goes quiet exactly as the problem gets worse.
    isTriggered: (state) => {
      const hours = metric(state, 'operator_hours_available');
      return hours !== null && hours <= 0;
    },
  }),

  finance: Object.freeze({
    dormant: true,
    trigger:
      'WAKES WHEN: revenue is above zero. There is nothing to manage until there is money, and ' +
      'a finance function over $0 is a spreadsheet about a hypothesis.',
    isTriggered: (state) => (metric(state, 'revenue') ?? 0) > 0,
  }),

  exit: Object.freeze({
    dormant: true,
    trigger:
      'WAKES WHEN: the kill criterion trips — evaluated fresh each cycle, not read from a stored ' +
      'flag. An unsolicited acquisition approach also wakes it, but no code can see that: only ' +
      'the operator can, by setting kill_criterion.tripped or activating the module directly.',
    // Review F1. This used to read `state.kill_criterion.tripped`, which NOTHING EVER WRITES —
    // assess() computes the trip fresh every cycle but cannot persist it (kill_criterion is
    // agent-protected, and the measurement path admits only metrics/cycle). So the trigger was
    // pinned to false and the exit module could never wake, on the one module where being late
    // costs the most. It now reads the freshly computed assessment, falling back to the stored
    // flag so an operator can still trip it by hand.
    isTriggered: (state, context) =>
      context?.assessment?.kill?.tripped === true || state?.kill_criterion?.tripped === true,
  }),
});

/** The four the spec calls dormant, derived rather than restated so they cannot drift apart. */
export const DORMANT_MODULES = Object.freeze(
  Object.entries(MODULES)
    .filter(([, module]) => module.dormant)
    .map(([name]) => name),
);

/**
 * Has this module's activation condition arrived?
 *
 * Never throws — this is a question, and asking it about a module that does not exist is answered
 * "no", not punished.
 */
export function activationTriggerMet(state, moduleName, context = {}) {
  if (!Object.hasOwn(MODULES, moduleName)) return false;
  return MODULES[moduleName].isTriggered(state, context) === true;
}

/**
 * Gate one module invocation.
 *
 * Refuses on: an unknown module, a state that declares no module map (fail closed — an absent map
 * is not an all-clear), and any module the state marks dormant. A dormant module refuses EVEN IF
 * its trigger is met, because activating is the operator's call and the guard forbids the agent
 * from making it.
 */
export function assertModuleRunnable(state, moduleName, context = {}) {
  if (!Object.hasOwn(MODULES, moduleName)) {
    abort(
      `unknown module ${JSON.stringify(moduleName)}; declared: [${Object.keys(MODULES).join(', ')}].`,
    );
  }

  const module = MODULES[moduleName];

  // Review F3, checked FIRST and against this frozen registry rather than the caller's state.
  // Reading only `state.modules` made the refusal exactly as honest as whoever supplied the
  // state — and the agent is assumed to be probing precisely that seam. The registry is a
  // compile-time constant, so a doctored state claiming `venue_sales: 'active'` changes nothing.
  //
  // Consequence, and it is the intended one: waking a module takes BOTH an operator edit to
  // ceo/state.json AND a reviewed source change here. For four modules with no implementation
  // behind them, a JSON edit alone should not be enough to "run" anything.
  if (module.dormant) {
    const ready = activationTriggerMet(state, moduleName, context)
      ? ' Its trigger APPEARS MET — that is an operator decision to activate, not something this ' +
        'module may do for itself.'
      : '';
    abort(`module "${moduleName}" is dormant and refuses to run. ${module.trigger}${ready}`);
  }

  const declared = state?.modules?.[moduleName];
  if (declared !== 'active' && declared !== 'dormant') {
    abort(
      `module "${moduleName}" has no declared state (found ${JSON.stringify(declared ?? null)}). ` +
        'An undeclared module is dormant.',
    );
  }

  if (declared === 'dormant') {
    abort(`module "${moduleName}" is dormant in state and refuses to run. ${module.trigger}`);
  }
}

/**
 * Which dormant modules are ready to be woken?
 *
 * Shaped like the anti-theater findings so it can ride the same preamble. Flags; never blocks —
 * a module becoming ready is good news, not a fault.
 */
export function detectDormantReadiness(state, context = {}) {
  const ready = DORMANT_MODULES.filter(
    (name) => state?.modules?.[name] === 'dormant' && activationTriggerMet(state, name, context),
  );

  return {
    id: 'dormant_module_ready',
    flagged: ready.length > 0,
    ready,
    detail:
      ready.length > 0
        ? `DORMANT MODULE READY: ${ready.join(', ')}. The activation condition has arrived. Only the operator can flip it — the orchestrator may not widen its own scope.`
        : 'No dormant module has met its activation trigger.',
  };
}
