import { describe, expect, it } from 'vitest';
import {
  VARIANTS,
  runCorpus,
  repeatHandProbe,
  sensitivityProbe,
  explorationProbe,
  freshHandProbe,
  type CorpusResult,
} from '@/lib/__evals__/matcherEval';

/**
 * g-7de10fce corpus gates — the REGRESSION CONTRACT for matcher v1.1.
 *
 * The adopted variant is `combined` (frequency-weighted Loved affinity +
 * cautious avoid-tag nudge). These gates encode the evidence that
 * justified adoption (docs/MATCHER-EVAL-g-7de10fce-2026-08-04.md); if a
 * future change breaks any of them, the change loses its evidence and
 * must re-earn it.
 *
 * Epsilons are deliberate: the corpus is deterministic, so equality
 * would hold today — the tolerance is headroom for legitimate future
 * catalog edits (the corpus runs over the real bundled catalog), not
 * for scoring regressions.
 */

const results = new Map<string, CorpusResult>(
  VARIANTS.map((v) => [v, runCorpus(v)]),
);
const baseline = results.get('baseline') as CorpusResult;
const combined = results.get('combined') as CorpusResult;

describe('corpus: hard filters are inviolable for EVERY variant', () => {
  it.each(VARIANTS.map((v) => [v] as const))('%s: zero violations', (v) => {
    expect((results.get(v) as CorpusResult).aggregate.totalViolations).toBe(0);
  });
});

describe('corpus: the adopted variant (combined) keeps its evidence', () => {
  it('loved-alignment improves over baseline in history scenarios', () => {
    expect(combined.aggregate.meanLovedAlignment).toBeGreaterThan(
      baseline.aggregate.meanLovedAlignment,
    );
  });

  it('avoid-tag exposure strictly improves (the evidence that justified candidate B)', () => {
    // Equality would mean the nudge went inert — the adoption evidence
    // is a measured REDUCTION, so the gate demands one (santa: Codex).
    expect(combined.aggregate.meanAvoidHit).toBeLessThan(
      baseline.aggregate.meanAvoidHit,
    );
  });

  it('vibe relevance is not sacrificed (within epsilon)', () => {
    expect(combined.aggregate.meanVibe).toBeGreaterThanOrEqual(
      baseline.aggregate.meanVibe - 0.01,
    );
  });

  it('geographic cost stays a tie-breaker, not a trade (≤ 0.05 mi mean)', () => {
    expect(combined.aggregate.meanMiles).toBeLessThanOrEqual(
      baseline.aggregate.meanMiles + 0.05,
    );
  });

  it('diversity does not collapse (neighborhoods, tag entropy within eps)', () => {
    expect(combined.aggregate.meanHoodCount).toBeGreaterThanOrEqual(
      baseline.aggregate.meanHoodCount - 0.1,
    );
    expect(combined.aggregate.meanEntropy).toBeGreaterThanOrEqual(
      baseline.aggregate.meanEntropy - 0.05,
    );
  });

  it('stale-hours exposure does not worsen', () => {
    expect(combined.aggregate.meanStaleHoursShare).toBeLessThanOrEqual(
      baseline.aggregate.meanStaleHoursShare + 0.01,
    );
  });
});

describe('corpus: cold-start (1 Loved + 1 Passed — GLM consult 2026-08-04)', () => {
  const coldIds = baseline.scenarios
    .filter((s) => s.scenarioId.endsWith('/ev-coldstart'))
    .map((s) => s.scenarioId);

  it('the corpus actually contains cold-start scenarios', () => {
    expect(coldIds.length).toBeGreaterThanOrEqual(4);
  });

  it('the avoid nudge is SILENT at cold start (caution rule: 1 Passed < minimum)', () => {
    for (const id of coldIds) {
      const row = (results.get('combined') as CorpusResult).scenarios.find(
        (s) => s.scenarioId === id,
      );
      // avoidHit is null exactly when the avoid map is empty — one bad
      // night must never become a taste verdict.
      expect(row?.top5AvoidHit).toBeNull();
    }
  });

  it('single-Loved weighted affinity does not echo-chamber the hand (entropy within eps of baseline)', () => {
    for (const id of coldIds) {
      const base = baseline.scenarios.find((s) => s.scenarioId === id);
      const cand = (results.get('combined') as CorpusResult).scenarios.find(
        (s) => s.scenarioId === id,
      );
      expect(cand?.top5TagEntropy ?? 0).toBeGreaterThanOrEqual(
        (base?.top5TagEntropy ?? 0) - 0.05,
      );
      expect(cand?.top5MeanVibe ?? 0).toBeGreaterThanOrEqual(
        (base?.top5MeanVibe ?? 0) - 0.01,
      );
    }
  });
});

describe('corpus: behavioral probes', () => {
  it.each(VARIANTS.map((v) => [v] as const))(
    '%s: repeat hand is disjoint from the first hand',
    (v) => {
      expect(repeatHandProbe(v).disjoint).toBe(true);
    },
  );

  it('repeat-hand relevance decays gracefully for the adopted variant (second hand ≥ 80% of first)', () => {
    const probe = repeatHandProbe('combined');
    expect(probe.secondMeanVibe).toBeGreaterThanOrEqual(
      probe.firstMeanVibe * 0.8,
    );
  });

  it('repeat-hand improvement is variant-relative: combined second hand ≥ baseline second hand (santa: Codex)', () => {
    expect(repeatHandProbe('combined').secondMeanVibe).toBeGreaterThanOrEqual(
      repeatHandProbe('baseline').secondMeanVibe,
    );
  });

  it('exploration slot survives every variant: present, long-tail, and the candidate set is NEVER filtered by taste signals (santa: Fable)', () => {
    for (const v of VARIANTS) {
      const probe = explorationProbe(v);
      expect(probe.slotPresent).toBe(true);
      expect(probe.slotOutsidePureTop).toBe(true);
      expect(probe.candidateSetMatchesBaseline).toBe(true);
    }
  });

  it('fresh-hand/widening path: zero violations, soft-seen ≡ hard-exclusion equivalence, per variant with ITS OWN first hand (santa: Fable r1 + Codex r2)', () => {
    for (const v of VARIANTS) {
      const probe = freshHandProbe(v);
      expect(probe.violations).toBe(0);
      expect(probe.softSeenEquivalenceHolds).toBe(true);
      expect(probe.seenStillIncluded).toBe(true);
    }
  });

  it('matching is deterministic and sensitive to profile changes', () => {
    const s = sensitivityProbe('combined');
    expect(s.deterministic).toBe(true);
    // Swapping one tag must actually change the hand…
    expect(s.swapOverlap).toBeLessThan(1);
    // …but not scramble it into randomness (some stability retained).
    expect(s.swapOverlap).toBeGreaterThan(0);
  });
});
