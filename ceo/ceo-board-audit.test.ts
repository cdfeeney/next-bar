import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AUDIT_EXITS,
  AUDIT_INTERVAL_DAYS,
  MAX_MEASUREMENT_AGE_DAYS,
  daysBetween,
  previousAudits,
  runAudit,
} from '../scripts/ceo-board-audit.mjs';
import baseState from './state.json';

class ProcessExit extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super('process.exit(' + String(code) + ')');
  }
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let auditsDir: string;

function expectHardAbort(action: () => void, detail?: string) {
  expect(action).toThrow(ProcessExit);
  expect(exitSpy).toHaveBeenCalledWith(1);
  if (detail !== undefined) {
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(detail));
  }
}

beforeEach(() => {
  auditsDir = path.join(mkdtempSync(path.join(tmpdir(), 'ceo-audit-')), 'audits');
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
    throw new ProcessExit(code);
  });
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(path.dirname(auditsDir), { recursive: true, force: true });
});

/** A state whose numbers the test controls; everything else is the real committed shape. */
function state(metrics: Record<string, number | null> = {}) {
  const next = structuredClone(baseState);
  next.metrics = { ...next.metrics, ...metrics };
  return next;
}

/** After the 2026-12-31 deadline: the board is due and can reach a real verdict. */
const AT = '2027-01-04';
/** Before the deadline: the only window in which UNMEASURABLE is a possible answer. */
const BEFORE_DEADLINE = '2026-11-02';
const day = 24 * 60 * 60 * 1000;
/** "now" one day after the measurement — fresh numbers. */
const NOW = Date.parse(`${AT}T00:00:00Z`) + day;
const NOW_BEFORE = Date.parse(`${BEFORE_DEADLINE}T00:00:00Z`) + day;

function measurement(at = AT) {
  return { at, source: 'manual_count', metrics: {} };
}

function audit(overrides: { metrics?: Record<string, number | null>; at?: string; now?: number } = {}) {
  return runAudit({
    state: state(overrides.metrics ?? {}),
    measurement: measurement(overrides.at ?? AT),
    auditsDir,
    now: overrides.now ?? NOW,
  });
}

describe('the board convenes on its own', () => {
  it('returns a verdict without running a cycle, and writes it down', () => {
    const result = audit({ metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 } });

    expect(result.board.verdict).toBe('KILL');
    expect(readdirSync(auditsDir)).toEqual([`${AT}-KILL.md`]);
    expect(readFileSync(result.file, 'utf8')).toContain('BOTH sides failed');
  });

  it('records the criterion it applied, so the file cannot paraphrase it later', () => {
    const result = audit({ metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 } });
    const report = readFileSync(result.file, 'utf8');

    expect(report).toContain('3 / 50');
    expect(report).toContain('1 / 15');
    expect(report).toContain('2026-12-31');
  });

  it('says UNMEASURABLE rather than blessing numbers nobody counted', () => {
    // Only reachable BEFORE the deadline. On or after it, an unmeasured side is a failed side —
    // arriving at the deadline unable to measure is the failure, not a pending result.
    const result = audit({
      at: BEFORE_DEADLINE,
      now: NOW_BEFORE,
      metrics: { wau: null, max_neighborhood_wau: null },
    });

    expect(result.board.verdict).toBe('UNMEASURABLE');
    expect(readFileSync(result.file, 'utf8')).toMatch(/go measure/i);
  });

  it.each([
    ['CONTINUE', { max_neighborhood_wau: 80, self_maintaining_venues: 20 }, 0, AT, NOW],
    ['RESCOPE', { max_neighborhood_wau: 3, self_maintaining_venues: 20 }, 4, AT, NOW],
    ['KILL', { max_neighborhood_wau: 3, self_maintaining_venues: 1 }, 5, AT, NOW],
    // UNMEASURABLE is a pre-deadline verdict; after the deadline an unread number is a failed one.
    ['UNMEASURABLE', { max_neighborhood_wau: null }, 6, BEFORE_DEADLINE, NOW_BEFORE],
  ])('exits %s with a code cron would notice', (verdict, metrics, code, at, now) => {
    const result = audit({ metrics: metrics as Record<string, number | null>, at, now });

    expect(result.board.verdict).toBe(verdict);
    expect((AUDIT_EXITS as Record<string, number>)[verdict]).toBe(code);
  });

  it('only CONTINUE is a zero exit', () => {
    const nonZero = Object.entries(AUDIT_EXITS).filter(([, code]) => code !== 0);
    expect(nonZero.map(([verdict]) => verdict).sort()).toEqual(['KILL', 'RESCOPE', 'UNMEASURABLE']);
  });

  it('mutates no state', () => {
    const before = JSON.stringify(state());
    audit({ metrics: { max_neighborhood_wau: 80, self_maintaining_venues: 20 } });
    expect(JSON.stringify(state())).toBe(before);
  });
});

describe('the date is not the auditor\'s to choose', () => {
  it('takes the audit date from the measurement envelope', () => {
    const result = audit({ at: '2027-02-02', now: Date.parse('2027-02-03T00:00:00Z') });
    expect(result.board.at).toBe('2027-02-02');
  });

  it('refuses a measurement with no usable date', () => {
    expectHardAbort(
      () => runAudit({ state: state(), measurement: { at: 'whenever' }, auditsDir, now: NOW }),
      'no flag for it on purpose',
    );
  });

  it('refuses an impossible date', () => {
    expectHardAbort(() =>
      runAudit({ state: state(), measurement: measurement('2027-99-99'), auditsDir, now: NOW }),
    );
  });
});

describe('stale numbers are refused', () => {
  it('refuses a measurement older than the limit', () => {
    // An audit against numbers from three months ago is an audit of a company that no longer exists.
    const stale = NOW + (MAX_MEASUREMENT_AGE_DAYS + 2) * 24 * 60 * 60 * 1000;
    expectHardAbort(() => audit({ now: stale }), 'stale measurement');
  });

  it('accepts a measurement right at the limit', () => {
    const edge = Date.parse(`${AT}T00:00:00Z`) + MAX_MEASUREMENT_AGE_DAYS * 24 * 60 * 60 * 1000;
    expect(() => audit({ now: edge })).not.toThrow();
  });

  it('refuses numbers dated in the future', () => {
    expectHardAbort(() => audit({ now: Date.parse('2026-01-01T00:00:00Z') }));
  });

  it('refuses to run with no clock at all', () => {
    expectHardAbort(() =>
      runAudit({ state: state(), measurement: measurement(), auditsDir, now: undefined as unknown as number }),
    );
  });
});

describe('an audit cannot be re-run until it agrees with you', () => {
  it('refuses a second audit for the same date', () => {
    audit({ metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 } });

    expectHardAbort(
      () => audit({ metrics: { max_neighborhood_wau: 80, self_maintaining_venues: 20 } }),
      'not re-runnable',
    );
  });

  it('leaves the original verdict untouched when a re-run is refused', () => {
    audit({ metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 } });
    try {
      audit({ metrics: { max_neighborhood_wau: 80, self_maintaining_venues: 20 } });
    } catch {
      // expected
    }

    // The nicer verdict never got written, and the honest one is still the only record.
    expect(readdirSync(auditsDir)).toEqual([`${AT}-KILL.md`]);
  });

  it('allows an audit under a new date with new numbers', () => {
    audit({ metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 } });
    const later = audit({
      at: '2027-02-01',
      now: Date.parse('2027-02-02T00:00:00Z'),
      metrics: { max_neighborhood_wau: 80, self_maintaining_venues: 20 },
    });

    expect(later.board.verdict).toBe('CONTINUE');
    expect(readdirSync(auditsDir).sort()).toEqual([`${AT}-KILL.md`, '2027-02-01-CONTINUE.md']);
  });
});

describe('the register', () => {
  it('reads the previous audits out of the filenames, so the record cannot disagree with itself', () => {
    audit({ metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 } });
    const seen = previousAudits(auditsDir);

    expect(seen).toEqual([{ at: AT, verdict: 'KILL', file: `${AT}-KILL.md` }]);
  });

  it('reports how long it has been, and calls out an overdue gap', () => {
    writeFileSync(path.join(mkdtempSync(path.join(tmpdir(), 'x-')), 'ignored'), '');
    audit({ metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 } });

    const overdueAt = '2027-06-01'; // well past the quarterly interval
    const result = audit({
      at: overdueAt,
      now: Date.parse('2027-06-02T00:00:00Z'),
      metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 },
    });

    expect(result.sinceLast?.at).toBe(AT);
    expect(result.sinceLast!.days).toBeGreaterThan(AUDIT_INTERVAL_DAYS);
    expect(result.overdue).toBe(true);
    expect(readFileSync(result.file, 'utf8')).toMatch(/OVERDUE/);
  });

  it('does not cry overdue on the first audit ever', () => {
    const result = audit({ metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 } });

    expect(result.sinceLast).toBeNull();
    expect(result.overdue).toBe(false);
    expect(readFileSync(result.file, 'utf8')).toMatch(/none — this is the first/);
  });

  it('tolerates an empty or missing audits directory', () => {
    expect(previousAudits(path.join(auditsDir, 'nope'))).toEqual([]);
  });

  it('ignores files that are not audit records', () => {
    audit({ metrics: { max_neighborhood_wau: 3, self_maintaining_venues: 1 } });
    writeFileSync(path.join(auditsDir, 'README.md'), 'notes', 'utf8');

    expect(previousAudits(auditsDir).map((entry) => entry.verdict)).toEqual(['KILL']);
  });
});

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween('2027-01-01', '2027-01-31')).toBe(30);
  });

  it('is negative when the second date is earlier', () => {
    expect(daysBetween('2027-01-31', '2027-01-01')).toBe(-30);
  });

  it('returns null on an unparseable date rather than guessing', () => {
    expect(daysBetween('whenever', '2027-01-01')).toBeNull();
  });
});
