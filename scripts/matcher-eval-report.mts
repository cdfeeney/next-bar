/**
 * matcher-eval-report — print the g-7de10fce offline evaluation table
 * (baseline vs candidates) from the SAME engine the vitest gates use.
 * Usage: npx tsx scripts/matcher-eval-report.mts
 */
import {
  VARIANTS,
  runCorpus,
  repeatHandProbe,
  sensitivityProbe,
} from '../src/lib/__evals__/matcherEval';

const f = (n: number | null): string => (n === null ? '—' : n.toFixed(4));
for (const variant of VARIANTS) {
  const r = runCorpus(variant);
  const a = r.aggregate;
  const probe = repeatHandProbe(variant);
  console.log(
    [
      variant.padEnd(13),
      `viol=${a.totalViolations}`,
      `vibe=${f(a.meanVibe)}`,
      `miles=${f(a.meanMiles)}`,
      `hoods=${f(a.meanHoodCount)}`,
      `entropy=${f(a.meanEntropy)}`,
      `staleHrs=${f(a.meanStaleHoursShare)}`,
      `lovedAlign=${f(a.meanLovedAlignment)}`,
      `avoidHit=${f(a.meanAvoidHit)}`,
      `repeatDisjoint=${probe.disjoint}`,
      `repeatVibe=${f(probe.firstMeanVibe)}→${f(probe.secondMeanVibe)}`,
    ].join('  '),
  );
}
const s = sensitivityProbe('baseline');
console.log(`sensitivity: deterministic=${s.deterministic} swapOverlap=${s.swapOverlap.toFixed(2)}`);
// Per-scenario detail for the history scenarios (where A/B act):
for (const variant of VARIANTS) {
  const r = runCorpus(variant);
  for (const row of r.scenarios) {
    if (row.top5LovedAlignment === null) continue;
    console.log(
      `${variant.padEnd(13)} ${row.scenarioId.padEnd(32)} vibe=${f(row.top5MeanVibe)} lovedAlign=${f(row.top5LovedAlignment)} avoidHit=${f(row.top5AvoidHit)} miles=${f(row.top5MeanMiles)} hoods=${row.top5HoodCount}`,
    );
  }
}
