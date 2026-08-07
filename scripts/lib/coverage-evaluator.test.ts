import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import { evaluateCoverage, formatEvaluation } from './coverage-evaluator.mjs';

const goldens = JSON.parse(
  readFileSync(path.resolve(__dirname, '../fixtures/coverage-goldens.json'), 'utf8'),
);

/** A run that found and judged everything correctly. */
function perfectRun() {
  return goldens
    .filter((golden: { label: string }) => golden.label !== 'not_bar')
    .map((golden: { name: string; placeId: string; source: string; label: string }) => ({
      name: golden.name,
      placeId: golden.placeId,
      sources: [golden.source],
      decision: golden.label === 'duplicate' ? 'duplicate' : 'accept',
    }));
}

describe('coverage evaluator', () => {
  it('scores a perfect run at full recall and full precision', () => {
    const report = evaluateCoverage(goldens, perfectRun());
    expect(report.totals.candidateRecall).toBe(1);
    expect(report.totals.autoAcceptPrecision).toBe(1);
    expect(report.totals.duplicatePrecision).toBe(1);
    expect(report.missed).toEqual([]);
  });

  it('counts a missed hybrid venue against recall and names it', () => {
    const rows = perfectRun().filter((row: { name: string }) => row.name !== 'Book Club Bar');
    const report = evaluateCoverage(goldens, rows);
    expect(report.totals.candidateRecall).toBeLessThan(1);
    expect(report.missed.map((item: { name: string }) => item.name)).toEqual(['Book Club Bar']);
    expect(report.byType.book_store.candidateRecall).toBe(0.5);
  });

  it('counts auto-accepting a non-bar against precision', () => {
    const rows = [
      ...perfectRun(),
      { name: 'Noho Juice Bar', placeId: 'gold-noho-juice-bar', sources: ['nearby'], decision: 'accept' },
    ];
    const report = evaluateCoverage(goldens, rows);
    expect(report.totals.autoAcceptPrecision).toBeLessThan(1);
    expect(report.falseAccepts.map((item: { name: string }) => item.name)).toEqual(['Noho Juice Bar']);
  });

  it('counts suppressing a real second location as a duplicate-precision miss', () => {
    // This is the multi-location failure expressed as a metric: calling the
    // Brooklyn Canuck a duplicate is wrong, and the evaluator must say so.
    const rows = perfectRun().map((row: { placeId: string; decision: string }) =>
      row.placeId === 'gold-canuck-brooklyn' ? { ...row, decision: 'duplicate' } : row,
    );
    const report = evaluateCoverage(goldens, rows);
    expect(report.totals.duplicatePrecision).toBeLessThan(1);
    expect(report.falseDuplicates.map((item: { name: string }) => item.name)).toContain('The Canuck');
  });

  it('never scores an SLA-only lead as a correct auto-accept', () => {
    const rows = [
      { name: 'ATTABOY COCKTAILS LLC', placeId: null, sources: ['sla'], decision: 'accept' },
    ];
    const report = evaluateCoverage(goldens, rows);
    expect(report.totals.autoAcceptPrecision).toBe(0);
    expect(report.bySource.sla.autoAcceptPrecision).toBe(0);
  });

  it('reports both boroughs independently', () => {
    const report = evaluateCoverage(goldens, perfectRun());
    expect(Object.keys(report.byBorough).sort()).toEqual(['brooklyn', 'manhattan']);
    expect(report.byBorough.brooklyn.expected).toBeGreaterThan(0);
    expect(report.byBorough.manhattan.expected).toBeGreaterThan(0);
  });

  it('treats an unlabelled row as unknown rather than as a precision failure', () => {
    const rows = [
      ...perfectRun(),
      { name: 'Some New Bar', placeId: 'not-in-goldens', sources: ['nearby'], decision: 'accept' },
    ];
    expect(evaluateCoverage(goldens, rows).totals.autoAcceptPrecision).toBe(1);
  });

  it('rejects a fixture carrying an unknown label', () => {
    expect(() => evaluateCoverage([{ name: 'X', label: 'maybe' }], [])).toThrow(/unknown label/);
  });

  it('formats a readable report', () => {
    const text = formatEvaluation(evaluateCoverage(goldens, perfectRun()));
    expect(text).toContain('candidate recall');
    expect(text).toContain('by borough');
  });
});
