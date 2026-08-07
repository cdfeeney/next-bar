/**
 * Deterministic coverage evaluator.
 *
 * Recall and precision are the two things the sweep has never been able to
 * state about itself. Without them, "we found more bars" and "we loosened the
 * filter" look identical. This scores a run against labelled golden fixtures
 * and reports both, broken out by the dimensions that actually move
 * independently: source, borough, and venue type.
 *
 * Everything here is pure. No network, no clock, no ordering dependence.
 */
import { normalizeName } from './coverage-search.mjs';
import { boroughOf } from './coverage-identity.mjs';

/** Golden labels. `bar` and `duplicate` are positives for recall. */
export const GOLDEN_LABELS = Object.freeze(['bar', 'not_bar', 'duplicate']);

function goldenKey(row) {
  return row.placeId ? `place:${row.placeId}` : `name:${normalizeName(row.name ?? '')}`;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function emptyBucket() {
  return {
    expected: 0,
    found: 0,
    accepted: 0,
    acceptedCorrect: 0,
    duplicates: 0,
    duplicatesCorrect: 0,
  };
}

function bucketFor(groups, key) {
  if (!key) return null;
  const existing = groups.get(key);
  if (existing) return existing;
  const created = emptyBucket();
  groups.set(key, created);
  return created;
}

function finalizeGroups(groups) {
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bucket]) => [
        key,
        {
          ...bucket,
          candidateRecall: ratio(bucket.found, bucket.expected),
          autoAcceptPrecision: ratio(bucket.acceptedCorrect, bucket.accepted),
          duplicatePrecision: ratio(bucket.duplicatesCorrect, bucket.duplicates),
        },
      ]),
  );
}

/**
 * Score `actualRows` (reviewed candidates carrying a `decision`) against
 * `goldens` (labelled fixtures).
 *
 * Precision denominators count only rows that HAVE a golden label. An
 * unlabelled row is unknown, not wrong — counting it as wrong would punish the
 * recall work this evaluator exists to encourage, and counting it as right
 * would be a lie.
 */
export function evaluateCoverage(goldens, actualRows) {
  const actualByKey = new Map(actualRows.map((row) => [goldenKey(row), row]));
  const bySource = new Map();
  const byBorough = new Map();
  const byType = new Map();

  let expected = 0;
  let found = 0;
  let accepted = 0;
  let acceptedCorrect = 0;
  let duplicates = 0;
  let duplicatesCorrect = 0;
  const missed = [];
  const falseAccepts = [];
  const falseDuplicates = [];

  for (const golden of goldens) {
    if (!GOLDEN_LABELS.includes(golden.label)) {
      throw new Error(`golden ${golden.name}: unknown label ${golden.label}`);
    }
    const actual = actualByKey.get(goldenKey(golden));
    const borough = golden.borough ?? boroughOf(golden) ?? 'unknown';
    const type = golden.primaryType || 'unknown';
    const sources = actual?.sources?.length ? actual.sources : [golden.source ?? 'unknown'];
    const buckets = [
      ...sources.map((source) => bucketFor(bySource, source)),
      bucketFor(byBorough, borough),
      bucketFor(byType, type),
    ].filter(Boolean);

    // Recall counts venues that SHOULD surface as candidates: real bars and
    // known duplicates both must be seen before they can be judged. A not_bar
    // golden is a precision probe, never a recall target.
    const isRecallTarget = golden.label !== 'not_bar';
    if (isRecallTarget) {
      expected += 1;
      for (const bucket of buckets) bucket.expected += 1;
      if (actual) {
        found += 1;
        for (const bucket of buckets) bucket.found += 1;
      } else {
        missed.push({ name: golden.name, borough, type, label: golden.label });
      }
    }

    if (!actual) continue;

    if (actual.decision === 'accept') {
      accepted += 1;
      for (const bucket of buckets) bucket.accepted += 1;
      if (golden.label === 'bar') {
        acceptedCorrect += 1;
        for (const bucket of buckets) bucket.acceptedCorrect += 1;
      } else {
        falseAccepts.push({ name: golden.name, borough, type, label: golden.label });
      }
    }

    if (actual.decision === 'duplicate') {
      duplicates += 1;
      for (const bucket of buckets) bucket.duplicates += 1;
      if (golden.label === 'duplicate') {
        duplicatesCorrect += 1;
        for (const bucket of buckets) bucket.duplicatesCorrect += 1;
      } else {
        falseDuplicates.push({ name: golden.name, borough, type, label: golden.label });
      }
    }
  }

  return {
    totals: {
      goldens: goldens.length,
      recallTargets: expected,
      candidatesFound: found,
      candidateRecall: ratio(found, expected),
      autoAccepts: accepted,
      autoAcceptPrecision: ratio(acceptedCorrect, accepted),
      duplicateCalls: duplicates,
      duplicatePrecision: ratio(duplicatesCorrect, duplicates),
    },
    bySource: finalizeGroups(bySource),
    byBorough: finalizeGroups(byBorough),
    byType: finalizeGroups(byType),
    missed,
    falseAccepts,
    falseDuplicates,
  };
}

function pct(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

export function formatEvaluation(report) {
  const { totals } = report;
  const lines = [
    'coverage evaluation',
    `  candidate recall      ${pct(totals.candidateRecall)}  (${totals.candidatesFound}/${totals.recallTargets})`,
    `  auto-accept precision ${pct(totals.autoAcceptPrecision)}  (${totals.autoAccepts} auto-accepts)`,
    `  duplicate precision   ${pct(totals.duplicatePrecision)}  (${totals.duplicateCalls} duplicate calls)`,
  ];
  for (const [title, groups] of [
    ['by source', report.bySource],
    ['by borough', report.byBorough],
    ['by type', report.byType],
  ]) {
    lines.push(`  ${title}:`);
    for (const [key, bucket] of Object.entries(groups)) {
      lines.push(
        `    ${key.padEnd(22)} recall ${pct(bucket.candidateRecall).padStart(6)}` +
          `  accept-precision ${pct(bucket.autoAcceptPrecision).padStart(6)}` +
          `  dup-precision ${pct(bucket.duplicatePrecision).padStart(6)}`,
      );
    }
  }
  if (report.missed.length > 0) {
    lines.push(`  missed (${report.missed.length}):`);
    for (const item of report.missed) {
      lines.push(`    ${item.name} [${item.borough}/${item.type}]`);
    }
  }
  if (report.falseAccepts.length > 0) {
    lines.push(`  false auto-accepts (${report.falseAccepts.length}):`);
    for (const item of report.falseAccepts) {
      lines.push(`    ${item.name} [labelled ${item.label}]`);
    }
  }
  return lines.join('\n');
}
