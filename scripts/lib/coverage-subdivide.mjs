/**
 * Saturation-driven adaptive subdivision.
 *
 * Google truncates every search at maxResultCount. A response that comes back
 * exactly at the cap is not a result — it is a *censored* result, and the only
 * way to see past it is to ask about a smaller piece of geography. This module
 * plans the base tiling, detects the cap, and produces bounded quadtree
 * children for cells that hit it.
 *
 * The radius must shrink with the cell. Reusing the base 325m radius on a 90m
 * subcell would put ~90% of each call's area outside the cell it is meant to
 * resolve: pure spend, and it re-imports the truncation you just subdivided to
 * escape.
 */
const LAT_METERS = 111_320;
const SQRT2 = Math.SQRT2;

/** places:searchNearby rejects a degenerate radius; stay clear of the floor. */
export const MIN_RADIUS_METERS = 40;

export const DEFAULT_SUBDIVISION = Object.freeze({
  maxDepth: 2,
  minCellMeters: 90,
  branching: 4,
});

/**
 * Radius of the circle that fully contains a square cell — the half-diagonal.
 * Anything smaller leaves the corners unsearched, which is a silent recall
 * hole rather than a visible failure.
 */
export function radiusForSide(sideMeters) {
  return Math.max(MIN_RADIUS_METERS, Math.round((sideMeters / 2) * SQRT2));
}

/**
 * The gap guard, evaluated at whatever level it is called with. The sweep's
 * original start-up check used only the base radius; under subdivision that
 * check says nothing about the levels where coverage actually gets thin.
 */
export function assertCoversCell(sideMeters, radiusMeters) {
  if (radiusMeters < (sideMeters / 2) * SQRT2 - 0.5) {
    throw new Error(
      `radius ${radiusMeters}m leaves the corners of a ${sideMeters}m cell unsearched ` +
        `(needs >= ${Math.ceil((sideMeters / 2) * SQRT2)}m)`,
    );
  }
  return true;
}

export function bboxCenter(bbox) {
  return {
    latitude: (bbox.north + bbox.south) / 2,
    longitude: (bbox.east + bbox.west) / 2,
  };
}

/** Longest side of the cell in meters — subdivision is driven by the worst case. */
export function bboxSideMeters(bbox) {
  const middleLat = (bbox.north + bbox.south) / 2;
  const height = (bbox.north - bbox.south) * LAT_METERS;
  const width =
    (bbox.east - bbox.west) * LAT_METERS * Math.cos((middleLat * Math.PI) / 180);
  return Math.max(height, width);
}

/**
 * Tile a region into square-ish cells of at most `stepMeters` per side. Unlike
 * gridForBbox (which emits corner POINTS and is kept for the legacy path),
 * this emits CELLS with extent, because a cell is what you can subdivide.
 */
export function planCells(bbox, stepMeters, { prefix = 'n' } = {}) {
  if (!Number.isFinite(stepMeters) || stepMeters <= 0) {
    throw new Error('stepMeters must be positive');
  }
  const middleLat = (bbox.north + bbox.south) / 2;
  const height = (bbox.north - bbox.south) * LAT_METERS;
  const width =
    (bbox.east - bbox.west) * LAT_METERS * Math.cos((middleLat * Math.PI) / 180);
  const rows = Math.max(1, Math.ceil(height / stepMeters));
  const columns = Math.max(1, Math.ceil(width / stepMeters));
  const latSpan = (bbox.north - bbox.south) / rows;
  const lngSpan = (bbox.east - bbox.west) / columns;

  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const south = bbox.south + latSpan * row;
      const west = bbox.west + lngSpan * column;
      const cellBbox = {
        north: south + latSpan,
        west,
        south,
        east: west + lngSpan,
      };
      cells.push(makeCell(`${prefix}:${row}:${column}`, cellBbox, 0));
    }
  }
  return cells;
}

function makeCell(id, bbox, depth, extra = {}) {
  const sideMeters = Math.round(bboxSideMeters(bbox));
  return {
    id,
    bbox,
    depth,
    sideMeters,
    center: bboxCenter(bbox),
    radiusMeters: radiusForSide(sideMeters),
    ...extra,
  };
}

/**
 * A response that returned exactly the cap it was allowed is censored. `>=`
 * rather than `===` because a future API change that returns more than
 * requested must not read as "not truncated".
 */
export function isSaturated(resultCount, maxResultCount) {
  return resultCount >= maxResultCount;
}

/**
 * Quadtree children, or null when the bounds forbid going further. Returning
 * null (rather than an empty array) forces the caller to make the
 * saturated-at-floor decision explicitly instead of treating "no children" as
 * "nothing left to do".
 */
export function subdivideCell(cell, options = {}) {
  const { maxDepth, minCellMeters } = { ...DEFAULT_SUBDIVISION, ...options };
  if (cell.depth >= maxDepth) return null;
  const childSide = cell.sideMeters / 2;
  if (childSide < minCellMeters) return null;

  const { north, west, south, east } = cell.bbox;
  const midLat = (north + south) / 2;
  const midLng = (east + west) / 2;
  const quadrants = [
    { north, west, south: midLat, east: midLng },
    { north, west: midLng, south: midLat, east },
    { north: midLat, west, south, east: midLng },
    { north: midLat, west: midLng, south, east },
  ];
  return quadrants.map((bbox, index) =>
    makeCell(`${cell.id}/${index}`, bbox, cell.depth + 1, {
      parentId: cell.id,
      ...(cell.query ? { query: cell.query } : {}),
      ...(cell.kind ? { kind: cell.kind } : {}),
    }),
  );
}

/**
 * Worst-case call count for one cell that saturates at every level:
 * C(D) = 1 + 4*C(D-1), C(0) = 1  =>  (4^(D+1) - 1) / 3.
 * Used for the pre-flight estimate and the budget check, so an operator sees
 * the ceiling before paying for it.
 */
export function worstCaseCallsPerCell(maxDepth) {
  return (4 ** (maxDepth + 1) - 1) / 3;
}

/**
 * Expected calls at a realistic saturation rate. Saturation in NYC clusters in
 * commercial corridors rather than spreading uniformly, so the uniform worst
 * case badly overstates a real sweep — but it is what --max-calls must survive.
 */
export function estimateCalls({
  baseCells,
  maxDepth = DEFAULT_SUBDIVISION.maxDepth,
  saturationRate = 0.15,
  decay = 0.4,
}) {
  let calls = baseCells;
  let saturatedCells = baseCells * saturationRate;
  for (let depth = 0; depth < maxDepth; depth++) {
    const children = saturatedCells * 4;
    calls += children;
    saturatedCells = children * saturationRate * decay;
  }
  return {
    expected: Math.ceil(calls),
    worstCase: Math.ceil(baseCells * worstCaseCallsPerCell(maxDepth)),
  };
}

/** Text Search clears saturation by shrinking the viewport, not the circle. */
export function planTextCells(bbox, queries, { prefix = 't' } = {}) {
  return queries.map((query, index) =>
    makeCell(`${prefix}:${index}`, bbox, 0, { kind: 'text', query }),
  );
}
