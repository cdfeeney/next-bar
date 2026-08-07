/**
 * The sweep control loop, separated from HTTP so it can be exercised
 * deterministically.
 *
 * `nearby-sweep.mjs` supplies a transport that talks to Google; the fixture
 * runner supplies one that replays recorded responses. Both drive identical
 * planning, saturation, subdivision, budget, and manifest logic — which is the
 * only way an offline run is evidence about the online one.
 */
import {
  classifyError,
  COMPLETING_STATUSES,
  SATURATED_AT_FLOOR,
} from './coverage-manifest.mjs';
import {
  DEFAULT_SUBDIVISION,
  isSaturated,
  planCells,
  planTextCells,
  subdivideCell,
} from './coverage-subdivide.mjs';
import { unsupportedTypeFromError } from './coverage-types.mjs';

/** Thrown by a transport to simulate or honor an operator interruption. */
export class SweepInterrupted extends Error {
  constructor(message = 'sweep interrupted') {
    super(message);
    this.name = 'SweepInterrupted';
  }
}

/** Raised when the planned call budget is spent. Never silently absorbed. */
export class BudgetExhausted extends Error {
  constructor(maxCalls) {
    super(`call budget of ${maxCalls} exhausted`);
    this.name = 'BudgetExhausted';
  }
}

export function planSweep(region, config) {
  const nearby = config.skipNearby
    ? []
    : planCells(region.bbox, config.step, { prefix: `n:${region.key}` });
  const text = config.skipText
    ? []
    : planTextCells(region.bbox, config.textQueries, { prefix: `t:${region.key}` });
  return [...nearby.map((cell) => ({ ...cell, kind: 'nearby' })), ...text];
}

/**
 * Run every planned cell to a terminal state, subdividing whatever saturates.
 *
 * `state` is a replayed manifest (or null for a fresh run) — cells already in a
 * completing state are skipped, which is what makes resume cheap and makes a
 * resumed run converge on the same manifest a single run would have produced.
 */
export async function runSweep({
  cells,
  transport,
  manifest,
  state = null,
  maxCalls = Infinity,
  maxResultCount = 20,
  subdivision = DEFAULT_SUBDIVISION,
  includedTypes = [],
  onPlaces = () => {},
}) {
  const ctx = {
    transport,
    manifest,
    state,
    maxCalls,
    maxResultCount,
    subdivision,
    includedTypes: [...includedTypes],
    onPlaces,
    callsUsed: 0,
    droppedTypes: [],
    interrupted: false,
    attemptsThisRun: new Map(),
  };

  for (const cell of cells) {
    try {
      await processCell(cell, ctx);
    } catch (error) {
      if (error instanceof SweepInterrupted) {
        ctx.interrupted = true;
        break;
      }
      if (error instanceof BudgetExhausted) break;
      throw error;
    }
  }

  return {
    callsUsed: ctx.callsUsed,
    interrupted: ctx.interrupted,
    droppedTypes: ctx.droppedTypes,
    includedTypes: ctx.includedTypes,
  };
}

function priorState(ctx, cellId) {
  return ctx.state?.cells?.get(cellId) ?? null;
}

/**
 * Attempt numbers must strictly increase, including across retries WITHIN a
 * run. `ctx.state` is the replayed prior manifest and is deliberately not
 * mutated mid-run, so deriving the number from it alone would emit two records
 * with the same attemptN and let a later failure hide behind an earlier
 * success in the completeness check.
 */
function nextAttempt(ctx, cellId, known) {
  const base = known?.attempts?.length ?? 0;
  const inRun = (ctx.attemptsThisRun.get(cellId) ?? 0) + 1;
  ctx.attemptsThisRun.set(cellId, inRun);
  return base + inRun;
}

/**
 * Continue a subdivision that a previous run started, using the child cells
 * recorded in the manifest. The parent's own search already happened; only its
 * unfinished children still owe work.
 */
async function resumeChildren(cell, known, ctx) {
  const outcomes = [];
  for (const childId of known.children) {
    const childState = ctx.state?.cells?.get(childId);
    const childCell = childState?.cell;
    if (!childCell) {
      // The SUBDIVIDE record is unusable; fail loudly rather than reporting a
      // clean run over a subdivision we cannot reconstruct.
      ctx.manifest.attempt({
        cellId: childId,
        attemptN: 1,
        ok: false,
        errorClass: 'network',
        message: 'manifest SUBDIVIDE record is missing this child cell geometry',
      });
      outcomes.push(null);
      continue;
    }
    outcomes.push(await processCell({ ...childCell, kind: childCell.kind ?? cell.kind }, ctx));
  }
  const terminal = [...COMPLETING_STATUSES, SATURATED_AT_FLOOR];
  if (outcomes.every((outcome) => terminal.includes(outcome))) {
    ctx.manifest.done(cell.id, 'cleared', { children: known.children.length, resumed: true });
    return 'cleared';
  }
  return null;
}

async function processCell(cell, ctx) {
  const known = priorState(ctx, cell.id);
  if (known && COMPLETING_STATUSES.includes(known.terminalStatus)) {
    // Replay this cell's recorded places. Skipping the CALL is the point of
    // resume; skipping the RESULTS would hand the caller a short candidate
    // list while the manifest still says the cell was covered.
    if (known.places?.length) ctx.onPlaces(known.places, cell);
    return known.terminalStatus;
  }
  // A cell that already hit the floor stays at the floor; re-querying it costs
  // money and cannot produce a different answer.
  if (known?.terminalStatus === SATURATED_AT_FLOOR) {
    if (known.places?.length) ctx.onPlaces(known.places, cell);
    return SATURATED_AT_FLOOR;
  }

  // A cell whose SUBDIVIDE is already recorded must NOT be re-queried. Doing so
  // re-bills a call we already paid for, and — because the re-query can come
  // back under the cap — can mark the parent 'unsaturated' and strand its
  // children forever: runSweep only iterates depth-0 cells, so nothing would
  // ever visit them again and the run could never converge.
  if (known?.children?.length && known.terminalStatus === null) {
    if (known.places?.length) ctx.onPlaces(known.places, cell);
    return resumeChildren(cell, known, ctx);
  }

  const attemptN = nextAttempt(ctx, cell.id, known);

  if (ctx.callsUsed >= ctx.maxCalls) {
    ctx.manifest.attempt({
      cellId: cell.id,
      attemptN,
      ok: false,
      errorClass: 'budget_exhausted',
      message: `stopped before call ${ctx.callsUsed + 1}; budget is ${ctx.maxCalls}`,
    });
    throw new BudgetExhausted(ctx.maxCalls);
  }

  let response;
  try {
    response = await ctx.transport(cell, ctx.includedTypes);
    ctx.callsUsed += 1;
  } catch (error) {
    if (error instanceof SweepInterrupted) throw error;
    ctx.callsUsed += 1;

    // Google rejects the whole request when one includedType is unrecognized.
    // Drop the named type, record it, and retry once rather than failing an
    // entire geography over taxonomy drift we cannot check offline.
    const unsupported = unsupportedTypeFromError(error.message, ctx.includedTypes);
    if (cell.kind === 'nearby' && unsupported.length > 0) {
      ctx.includedTypes = ctx.includedTypes.filter((type) => !unsupported.includes(type));
      ctx.droppedTypes.push(...unsupported);
      ctx.manifest.attempt({
        cellId: cell.id,
        attemptN,
        ok: false,
        errorClass: 'unsupported_type',
        message: `dropped unsupported includedTypes: ${unsupported.join(', ')}`,
      });
      // unsupportedTypeFromError only ever returns members of the list it was
      // given, so the list strictly shrinks and this recursion is bounded by
      // its length. Guard anyway: an empty list means we have nothing left to
      // ask for and must stop rather than retry forever.
      if (ctx.includedTypes.length === 0) {
        ctx.manifest.attempt({
          cellId: cell.id,
          attemptN: nextAttempt(ctx, cell.id, known),
          ok: false,
          errorClass: 'network',
          message: 'every includedType was rejected by Google; nothing left to request',
        });
        return null;
      }
      return processCell(cell, ctx);
    }

    ctx.manifest.attempt({
      cellId: cell.id,
      attemptN,
      ok: false,
      errorClass: classifyError(error, error.status),
      message: error.message,
    });
    return null;
  }

  const places = response?.places ?? [];
  const capped = isSaturated(places.length, ctx.maxResultCount);
  ctx.manifest.attempt({
    cellId: cell.id,
    attemptN,
    ok: true,
    count: places.length,
    capped,
  });
  ctx.manifest.result(cell.id, places);
  ctx.onPlaces(places, cell);

  if (!capped) {
    ctx.manifest.done(cell.id, 'unsaturated', { count: places.length });
    return 'unsaturated';
  }

  const children = subdivideCell(cell, ctx.subdivision);
  if (!children) {
    // Bounded on purpose. Recall is knowably short here, and the manifest says
    // so rather than letting the run round up to "complete".
    ctx.manifest.done(cell.id, SATURATED_AT_FLOOR, {
      sideMeters: cell.sideMeters,
      depth: cell.depth,
      reason:
        cell.depth >= ctx.subdivision.maxDepth
          ? 'max subdivision depth reached'
          : 'minimum cell size reached',
    });
    return SATURATED_AT_FLOOR;
  }

  ctx.manifest.subdivide(cell.id, children.map((child) => child.id), children);
  const outcomes = [];
  for (const child of children) {
    outcomes.push(await processCell(child, ctx));
  }
  // A child that hit the floor is still a FINISHED child: this cell did the
  // subdivision it was asked to do. The residual saturation belongs to the
  // floor cell that actually has it — attributing it to every ancestor too
  // would report "missing work" at depth 0 and hide where recall is short.
  const terminal = [...COMPLETING_STATUSES, SATURATED_AT_FLOOR];
  if (outcomes.every((outcome) => terminal.includes(outcome))) {
    ctx.manifest.done(cell.id, 'cleared', {
      children: children.length,
      residualSaturation: outcomes.filter((outcome) => outcome === SATURATED_AT_FLOOR).length,
    });
    return 'cleared';
  }
  // Leave the parent outstanding: its subdivision did not finish, and the
  // completeness check must be able to see that.
  return null;
}
