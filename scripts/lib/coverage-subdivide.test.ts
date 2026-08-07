import { describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import {
  DEFAULT_SUBDIVISION,
  assertCoversCell,
  bboxSideMeters,
  estimateCalls,
  isSaturated,
  planCells,
  planTextCells,
  radiusForSide,
  subdivideCell,
  worstCaseCallsPerCell,
} from './coverage-subdivide.mjs';

const bbox = { north: 40.753, west: -74.013, south: 40.738, east: -73.997 };

/**
 * subdivideCell returns null at the bounds on purpose, so the caller has to
 * decide about the floor explicitly. These tests assert children exist first.
 */
function quads(cell: any, options: any): any[] {
  const children = subdivideCell(cell, options);
  expect(children).not.toBeNull();
  return children as any[];
}

describe('cell planning and coverage geometry', () => {
  it('tiles the whole box with cells no larger than the step', () => {
    // 1670m x 1350m at a 360m step tiles to 5 rows x 4 columns. These are
    // CELLS with extent, not the corner POINTS the legacy grid emitted.
    const cells = planCells(bbox, 360);
    expect(cells).toHaveLength(20);
    for (const cell of cells) expect(cell.sideMeters).toBeLessThanOrEqual(361);
    expect(Math.min(...cells.map((cell: { bbox: { south: number } }) => cell.bbox.south))).toBeCloseTo(
      bbox.south,
      6,
    );
    expect(Math.max(...cells.map((cell: { bbox: { north: number } }) => cell.bbox.north))).toBeCloseTo(
      bbox.north,
      6,
    );
  });

  it('derives a radius that covers the cell corners, not just its edges', () => {
    // Half-diagonal. An inscribed radius would leave the corners unsearched,
    // which is a silent recall hole rather than a visible failure.
    expect(radiusForSide(360)).toBe(255);
    expect(() => assertCoversCell(360, 255)).not.toThrow();
    expect(() => assertCoversCell(360, 200)).toThrow(/leaves the corners/);
  });

  it('shrinks the radius with the cell instead of reusing the base circle', () => {
    const [child] = quads(planCells(bbox, 360)[0], DEFAULT_SUBDIVISION);
    expect(child.sideMeters).toBeLessThan(200);
    expect(child.radiusMeters).toBeLessThan(radiusForSide(360));
    expect(() => assertCoversCell(child.sideMeters, child.radiusMeters)).not.toThrow();
  });
});

describe('saturation detection', () => {
  it('treats a response at the cap as censored, not as a result', () => {
    expect(isSaturated(20, 20)).toBe(true);
    expect(isSaturated(19, 20)).toBe(false);
    // A future API that over-delivers must not read as "not truncated".
    expect(isSaturated(21, 20)).toBe(true);
  });
});

describe('bounded subdivision', () => {
  const cell = planCells(bbox, 360)[0];

  it('produces four children that tile the parent exactly', () => {
    const children = quads(cell, DEFAULT_SUBDIVISION);
    expect(children).toHaveLength(4);
    expect(new Set(children.map((child) => child.id)).size).toBe(4);
    const area = (box: any) => (box.north - box.south) * (box.east - box.west);
    const childArea = children.reduce((total, child) => total + area(child.bbox), 0);
    expect(childArea).toBeCloseTo(area(cell.bbox), 12);
  });

  it('stops at the depth bound', () => {
    const depth1 = quads(cell, { maxDepth: 1, minCellMeters: 10 })[0];
    expect(subdivideCell(depth1, { maxDepth: 1, minCellMeters: 10 })).toBeNull();
  });

  it('stops at the minimum cell size', () => {
    expect(subdivideCell(cell, { maxDepth: 5, minCellMeters: 300 })).toBeNull();
  });

  it('carries the query through when a text cell subdivides its viewport', () => {
    const [textCell] = planTextCells(bbox, ['rooftop bars in Chelsea']);
    const children = quads(textCell, { maxDepth: 2, minCellMeters: 90 });
    expect(children).toHaveLength(4);
    expect(children.every((child) => child.query === 'rooftop bars in Chelsea')).toBe(true);
    expect(children.every((child) => child.kind === 'text')).toBe(true);
  });
});

describe('call bounding', () => {
  it('matches the closed form (4^(D+1)-1)/3', () => {
    expect(worstCaseCallsPerCell(0)).toBe(1);
    expect(worstCaseCallsPerCell(1)).toBe(5);
    expect(worstCaseCallsPerCell(2)).toBe(21);
    expect(worstCaseCallsPerCell(3)).toBe(85);
  });

  it('keeps the expected estimate far below the uniform worst case', () => {
    const estimate = estimateCalls({ baseCells: 1200, maxDepth: 2 });
    expect(estimate.worstCase).toBe(25_200);
    expect(estimate.expected).toBeLessThan(3_000);
    expect(estimate.expected).toBeGreaterThan(1_200);
  });
});
