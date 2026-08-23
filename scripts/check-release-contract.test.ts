import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs guard, deliberately not TypeScript
import { checkContract, digestOf } from './check-release-contract.mjs';

// Why this exists: the release-contract guard is the ONLY mechanical enforcement of the
// design-to-PRD admission rules. Everything else in that chain is prose that a reviewer can
// agree with while a field is empty or a digest has moved. A guard nobody proves can fail is
// not a gate, so each case below re-breaks exactly one rule and asserts the specific code.

const decisionMd = 'D-C-01 approved. D-C-27 approved. D-P-03 pending. D-O-04 was open.';

const shaOf = (s: string) => createHash('sha256').update(Buffer.from(s)).digest('hex');

/** A row that passes every check, so each case can break exactly one thing. */
const goodRow = (over: Record<string, unknown> = {}) => ({
  requirement_id: 'V8-R-STO-001',
  kind: 'action',
  title: 'a requirement',
  sources: ['design:canvas-a'],
  actor: 'user',
  entry_point: 'somewhere',
  behavior: 'does a thing',
  states: ['on'],
  audience: 'friends',
  trust_boundary: null,
  data_owner: null,
  retention: null,
  failure_recovery: null,
  accessibility: null,
  exclusions: [],
  status: 'approved',
  decision_ref: 'D-C-01',
  blocked_on: null,
  goal_ids: [],
  acceptance_refs: [],
  implementation_paths: [],
  evidence: [],
  coverage: 'complete',
  ...over,
});

const APPROVED_STATUS = 'Status: **FOUNDER-APPROVED AND FROZEN — 2026-08-23.**\nbody\n';
const DRAFT_STATUS = 'Status: **DRAFT** pending final founder approval.\nbody\n';

const FILES: Record<string, string> = {
  'docs/PRD.md': 'prd',
  'docs/DELTA.md': APPROVED_STATUS,
  'docs/DECISIONS.md': APPROVED_STATUS,
  'docs/design-reference/README.md': 'readme',
  'scripts/check-release-contract.mjs': 'validator',
  'scripts/check-release-contract.test.ts': 'validator-test',
  'docs/design-reference/approved/a.png': 'png-a',
  'docs/design-reference/approved/b.png': 'png-b',
};

/** Override a file's content for one case, so a single rule can be broken at a time. */
const readerWith = (overrides: Record<string, string> = {}) => (rel: string) => {
  const src = { ...FILES, ...overrides };
  return rel in src ? Buffer.from(src[rel]) : null;
};
const readFile = readerWith();
const listDir = (rel: string) =>
  rel === 'docs/design-reference/approved' ? ['a.png', 'b.png'] : null;

const cleanLedger = (rows = [goodRow(), goodRow({ requirement_id: 'V8-R-STO-002', title: 'second', sources: ['design:canvas-b'] })]) => ({
  ledger_version: '2.0.0',
  ledger_status: 'draft',
  release_id: 'V8',
  contract: {
    prd: { path: 'docs/PRD.md', version: 'v1', sha256: shaOf('prd') },
    delta: { path: 'docs/DELTA.md', version: 'v8.3', sha256: shaOf(APPROVED_STATUS) },
    decision_record: { path: 'docs/DECISIONS.md', version: 'r3', sha256: shaOf(APPROVED_STATUS) },
    design_reference_readme: { path: 'docs/design-reference/README.md', sha256: shaOf('readme') },
    validator: { path: 'scripts/check-release-contract.mjs', sha256: shaOf('validator') },
    validator_test: { path: 'scripts/check-release-contract.test.ts', sha256: shaOf('validator-test') },
  },
  approved_artifact_manifest: { directory: 'docs/design-reference/approved', expected_count: 2 },
  approved_artifacts: [
    { id: 'canvas-a', path: 'docs/design-reference/approved/a.png', sha256: shaOf('png-a'), approval_scope: 'both', approver: 'founder', approved_on: '2026-08-12', stale_in_canvas_banner: null, banner_superseded_by: null },
    { id: 'canvas-b', path: 'docs/design-reference/approved/b.png', sha256: shaOf('png-b'), approval_scope: 'both', approver: 'founder', approved_on: '2026-08-21', stale_in_canvas_banner: 'EXPLORATORY', banner_superseded_by: 'D-C-27' },
  ],
  open_decisions: [{ id: 'D-P-03', subject: 'group administration' }],
  requirements: rows,
});

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);
const run = (ledger: unknown, md = decisionMd) => checkContract(ledger, md, readFile, listDir);

describe('checkContract', () => {
  it('passes a ledger that satisfies every admission rule', () => {
    expect(run(cleanLedger())).toEqual([]);
  });

  // ---------------------------------------------------------------- row shape
  it('rejects a requirement whose required field is empty', () => {
    expect(codes(run(cleanLedger([goodRow({ actor: '' })])))).toContain('MISSING_FIELD');
  });

  it('rejects a requirement whose when-applicable key is absent rather than null', () => {
    const row = goodRow();
    delete (row as Record<string, unknown>).retention;
    expect(run(cleanLedger([row])).some((f) => f.code === 'MISSING_FIELD' && f.where.endsWith('.retention'))).toBe(true);
  });

  it('rejects a kind outside action|policy', () => {
    expect(codes(run(cleanLedger([goodRow({ kind: 'vibes' })])))).toContain('BAD_KIND');
  });

  it('rejects a status outside the contract enum', () => {
    expect(codes(run(cleanLedger([goodRow({ status: 'probably-fine' })])))).toContain('BAD_STATUS');
  });

  it('rejects a coverage value outside the contract enum', () => {
    expect(codes(run(cleanLedger([goodRow({ coverage: 'mostly' })])))).toContain('BAD_COVERAGE');
  });

  it('rejects two rows sharing one requirement_id', () => {
    expect(codes(run(cleanLedger([goodRow(), goodRow({ title: 'another' })])))).toContain('DUPLICATE_ID');
  });

  it('rejects duplicate requirement ownership — two ids, one identity', () => {
    expect(codes(run(cleanLedger([goodRow(), goodRow({ requirement_id: 'V8-R-STO-002' })])))).toContain('DUPLICATE_OWNERSHIP');
  });

  // ------------------------------------------------- unresolved vs approved
  it('rejects a row that depends on an open decision but reads as approved', () => {
    expect(codes(run(cleanLedger([goodRow({ blocked_on: 'D-P-03', status: 'approved' })])))).toContain('UNRESOLVED_MARKED_APPROVED');
  });

  it('rejects a row that cites an open decision as its authority but reads as approved', () => {
    expect(codes(run(cleanLedger([goodRow({ decision_ref: 'D-P-03', status: 'approved' })])))).toContain('UNRESOLVED_MARKED_APPROVED');
  });

  it('accepts the same row once it is marked blocked', () => {
    expect(run(cleanLedger([
      goodRow({ blocked_on: 'D-P-03', status: 'blocked' }),
      goodRow({ requirement_id: 'V8-R-STO-002', title: 'second', sources: ['design:canvas-b'] }),
    ]))).toEqual([]);
  });

  // "Open" comes from the ledger's own open_decisions list, never from the shape of an id. A
  // resolved question keeps its historical D-P- id, and citing it must NOT re-open anything.
  it('treats a resolved decision id as resolved even though it keeps its D-P- prefix', () => {
    const l = cleanLedger([goodRow({ decision_ref: 'D-P-03', status: 'approved' }), goodRow({ requirement_id: 'V8-R-STO-002', title: 'second', sources: ['design:canvas-b'] })]);
    l.open_decisions = [];
    expect(run(l)).toEqual([]);
  });

  // The failure that actually bit us: an approved security requirement whose implementation is
  // merely absent was recorded as `blocked`, which reads as "the product question is unsettled"
  // when the truth is "approved, and nobody has built it". Unbuilt work is coverage, not status.
  it('rejects a blocked row that names a capability gap instead of an open decision', () => {
    const findings = run(cleanLedger([goodRow({ status: 'blocked', blocked_on: 'capability: server-side URL minting' })]));
    expect(codes(findings)).toContain('BLOCKED_WITHOUT_OPEN_DECISION');
  });

  it('rejects a blocked row that names no blocker at all', () => {
    expect(codes(run(cleanLedger([goodRow({ status: 'blocked', blocked_on: null })])))).toContain('BLOCKED_WITHOUT_OPEN_DECISION');
  });

  it('rejects a blocked row citing a decision that is no longer open', () => {
    const l = cleanLedger([goodRow({ status: 'blocked', blocked_on: 'D-P-03' }), goodRow({ requirement_id: 'V8-R-STO-002', title: 'second', sources: ['design:canvas-b'] })]);
    l.open_decisions = [];
    expect(codes(run(l))).toContain('BLOCKED_WITHOUT_OPEN_DECISION');
  });

  it('accepts an approved requirement whose implementation is simply missing', () => {
    expect(run(cleanLedger([
      goodRow({ status: 'approved', blocked_on: null, coverage: 'missing' }),
      goodRow({ requirement_id: 'V8-R-STO-002', title: 'second', sources: ['design:canvas-b'] }),
    ]))).toEqual([]);
  });

  it('rejects a deferral with no owner citation', () => {
    expect(codes(run(cleanLedger([goodRow({ status: 'deferred', decision_ref: '' })])))).toContain('MISSING_FIELD');
  });

  // ---------------------------------------------------------- id resolution
  it('rejects a decision id the decision record does not define', () => {
    expect(codes(run(cleanLedger([goodRow({ decision_ref: 'D-C-99' })])))).toContain('UNKNOWN_DECISION');
  });

  it('rejects an open decision the decision record does not define', () => {
    const l = cleanLedger();
    l.open_decisions = [{ id: 'D-P-42', subject: 'invented' }];
    expect(codes(run(l))).toContain('UNKNOWN_DECISION');
  });

  it('rejects a reference to a requirement id no row defines', () => {
    expect(codes(run(cleanLedger([goodRow({ behavior: 'see V8-R-FEED-003 for the rest' })])))).toContain('UNKNOWN_REQUIREMENT_ID');
  });

  it('rejects a decision record that names a requirement id no row defines', () => {
    expect(codes(run(cleanLedger(), `${decisionMd} see V8-R-GRP-009`))).toContain('UNKNOWN_REQUIREMENT_ID');
  });

  // ------------------------------------------------------- contract binding
  it.each(['prd', 'delta', 'decision_record', 'design_reference_readme'])(
    'rejects digest drift on the bound contract part %s',
    (part) => {
      const l = cleanLedger();
      (l.contract as Record<string, { sha256: string }>)[part].sha256 = 'deadbeef';
      expect(codes(run(l))).toContain('DIGEST_DRIFT');
    },
  );

  it('rejects a contract part that is not bound by digest at all', () => {
    const l = cleanLedger();
    delete (l.contract as Record<string, unknown>).delta;
    expect(codes(run(l))).toContain('MISSING_FIELD');
  });

  it('rejects a missing validator', () => {
    const l = cleanLedger();
    l.contract.validator.path = 'scripts/nope.mjs';
    expect(codes(run(l))).toContain('ABSENT');
  });

  it('rejects drift on the validator and on its own test', () => {
    for (const part of ['validator', 'validator_test']) {
      const l = cleanLedger();
      (l.contract as Record<string, { sha256: string }>)[part].sha256 = 'deadbeef';
      expect(codes(run(l))).toContain('DIGEST_DRIFT');
    }
  });

  // ------------------------------------------- approved ledger vs draft docs
  //
  // The exact defect: the ledger read `founder-approved` while the PRD delta it binds still
  // declared `Status: **DRAFT**`. Every digest matched, so the contract passed, and the release's
  // approval state depended on which file a reader opened.
  describe('DRAFT_BOUND_ARTIFACT', () => {
    const approvedLedger = (over: Record<string, unknown> = {}) => ({
      ...cleanLedger(),
      ledger_status: 'founder-approved',
      last_owner_approval: { approver: 'founder', approved_on: '2026-08-23' },
      ...over,
    });

    it('fails a founder-approved ledger whose bound delta still says DRAFT', () => {
      const l = approvedLedger();
      l.contract.delta.sha256 = shaOf(DRAFT_STATUS);
      const findings = checkContract(l, decisionMd, readerWith({ 'docs/DELTA.md': DRAFT_STATUS }), listDir);
      expect(codes(findings)).toContain('DRAFT_BOUND_ARTIFACT');
      expect(findings.find((f) => f.code === 'DRAFT_BOUND_ARTIFACT')?.where).toBe('docs/DELTA.md');
    });

    it('fails a founder-approved ledger whose bound decision record still says DRAFT', () => {
      const l = approvedLedger();
      l.contract.decision_record.sha256 = shaOf(DRAFT_STATUS);
      const findings = checkContract(l, DRAFT_STATUS + decisionMd, readerWith({ 'docs/DECISIONS.md': DRAFT_STATUS }), listDir);
      expect(codes(findings)).toContain('DRAFT_BOUND_ARTIFACT');
      expect(findings.find((f) => f.code === 'DRAFT_BOUND_ARTIFACT')?.where).toBe('docs/DECISIONS.md');
    });

    it('fails a founder-approved ledger with no last_owner_approval', () => {
      const findings = run(approvedLedger({ last_owner_approval: null }));
      expect(codes(findings)).toContain('DRAFT_BOUND_ARTIFACT');
    });

    it('fails a bound document that declares no Status line at all', () => {
      const l = approvedLedger();
      l.contract.delta.sha256 = shaOf('no status here');
      const findings = checkContract(l, decisionMd, readerWith({ 'docs/DELTA.md': 'no status here' }), listDir);
      expect(codes(findings)).toContain('DRAFT_BOUND_ARTIFACT');
    });

    it('passes the properly founder-approved and frozen package', () => {
      expect(run(approvedLedger())).toEqual([]);
    });

    // "draft" is legitimate PRODUCT vocabulary in these documents — the superseded Map
    // draft-filter state. Only the Status: line may be read, or the contract would be rejected
    // for describing a feature.
    it('does not fire on the word draft appearing in product prose', () => {
      const withProse = `${APPROVED_STATUS}\nThe superseded Map behavior held filters as a DRAFT until Apply.\n`;
      const l = approvedLedger();
      l.contract.delta.sha256 = shaOf(withProse);
      expect(checkContract(l, decisionMd, readerWith({ 'docs/DELTA.md': withProse }), listDir)).toEqual([]);
    });

    it('stays silent while the ledger is still a draft', () => {
      const l = cleanLedger();
      l.contract.delta.sha256 = shaOf(DRAFT_STATUS);
      const findings = checkContract(l, decisionMd, readerWith({ 'docs/DELTA.md': DRAFT_STATUS }), listDir);
      expect(codes(findings)).not.toContain('DRAFT_BOUND_ARTIFACT');
    });
  });

  // ------------------------------------------------------- artifact manifest
  it('rejects a manifest whose count does not match its declared expectation', () => {
    const l = cleanLedger();
    l.approved_artifact_manifest.expected_count = 16;
    expect(codes(run(l))).toContain('MANIFEST_COUNT');
  });

  it('rejects a declared artifact that is absent under the artifact root', () => {
    const l = cleanLedger();
    l.approved_artifacts[0].path = 'docs/design-reference/approved/gone.png';
    expect(codes(run(l))).toContain('ABSENT');
  });

  it('rejects an extra file sitting in the approved directory but absent from the manifest', () => {
    const l = cleanLedger();
    l.approved_artifact_manifest.expected_count = 1;
    l.approved_artifacts = [l.approved_artifacts[0]];
    expect(codes(run(l))).toContain('EXTRA_ARTIFACT');
  });

  it('rejects a duplicate artifact id', () => {
    const l = cleanLedger();
    l.approved_artifacts[1].id = 'canvas-a';
    expect(codes(run(l))).toContain('DUPLICATE_ARTIFACT_ID');
  });

  it('rejects a duplicate artifact path', () => {
    const l = cleanLedger();
    l.approved_artifacts[1].path = l.approved_artifacts[0].path;
    expect(codes(run(l))).toContain('DUPLICATE_ARTIFACT_PATH');
  });

  it('rejects two manifest entries that are byte-identical', () => {
    const l = cleanLedger();
    l.approved_artifacts[1].sha256 = l.approved_artifacts[0].sha256;
    expect(codes(run(l))).toContain('DUPLICATE_ARTIFACT_DIGEST');
  });

  it('rejects digest drift on an approved canvas', () => {
    const l = cleanLedger();
    l.approved_artifacts[0].sha256 = 'deadbeef';
    expect(codes(run(l))).toContain('DIGEST_DRIFT');
  });

  it('rejects a stale in-canvas banner with no superseding decision', () => {
    const l = cleanLedger();
    l.approved_artifacts[1].banner_superseded_by = null;
    expect(codes(run(l))).toContain('UNCITED_BANNER');
  });

  it('rejects an approved artifact that no requirement row cites', () => {
    expect(codes(run(cleanLedger([goodRow({ sources: ['design:canvas-a'] })])))).toContain('ARTIFACT_WITHOUT_REQUIREMENT');
  });

  // Every canvas action needs an action-level row, so a canvas covered only by policy fails.
  it('rejects an approved artifact covered only by policy rows', () => {
    const l = cleanLedger([
      goodRow(),
      goodRow({ requirement_id: 'V8-R-STO-002', title: 'second', kind: 'policy', sources: ['design:canvas-b'] }),
    ]);
    expect(codes(run(l))).toContain('ARTIFACT_WITHOUT_ACTION_ROW');
  });

  it('rejects a design source naming an artifact the manifest does not carry', () => {
    const l = cleanLedger([
      goodRow(),
      goodRow({ requirement_id: 'V8-R-STO-002', title: 'second', sources: ['design:canvas-b'] }),
      goodRow({ requirement_id: 'V8-R-STO-003', title: 'third', sources: ['design:canvas-ghost'] }),
    ]);
    expect(codes(run(l))).toContain('UNKNOWN_ARTIFACT_SOURCE');
  });

  it('refuses to green when the decision record carries no decision ids', () => {
    expect(codes(run(cleanLedger(), 'no ids here'))).toContain('NO_DECISIONS');
  });

  // ------------------------------------------------------------ digest rule
  // The CRLF trap: on a core.autocrlf Windows checkout a committed .md arrives with CRLF
  // while its git blob holds LF. Without folding, every multi-line text file reports drift
  // on every run and the guard becomes noise. Binaries must NOT be folded.
  it('hashes text files with CRLF folded so a Windows checkout does not report false drift', () => {
    expect(digestOf('docs/a.md', Buffer.from('one\r\ntwo\r\n')))
      .toBe(digestOf('docs/a.md', Buffer.from('one\ntwo\n')));
  });

  it('hashes binary files byte-for-byte, CR LF pairs included', () => {
    expect(digestOf('docs/a.png', Buffer.from('one\r\ntwo\r\n')))
      .not.toBe(digestOf('docs/a.png', Buffer.from('one\ntwo\n')));
  });
});
