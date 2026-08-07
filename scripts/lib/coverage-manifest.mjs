/**
 * Resumable, truth-telling run manifest for the coverage sweep.
 *
 * Format is append-only JSONL flushed after every record. JSONL because each
 * event is small and self-contained, a torn trailing line is recoverable by
 * discarding it, and rewriting one JSON blob per cell would turn an
 * append-safe file into an overwrite-corruptible one — the exact failure mode
 * resume exists to survive.
 *
 * The manifest is the source of truth, not a log: RESULT records carry the
 * place ids, so the candidate file is reconstructable from the manifest alone
 * even if the process dies during post-sweep dedup.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// v2: RESULT records carry full place payloads, not just ids, so a resumed run
// can rebuild the candidate queue without re-querying. Bumping this changes the
// config hash, so v1 manifests correctly refuse to resume onto v2 code.
export const MANIFEST_SCHEMA_VERSION = 2;

/** Terminal states that count toward a complete run. */
export const COMPLETING_STATUSES = Object.freeze(['unsaturated', 'cleared', 'ack_terminal']);

/**
 * A cell that still caps at the minimum size is NOT complete. Recall is
 * knowably short there, and reporting "complete" would launder that away.
 */
export const SATURATED_AT_FLOOR = 'saturated_at_floor';

/** Error classes a run may not silently carry past a completeness check. */
export const BLOCKING_ERROR_CLASSES = Object.freeze([
  'quota',
  'http5xx',
  'network',
  'budget_exhausted',
]);

/** Canonical JSON so key insertion order cannot change the hash. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

/**
 * Hash the EFFECTIVE sweep configuration. This must cover everything that
 * changes what work is planned — including the real includedTypes list and the
 * verbatim text queries, not just the geometry. A run whose type list changed
 * has a different universe and must not resume onto old results.
 */
export function configHash(config) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize({ ...config, schemaVersion: MANIFEST_SCHEMA_VERSION })))
    .digest('hex')
    .slice(0, 16);
}

export function classifyError(error, status) {
  if (status === 429 || /quota|rate.?limit|per day/i.test(String(error?.message ?? ''))) {
    return 'quota';
  }
  if (typeof status === 'number' && status >= 500) return 'http5xx';
  if (typeof status === 'number' && status >= 400) return 'http4xx';
  return 'network';
}

class ManifestWriter {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.fd = fs.openSync(file, 'a');
  }

  /**
   * Flush to disk on every record. A resume that loses the last few cells
   * re-queries them; a resume that trusts an unflushed buffer reports work as
   * done that never happened.
   */
  append(record) {
    const line = `${JSON.stringify({ ...record, ts: this.now() })}\n`;
    fs.writeSync(this.fd, line);
    fs.fsyncSync(this.fd);
    return record;
  }

  // Overridable so fixture runs produce byte-identical manifests.
  now() {
    return new Date().toISOString();
  }

  plan(plan) {
    return this.append({ type: 'PLAN', ...plan });
  }

  attempt(record) {
    return this.append({ type: 'ATTEMPT', ...record });
  }

  /**
   * Records the full place payloads, not just their ids. The docstring at the
   * top of this file claims the candidate file is reconstructable from the
   * manifest alone; ids alone cannot do that, and a resume would silently
   * rebuild a short queue from only the cells it re-queried.
   */
  result(cellId, places) {
    return this.append({
      type: 'RESULT',
      cellId,
      placeIds: places.map((place) => place.id).filter(Boolean),
      places,
    });
  }

  subdivide(parentId, childIds, childCells) {
    return this.append({ type: 'SUBDIVIDE', parentId, childIds, childCells });
  }

  done(cellId, terminalStatus, detail) {
    return this.append({ type: 'DONE', cellId, terminalStatus, detail });
  }

  ackTerminal(cellId, reason, operator = 'sweep') {
    return this.append({ type: 'ACK_TERMINAL', cellId, reason, operator });
  }

  /**
   * Written only after the completeness invariant holds. Its presence beside a
   * failing invariant is itself a detectable fault — see completionReport().
   */
  runDone(report) {
    return this.append({ type: 'RUN_DONE', status: report.status, summary: report.summary });
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

export function openManifest(file) {
  return new ManifestWriter(path.resolve(file));
}

/**
 * Open a manifest for a NEW run, refusing to append onto an existing plan.
 *
 * replay() honours the first PLAN it finds, so a second PLAN appended to the
 * same file makes every cell of the new plan `planned:false` — invisible to the
 * completeness check. A quota-failed run could then inherit the previous run's
 * "complete" and report success for work it never did.
 */
export function openNewManifest(file) {
  const resolved = path.resolve(file);
  // Any existing content is a refusal, not just a parseable plan. A file whose
  // single record was torn by a kill has no PLAN to find, and appending to it
  // would concatenate onto the partial line and leave the manifest permanently
  // unparsable — after the run had already spent its calls.
  if (fs.existsSync(resolved) && fs.statSync(resolved).size > 0) {
    const existing = replay(parseManifest(fs.readFileSync(resolved, 'utf8')));
    const detail = existing.plan
      ? `already contains a run plan (configHash ${existing.plan.configHash})`
      : 'already contains data (possibly a truncated record from a killed run)';
    throw new Error(
      `${resolved} ${detail}. Pass --resume to continue it, or choose a new --manifest path. ` +
        'Appending a second plan would hide the new run from the completeness check.',
    );
  }
  return new ManifestWriter(resolved);
}

/**
 * Parse a manifest, tolerating a torn final line from a killed process.
 * Anything before the last newline is durable and must parse.
 */
export function parseManifest(text) {
  const lastNewline = text.lastIndexOf('\n');
  const durable = lastNewline === -1 ? '' : text.slice(0, lastNewline);
  const records = [];
  for (const line of durable.split('\n')) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line));
  }
  return { records, tornTail: text.length > lastNewline + 1 };
}

export function loadManifest(file) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) return null;
  return replay(parseManifest(fs.readFileSync(resolved, 'utf8')));
}

/**
 * Fold the record stream into per-cell state. Every judgement about the run is
 * made from this, so a resume and a completeness check always agree.
 */
export function replay({ records, tornTail = false }) {
  const plan = records.find((record) => record.type === 'PLAN') ?? null;
  const cells = new Map();

  const ensure = (cellId, seed = {}) => {
    const existing = cells.get(cellId);
    if (existing) return existing;
    const created = {
      cellId,
      planned: false,
      depth: 0,
      attempts: [],
      lastOk: null,
      capped: false,
      placeIds: [],
      places: [],
      children: [],
      parentId: null,
      terminalStatus: null,
      ...seed,
    };
    cells.set(cellId, created);
    return created;
  };

  for (const cell of plan?.cells ?? []) {
    ensure(cell.id, { planned: true, depth: cell.depth ?? 0, cell });
  }

  for (const record of records) {
    switch (record.type) {
      case 'ATTEMPT': {
        const cell = ensure(record.cellId);
        cell.attempts.push(record);
        if (record.ok) {
          cell.lastOk = record;
          cell.capped = Boolean(record.capped);
        }
        break;
      }
      case 'RESULT': {
        const cell = ensure(record.cellId);
        cell.placeIds = [...new Set([...cell.placeIds, ...(record.placeIds ?? [])])];
        const byId = new Map(cell.places.map((place) => [place.id, place]));
        for (const place of record.places ?? []) byId.set(place.id, place);
        cell.places = [...byId.values()];
        break;
      }
      case 'SUBDIVIDE': {
        const parent = ensure(record.parentId);
        parent.children = [...new Set([...parent.children, ...record.childIds])];
        for (const child of record.childCells ?? []) {
          ensure(child.id, {
            planned: true,
            depth: child.depth ?? parent.depth + 1,
            parentId: record.parentId,
            cell: child,
          });
        }
        break;
      }
      case 'DONE': {
        const cell = ensure(record.cellId);
        cell.terminalStatus = record.terminalStatus;
        break;
      }
      case 'ACK_TERMINAL': {
        const cell = ensure(record.cellId);
        cell.acked = record;
        break;
      }
      default:
        break;
    }
  }

  return { plan, cells, records, tornTail };
}

/**
 * The completeness invariant. A run may claim "complete" only when this
 * returns complete:true — see AC6. Deliberately returns the offending cell ids
 * so the summary can say what is outstanding instead of just refusing.
 */
export function completeness(state) {
  const missing = [];
  const failed = [];
  const saturated = [];
  const unclearedCap = [];

  for (const cell of state.cells.values()) {
    if (!cell.planned) continue;

    // (1) every planned cell and every subdivision child reaches a terminal state
    if (cell.terminalStatus === null) {
      missing.push(cell.cellId);
    } else if (cell.terminalStatus === SATURATED_AT_FLOOR) {
      saturated.push(cell.cellId);
    } else if (!COMPLETING_STATUSES.includes(cell.terminalStatus)) {
      missing.push(cell.cellId);
    } else if (cell.terminalStatus !== 'ack_terminal' && !cell.lastOk) {
      // A DONE record is a claim, not evidence. 'unsaturated' and 'cleared'
      // both require a search to have actually succeeded; only 'ack_terminal'
      // is legitimately unsupported by one. Without this, a truncated or
      // hand-edited manifest could assert completeness for work never done.
      missing.push(cell.cellId);
    }

    // (2) a capped cell must have been subdivided, and its children finished.
    //     A child at the floor counts as finished here — its own
    //     SATURATED_AT_FLOOR entry is what blocks completion, so the residual
    //     is reported once, against the cell that has it.
    if (cell.capped && cell.terminalStatus !== SATURATED_AT_FLOOR) {
      const children = cell.children.map((id) => state.cells.get(id));
      const finishedByChildren =
        children.length > 0 &&
        children.every(
          (child) =>
            child &&
            (COMPLETING_STATUSES.includes(child.terminalStatus) ||
              child.terminalStatus === SATURATED_AT_FLOOR),
        );
      if (!finishedByChildren && cell.terminalStatus !== 'ack_terminal') {
        unclearedCap.push(cell.cellId);
      }
    }

    // (3) no blocking error survives without a retry that worked, or an ack
    const blocking = cell.attempts.filter(
      (attempt) => !attempt.ok && BLOCKING_ERROR_CLASSES.includes(attempt.errorClass),
    );
    if (blocking.length > 0) {
      const recoveredAt = cell.lastOk?.attemptN ?? -1;
      const unrecovered = blocking.some((attempt) => (attempt.attemptN ?? 0) > recoveredAt);
      if (unrecovered && cell.terminalStatus !== 'ack_terminal') {
        failed.push(cell.cellId);
      }
    }
  }

  const complete =
    missing.length === 0 &&
    failed.length === 0 &&
    saturated.length === 0 &&
    unclearedCap.length === 0;

  // Order by how specific the diagnosis is, not by which list is longest. A
  // quota-blocked cell is also an unfinished cell; reporting it as generic
  // "missing work" throws away the one thing the operator needs to know.
  let status;
  if (complete) status = 'complete';
  else if (failed.length > 0) status = 'incomplete_failed';
  else if (missing.length > 0 || unclearedCap.length > 0) status = 'incomplete_missing_work';
  else status = 'incomplete_saturated';

  const plannedCells = [...state.cells.values()].filter((cell) => cell.planned);
  return {
    complete,
    status,
    missing,
    failed,
    saturated,
    unclearedCap,
    summary: {
      plannedCells: plannedCells.length,
      finished: plannedCells.filter((cell) => COMPLETING_STATUSES.includes(cell.terminalStatus))
        .length,
      subdivided: plannedCells.filter((cell) => cell.children.length > 0).length,
      saturatedAtFloor: saturated.length,
      failed: failed.length,
      outstanding: missing.length + unclearedCap.length,
      uniquePlaceIds: new Set(plannedCells.flatMap((cell) => cell.placeIds)).size,
      tornTail: Boolean(state.tornTail),
    },
  };
}

/**
 * Guard the summary printer. A DONE-bearing manifest whose invariant fails is
 * worse than an obviously partial one — it looks finished. Name that case
 * separately so it can never read as success.
 */
export function completionReport(state) {
  const report = completeness(state);
  const claimsDone = state.records.some((record) => record.type === 'RUN_DONE');
  if (claimsDone && !report.complete) {
    return { ...report, status: 'manifest_inconsistent', complete: false };
  }
  return report;
}

/** Cells a resume must still do: never attempted, failed, or capped-but-uncleared. */
export function outstandingCells(state) {
  const report = completeness(state);
  const ids = new Set([...report.missing, ...report.failed, ...report.unclearedCap]);
  return [...ids]
    .map((id) => state.cells.get(id))
    .filter((cell) => cell && cell.cell)
    .sort((a, b) => a.depth - b.depth || a.cellId.localeCompare(b.cellId));
}

/** Refuse to resume onto a manifest planned under different configuration. */
export function assertResumable(state, expectedHash) {
  if (!state?.plan) throw new Error('manifest has no PLAN record; cannot resume');
  if (state.plan.configHash !== expectedHash) {
    throw new Error(
      `manifest configHash ${state.plan.configHash} does not match current configuration ${expectedHash}; ` +
        'start a new manifest rather than merging incompatible runs',
    );
  }
  return true;
}
