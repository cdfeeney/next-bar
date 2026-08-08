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
      lastOkHasResult: false,
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
          // The page for THIS attempt has not been seen yet. "Does the cell
          // have any places" is not a usable proxy: a page from an earlier
          // attempt would answer yes, and a legitimate empty page would answer
          // no. Only the record order can say whether this attempt's result
          // reached the disk.
          cell.lastOkHasResult = false;
          // Saturation is STICKY. Once a response for this cell came back at
          // the cap we know the cell is censored, and no later, smaller answer
          // makes that untrue — Google returns a different slice each time.
          // Overwriting the flag let a second uncapped attempt erase the first
          // one's evidence and certify a known-censored cell with no
          // subdivision, which is exactly the recall loss this file exists to
          // prevent.
          cell.capped = cell.capped || Boolean(record.capped);
        }
        break;
      }
      case 'RESULT': {
        const cell = ensure(record.cellId);
        cell.placeIds = [...new Set([...cell.placeIds, ...(record.placeIds ?? [])])];
        const byId = new Map(cell.places.map((place) => [place.id, place]));
        for (const place of record.places ?? []) byId.set(place.id, place);
        cell.places = [...byId.values()];
        if (cell.lastOk) cell.lastOkHasResult = true;
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
/**
 * A waiver needs a real acknowledgement, not just a DONE claiming the word.
 * Used by all three clauses of the invariant so a fabricated status cannot
 * excuse missing work in one place while being caught in another — which also
 * kept the operator-facing status from naming the real reason.
 */
function isAcknowledged(cell) {
  return cell.terminalStatus === 'ack_terminal' && Boolean(cell.acked);
}

/**
 * Is this cell finished, for every judge that asks?
 *
 * `processCell` and `completeness()` both decide "does this cell still owe
 * work", and they must not answer differently. They used to: each tested
 * `COMPLETING_STATUSES.includes(terminalStatus)` directly, so a DONE claiming
 * `ack_terminal` with no ACK_TERMINAL behind it read as finished to the engine
 * and as outstanding to the invariant. The cell was then unreachable — the
 * engine skipped it, completeness refused to pass it, and `ackEligibility`
 * declined to waive it because its last attempt had succeeded. One definition,
 * used by both, is what keeps that from recurring.
 */
export function isCompleting(cell) {
  if (!cell) return false;
  if (cell.terminalStatus === 'ack_terminal') return isAcknowledged(cell);
  if (!COMPLETING_STATUSES.includes(cell.terminalStatus)) return false;
  // A DONE is a claim; a successful ATTEMPT is the evidence for it. The
  // invariant has always demanded this and the engine never did, so a DONE
  // saying 'unsaturated' with no attempt behind it was finished to one judge
  // and outstanding to the other — the same deadlock the ack_terminal case
  // had, and just as unwaivable, since a never-attempted cell is not eligible.
  return Boolean(cell.lastOk);
}

/**
 * Terminal: this cell owes no further SUBDIVISION, whatever that means for the
 * run's verdict. The floor belongs here and not in `isCompleting`, because a
 * cell still capping at the minimum size is finished as work and knowably short
 * as coverage — two different questions with two different answers.
 *
 * This is the predicate `completeness` needs for "did this cell's children
 * finish", and it is deliberately NOT `isSettledForResume`: completeness must
 * not consult the blocking check here, because a blocked child is already
 * reported against ITSELF by clause 3. It was previously hand-spelled at that
 * call site, one omitted disjunct away from silently letting a floor-saturated
 * child count toward a clean report.
 */
export function isTerminal(cell) {
  if (!cell) return false;
  // The floor arm carries the SAME evidence demand as the rest. Writing it as a
  // bare disjunction made `saturated_at_floor` the one status accepted on the
  // word alone — and since a floor cell is waivable, a fabricated floor DONE
  // could be acknowledged and counted toward a COMPLETE run over geography
  // nobody ever searched. Nothing legitimate is lost: a floor status is only
  // ever written after a capped response, and a capped response IS a successful
  // attempt, so a real floor cell always carries `lastOk`.
  if (cell.terminalStatus === SATURATED_AT_FLOOR) return Boolean(cell.lastOk);
  return isCompleting(cell);
}

/**
 * Finished for the purpose of not working this cell again on a resume.
 *
 * `isTerminal` plus one thing: a terminal status does NOT survive a blocking
 * failure recorded after it. The run must retry, and nothing else can clear it
 * — `ackEligibility` deliberately refuses to waive a transient class — so
 * treating such a cell as finished strands it with no lever at all.
 *
 * The three questions now have three names. `isCompleting`: may the run report
 * this cell as done? `isTerminal`: does it owe more subdivision? This: does a
 * resume still owe it work? Picking the wrong one used to be an omitted
 * disjunct at a call site; now it is a visible choice of verb.
 */
export function isSettledForResume(cell) {
  return isTerminal(cell) && !hasUnrecoveredBlocking(cell);
}

/**
 * A blocking failure with no later success and no waiver. Shared for the same
 * reason as `isCompleting`: the engine must not write a terminal status over a
 * transient failure that `completeness()` will still count against the run.
 */
export function hasUnrecoveredBlocking(cell) {
  const blocking = (cell?.attempts ?? []).filter(
    (attempt) => !attempt.ok && BLOCKING_ERROR_CLASSES.includes(attempt.errorClass),
  );
  if (blocking.length === 0) return false;
  const recoveredAt = cell.lastOk?.attemptN ?? -1;
  return blocking.some((attempt) => (attempt.attemptN ?? 0) > recoveredAt);
}

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
    } else if (cell.terminalStatus === 'ack_terminal') {
      // ack_terminal is the one status legitimately unsupported by a successful
      // search — but it must be backed by an actual ACK_TERMINAL record.
      if (!isAcknowledged(cell)) missing.push(cell.cellId);
    } else if (!cell.lastOk) {
      // A DONE record is a claim, not evidence. 'unsaturated' and 'cleared'
      // both require a search to have actually succeeded. Without this, a
      // truncated or hand-edited manifest could assert completeness for work
      // that was never done.
      missing.push(cell.cellId);
    }

    // (2) a capped cell must have been subdivided, and its children finished.
    //     A child at the floor counts as finished here — its own
    //     SATURATED_AT_FLOOR entry is what blocks completion, so the residual
    //     is reported once, against the cell that has it.
    if (cell.capped && cell.terminalStatus !== SATURATED_AT_FLOOR) {
      const children = cell.children.map((id) => state.cells.get(id));
      const finishedByChildren = children.length > 0 && children.every(isTerminal);
      if (!finishedByChildren && !isAcknowledged(cell)) {
        unclearedCap.push(cell.cellId);
      }
    }

    // (3) no blocking error survives without a retry that worked, or an ack
    if (hasUnrecoveredBlocking(cell) && !isAcknowledged(cell)) {
      failed.push(cell.cellId);
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
  // A cell that any clause reported against is not "finished", whatever its
  // status word says. Counting them separately let the same cell appear in
  // `finished` and in `outstanding` in one summary — the object RUN_DONE
  // persists for the operator.
  const outstandingIds = new Set([...missing, ...failed, ...unclearedCap]);
  return {
    complete,
    status,
    missing,
    failed,
    saturated,
    unclearedCap,
    summary: {
      plannedCells: plannedCells.length,
      // `isCompleting`, not raw status membership. The summary was the last
      // judge still reading the bare word, so an evidence-less DONE was counted
      // as finished while the same cell sat in `missing` in the same object —
      // and that object is what RUN_DONE persists for the operator.
      finished: plannedCells.filter(
        (cell) => isCompleting(cell) && !outstandingIds.has(cell.cellId),
      ).length,
      subdivided: plannedCells.filter((cell) => cell.children.length > 0).length,
      saturatedAtFloor: saturated.length,
      failed: failed.length,
      // Distinct CELLS, not the sum of two lists. A capped cell with no DONE is
      // both `missing` and `unclearedCap`, so adding the lengths reported two
      // outstanding cells where only one planned cell existed.
      outstanding: new Set([...missing, ...unclearedCap]).size,
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

/**
 * Whether a cell may legitimately be waived.
 *
 * A waiver permanently removes a cell's venues from the results, so it must be
 * reachable ONLY for work the sweep has actually tried and cannot finish. The
 * id existing in the manifest is not evidence of anything: a never-attempted
 * cell is "missing", and waiving it would report COMPLETE over a geography
 * nobody ever searched — indistinguishable, afterwards, from a clean run.
 *
 * Returns `{ eligible, reason }` so the caller can explain a refusal.
 */
export function ackEligibility(state, cellId) {
  const cell = state?.cells?.get(cellId);
  if (!cell) return { eligible: false, reason: 'no such cell in this manifest' };
  if (cell.terminalStatus === 'ack_terminal' && cell.acked) {
    return { eligible: false, reason: 'already acknowledged' };
  }
  // The same definition the engine resumes by. Testing raw status membership
  // here made this a THIRD judge with its own answer: a forged ack_terminal
  // child read as finished, the "acknowledge those children instead" refusal
  // went dead, and a parent could be waived while its child stayed outstanding.
  const unfinishedChildren = (cell.children ?? []).filter(
    (childId) => !isSettledForResume(state.cells.get(childId)),
  );
  if (unfinishedChildren.length > 0) {
    return {
      eligible: false,
      reason:
        `its subdivision is unfinished (${unfinishedChildren.length} of ${cell.children.length} children outstanding) — ` +
        'acknowledge those children instead, or resume to finish them',
    };
  }
  // The never-attempted refusal comes FIRST. It used to sit below the floor
  // check, so a fabricated `saturated_at_floor` DONE was waived on the word
  // alone — granted with the reassuring reason "saturated at the floor" — and
  // the run then reported complete over a cell nobody had searched. That is
  // exactly what this guard's docstring promises cannot happen.
  if (cell.attempts.length === 0) {
    return { eligible: false, reason: 'it has never been attempted; run or resume the sweep first' };
  }
  if (cell.terminalStatus === SATURATED_AT_FLOOR) return { eligible: true, reason: 'saturated at the floor' };
  const last = cell.attempts[cell.attempts.length - 1];
  if (last.ok) {
    return { eligible: false, reason: 'its most recent attempt succeeded, so it is not stuck' };
  }
  // The transient classes are the ones a resume is FOR — quota windows reopen,
  // networks recover, budgets get raised. Waiving one permanently discards
  // geography that a retry would have covered, and `budget_exhausted` is
  // written before any call is made, so allowing it would also defeat the
  // never-attempted guard above.
  if (BLOCKING_ERROR_CLASSES.includes(last.errorClass)) {
    return {
      eligible: false,
      reason:
        `its last failure was transient (${last.errorClass}) — resume handles that; ` +
        'raise --max-calls or wait for the quota window rather than waiving real geography',
    };
  }
  return { eligible: true, reason: `last attempt failed permanently (${last.errorClass ?? 'unknown'})` };
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
