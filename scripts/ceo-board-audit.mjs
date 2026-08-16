// The board, convened on its own.
//
// scripts/ceo-board.mjs decides the verdict; this decides that the question gets ASKED. Until now
// the kill criterion was only ever evaluated as a side effect of running a weekly cycle, which
// means the one component with teeth could only bite if the operator was already engaged enough to
// run the loop — and the weeks nobody runs the loop are exactly the weeks the answer matters most.
// A deadline that only arrives if you look at it is not a deadline.
//
// Three refusals make this an audit rather than a status page:
//
//  1. THE DATE IS NOT THE AUDITOR'S TO CHOOSE. It comes from the operator-owned measurement
//     envelope. There is deliberately no --at flag: an auditor that can pick its own "as of" date
//     can always find one where the numbers look better, and would eventually be asked to.
//  2. STALE NUMBERS ARE REFUSED. An audit against a measurement from three months ago is not an
//     audit of anything. This is the one place a real clock is read, at the CLI boundary, purely to
//     ask how old the numbers are — never to decide the verdict.
//  3. AN AUDIT CANNOT BE RE-RUN UNTIL IT AGREES WITH YOU. The record is written with an exclusive
//     create, so a second audit for the same date refuses rather than overwrites.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VERDICTS, auditKill, isCalendarDate } from './ceo-board.mjs';
import { assertActionAllowed } from './ceo-guard.mjs';

export class CeoAuditAbort extends Error {
  constructor(message) {
    super(message);
    this.name = 'CeoAuditAbort';
  }
}

function abort(detail) {
  const message = `[ceo-board-audit] ${detail} Aborting.`;
  console.error(message);
  process.exit(1);
  throw new CeoAuditAbort(message);
}

/**
 * Exit codes, one per verdict.
 *
 * CONTINUE is the only zero. Everything else is meant to be noticed by whatever ran this — a cron
 * line, a CI step, a person skimming a terminal — because every other verdict is a decision the
 * operator owes an answer to.
 */
export const AUDIT_EXITS = Object.freeze({
  [VERDICTS.CONTINUE]: 0,
  [VERDICTS.UNMEASURABLE]: 6,
  [VERDICTS.RESCOPE]: 4,
  [VERDICTS.KILL]: 5,
});

/** Numbers older than this describe a different company. */
export const MAX_MEASUREMENT_AGE_DAYS = 30;

/** The audit cadence the operator committed to. Past this, the silence is itself the finding. */
export const AUDIT_INTERVAL_DAYS = 92;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two YYYY-MM-DD dates. Pure: both ends are supplied, neither is read. */
export function daysBetween(earlier, later) {
  const from = Date.parse(`${earlier}T00:00:00Z`);
  const to = Date.parse(`${later}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / DAY_MS);
}

const AUDIT_FILE = /^(\d{4}-\d{2}-\d{2})-([A-Z]+)\.md$/;

/**
 * When the board last sat, and what it said.
 *
 * Read from the filenames rather than an index, so the record cannot disagree with itself. A
 * directory of audits IS the register.
 */
export function previousAudits(auditsDir) {
  let entries;
  try {
    entries = readdirSync(auditsDir);
  } catch {
    return [];
  }
  return entries
    .map((name) => AUDIT_FILE.exec(name))
    .filter((match) => match !== null)
    .map((match) => ({ at: match[1], verdict: match[2], file: match[0] }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

function line(label, value) {
  return `- **${label}:** ${value}`;
}

function days(count) {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

/** The audit record. Short on purpose — a verdict nobody reads is a verdict nobody acts on. */
export function renderAudit(board, { state, sinceLast, measurementAgeDays, overdue }) {
  const { users, venues } = board.sides;
  const readable = (side) => (side.measurable ? side.value : 'UNMEASURED');

  return [
    `# Board audit ${board.at} — ${board.verdict}`,
    '',
    board.detail,
    '',
    '## The criterion, as written in advance',
    '',
    line('Deadline', board.deadline),
    line(
      'Users side',
      `${readable(users)} / ${users.threshold} weekly-active in one neighbourhood — ${users.failed ? 'FAILED' : 'passed'}`,
    ),
    line(
      'Venues side',
      `${readable(venues)} / ${venues.threshold} self-maintaining — ${venues.failed ? 'FAILED' : 'passed'}`,
    ),
    '',
    '## Provenance',
    '',
    line('Numbers counted', `${board.at} (${days(measurementAgeDays)} ago)`),
    line('Cycle on record', String(state.cycle)),
    line(
      'Previous audit',
      sinceLast === null
        ? 'none — this is the first'
        : `${sinceLast.at} (${days(sinceLast.days)} ago, said ${sinceLast.verdict})`,
    ),
    ...(overdue
      ? ['', `> **OVERDUE.** More than ${AUDIT_INTERVAL_DAYS} days since the last audit. The gap is itself a finding.`]
      : []),
    '',
    '## What is owed',
    '',
    board.remedy ?? 'Nothing. The numbers cleared the bar the operator set in advance.',
    '',
    '---',
    '',
    'Written by scripts/ceo-board-audit.mjs. The date came from the operator-owned measurement',
    'envelope, not from this program. This file was created exclusively: a second audit for the same',
    'date refuses rather than overwrites, because an audit you can re-run until it agrees with you is',
    'not an audit.',
    '',
  ].join('\n');
}

/**
 * Convene the board.
 *
 * `now` is injected (the CLI supplies the real clock) and is used ONLY to ask how old the numbers
 * are. It never reaches the verdict: that comes from the measurement's own date, compared against
 * the deadline the operator wrote down.
 */
export function runAudit({ state, measurement, auditsDir, now }) {
  assertActionAllowed({ capability: 'RESEARCH', action: 'read_metrics' });

  if (!Number.isFinite(now)) {
    abort('an audit needs a real clock to judge how old the numbers are.');
  }
  const at = measurement?.at;
  if (!isCalendarDate(at)) {
    abort(
      `the measurement carries no usable date (got ${JSON.stringify(at ?? null)}). The audit date ` +
        'comes from the measurement envelope and nowhere else — there is no flag for it on purpose.',
    );
  }

  const today = new Date(now).toISOString().slice(0, 10);
  const measurementAgeDays = daysBetween(at, today);

  if (measurementAgeDays !== null && measurementAgeDays > MAX_MEASUREMENT_AGE_DAYS) {
    abort(
      `the numbers are ${measurementAgeDays} days old (limit ${MAX_MEASUREMENT_AGE_DAYS}). An audit ` +
        'against a stale measurement is an audit of a company that no longer exists. Count this ' +
        "month's numbers into the measurement file, then convene the board.",
    );
  }
  if (measurementAgeDays !== null && measurementAgeDays < 0) {
    abort(`the measurement is dated ${at}, which is in the future relative to ${today}.`);
  }

  assertActionAllowed({ capability: 'RESEARCH', action: 'run_analysis' });
  const board = auditKill(state, { at });

  const history = previousAudits(auditsDir);
  const last = history[history.length - 1] ?? null;
  const sinceLast =
    last === null ? null : { at: last.at, verdict: last.verdict, days: daysBetween(last.at, at) };
  const overdue = sinceLast !== null && sinceLast.days !== null && sinceLast.days > AUDIT_INTERVAL_DAYS;

  const report = renderAudit(board, { state, sinceLast, measurementAgeDays, overdue });
  const file = path.join(auditsDir, `${at}-${board.verdict}.md`);

  assertActionAllowed({ capability: 'MUTATE_BRANCH', action: 'write_repo_file', branch: 'audit' });
  mkdirSync(auditsDir, { recursive: true });

  // Exclusive create. Not a convenience check — the whole point is that today's verdict cannot be
  // quietly replaced by a nicer one after somebody edits the numbers.
  const alreadyAudited = history.find((entry) => entry.at === at);
  if (alreadyAudited !== undefined || existsSync(file)) {
    abort(
      `${at} has already been audited (${alreadyAudited?.file ?? path.basename(file)}). An audit is ` +
        'not re-runnable: re-auditing the same numbers until the verdict changes is the failure this ' +
        'whole file exists to prevent. To audit again, count new numbers under a new date.',
    );
  }

  try {
    writeFileSync(file, report, { encoding: 'utf8', flag: 'wx', flush: true });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      abort(`${at} has already been audited (${path.basename(file)}).`);
    }
    throw error;
  }

  return { board, report, file, sinceLast, overdue, measurementAgeDays };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/ceo-board-audit.mjs [options]

  --state <path>        CEO state to read     (default ceo/state.json)
  --measurement <path>  OPERATOR-owned counts (default ceo/measurements/latest.json)
  --audits <dir>        where verdicts are recorded (default ceo/audits)

There is deliberately no --at flag. The audit date comes from the measurement envelope, because an
auditor that can choose its own "as of" date can always find one where the numbers look better.

Exit codes: 0 CONTINUE · 4 RESCOPE · 5 KILL · 6 UNMEASURABLE · 1 refused.`;

function parseArgs(argv) {
  const options = {
    state: 'ceo/state.json',
    measurement: 'ceo/measurements/latest.json',
    audits: 'ceo/audits',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    const key = flag.replace(/^--/, '');
    if (!flag.startsWith('--') || !Object.hasOwn(options, key)) {
      abort(`unknown argument ${JSON.stringify(flag)}.\n${USAGE}`);
    }
    index += 1;
    if (index >= argv.length) abort(`${flag} requires a value.`);
    options[key] = argv[index];
  }

  return options;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    abort(`could not read ${label} at ${filePath}: ${error.message}`);
  }
}

function main(argv) {
  const options = parseArgs(argv);
  const state = readJson(options.state, 'state');
  const envelope = readJson(options.measurement, 'measurement');

  const result = runAudit({
    state,
    measurement: envelope.measurement,
    auditsDir: options.audits,
    now: Date.now(),
  });

  console.log(result.report);
  console.log(`recorded: ${result.file}`);
  process.exit(AUDIT_EXITS[result.board.verdict] ?? 1);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && entrypoint.endsWith('ceo-board-audit.mjs')) {
  main(process.argv.slice(2));
}
