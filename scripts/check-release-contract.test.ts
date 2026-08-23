import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs guard, deliberately not TypeScript
import { checkContract, digestOf } from './check-release-contract.mjs';

// Why this exists: the release-contract guard is the ONLY mechanical enforcement of the
// design-to-PRD admission rules. Everything else in that chain is prose that a reviewer can
// agree with while a field is empty or a digest has moved. A guard nobody proves can fail is
// not a gate, so each case below re-breaks exactly one rule and asserts the specific code.

const decisionMd = 'D-C-01 approved. D-O-04 open. D-C-11 approved.';

/** A row that passes every check, so each case can break exactly one thing. */
const goodRow = (over: Record<string, unknown> = {}) => ({
  requirement_id: 'V8-R-STO-001',
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

const goodLedger = (rows = [goodRow()]) => ({
  ledger_version: '1.0.0',
  release_id: 'V8',
  prd_path: 'docs/PRD.md',
  prd_version: 'v1',
  prd_sha256: 'aa',
  decision_record_path: 'docs/DECISIONS.md',
  approved_artifacts: [
    { id: 'canvas-a', path: 'docs/a.png', sha256: 'bb', approval_scope: 'both', approver: 'founder', approved_on: '2026-08-21' },
  ],
  requirements: rows,
});

/** Digests match, everything present — so digest checks never mask another case. */
const readFile = (rel: string) =>
  rel === 'docs/PRD.md' ? Buffer.from('prd') : rel === 'docs/a.png' ? Buffer.from('png') : null;

/** The same reader, with the two digests the ledger must record for a clean run. */
const shaOf = (s: string) => require('node:crypto').createHash('sha256').update(Buffer.from(s)).digest('hex');

const cleanLedger = (rows = [goodRow()]) => {
  const l = goodLedger(rows);
  l.prd_sha256 = shaOf('prd');
  l.approved_artifacts[0].sha256 = shaOf('png');
  return l;
};

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('checkContract', () => {
  it('passes a ledger that satisfies every admission rule', () => {
    expect(checkContract(cleanLedger(), decisionMd, readFile)).toEqual([]);
  });

  it('rejects a requirement whose required field is empty', () => {
    const findings = checkContract(cleanLedger([goodRow({ actor: '' })]), decisionMd, readFile);
    expect(codes(findings)).toContain('MISSING_FIELD');
  });

  it('rejects a requirement whose when-applicable key is absent rather than null', () => {
    const row = goodRow();
    delete (row as Record<string, unknown>).retention;
    const findings = checkContract(cleanLedger([row]), decisionMd, readFile);
    expect(findings.some((f) => f.code === 'MISSING_FIELD' && f.where.endsWith('.retention'))).toBe(true);
  });

  it('rejects two rows sharing one requirement_id', () => {
    const findings = checkContract(cleanLedger([goodRow(), goodRow({ title: 'another' })]), decisionMd, readFile);
    expect(codes(findings)).toContain('DUPLICATE_ID');
  });

  it('rejects duplicate requirement ownership — two ids, one identity', () => {
    const findings = checkContract(
      cleanLedger([goodRow(), goodRow({ requirement_id: 'V8-R-STO-002' })]),
      decisionMd, readFile,
    );
    expect(codes(findings)).toContain('DUPLICATE_OWNERSHIP');
  });

  it('rejects a requirement that depends on an open decision but reads as approved', () => {
    const findings = checkContract(
      cleanLedger([goodRow({ blocked_on: 'D-O-04', status: 'approved' })]),
      decisionMd, readFile,
    );
    expect(codes(findings)).toContain('UNRESOLVED_MARKED_APPROVED');
  });

  it('accepts the same row once it is marked blocked', () => {
    const findings = checkContract(
      cleanLedger([goodRow({ blocked_on: 'D-O-04', status: 'blocked' })]),
      decisionMd, readFile,
    );
    expect(findings).toEqual([]);
  });

  it('rejects a decision id that the decision record does not define', () => {
    const findings = checkContract(cleanLedger([goodRow({ decision_ref: 'D-C-99' })]), decisionMd, readFile);
    expect(codes(findings)).toContain('UNKNOWN_DECISION');
  });

  it('rejects a reference to a requirement id no row defines', () => {
    const findings = checkContract(
      cleanLedger([goodRow({ behavior: 'see V8-R-FEED-003 for the rest' })]),
      decisionMd, readFile,
    );
    expect(codes(findings)).toContain('UNKNOWN_REQUIREMENT_ID');
  });

  it('rejects an approved artifact that no requirement row cites', () => {
    const findings = checkContract(
      cleanLedger([goodRow({ sources: ['design:some-other-canvas'] })]),
      decisionMd, readFile,
    );
    expect(codes(findings)).toContain('ARTIFACT_WITHOUT_REQUIREMENT');
  });

  it('rejects digest drift on a declared artifact', () => {
    const l = cleanLedger();
    l.approved_artifacts[0].sha256 = 'deadbeef';
    expect(codes(checkContract(l, decisionMd, readFile))).toContain('DIGEST_DRIFT');
  });

  it('rejects a declared artifact that is absent under the artifact root', () => {
    const findings = checkContract(cleanLedger(), decisionMd, () => null);
    expect(codes(findings)).toContain('ABSENT');
  });

  it('rejects a status outside the contract enum', () => {
    const findings = checkContract(cleanLedger([goodRow({ status: 'probably-fine' })]), decisionMd, readFile);
    expect(codes(findings)).toContain('BAD_STATUS');
  });

  it('rejects a coverage value outside the contract enum', () => {
    const findings = checkContract(cleanLedger([goodRow({ coverage: 'mostly' })]), decisionMd, readFile);
    expect(codes(findings)).toContain('BAD_COVERAGE');
  });

  it('refuses to green when the decision record carries no decision ids', () => {
    expect(codes(checkContract(cleanLedger(), 'no ids here', readFile))).toContain('NO_DECISIONS');
  });

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

  it('still reports real drift on a text file once line endings are excluded as a cause', () => {
    const l = cleanLedger();
    l.prd_sha256 = shaOf('a different prd');
    const findings = checkContract(l, decisionMd, (rel: string) =>
      rel === 'docs/PRD.md' ? Buffer.from('prd') : rel === 'docs/a.png' ? Buffer.from('png') : null);
    expect(codes(findings)).toContain('DIGEST_DRIFT');
  });
});
