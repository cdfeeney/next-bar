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

/**
 * The manifest itself is unusable for this cell — a SUBDIVIDE that names a
 * child but carries no geometry for it, so there is nothing to search.
 *
 * Deliberately NOT in BLOCKING_ERROR_CLASSES. Every blocking class means "a
 * retry might work", and `ackEligibility` refuses to waive one for exactly that
 * reason: quota windows reopen, networks recover. Absent geometry recovers from
 * nothing. Recording it as `network` told the operator to resume and wait,
 * while no resume could ever supply the missing cell — the cell was
 * unfinishable by the engine and unwaivable by the operator at once, and every
 * resume appended another identical failure. As a non-blocking class it falls
 * to the permanent-failure grant, which is the honest description and restores
 * the lever.
 */
export const MANIFEST_CORRUPT = 'manifest_corrupt';

/**
 * Google rejected every `includedType` we know how to ask for, so there is
 * nothing left to request for this cell.
 *
 * Non-blocking for the same reason as MANIFEST_CORRUPT: a retry cannot help.
 * The type list is rebuilt from configuration at the start of every run, so a
 * resume asks the identical question and gets the identical rejection — this
 * was recorded as `network`, which made `ackEligibility` refuse the waiver as
 * transient while each resume re-bought the same rejected calls and appended
 * three more records. Reproduced at 3 -> 6 -> 9 records over three resumes,
 * permanently `incomplete_failed`, with no lever in any direction. Taxonomy
 * drift is fixed by changing the configured types (a new configHash and a new
 * run) or by waiving the cell; it is never fixed by resuming.
 */
export const TYPES_EXHAUSTED = 'types_exhausted';

/**
 * Google rejected ONE `includedType`; the engine drops it and re-queries the
 * same cell in the same run.
 *
 * Non-blocking, because it is resolved mid-run and must not put a
 * drop-and-retry cell into `failed`. But it is also NOT permanent, which is the
 * distinction the waiver check has to make: it is only ever the last attempt
 * when a run ended between the drop and its retry, and a resume rebuilds the
 * type list and finishes the cell. Neither `MANIFEST_CORRUPT` nor
 * `TYPES_EXHAUSTED` has a pending retry; this one always does.
 */
export const UNSUPPORTED_TYPE = 'unsupported_type';

/**
 * One past the HIGHEST attempt number on record — not one past the COUNT.
 *
 * `unrecoveredBlocking` decides recovery by comparing `attemptN` values, so
 * whatever mints those numbers has to agree with it about what they mean.
 * Counting instead of maximising let any manifest whose numbers are sparse or
 * non-monotonic — a merge, a hand edit, a sentinel written with a fixed number
 * — mint a SUCCESS numbered below an earlier failure. The cell then held a
 * terminal DONE and real evidence while the invariant still reported it
 * `failed`: the manifest and the invariant contradicting each other, which is
 * the defect family this module exists to make impossible.
 */
export function highestAttemptNumber(cell) {
  return (cell?.attempts ?? []).reduce(
    (highest, attempt) => Math.max(highest, attempt.attemptN ?? 0),
    0,
  );
}

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
        // Every named child is PLANNED work, whether or not this record carried
        // its geometry. Planning it only from `childCells` made a child named in
        // `childIds` but missing from `childCells` invisible: `completeness`
        // skips unplanned cells, so it was neither outstanding nor finished nor
        // counted. Once such a child became waivable, acknowledging it let the
        // parent settle to 'cleared' and the whole run report COMPLETE with
        // `1/1 cells finished` — over a quadrant nobody had searched, and with
        // no trace of it in the summary. Reproduced end to end.
        //
        // Planned-without-geometry is the honest state: the invariant reports
        // it outstanding, `outstandingCells` still declines to offer it for
        // resume (it filters on `cell.cell`, which cannot be reconstructed), and
        // the operator's waiver is recorded and counted like any other.
        for (const childId of record.childIds ?? []) {
          ensure(childId, { planned: true, depth: parent.depth + 1, parentId: record.parentId });
        }
        for (const child of record.childCells ?? []) {
          const known = ensure(child.id, {
            planned: true,
            depth: child.depth ?? parent.depth + 1,
            parentId: record.parentId,
            cell: child,
          });
          // Overlay geometry when a later record supplies what an earlier one
          // omitted; `ensure` returns the existing cell rather than reseeding.
          known.planned = true;
          known.depth = child.depth ?? parent.depth + 1;
          known.parentId = record.parentId;
          known.cell = child;
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
 * Every status word that ends a cell's participation in the run — the whole
 * terminal vocabulary, in one place. The engine judges `processCell`'s RETURN
 * value against the same list it judges recorded cells against, because a
 * second copy of the vocabulary is a second chance for the two to disagree.
 */
export const TERMINAL_STATUSES = Object.freeze([...COMPLETING_STATUSES, SATURATED_AT_FLOOR]);

/** Is this status word a terminal claim at all? Operates on the WORD, not a cell. */
export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

/** The raw blocking-failure scan. `classify` is the only caller; use `Verdict.blocked`. */
function unrecoveredBlocking(cell) {
  const blocking = (cell?.attempts ?? []).filter(
    (attempt) => !attempt.ok && BLOCKING_ERROR_CLASSES.includes(attempt.errorClass),
  );
  if (blocking.length === 0) return false;
  const recoveredAt = cell.lastOk?.attemptN ?? -1;
  return blocking.some((attempt) => (attempt.attemptN ?? 0) > recoveredAt);
}

/**
 * @typedef {object} Verdict
 * @property {'unfinished'|'unbacked'|'floor'|'complete'} kind what this cell IS
 * @property {boolean} claimsFloor the DONE says `saturated_at_floor`, evidence or not
 * @property {boolean} hasEvidence a successful ATTEMPT is on record
 * @property {boolean} acknowledged an `ack_terminal` DONE with a real ACK_TERMINAL behind it
 * @property {boolean} blocked an unrecovered blocking failure
 * @property {boolean} completing may the run report this cell as done?
 * @property {boolean} terminal does it owe any further subdivision?
 * @property {boolean} settledForResume does a resume still owe it work?
 * @property {boolean} atFloor searched, and still capped at the minimum cell size
 * @property {string} why one line naming the reason for `kind`
 */

/**
 * Classify a cell ONCE. Every judge in this codebase is a view over this.
 *
 * This function exists because the judges used to be written out by hand, one
 * per question, and they drifted apart every single time the rules changed.
 * The engine, the completeness invariant, the summary printer and the waiver
 * check each decided "is this cell finished" from the raw `terminalStatus`
 * word, and each of the seven defects found in review was one of those copies
 * lagging the others: a forged `ack_terminal` that was finished to the engine
 * and outstanding to the invariant; an evidence-less `cleared` counted in
 * `summary.finished` while the same cell sat in `missing` in the same object; a
 * fabricated `saturated_at_floor` waived on the word alone and reported
 * COMPLETE over geography nobody had searched. Every one of those was a cell
 * two judges classified differently.
 *
 * So there is one classification, and disagreement is no longer expressible:
 *
 *   `unfinished` — no DONE, or a word that is not a terminal claim at all.
 *   `unbacked`   — a terminal claim with nothing behind it. A DONE is a CLAIM;
 *                  a successful ATTEMPT is the evidence. `ack_terminal` is the
 *                  one status legitimately unsupported by a search, and its
 *                  evidence is the operator's ACK_TERMINAL record instead.
 *   `floor`      — searched, and still capped at the minimum cell size. Finished
 *                  as work, knowably short as coverage: two different questions,
 *                  which is exactly why `terminal` and `completing` differ.
 *   `complete`   — a terminal claim with its evidence.
 *
 * `blocked` is orthogonal to `kind`: a cell can hold a real, evidenced terminal
 * status AND a blocking failure recorded after it. That is why `settledForResume`
 * is not `terminal` — the run still owes the retry, and nothing else can clear
 * it, since `ackEligibility` refuses to waive a transient class.
 */
export function classify(cell) {
  const status = cell?.terminalStatus ?? null;
  const hasEvidence = Boolean(cell?.lastOk);
  const acknowledged = status === 'ack_terminal' && Boolean(cell?.acked);

  let kind;
  let why;
  if (!cell || !isTerminalStatus(status)) {
    kind = 'unfinished';
    why = status === null ? 'no DONE record' : `'${status}' is not a terminal status`;
  } else if (status === 'ack_terminal') {
    // The one status a search cannot back. Its evidence is the operator's
    // explicit waiver record instead — and it must actually be there.
    kind = acknowledged ? 'complete' : 'unbacked';
    why = acknowledged
      ? 'acknowledged by the operator'
      : "claims 'ack_terminal' with no ACK_TERMINAL record behind it";
  } else if (!hasEvidence) {
    kind = 'unbacked';
    why = `claims '${status}' with no successful attempt behind it`;
  } else if (status === SATURATED_AT_FLOOR) {
    kind = 'floor';
    why = 'searched, and still saturated at the minimum cell size';
  } else {
    kind = 'complete';
    why = `'${status}', backed by a successful attempt`;
  }

  const terminal = kind === 'complete' || kind === 'floor';
  return Object.freeze({
    kind,
    // The raw word is deliberately NOT on this object. It was, briefly, as
    // "for messages, never for decisions" — but a decision object carrying the
    // exact word the old defects switched on is an invitation, and a naming
    // convention is advice, not structure. `why` carries the word for messages;
    // there is nothing here to branch on by accident.
    //
    // `claimsFloor` is the one place the CLAIM is separable from the fact, and
    // it is named so the difference is visible: `atFloor` means the cell IS at
    // the floor (claim AND evidence); `claimsFloor` means only that the DONE
    // says so. Exactly one caller needs the weaker one — see completeness
    // clause 2.
    claimsFloor: status === SATURATED_AT_FLOOR,
    hasEvidence,
    acknowledged,
    blocked: unrecoveredBlocking(cell),
    completing: kind === 'complete',
    terminal,
    settledForResume: terminal && !unrecoveredBlocking(cell),
    atFloor: kind === 'floor',
    why,
  });
}

/**
 * May the run report this cell as done? A view over `classify`.
 *
 * Note this is deliberately NOT `terminal`: a cell still capping at the floor
 * is finished as work and knowably short as coverage.
 */
export function isCompleting(cell) {
  return classify(cell).completing;
}

/**
 * Does this cell owe any further SUBDIVISION? A view over `classify`.
 *
 * This is the predicate `completeness` needs for "did this cell's children
 * finish", and it is deliberately NOT `isSettledForResume`: completeness must
 * not consult the blocking check here, because a blocked child is already
 * reported against ITSELF by clause 3.
 */
export function isTerminal(cell) {
  return classify(cell).terminal;
}

/** Does a resume still owe this cell work? A view over `classify`. */
export function isSettledForResume(cell) {
  return classify(cell).settledForResume;
}

/** An unrecovered blocking failure. A view over `classify`. */
export function hasUnrecoveredBlocking(cell) {
  return classify(cell).blocked;
}

/**
 * The completeness invariant. A run may claim "complete" only when this
 * returns complete:true — see AC6. Deliberately returns the offending cell ids
 * so the summary can say what is outstanding instead of just refusing.
 *
 * Every clause reads a `Verdict`, never a raw status word. The three buckets
 * are the three `kind`s that are not `complete`, so a cell cannot be finished
 * to this function and outstanding to the engine, or vice versa.
 */
export function completeness(state) {
  const missing = [];
  const failed = [];
  const saturated = [];
  const unclearedCap = [];

  for (const cell of state.cells.values()) {
    if (!cell.planned) continue;
    const verdict = classify(cell);

    // (1) every planned cell and every subdivision child reaches a terminal
    //     state. `floor` is terminal but not complete — recall is knowably
    //     short there, and only a floor claim WITH evidence means that; without
    //     a successful attempt the cell was never searched at all, and calling
    //     it saturated tells the operator the opposite of the truth.
    if (verdict.atFloor) saturated.push(cell.cellId);
    else if (!verdict.completing) missing.push(cell.cellId);

    // (2) a capped cell must have been subdivided, and its children finished.
    //     A child at the floor counts as finished here — its own
    //     SATURATED_AT_FLOOR entry is what blocks completion, so the residual
    //     is reported once, against the cell that has it.
    //     `claimsFloor`, not `atFloor`. This clause exempts anything claiming
    //     the floor, evidence or not — which is what the raw-word test it
    //     replaced did, and `unclearedCap` is part of the published report and
    //     the CLI diagnostic. Tightening it to `atFloor` would add unbacked
    //     floor claims to that array. Those cells are already reported by
    //     clause 1, so nothing is lost, and the shape cannot arise from a real
    //     manifest anyway: `replay` sets `capped` only inside the `record.ok`
    //     branch, so `capped` implies evidence. Reading the verdict rather than
    //     the word keeps the single source of truth; `claimsFloor` is how the
    //     verdict says "the DONE claims it" without asserting it is true.
    if (cell.capped && !verdict.claimsFloor) {
      const children = cell.children.map((id) => state.cells.get(id));
      const finishedByChildren = children.length > 0 && children.every(isTerminal);
      if (!finishedByChildren && !verdict.acknowledged) {
        unclearedCap.push(cell.cellId);
      }
    }

    // (3) no blocking error survives without a retry that worked, or an ack
    if (verdict.blocked && !verdict.acknowledged) {
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
      // The same `Verdict` the invariant judged by. The summary was the last
      // judge still reading the bare word, so an evidence-less DONE was counted
      // as finished while the same cell sat in `missing` in the same object —
      // and that object is what RUN_DONE persists for the operator.
      finished: plannedCells.filter(
        (cell) => classify(cell).completing && !outstandingIds.has(cell.cellId),
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
/** Every cell beneath this one, at any depth. `seen` guards a malformed cycle. */
function descendantIds(state, cellId, seen = new Set()) {
  const out = [];
  for (const childId of state?.cells?.get(cellId)?.children ?? []) {
    if (seen.has(childId)) continue;
    seen.add(childId);
    out.push(childId, ...descendantIds(state, childId, seen));
  }
  return out;
}

export function ackEligibility(state, cellId) {
  const cell = state?.cells?.get(cellId);
  if (!cell) return { eligible: false, reason: 'no such cell in this manifest' };
  const verdict = classify(cell);
  if (verdict.acknowledged) {
    return { eligible: false, reason: 'already acknowledged' };
  }
  // The same `Verdict` the engine resumes by. Testing raw status membership
  // here made this a THIRD judge with its own answer: a forged ack_terminal
  // child read as finished, the "acknowledge those children instead" refusal
  // went dead, and a parent could be waived while its child stayed outstanding.
  //
  // And it walks the whole SUBTREE, not one level. A waiver makes this cell
  // terminal, so the engine stops descending through it — anything unfinished
  // below is then orphaned, with no resume that will ever reach it. Checking
  // only direct children let a grandchild's unrecovered retry be waived away
  // by acknowledging its grandparent.
  const unfinishedChildren = descendantIds(state, cellId).filter(
    (descendantId) => !classify(state.cells.get(descendantId)).settledForResume,
  );
  if (unfinishedChildren.length > 0) {
    return {
      eligible: false,
      reason:
        // Both numbers count the same thing — the whole subtree. Reporting the
        // direct-child total beside a descendant count read as "1 of 4" for a
        // grandchild four levels down.
        `its subdivision is unfinished (${unfinishedChildren.length} of ${descendantIds(state, cellId).length} cells beneath it outstanding) — ` +
        'acknowledge those children instead, or resume to finish them',
    };
  }
  // A planned cell with no geometry can NEVER be attempted, so "never attempted"
  // is not a reason to refuse it — it is the reason it must be waivable. This
  // arises when a SUBDIVIDE names a childId but carries no `childCells` entry
  // for it: replay plans the child (otherwise it is invisible to the invariant
  // and a waiver of it silently completes the run), but no resume can offer it,
  // because `outstandingCells` rightly declines a cell it cannot reconstruct.
  //
  // The engine normally writes a MANIFEST_CORRUPT sentinel on the first resume,
  // which makes the cell waivable through the permanent-failure grant below.
  // But that only happens if the resume reaches `resumeChildren` — and it does
  // not when the PARENT is already acknowledged, because the waiver
  // short-circuit returns before descending. Reproduced: attempts 0, reported
  // `missing` forever, never offered by a resume, and the waiver refused as
  // never-attempted. Visible and unsatisfiable is not an improvement on
  // invisible; it needs the lever too.
  //
  // This sits ABOVE the never-attempted refusal and is deliberately narrow: a
  // cell planned from `PLAN.cells` always carries its geometry, so only a
  // subdivision child with a lost `childCells` entry can reach it.
  if (cell.planned && !cell.cell) {
    return {
      eligible: true,
      reason: 'its geometry is missing from the manifest, so no resume can reconstruct or search it',
    };
  }
  // The never-attempted refusal comes FIRST (after the case above). It used to
  // sit below the floor check, so a fabricated `saturated_at_floor` DONE was
  // waived on the word alone — granted with the reassuring reason "saturated at
  // the floor" — and the run then reported complete over a cell nobody had
  // searched. That is exactly what this guard's docstring promises cannot happen.
  if (cell.attempts.length === 0) {
    return { eligible: false, reason: 'it has never been attempted; run or resume the sweep first' };
  }
  // `verdict.atFloor`, which already demands the evidence. The never-attempted
  // guard above closes the zero-attempt forgery; the evidence half of `atFloor`
  // closes the attempted-and-FAILED one, where a fabricated floor DONE sat over
  // nothing but errors and was waived with the reassuring reason below —
  // reaching COMPLETE with no successful query ever made. It must stay ABOVE
  // the two refusals that follow: a real floor cell is legitimately waivable
  // whether its last attempt succeeded or later failed transiently, because at
  // the floor there is nothing left to subdivide and nothing for a retry to
  // reach.
  if (verdict.atFloor) {
    return { eligible: true, reason: 'saturated at the floor' };
  }
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
  // `unsupported_type` is not blocking and not permanent — it is the one class
  // the engine resolves WITHIN a run, by dropping the rejected type and
  // re-querying the same cell with what remains. It is only ever the LAST
  // attempt when the run ended between the drop and its retry, and a resume
  // rebuilds the type list and finishes the cell.
  //
  // It fell through to the grant below and was waived as "failed permanently",
  // which was factually wrong and discarded geography the very next resume
  // would have covered. Reproduced both halves: the waiver was granted, and a
  // resume of the same manifest reported complete. It is deliberately NOT added
  // to BLOCKING_ERROR_CLASSES — that would make `unrecoveredBlocking` true for
  // a condition resolved mid-run and put every drop-and-retry cell into
  // `failed`.
  if (last.errorClass === UNSUPPORTED_TYPE) {
    return {
      eligible: false,
      reason:
        'its last failure was a rejected includedType, which a resume retries with the ' +
        'remaining types — resume it rather than waiving geography that is still reachable',
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
