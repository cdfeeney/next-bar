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

async function processCell(cell, ctx) {
  const known = priorState(ctx, cell.id);
  if (known && COMPLETING_STATUSES.includes(known.terminalStatus)) {
    return known.terminalStatus;
  }
  // A cell that already hit the floor stays at the floor; re-querying it costs
  // money and cannot produce a different answer.
  if (known?.terminalStatus === SATURATED_AT_FLOOR) return SATURATED_AT_FLOOR;

  const attemptN = (known?.attempts?.length ?? 0) + 1;

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
  ctx.manifest.result(
    cell.id,
    places.map((place) => place.id).filter(Boolean),
  );
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
