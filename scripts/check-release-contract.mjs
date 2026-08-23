/**
 * check-release-contract.mjs — deterministic admission gate for a release
 * traceability ledger.
 *
 * WHY. The design-to-PRD contract lists admission failures that are supposed to
 * stop goal creation and implementation. Until now nothing enforced them: the
 * skill is prose, the handoffs are prose, and a reviewer reading either can
 * agree a ledger is fine while a required field is empty or a digest has moved
 * underneath it. This is the mechanical half. It reads the ledger as DATA and
 * never executes anything from it.
 *
 * No existing validator covered this. `scripts/check-migration-ledger.ts` is the
 * migration ledger and is unrelated; its exit-code convention is reused here on
 * purpose so both guards read the same way.
 *
 * EXIT CODES — the distinction matters, so they are not all "1":
 *   0  every check passed
 *   1  at least one admission failure — the ledger must not authorize work
 *   2  COULD NOT VERIFY — the ledger or decision record was unreadable or
 *      unparseable. Never a silent pass: a guard that greens when it cannot see
 *      is the exact failure mode this repository has already paid for.
 *
 * Usage:
 *   node scripts/check-release-contract.mjs [ledger.json] [--artifact-root <dir>]
 *
 * `--artifact-root` is where declared paths are resolved for digest checking.
 * It defaults to the ledger's own repository root. CI can point it at a trusted
 * checkout so the code that RUNS is not the code under review.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const OK = 0;
const VIOLATION = 1;
const COULD_NOT_VERIFY = 2;

const STATUS = new Set(['approved', 'deferred', 'blocked', 'superseded']);
const COVERAGE = new Set(['complete', 'partial', 'missing', 'contradicted', 'duplicated', 'stale']);

/** Keys every requirement row must carry AND fill. */
const REQUIRED_FILLED = [
  'requirement_id', 'title', 'sources', 'actor', 'entry_point',
  'behavior', 'states', 'audience', 'status', 'coverage', 'decision_ref',
];

/**
 * Keys every row must CARRY, but which the contract says apply only "when
 * applicable" — so null is a legitimate, auditable answer and an absent key is
 * not. The distinction is the point: null means someone decided it does not
 * apply; missing means nobody looked.
 */
const REQUIRED_PRESENT = [
  'trust_boundary', 'data_owner', 'retention', 'failure_recovery', 'accessibility',
  'exclusions', 'blocked_on', 'goal_ids', 'acceptance_refs', 'implementation_paths', 'evidence',
];

const REQ_ID = /V8-R-[A-Z]+-\d{3}/g;
const OPEN_DECISION = /^D-O-/;
const DECISION_ID = /\bD-[CO]-\d{2}\b/g;

/**
 * Text files are hashed with CRLF folded to LF; binary files are hashed raw.
 *
 * WHY, and it is not cosmetic: this repository runs on Windows with
 * `core.autocrlf`, so a committed `.md` arrives in the working tree with CRLF
 * line endings while its git blob holds LF. Hashing the working-tree bytes
 * therefore reports drift for EVERY multi-line text file, on every checkout,
 * forever — which is exactly the reading that produced a false eleven-file
 * migration-drift claim on 2026-08-16 (see CLAUDE.md, "Do not re-derive that
 * claim by hashing raw bytes"). A guard that cries drift every run teaches
 * people to ignore it, so the digest a ledger records is the LF-normalised one
 * and matches `git show <ref>:<path> | sha256sum`.
 *
 * PNGs and other binaries are hashed byte-for-byte: folding CR LF pairs inside
 * compressed image data would corrupt the very identity being checked.
 */
const TEXT_FILE = /\.(md|json|txt|ts|tsx|js|mjs|cjs|sql|ya?ml)$/i;

export function digestOf(path, buf) {
  const bytes = TEXT_FILE.test(path)
    ? Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
    : buf;
  return createHash('sha256').update(bytes).digest('hex');
}

const isEmpty = (v) =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0);

/**
 * The whole check, as a pure function over already-read text. Kept free of
 * process state and of `readFileSync` for everything except the artifact digests,
 * which are the one genuinely I/O-bound check — so the interesting logic is
 * testable against fixture strings without a repository.
 *
 * @param ledger      parsed ledger object
 * @param decisionMd  the decision record's text, for resolving D- ids
 * @param readFile    (relPath) => Buffer | null — null means "not present"
 * @returns {{code:string, where:string, detail:string}[]}
 */
export function checkContract(ledger, decisionMd, readFile) {
  const findings = [];
  const fail = (code, where, detail) => findings.push({ code, where, detail });

  const requirements = Array.isArray(ledger.requirements) ? ledger.requirements : [];
  if (requirements.length === 0) {
    fail('NO_REQUIREMENTS', 'ledger', 'the ledger declares no requirement rows');
  }

  // --- release-level fields -------------------------------------------------
  for (const key of ['release_id', 'prd_path', 'prd_version', 'prd_sha256', 'decision_record_path', 'ledger_version']) {
    if (isEmpty(ledger[key])) fail('MISSING_FIELD', `ledger.${key}`, 'required release-level field is empty');
  }

  // --- decision ids that actually exist in the decision record --------------
  const knownDecisions = new Set(String(decisionMd).match(DECISION_ID) ?? []);
  if (knownDecisions.size === 0) {
    fail('NO_DECISIONS', ledger.decision_record_path ?? 'decision record', 'no D-C-/D-O- ids found; the decision record is empty or the wrong file');
  }

  // --- requirement identity -------------------------------------------------
  const byId = new Map();
  const byTitle = new Map();
  for (const r of requirements) {
    const id = r.requirement_id;
    if (byId.has(id)) fail('DUPLICATE_ID', id, 'two requirement rows share one requirement_id');
    byId.set(id, r);
    const t = String(r.title ?? '').trim().toLowerCase();
    if (t && byTitle.has(t)) {
      fail('DUPLICATE_OWNERSHIP', id, `duplicate requirement identity — same title as ${byTitle.get(t)}`);
    }
    if (t) byTitle.set(t, id);
  }

  // --- per-row checks -------------------------------------------------------
  for (const r of requirements) {
    const id = r.requirement_id ?? '(unnamed row)';

    for (const key of REQUIRED_FILLED) {
      if (isEmpty(r[key])) fail('MISSING_FIELD', `${id}.${key}`, 'required field is empty');
    }
    for (const key of REQUIRED_PRESENT) {
      if (!(key in r)) fail('MISSING_FIELD', `${id}.${key}`, 'required key is absent (null is allowed; missing is not)');
    }

    if (r.status !== undefined && !STATUS.has(r.status)) {
      fail('BAD_STATUS', id, `status "${r.status}" is not approved|deferred|blocked|superseded`);
    }
    if (r.coverage !== undefined && !COVERAGE.has(r.coverage)) {
      fail('BAD_COVERAGE', id, `coverage "${r.coverage}" is not complete|partial|missing|contradicted|duplicated|stale`);
    }

    // The admission failure this exists for: a requirement that hangs on an
    // unresolved owner decision must never read as approved.
    if (typeof r.blocked_on === 'string' && OPEN_DECISION.test(r.blocked_on) && r.status !== 'blocked') {
      fail('UNRESOLVED_MARKED_APPROVED', id, `depends on open decision ${r.blocked_on} but status is "${r.status}"`);
    }

    // Every deferral and supersession needs an owner citation.
    if ((r.status === 'deferred' || r.status === 'superseded') && isEmpty(r.decision_ref)) {
      fail('UNCITED_STATUS', id, `status "${r.status}" without an owner-decision citation`);
    }

    // Decision ids must resolve to the decision record.
    for (const field of ['decision_ref', 'blocked_on']) {
      const v = r[field];
      if (typeof v !== 'string') continue;
      for (const d of v.match(DECISION_ID) ?? []) {
        if (!knownDecisions.has(d)) fail('UNKNOWN_DECISION', `${id}.${field}`, `${d} is not in the decision record`);
      }
    }

    // Any V8-R- token mentioned anywhere in the row must be a real requirement.
    for (const token of JSON.stringify(r).match(REQ_ID) ?? []) {
      if (!byId.has(token)) fail('UNKNOWN_REQUIREMENT_ID', id, `references ${token}, which no row defines`);
    }
  }

  // Cross-file: requirement ids named by the PRD delta / decision record.
  for (const token of String(decisionMd).match(REQ_ID) ?? []) {
    if (!byId.has(token)) fail('UNKNOWN_REQUIREMENT_ID', ledger.decision_record_path, `decision record references ${token}, which no row defines`);
  }

  // --- every approved artifact needs at least one requirement row -----------
  const artifacts = Array.isArray(ledger.approved_artifacts) ? ledger.approved_artifacts : [];
  if (artifacts.length === 0) fail('NO_ARTIFACTS', 'ledger.approved_artifacts', 'no approved artifacts declared');
  const cited = new Set();
  for (const r of requirements) for (const s of r.sources ?? []) {
    if (typeof s === 'string' && s.startsWith('design:')) cited.add(s.slice('design:'.length));
  }
  for (const a of artifacts) {
    if (!cited.has(a.id)) fail('ARTIFACT_WITHOUT_REQUIREMENT', a.id, 'approved artifact has no requirement rows');
    for (const key of ['path', 'sha256', 'approval_scope', 'approver', 'approved_on']) {
      if (isEmpty(a[key])) fail('MISSING_FIELD', `artifact ${a.id}.${key}`, 'required artifact field is empty');
    }
    if (!['visual', 'capability', 'both'].includes(a.approval_scope)) {
      fail('BAD_SCOPE', a.id, `approval_scope "${a.approval_scope}" is not visual|capability|both`);
    }
  }

  // --- digest drift ---------------------------------------------------------
  const digestTargets = [
    { label: 'PRD', path: ledger.prd_path, sha256: ledger.prd_sha256 },
    ...artifacts.map((a) => ({ label: a.id, path: a.path, sha256: a.sha256 })),
  ];
  for (const t of digestTargets) {
    if (!t.path) continue;
    const buf = readFile(t.path);
    if (buf === null) {
      fail('ABSENT', t.path, `${t.label} is declared by the ledger but not present under the artifact root`);
      continue;
    }
    const actual = digestOf(t.path, buf);
    if (actual !== t.sha256) {
      fail('DIGEST_DRIFT', t.path, `${t.label} recorded ${t.sha256}, actual ${actual}`);
    }
  }

  return findings;
}

// --- I/O half ---------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const rootFlag = args.indexOf('--artifact-root');
  const artifactRootArg = rootFlag === -1 ? null : args[rootFlag + 1];
  const ledgerPath = resolve(args.find((a) => !a.startsWith('--') && a !== artifactRootArg) ?? 'docs/V8-TRACEABILITY-LEDGER.json');

  let ledger;
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch (err) {
    console.error(`COULD NOT VERIFY: ${ledgerPath} is unreadable or not JSON — ${err.message}`);
    return COULD_NOT_VERIFY;
  }

  // Two roots on purpose, and they are not the same thing.
  //
  // The CONTRACT root is where the ledger itself lives — its decision record is
  // a sibling document and always travels with it.
  //
  // The ARTIFACT root is where declared paths are resolved for digest checking,
  // and it is separately overridable so the contract can be checked against a
  // different checkout: the integration base, a release candidate, or in CI a
  // trusted tree, so the code that RUNS is not the tree under review.
  const contractRoot = resolve(join(dirname(ledgerPath), '..'));
  const artifactRoot = resolve(artifactRootArg ?? contractRoot);

  let decisionMd;
  try {
    decisionMd = readFileSync(join(contractRoot, ledger.decision_record_path), 'utf8');
  } catch (err) {
    console.error(`COULD NOT VERIFY: decision record ${ledger.decision_record_path} is unreadable — ${err.message}`);
    return COULD_NOT_VERIFY;
  }

  const readFile = (rel) => {
    const abs = join(artifactRoot, rel);
    return existsSync(abs) ? readFileSync(abs) : null;
  };

  const findings = checkContract(ledger, decisionMd, readFile);

  const reqs = ledger.requirements ?? [];
  const tally = (key) => reqs.reduce((acc, r) => (acc[r[key]] = (acc[r[key]] ?? 0) + 1, acc), {});
  console.log(`release       ${ledger.release_id}   ledger ${ledger.ledger_version} (${ledger.ledger_status})`);
  console.log(`artifact root ${artifactRoot}`);
  console.log(`requirements  ${reqs.length}`);
  console.log(`  by status   ${JSON.stringify(tally('status'))}`);
  console.log(`  by coverage ${JSON.stringify(tally('coverage'))}`);

  if (findings.length === 0) {
    console.log('\nRELEASE CONTRACT OK — every admission check passed.');
    return OK;
  }

  const byCode = findings.reduce((acc, f) => (acc[f.code] = (acc[f.code] ?? 0) + 1, acc), {});
  console.error(`\n${findings.length} admission failure(s): ${JSON.stringify(byCode)}\n`);
  for (const f of findings) console.error(`  [${f.code}] ${f.where}\n      ${f.detail}`);
  console.error('\nThis ledger does not authorize goal creation or implementation.');
  return VIOLATION;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('check-release-contract.mjs')) {
  process.exit(main(process.argv));
}
