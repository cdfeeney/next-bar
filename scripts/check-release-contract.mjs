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
 * WHAT IT BINDS. The whole contract, by SHA-256: the authoritative PRD, the
 * versioned delta, the decision record, the design-reference README, and the
 * EXACT 16-artifact approved manifest — no missing file, no extra file in the
 * directory, no duplicate id, path or digest. A file cannot contain its own
 * digest, so the ledger's is emitted on every run and recorded with the
 * founder's approval.
 *
 * SELF-CONTAINED OR NOT AT ALL. `--artifact-root` exists so CI can check the
 * contract against another checkout, but a ledger that only passes with an
 * override is NOT integration-ready, and the report says so in those words.
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
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const OK = 0;
const VIOLATION = 1;
const COULD_NOT_VERIFY = 2;

const STATUS = new Set(['approved', 'deferred', 'blocked', 'superseded']);
const COVERAGE = new Set(['complete', 'partial', 'missing', 'contradicted', 'duplicated', 'stale']);
const KIND = new Set(['action', 'policy']);

/** Keys every requirement row must carry AND fill. */
const REQUIRED_FILLED = [
  'requirement_id', 'kind', 'title', 'sources', 'actor', 'entry_point',
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
/** Confirmed (D-C-nn), pending founder approval (D-P-nn), or a revision-1 open id (D-O-nn). */
const DECISION_ID = /\bD-[CPO]-\d{2}\b/g;

const TEXT_FILE = /\.(md|json|txt|ts|tsx|js|mjs|cjs|sql|ya?ml)$/i;

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
 * The whole check, as a pure function over already-read data. Kept free of
 * process state so every rule is testable against fixtures without a repository.
 *
 * @param ledger      parsed ledger object
 * @param decisionMd  the decision record's text, for resolving D- ids
 * @param readFile    (relPath) => Buffer | null — null means "not present"
 * @param listDir     (relPath) => string[] | null — directory entries, for extra-file detection
 * @returns {{code:string, where:string, detail:string}[]}
 */
export function checkContract(ledger, decisionMd, readFile, listDir = () => null) {
  const findings = [];
  const fail = (code, where, detail) => findings.push({ code, where, detail });

  const requirements = Array.isArray(ledger.requirements) ? ledger.requirements : [];
  if (requirements.length === 0) {
    fail('NO_REQUIREMENTS', 'ledger', 'the ledger declares no requirement rows');
  }

  // --- release-level fields -------------------------------------------------
  for (const key of ['release_id', 'ledger_version']) {
    if (isEmpty(ledger[key])) fail('MISSING_FIELD', `ledger.${key}`, 'required release-level field is empty');
  }

  // --- the frozen contract, bound by digest --------------------------------
  const contract = ledger.contract ?? {};
  const CONTRACT_PARTS = ['prd', 'delta', 'decision_record', 'design_reference_readme', 'validator', 'validator_test'];
  for (const part of CONTRACT_PARTS) {
    const entry = contract[part];
    if (!entry || isEmpty(entry.path) || isEmpty(entry.sha256)) {
      fail('MISSING_FIELD', `ledger.contract.${part}`, 'the contract must bind this part by path and sha256');
      continue;
    }
    const buf = readFile(entry.path);
    if (buf === null) {
      fail('ABSENT', entry.path, `contract part "${part}" is declared but not present under the artifact root`);
      continue;
    }
    const actual = digestOf(entry.path, buf);
    if (actual !== entry.sha256) {
      fail('DIGEST_DRIFT', entry.path, `contract part "${part}" recorded ${entry.sha256}, actual ${actual}`);
    }
  }
  // --- an approved ledger may not bind a document that still says DRAFT ------
  //
  // The defect this closes: the ledger read `founder-approved` while the PRD delta it binds
  // still declared `Status: **DRAFT** pending final founder approval`. Every digest matched, so
  // the contract passed — and the approval status of the release depended on which of the two
  // files a reader happened to open.
  //
  // Deliberately NOT a prose parser. It reads exactly one line per document — the first line
  // beginning `Status:` — because "draft" appears legitimately elsewhere in these documents as
  // PRODUCT content (the superseded Map draft-filter state). Grepping the whole file would
  // reject the contract for describing a feature.
  const APPROVED_LEDGER_STATUS = new Set(['founder-approved', 'frozen']);
  if (APPROVED_LEDGER_STATUS.has(ledger.ledger_status)) {
    if (ledger.last_owner_approval == null) {
      fail('DRAFT_BOUND_ARTIFACT', 'ledger.last_owner_approval', `ledger_status is "${ledger.ledger_status}" but last_owner_approval is null — an approved ledger must record who approved it and when`);
    }
    // The authoritative narrative documents. The README is an approval record for the design
    // package rather than a status-bearing contract document, so it is not required to declare one.
    for (const part of ['decision_record', 'delta']) {
      const path = contract[part]?.path;
      const buf = path ? readFile(path) : null;
      if (buf === null) continue; // already reported as MISSING_FIELD or ABSENT above
      const status = buf.toString('utf8').split(/\r?\n/).find((line) => line.startsWith('Status:'));
      if (status === undefined) {
        fail('DRAFT_BOUND_ARTIFACT', path, `bound ${part} declares no "Status:" line, so its approval state cannot be read while the ledger claims "${ledger.ledger_status}"`);
      } else if (/\bDRAFT\b/i.test(status)) {
        fail('DRAFT_BOUND_ARTIFACT', path, `bound ${part} still declares itself DRAFT while the ledger claims "${ledger.ledger_status}" — ${status.trim()}`);
      } else if (!/FOUNDER-APPROVED/i.test(status)) {
        fail('DRAFT_BOUND_ARTIFACT', path, `bound ${part} does not declare founder approval while the ledger claims "${ledger.ledger_status}" — ${status.trim()}`);
      }
    }
  }

  // --- decision ids that actually exist in the decision record --------------
  const knownDecisions = new Set(String(decisionMd).match(DECISION_ID) ?? []);
  if (knownDecisions.size === 0) {
    fail('NO_DECISIONS', contract.decision_record?.path ?? 'decision record', 'no D-C-/D-P-/D-O- ids found; the decision record is empty or the wrong file');
  }

  // Every open decision the ledger lists must exist in the decision record.
  const openDecisions = new Set();
  for (const open of ledger.open_decisions ?? []) {
    openDecisions.add(open.id);
    if (!knownDecisions.has(open.id)) {
      fail('UNKNOWN_DECISION', `ledger.open_decisions.${open.id}`, `${open.id} is not in the decision record`);
    }
  }

  // --- the exact 16-artifact manifest --------------------------------------
  const artifacts = Array.isArray(ledger.approved_artifacts) ? ledger.approved_artifacts : [];
  const manifest = ledger.approved_artifact_manifest ?? {};
  const expected = manifest.expected_count;

  if (typeof expected !== 'number') {
    fail('MISSING_FIELD', 'ledger.approved_artifact_manifest.expected_count', 'the manifest must state its exact expected count');
  } else if (artifacts.length !== expected) {
    fail('MANIFEST_COUNT', 'ledger.approved_artifacts', `manifest expects exactly ${expected} artifacts, the ledger declares ${artifacts.length}`);
  }

  const seenId = new Map();
  const seenPath = new Map();
  const seenDigest = new Map();
  for (const a of artifacts) {
    for (const key of ['id', 'path', 'sha256', 'approval_scope', 'approver', 'approved_on']) {
      if (isEmpty(a[key])) fail('MISSING_FIELD', `artifact ${a.id ?? '(unnamed)'}.${key}`, 'required artifact field is empty');
    }
    if (!['visual', 'capability', 'both'].includes(a.approval_scope)) {
      fail('BAD_SCOPE', a.id, `approval_scope "${a.approval_scope}" is not visual|capability|both`);
    }
    if (seenId.has(a.id)) fail('DUPLICATE_ARTIFACT_ID', a.id, 'two manifest entries share one id');
    seenId.set(a.id, true);
    if (seenPath.has(a.path)) fail('DUPLICATE_ARTIFACT_PATH', a.path, `also claimed by ${seenPath.get(a.path)}`);
    seenPath.set(a.path, a.id);
    if (seenDigest.has(a.sha256)) {
      fail('DUPLICATE_ARTIFACT_DIGEST', a.id, `byte-identical to ${seenDigest.get(a.sha256)} — two manifest entries cannot be the same file`);
    }
    seenDigest.set(a.sha256, a.id);

    // A stale in-canvas banner is only tolerable when an owner decision supersedes it.
    if (!isEmpty(a.stale_in_canvas_banner) && isEmpty(a.banner_superseded_by)) {
      fail('UNCITED_BANNER', a.id, `carries the in-canvas banner "${a.stale_in_canvas_banner}" with no superseding decision`);
    }

    const buf = readFile(a.path);
    if (buf === null) {
      fail('ABSENT', a.path, `${a.id} is declared by the manifest but not present under the artifact root`);
      continue;
    }
    const actual = digestOf(a.path, buf);
    if (actual !== a.sha256) fail('DIGEST_DRIFT', a.path, `${a.id} recorded ${a.sha256}, actual ${actual}`);
  }

  // An EXTRA file in the approved directory is an unmanifested approved artifact.
  if (manifest.directory) {
    const entries = listDir(manifest.directory);
    if (entries === null) {
      fail('ABSENT', manifest.directory, 'the approved-artifact directory is not present under the artifact root');
    } else {
      for (const name of entries.filter((n) => n.toLowerCase().endsWith('.png'))) {
        const rel = `${manifest.directory}/${name}`;
        if (!seenPath.has(rel)) {
          fail('EXTRA_ARTIFACT', rel, 'present in the approved directory but absent from the manifest');
        }
      }
    }
  }

  // --- an approved ledger may not describe a settled decision as still open --
  //
  // The defect this closes: V8-R-STO-016 said "D-C-33 must settle" deletion and V8-R-CMP-003
  // said it was "not yet decided", while D-C-33 had already settled both. Every digest matched,
  // open_decisions was empty, and the contract still passed — so an implementer reading either
  // row would have believed the semantics were open.
  //
  // Deliberately narrow. It matches DECISION-STATUS phrases only. "is open" is excluded on
  // purpose: it is product vocabulary here (a sheet is open, voting is open), and banning it
  // would reject the contract for describing a feature — the same lesson as the DRAFT rule.
  const STALE_DECISION = /\b(?:must settle|not yet decided|undecided|to be decided|still open for decision)\b/i;
  const NARRATIVE_FIELDS = ['behavior', 'failure_recovery', 'retention', 'trust_boundary', 'audience', 'data_owner', 'accessibility'];
  if (APPROVED_LEDGER_STATUS.has(ledger.ledger_status)) {
    for (const r of requirements) {
      for (const field of NARRATIVE_FIELDS) {
        const v = r[field];
        if (typeof v !== 'string') continue;
        const hit = v.match(STALE_DECISION);
        if (hit) {
          fail('STALE_DECISION_LANGUAGE', `${r.requirement_id}.${field}`, `describes a decision as unsettled ("${hit[0]}") in a "${ledger.ledger_status}" ledger with ${openDecisions.size} open decision(s)`);
        }
      }
    }
  }

  // --- the approval must actually cover the contract it is stamped on -------
  //
  // The defect this closes: contract 3.1.0 added D-C-37, D-C-38 and D-C-39, but
  // last_owner_approval still listed only D-C-19 and D-C-29..36, named no contract version, and
  // bound the 3.0.0-era commit and ledger. Every digest matched, no binding was pending, and the
  // contract passed — so a founder-approved contract carried three decisions nobody had approved.
  //
  // The validator and its own test are deliberately EXCLUDED from the identity equality below.
  // An approval that authorizes a validator repair necessarily changes their digests after it is
  // stamped; the identity records what was acknowledged, and `contract.validator*` carries the
  // current value. That carve-out is written down here rather than left implicit.
  if (APPROVED_LEDGER_STATUS.has(ledger.ledger_status) && ledger.last_owner_approval != null) {
    const appr = ledger.last_owner_approval;
    const scope = new Set(appr.decisions_approved ?? []);
    const scopeIds = new Set([...scope].map((s) => String(s).match(/D-[CPO]-\d{2}/)?.[0]).filter(Boolean));

    for (const b of ledger.product_bindings ?? []) {
      if (b.status !== 'resolved' || !b.decision_id) continue;
      if (!scopeIds.has(b.decision_id)) {
        fail('STALE_APPROVAL_SCOPE', `ledger.product_bindings.${b.id}`, `resolves to ${b.decision_id}, which is absent from last_owner_approval.decisions_approved — the approval does not cover this binding`);
      }
    }

    const approvedVersion = appr.contract_version ?? appr.approved_contract_identity?.contract_version;
    if (!approvedVersion) {
      fail('STALE_APPROVAL_SCOPE', 'ledger.last_owner_approval.contract_version', `names no contract version while the ledger is "${ledger.ledger_version}"`);
    } else if (approvedVersion !== ledger.ledger_version) {
      fail('STALE_APPROVAL_SCOPE', 'ledger.last_owner_approval.contract_version', `approves contract version "${approvedVersion}" but the ledger is "${ledger.ledger_version}" — an older approval cannot cover a newer contract`);
    }

    const identity = appr.approved_contract_identity ?? {};
    const BOUND = [
      ['prd_sha256', 'prd'],
      ['delta_sha256', 'delta'],
      ['decision_record_sha256', 'decision_record'],
      ['design_reference_readme_sha256', 'design_reference_readme'],
    ];
    for (const [identityKey, contractKey] of BOUND) {
      const declared = identity[identityKey];
      const current = contract[contractKey]?.sha256;
      if (!declared) {
        fail('STALE_APPROVAL_SCOPE', `ledger.last_owner_approval.approved_contract_identity.${identityKey}`, `does not bind the ${contractKey}, so the approval identity is incomplete`);
      } else if (current && declared !== current) {
        fail('STALE_APPROVAL_SCOPE', `ledger.last_owner_approval.approved_contract_identity.${identityKey}`, `binds ${declared} but the contract's ${contractKey} is ${current} — the approval identity does not match the contract it is stamped on`);
      }
    }
  }

  // --- every product binding must be resolved before approval ---------------
  //
  // The companion defect: three product bindings sat "PENDING FOUNDER CONFIRMATION" in the plan
  // while the contract read approved. A binding is either resolved and carried by a decision id,
  // or the contract is not approved.
  for (const b of ledger.product_bindings ?? []) {
    if (isEmpty(b.id) || isEmpty(b.status)) {
      fail('UNRESOLVED_BINDING', `ledger.product_bindings.${b.id ?? '(unnamed)'}`, 'a product binding must carry an id and a status');
      continue;
    }
    if (APPROVED_LEDGER_STATUS.has(ledger.ledger_status) && b.status !== 'resolved') {
      fail('UNRESOLVED_BINDING', b.id, `is "${b.status}" while the ledger claims "${ledger.ledger_status}" — an approved contract carries no pending binding`);
    }
    if (b.status === 'resolved') {
      if (isEmpty(b.decision_id)) fail('UNRESOLVED_BINDING', b.id, 'is resolved but names no decision id');
      else if (!knownDecisions.has(b.decision_id)) fail('UNKNOWN_DECISION', `ledger.product_bindings.${b.id}`, `${b.decision_id} is not in the decision record`);
      for (const id of b.affects ?? []) {
        if (!requirements.some((r) => r.requirement_id === id)) {
          fail('UNKNOWN_REQUIREMENT_ID', `ledger.product_bindings.${b.id}`, `affects ${id}, which no row defines`);
        }
      }
    }
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

    if (r.kind !== undefined && !KIND.has(r.kind)) {
      fail('BAD_KIND', id, `kind "${r.kind}" is not action|policy`);
    }
    if (r.status !== undefined && !STATUS.has(r.status)) {
      fail('BAD_STATUS', id, `status "${r.status}" is not approved|deferred|blocked|superseded`);
    }
    if (r.coverage !== undefined && !COVERAGE.has(r.coverage)) {
      fail('BAD_COVERAGE', id, `coverage "${r.coverage}" is not complete|partial|missing|contradicted|duplicated|stale`);
    }

    // "Open" is read from the ledger's own open_decisions list, never inferred from an id's
    // shape. A resolved question keeps its historical id, so a `D-P-` prefix proves nothing.
    //
    // Two doors into the same admission failure: a requirement that hangs on a still-open
    // owner decision must never read as approved.
    if (typeof r.blocked_on === 'string' && openDecisions.has(r.blocked_on) && r.status !== 'blocked') {
      fail('UNRESOLVED_MARKED_APPROVED', id, `depends on open decision ${r.blocked_on} but status is "${r.status}"`);
    }
    if (typeof r.decision_ref === 'string' && openDecisions.has(r.decision_ref) && r.status !== 'blocked') {
      fail('UNRESOLVED_MARKED_APPROVED', id, `cites open decision ${r.decision_ref} as its authority but status is "${r.status}"`);
    }

    // And the converse, which is the failure that actually bit us: a requirement whose
    // implementation is merely MISSING was being recorded as `blocked`, which reads as "the
    // product question is unsettled" when the truth is "approved, and nobody has built it".
    // Blocking is reserved for a genuinely open product decision, so a blocked row must name
    // one that is currently open. Unbuilt work belongs in `coverage`, never in `status`.
    if (r.status === 'blocked') {
      if (typeof r.blocked_on !== 'string' || r.blocked_on === '') {
        fail('BLOCKED_WITHOUT_OPEN_DECISION', id, 'is blocked but names no blocking decision — missing implementation alone is coverage, not status');
      } else if (!openDecisions.has(r.blocked_on)) {
        fail('BLOCKED_WITHOUT_OPEN_DECISION', id, `is blocked on "${r.blocked_on}", which is not a currently open product decision — missing implementation alone must not block an approved requirement`);
      }
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

  // Cross-file: requirement ids named by the decision record.
  for (const token of String(decisionMd).match(REQ_ID) ?? []) {
    if (!byId.has(token)) fail('UNKNOWN_REQUIREMENT_ID', contract.decision_record?.path ?? 'decision record', `decision record references ${token}, which no row defines`);
  }

  // --- every approved artifact needs rows, and at least one ACTION row -------
  const cited = new Map();
  for (const r of requirements) {
    for (const s of r.sources ?? []) {
      if (typeof s !== 'string' || !s.startsWith('design:')) continue;
      const artifactId = s.slice('design:'.length);
      const seen = cited.get(artifactId) ?? { total: 0, action: 0 };
      seen.total += 1;
      if (r.kind === 'action') seen.action += 1;
      cited.set(artifactId, seen);
    }
  }
  for (const a of artifacts) {
    const seen = cited.get(a.id);
    if (!seen || seen.total === 0) {
      fail('ARTIFACT_WITHOUT_REQUIREMENT', a.id, 'approved artifact has no requirement rows');
    } else if (seen.action === 0) {
      fail('ARTIFACT_WITHOUT_ACTION_ROW', a.id, 'approved artifact has no action-level requirement row — every canvas action needs one');
    }
  }
  // A source naming an artifact the manifest does not carry is a dangling citation.
  for (const artifactId of cited.keys()) {
    if (!seenId.has(artifactId)) {
      fail('UNKNOWN_ARTIFACT_SOURCE', artifactId, 'cited as a design source by a requirement row but absent from the manifest');
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

  let ledgerRaw;
  let ledger;
  try {
    ledgerRaw = readFileSync(ledgerPath);
    ledger = JSON.parse(ledgerRaw.toString('utf8'));
  } catch (err) {
    console.error(`COULD NOT VERIFY: ${ledgerPath} is unreadable or not JSON — ${err.message}`);
    return COULD_NOT_VERIFY;
  }

  // Two roots on purpose, and they are not the same thing.
  //
  // The CONTRACT root is where the ledger itself lives — its decision record is
  // a sibling document and always travels with it.
  //
  // The ARTIFACT root is where declared paths are resolved for digest checking.
  // It is overridable so CI can check against a trusted tree, but an override
  // means this run does NOT prove the contract is self-contained.
  const contractRoot = resolve(join(dirname(ledgerPath), '..'));
  const overridden = artifactRootArg !== null;
  const artifactRoot = resolve(artifactRootArg ?? contractRoot);

  const decisionPath = ledger.contract?.decision_record?.path;
  let decisionMd;
  try {
    decisionMd = readFileSync(join(contractRoot, decisionPath), 'utf8');
  } catch (err) {
    console.error(`COULD NOT VERIFY: decision record ${decisionPath} is unreadable — ${err.message}`);
    return COULD_NOT_VERIFY;
  }

  const readFile = (rel) => {
    const abs = join(artifactRoot, rel);
    return existsSync(abs) ? readFileSync(abs) : null;
  };
  const listDir = (rel) => {
    const abs = join(artifactRoot, rel);
    return existsSync(abs) ? readdirSync(abs) : null;
  };

  const findings = checkContract(ledger, decisionMd, readFile, listDir);

  const reqs = ledger.requirements ?? [];
  const tally = (key) => reqs.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + 1), acc), {});
  console.log(`release        ${ledger.release_id}   ledger ${ledger.ledger_version} (${ledger.ledger_status})`);
  console.log(`ledger sha256  ${digestOf(ledgerPath, ledgerRaw)}`);
  console.log(`artifact root  ${artifactRoot}${overridden ? '   [OVERRIDDEN]' : ''}`);
  console.log(`artifacts      ${(ledger.approved_artifacts ?? []).length} of ${ledger.approved_artifact_manifest?.expected_count ?? '?'} expected`);
  console.log(`requirements   ${reqs.length}`);
  console.log(`  by kind      ${JSON.stringify(tally('kind'))}`);
  console.log(`  by status    ${JSON.stringify(tally('status'))}`);
  console.log(`  by coverage  ${JSON.stringify(tally('coverage'))}`);
  console.log(`open decisions ${(ledger.open_decisions ?? []).length} still awaiting founder approval`);

  if (overridden) {
    console.log('\nNOTE: --artifact-root was supplied. This run does NOT prove the contract is');
    console.log('self-contained, and must not be reported as integration-ready.');
  }

  if (findings.length === 0) {
    console.log(`\nRELEASE CONTRACT OK — every admission check passed${overridden ? ' (against an external root)' : ' with no artifact-root override'}.`);
    return OK;
  }

  const byCode = findings.reduce((acc, f) => ((acc[f.code] = (acc[f.code] ?? 0) + 1), acc), {});
  console.error(`\n${findings.length} admission failure(s): ${JSON.stringify(byCode)}\n`);
  for (const f of findings) console.error(`  [${f.code}] ${f.where}\n      ${f.detail}`);
  console.error('\nThis ledger does not authorize goal creation or implementation.');
  return VIOLATION;
}

if (process.argv[1]?.endsWith('check-release-contract.mjs')) {
  process.exit(main(process.argv));
}
