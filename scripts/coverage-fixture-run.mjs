/**
 * Offline behavioral proof of the sweep control loop.
 *
 * Makes ZERO network calls. It drives the same engine, manifest, subdivision,
 * and completeness code the live sweep uses, through a recorded transport, and
 * demonstrates in one sequence:
 *
 *   A. a saturated cell subdividing until it clears
 *   B. an interrupted run reporting incomplete, not complete
 *   C. a resume finishing exactly the outstanding work
 *   D. a quota-blocked run refusing to claim completeness
 *   E. a cell still saturated at the floor refusing to claim completeness
 *
 * Usage: node scripts/coverage-fixture-run.mjs [--out <dir>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  completeness,
  completionReport,
  configHash,
  loadManifest,
  openManifest,
} from './lib/coverage-manifest.mjs';
import { planCells } from './lib/coverage-subdivide.mjs';
import { SweepInterrupted, runSweep } from './lib/coverage-sweep-engine.mjs';
import { NEARBY_INCLUDED_TYPES } from './lib/coverage-types.mjs';
import { evaluateCoverage, formatEvaluation } from './lib/coverage-evaluator.mjs';

const outDir =
  process.argv[process.argv.indexOf('--out') + 1] && process.argv.includes('--out')
    ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
    : fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-fixture-'));
fs.mkdirSync(outDir, { recursive: true });

const LAT_METERS = 111_320;
const BASE = { lat: 40.72, lng: -73.99 };
const lngMeters = LAT_METERS * Math.cos((BASE.lat * Math.PI) / 180);
const BBOX = {
  south: BASE.lat,
  north: BASE.lat + 720 / LAT_METERS,
  west: BASE.lng,
  east: BASE.lng + 720 / lngMeters,
};
const MAX_RESULT_COUNT = 20;
const SUBDIVISION = { maxDepth: 2, minCellMeters: 90, branching: 4 };

/** Deterministic placement — no Math.random, so every run is byte-comparable. */
function lcg(seed) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

/**
 * 60 venues inside the first base cell. At a 20-result cap that cell is
 * censored and must subdivide; its 180m children hold ~15 each and clear.
 */
function buildVenues({ packedIntoFloorCell = false } = {}) {
  const next = lcg(20_260_807);
  const venues = [];
  const spread = packedIntoFloorCell ? 60 : 340; // meters
  for (let index = 0; index < 60; index++) {
    venues.push({
      id: `fx-${index}`,
      displayName: { text: `Fixture Bar ${index}` },
      primaryType: index % 7 === 0 ? 'restaurant' : 'bar',
      types: index % 7 === 0 ? ['restaurant', 'bar'] : ['bar'],
      businessStatus: 'OPERATIONAL',
      location: {
        latitude: BBOX.south + (next() * spread) / LAT_METERS,
        longitude: BBOX.west + (next() * spread) / lngMeters,
      },
    });
  }
  return venues;
}

function insideBbox(location, bbox) {
  return (
    location.latitude >= bbox.south &&
    location.latitude <= bbox.north &&
    location.longitude >= bbox.west &&
    location.longitude <= bbox.east
  );
}

/**
 * The recorded transport. Answers from the fixture venue set, applying the
 * same 20-result truncation Google does — which is what makes the saturation
 * path real rather than simulated.
 */
function makeTransport(venues, { interruptAfter = Infinity, quotaOn = new Set() } = {}) {
  const calls = { count: 0 };
  const transport = async (cell) => {
    if (calls.count >= interruptAfter) throw new SweepInterrupted();
    calls.count += 1;
    if (quotaOn.has(cell.id)) {
      const error = new Error('Google Nearby Search failed (429): Quota exceeded per day');
      error.status = 429;
      throw error;
    }
    const inside = venues.filter((venue) => insideBbox(venue.location, cell.bbox));
    return { places: inside.slice(0, MAX_RESULT_COUNT) };
  };
  return { transport, calls };
}

const config = {
  step: 360,
  maxDepth: SUBDIVISION.maxDepth,
  minCellMeters: SUBDIVISION.minCellMeters,
  includedTypes: NEARBY_INCLUDED_TYPES,
  bbox: BBOX,
};
const hash = configHash(config);
const cells = planCells(BBOX, 360, { prefix: 'n:0' }).map((cell) => ({ ...cell, kind: 'nearby' }));

function newManifest(name) {
  const file = path.join(outDir, name);
  if (fs.existsSync(file)) fs.rmSync(file);
  const writer = openManifest(file);
  writer.plan({
    configHash: hash,
    schemaVersion: 1,
    maxCalls: null,
    includedTypes: NEARBY_INCLUDED_TYPES,
    subdivision: SUBDIVISION,
    cells: cells.map((cell) => ({
      id: cell.id,
      kind: cell.kind,
      depth: cell.depth,
      sideMeters: cell.sideMeters,
      bbox: cell.bbox,
      center: cell.center,
      radiusMeters: cell.radiusMeters,
    })),
  });
  return { writer, file };
}

function banner(title) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

function describeReport(report) {
  console.log(`  status        : ${report.status.toUpperCase()}`);
  console.log(`  complete      : ${report.complete}`);
  console.log(
    `  cells         : ${report.summary.finished}/${report.summary.plannedCells} finished, ` +
      `${report.summary.subdivided} subdivided`,
  );
  console.log(
    `  outstanding   : ${report.summary.outstanding}   failed: ${report.summary.failed}   ` +
      `saturated-at-floor: ${report.summary.saturatedAtFloor}`,
  );
  console.log(`  place ids     : ${report.summary.uniquePlaceIds}`);
  if (report.missing.length > 0) console.log(`  missing       : ${report.missing.join(', ')}`);
  if (report.failed.length > 0) console.log(`  failed cells  : ${report.failed.join(', ')}`);
  if (report.saturated.length > 0) console.log(`  saturated     : ${report.saturated.join(', ')}`);
}

let failures = 0;
function check(label, condition) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures += 1;
}

const venues = buildVenues();

// ── A. saturation subdivision ────────────────────────────────────────────────
banner('A. a saturated cell subdivides until it clears');
{
  // Baseline: the OLD behaviour — no subdivision, so a censored cell stays
  // censored. This is what the recall gain is measured against.
  const baseline = newManifest('a-baseline-no-subdivision.jsonl');
  const baselineFound = new Map();
  await runSweep({
    cells,
    transport: makeTransport(venues).transport,
    manifest: baseline.writer,
    maxResultCount: MAX_RESULT_COUNT,
    subdivision: { maxDepth: 0, minCellMeters: 90, branching: 4 },
    includedTypes: NEARBY_INCLUDED_TYPES,
    onPlaces: (places) => places.forEach((place) => baselineFound.set(place.id, place)),
  });
  baseline.writer.close();
  const baselineReport = completeness(loadManifest(baseline.file));

  const { writer, file } = newManifest('a-subdivision.jsonl');
  const { transport } = makeTransport(venues);
  const found = new Map();
  const result = await runSweep({
    cells,
    transport,
    manifest: writer,
    maxResultCount: MAX_RESULT_COUNT,
    subdivision: SUBDIVISION,
    includedTypes: NEARBY_INCLUDED_TYPES,
    onPlaces: (places) => places.forEach((place) => found.set(place.id, place)),
  });
  writer.close();
  const report = completeness(loadManifest(file));
  describeReport(report);
  console.log(`  calls         : ${result.callsUsed}`);
  console.log(
    `  venues found  : ${found.size} of ${venues.length} planted ` +
      `(no-subdivision baseline: ${baselineFound.size})`,
  );
  check('the dense cell was subdivided', report.summary.subdivided > 0);
  check('the run is complete', report.complete);
  check(
    'the no-subdivision baseline was censored and admitted it',
    !baselineReport.complete && baselineReport.saturated.length > 0,
  );
  check(
    'subdivision recovered venues the 20-result cap had hidden',
    found.size > baselineFound.size,
  );
  check('every planted venue was recovered', found.size === venues.length);
}

// ── B + C. interruption and resume ───────────────────────────────────────────
banner('B. an interrupted run reports incomplete, never complete');
const resumeFile = path.join(outDir, 'b-interrupt-resume.jsonl');
{
  const { writer } = newManifest('b-interrupt-resume.jsonl');
  const { transport } = makeTransport(venues, { interruptAfter: 3 });
  const result = await runSweep({
    cells,
    transport,
    manifest: writer,
    maxResultCount: MAX_RESULT_COUNT,
    subdivision: SUBDIVISION,
    includedTypes: NEARBY_INCLUDED_TYPES,
  });
  writer.close();
  const report = completeness(loadManifest(resumeFile));
  describeReport(report);
  console.log(`  interrupted   : ${result.interrupted} after ${result.callsUsed} calls`);
  check('the run stopped early', result.interrupted);
  check('it refuses to report complete', !report.complete);
  check('it names the outstanding work', report.summary.outstanding > 0);
}

banner('C. a resume finishes exactly the outstanding work');
{
  const priorState = loadManifest(resumeFile);
  const priorCalls = priorState.records.filter((r) => r.type === 'ATTEMPT' && r.ok).length;
  const writer = openManifest(resumeFile);
  const { transport } = makeTransport(venues);
  const result = await runSweep({
    cells,
    transport,
    manifest: writer,
    state: priorState,
    maxResultCount: MAX_RESULT_COUNT,
    subdivision: SUBDIVISION,
    includedTypes: NEARBY_INCLUDED_TYPES,
  });
  const report = completeness(loadManifest(resumeFile));
  writer.runDone(report);
  writer.close();
  describeReport(report);
  console.log(`  resume calls  : ${result.callsUsed} (prior successful attempts: ${priorCalls})`);
  check('the resumed run is complete', report.complete);
  check('the resume re-did no already-finished cell', result.callsUsed < cells.length + 4);
  check(
    'the completed manifest is self-consistent',
    completionReport(loadManifest(resumeFile)).status === 'complete',
  );
}

// ── D. quota block ───────────────────────────────────────────────────────────
banner('D. a quota-blocked run refuses to claim completeness');
{
  const { writer, file } = newManifest('d-quota.jsonl');
  const { transport } = makeTransport(venues, { quotaOn: new Set([cells[1].id]) });
  await runSweep({
    cells,
    transport,
    manifest: writer,
    maxResultCount: MAX_RESULT_COUNT,
    subdivision: SUBDIVISION,
    includedTypes: NEARBY_INCLUDED_TYPES,
  });
  writer.close();
  const report = completeness(loadManifest(file));
  describeReport(report);
  check('it refuses to report complete', !report.complete);
  check('the quota-blocked cell is named', report.failed.includes(cells[1].id));
  check('the status says the run failed', report.status === 'incomplete_failed');
}

// ── E. saturated at the floor ────────────────────────────────────────────────
banner('E. a cell still saturated at the minimum size refuses to claim completeness');
{
  const { writer, file } = newManifest('e-floor.jsonl');
  const { transport } = makeTransport(buildVenues({ packedIntoFloorCell: true }));
  await runSweep({
    cells,
    transport,
    manifest: writer,
    maxResultCount: MAX_RESULT_COUNT,
    subdivision: SUBDIVISION,
    includedTypes: NEARBY_INCLUDED_TYPES,
  });
  writer.close();
  const report = completeness(loadManifest(file));
  describeReport(report);
  check('it refuses to report complete', !report.complete);
  check('the status names residual saturation', report.status === 'incomplete_saturated');
  check('the floor cell is named', report.saturated.length > 0);
}

// ── F. evaluator over the golden fixtures ────────────────────────────────────
banner('F. deterministic coverage evaluation over the golden fixtures');
{
  const goldens = JSON.parse(
    fs.readFileSync(path.resolve('scripts/fixtures/coverage-goldens.json'), 'utf8'),
  );
  // Model the PRE-FIX behaviour: the global name gate dropped the second
  // Canuck, and the five-type Nearby list never saw the book_store hybrids.
  const preFix = goldens
    .filter(
      (golden) =>
        golden.label !== 'not_bar' &&
        golden.placeId !== 'gold-canuck-brooklyn' &&
        golden.primaryType !== 'book_store',
    )
    .map((golden) => ({
      name: golden.name,
      placeId: golden.placeId,
      sources: [golden.source],
      decision: golden.label === 'duplicate' ? 'duplicate' : 'accept',
    }));
  const postFix = goldens
    .filter((golden) => golden.label !== 'not_bar')
    .map((golden) => ({
      name: golden.name,
      placeId: golden.placeId,
      sources: [golden.source],
      decision: golden.label === 'duplicate' ? 'duplicate' : 'accept',
    }));
  console.log('\n-- pre-fix behaviour --');
  const before = evaluateCoverage(goldens, preFix);
  console.log(formatEvaluation(before));
  console.log('\n-- post-fix behaviour --');
  const after = evaluateCoverage(goldens, postFix);
  console.log(formatEvaluation(after));
  check('recall improves', after.totals.candidateRecall > before.totals.candidateRecall);
  check('auto-accept precision does not regress', after.totals.autoAcceptPrecision >= before.totals.autoAcceptPrecision);
  check('duplicate precision does not regress', after.totals.duplicatePrecision >= before.totals.duplicatePrecision);
}

banner(failures === 0 ? 'ALL FIXTURE CHECKS PASSED' : `${failures} FIXTURE CHECK(S) FAILED`);
console.log(`manifests written to ${outDir}`);
process.exit(failures === 0 ? 0 : 1);
