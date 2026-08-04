import type { Bar, Coords, ManhattanNeighborhood, VibeProfile, VibeTag } from '@/types';
import { bars as CATALOG } from '@/lib/bars';
import { jaccard, matches } from '@/lib/matching';
import { haversineMiles } from '@/lib/distance';
import { daysAgo } from '@/lib/freshness';
import { hasTrustworthyHours } from '@/lib/openNow';
import { LAST_VERIFIED_HARD_FILTER_DAYS } from '@/lib/constants';
import {
  buildAvoidTagWeights,
  buildLovedTagWeights,
  weightedTagCoverage,
  type TagWeights,
} from '@/lib/tasteSignals';

/**
 * matcherEval — reproducible offline evaluation of the bar matcher over
 * the REAL bundled catalog (g-7de10fce, matcher quality v1.1).
 *
 * Everything here is deterministic: a fixed evaluation clock, hand-built
 * scenarios, and persona histories derived from the catalog by stable
 * id-sort — so a metric delta between two runs is a code change, never
 * noise. The engine is consumed by BOTH the vitest gates
 * (matcherCorpus.eval.test.ts) and the human-readable report script
 * (scripts/matcher-eval-report.mts) so the numbers in the docs and the
 * numbers CI enforces can never diverge.
 *
 * MEASUREMENT vs SCORING: lovedAlignment/avoidHit are computed with the
 * same measurement functions for every variant — a variant is never
 * graded by its own scoring function.
 */

/** Fixed evaluation clock: all catalog lastVerified values (≤2026-07-25)
 * are within the freshness window at this instant. Local-time string so
 * the late-night bias reads local hours the way live surfaces do. */
export const EVAL_NOW = new Date('2026-08-01T21:00:00');
/** Late-night variant of the clock (01:30 local = bias window). */
export const EVAL_LATE = new Date('2026-08-02T01:30:00');

export type VariantId = 'baseline' | 'weightedLoved' | 'avoidTags' | 'combined';
export const VARIANTS: readonly VariantId[] = [
  'baseline',
  'weightedLoved',
  'avoidTags',
  'combined',
];

export type Persona = {
  id: string;
  tags: VibeTag[];
  /** Tags that define what this persona keeps loving (history seed). */
  lovedSeedTags: VibeTag[];
  /** Tags that define what this persona keeps passing on (history seed). */
  passedSeedTags: VibeTag[];
};

export const PERSONAS: readonly Persona[] = [
  {
    id: 'divey-locals',
    tags: ['dive', 'locals', 'beer'],
    lovedSeedTags: ['dive', 'rough'],
    passedSeedTags: ['polished', 'trendy'],
  },
  {
    id: 'cocktail-date',
    tags: ['cocktail', 'date', 'polished'],
    lovedSeedTags: ['cocktail', 'speakeasy'],
    passedSeedTags: ['loud', 'rough'],
  },
  {
    id: 'dance-late',
    tags: ['dance', 'loud', 'trendy'],
    lovedSeedTags: ['dance', 'club'],
    passedSeedTags: ['chill', 'wine'],
  },
  {
    id: 'chill-garden',
    tags: ['chill', 'wine', 'garden'],
    lovedSeedTags: ['chill', 'garden'],
    passedSeedTags: ['loud', 'club'],
  },
  { id: 'neutral', tags: [], lovedSeedTags: [], passedSeedTags: [] },
];

/** Deterministic history: the first N id-sorted OPEN catalog bars whose
 * tag list contains ≥1 seed tag (and none of the excluded tags). */
export function pickHistoryBars(
  seedTags: readonly VibeTag[],
  count: number,
  excludeTags: readonly VibeTag[] = [],
): string[] {
  if (seedTags.length === 0) return [];
  return [...CATALOG]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter(
      (b) =>
        b.businessStatus !== 'CLOSED_PERMANENTLY' &&
        seedTags.some((t) => b.tags.includes(t)) &&
        !excludeTags.some((t) => b.tags.includes(t)),
    )
    .slice(0, count)
    .map((b) => b.id);
}

export type Scenario = {
  id: string;
  persona: Persona;
  coords: Coords | null;
  neighborhoods: ManhattanNeighborhood[];
  maxMiles: number | null;
  withHistory: boolean;
  /** 'cold' = 1 Loved + 1 Passed — the most common real new-user state
   * (GLM consult 2026-08-04: the corpus originally jumped from "no
   * history" straight to 6+5). Default 'full' = 6 Loved + 5 Passed. */
  historySize?: 'full' | 'cold';
  late?: boolean;
  maxResults?: number;
};

const EV: Coords = { lat: 40.727, lng: -73.984 }; // dense (East Village)
const HARLEM: Coords = { lat: 40.81, lng: -73.945 }; // sparse
const WBURG: Coords = { lat: 40.714, lng: -73.961 };

function scenarios(): Scenario[] {
  const list: Scenario[] = [];
  for (const persona of PERSONAS) {
    // Dense location, walkable radius, evening.
    list.push({
      id: `${persona.id}/ev-walkable`,
      persona,
      coords: EV,
      neighborhoods: [],
      maxMiles: 0.75,
      withHistory: false,
    });
    // Sparse location, cab radius — exercises relaxation.
    list.push({
      id: `${persona.id}/harlem-cab`,
      persona,
      coords: HARLEM,
      neighborhoods: [],
      maxMiles: 1.5,
      withHistory: false,
    });
    // No location (quiz/planning surface).
    list.push({
      id: `${persona.id}/no-coords`,
      persona,
      coords: null,
      neighborhoods: [],
      maxMiles: null,
      withHistory: false,
    });
    // Neighborhood-constrained.
    list.push({
      id: `${persona.id}/hood-ev`,
      persona,
      coords: null,
      neighborhoods: ['East Village'],
      maxMiles: null,
      withHistory: false,
    });
    if (persona.tags.length > 0) {
      // With Loved/Pass history (the axis candidates A/B act on).
      list.push({
        id: `${persona.id}/ev-history`,
        persona,
        coords: EV,
        neighborhoods: [],
        maxMiles: 1.5,
        withHistory: true,
      });
      list.push({
        id: `${persona.id}/wburg-history-late`,
        persona,
        coords: WBURG,
        neighborhoods: [],
        maxMiles: 1.5,
        withHistory: true,
        late: true,
      });
      // Cold start: 1 Loved + 1 Passed. The caution rule makes the
      // avoid nudge SILENT here (1 < MIN_PASSED_BARS_FOR_AVOID) and the
      // weighted affinity reduces to single-bar coverage — the corpus
      // must show that neither echo-chambers the hand.
      list.push({
        id: `${persona.id}/ev-coldstart`,
        persona,
        coords: EV,
        neighborhoods: [],
        maxMiles: 1.5,
        withHistory: true,
        historySize: 'cold',
      });
    }
  }
  return list;
}

export type ScenarioMetrics = {
  scenarioId: string;
  resultCount: number;
  violations: {
    closed: number;
    staleVerified: number;
    neighborhood: number;
    radius: number;
  };
  top5MeanVibe: number;
  top5MeanMiles: number | null;
  top5HoodCount: number;
  top5TagEntropy: number;
  top5StaleHoursShare: number;
  /** Measured with the persona's weighted loved map for EVERY variant. */
  top5LovedAlignment: number | null;
  /** Measured with the persona's avoid map for EVERY variant. */
  top5AvoidHit: number | null;
};

export type CorpusResult = {
  variant: VariantId;
  scenarios: ScenarioMetrics[];
  aggregate: {
    totalViolations: number;
    meanVibe: number;
    meanMiles: number;
    meanHoodCount: number;
    meanEntropy: number;
    meanStaleHoursShare: number;
    /** Mean over history scenarios only. */
    meanLovedAlignment: number;
    meanAvoidHit: number;
  };
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function tagEntropy(barsIn: Bar[]): number {
  const counts = new Map<string, number>();
  let total = 0;
  for (const b of barsIn) {
    for (const t of b.tags) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      total += 1;
    }
  }
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log(p);
  }
  return h;
}

type History = {
  lovedIds: string[];
  passedIds: string[];
  lovedFlat: VibeTag[];
  lovedWeights: TagWeights;
  avoidWeights: TagWeights;
};

export function personaHistory(
  persona: Persona,
  size: 'full' | 'cold' = 'full',
): History {
  const lovedIds = pickHistoryBars(persona.lovedSeedTags, size === 'cold' ? 1 : 6);
  const passedIds = pickHistoryBars(
    persona.passedSeedTags,
    size === 'cold' ? 1 : 5,
    persona.lovedSeedTags,
  );
  const lovedSet = new Set(lovedIds);
  const lovedFlat = new Set<VibeTag>();
  for (const b of CATALOG) {
    if (lovedSet.has(b.id)) for (const t of b.tags) lovedFlat.add(t);
  }
  return {
    lovedIds,
    passedIds,
    lovedFlat: Array.from(lovedFlat),
    lovedWeights: buildLovedTagWeights(lovedIds, CATALOG),
    avoidWeights: buildAvoidTagWeights(passedIds, lovedIds, CATALOG),
  };
}

function runScenario(
  scenario: Scenario,
  variant: VariantId,
): ScenarioMetrics {
  const history = scenario.withHistory
    ? personaHistory(scenario.persona, scenario.historySize ?? 'full')
    : null;
  const profile = {
    tags: scenario.persona.tags,
    answers: {},
  } as unknown as VibeProfile;

  const results = matches({
    profile,
    coords: scenario.coords,
    preferredNeighborhoods: scenario.neighborhoods,
    maxMiles: scenario.maxMiles,
    bars: CATALOG as Bar[],
    // PRODUCTION PARITY (santa: Codex): both live call sites hard-
    // exclude Pass-rated bars; the corpus must not credit the avoid
    // nudge for demoting bars real callers never admit.
    excludeIds: history?.passedIds,
    maxResults: scenario.maxResults ?? 5,
    now: EVAL_NOW,
    biasNow: scenario.late ? EVAL_LATE : undefined,
    // Flat union is ALWAYS passed when history exists — production
    // callers keep it as the fallback affinity for the ≥2-Loved caution
    // floor; the weighted variants add the weight map on top.
    lovedTags: history !== null ? history.lovedFlat : [],
    lovedTagWeights:
      history !== null &&
      (variant === 'weightedLoved' || variant === 'combined')
        ? history.lovedWeights
        : undefined,
    avoidTagWeights:
      history !== null && (variant === 'avoidTags' || variant === 'combined')
        ? history.avoidWeights
        : undefined,
  });

  const top5 = results.slice(0, 5);
  const allowedHoods = new Set(scenario.neighborhoods);
  const violations = {
    closed: results.filter((b) => b.businessStatus === 'CLOSED_PERMANENTLY')
      .length,
    staleVerified: results.filter(
      (b) => daysAgo(b.lastVerified, EVAL_NOW) > LAST_VERIFIED_HARD_FILTER_DAYS,
    ).length,
    neighborhood:
      scenario.neighborhoods.length === 0
        ? 0
        : results.filter((b) => !allowedHoods.has(b.neighborhood)).length,
    radius:
      scenario.coords === null || scenario.maxMiles === null
        ? 0
        : results.filter(
            (b) =>
              haversineMiles(scenario.coords as Coords, b) >
              (scenario.maxMiles as number) + 1e-9,
          ).length,
  };

  return {
    scenarioId: scenario.id,
    resultCount: results.length,
    violations,
    top5MeanVibe: mean(top5.map((b) => jaccard(scenario.persona.tags, b.tags))),
    top5MeanMiles:
      scenario.coords === null
        ? null
        : mean(top5.map((b) => haversineMiles(scenario.coords as Coords, b))),
    top5HoodCount: new Set(top5.map((b) => b.neighborhood)).size,
    top5TagEntropy: tagEntropy(top5),
    top5StaleHoursShare:
      top5.length === 0
        ? 0
        : top5.filter((b) => !hasTrustworthyHours(b)).length / top5.length,
    top5LovedAlignment:
      history === null || history.lovedWeights.size === 0
        ? null // unmeasurable (cold start below the weight caution floor)
        : mean(
            top5.map((b) => weightedTagCoverage(b.tags, history.lovedWeights)),
          ),
    top5AvoidHit:
      history === null || history.avoidWeights.size === 0
        ? null
        : mean(
            top5.map((b) => weightedTagCoverage(b.tags, history.avoidWeights)),
          ),
  };
}

export function runCorpus(variant: VariantId): CorpusResult {
  const rows = scenarios().map((s) => runScenario(s, variant));
  const withCoords = rows.filter((r) => r.top5MeanMiles !== null);
  const withHistory = rows.filter((r) => r.top5LovedAlignment !== null);
  const withAvoid = rows.filter((r) => r.top5AvoidHit !== null);
  return {
    variant,
    scenarios: rows,
    aggregate: {
      totalViolations: rows.reduce(
        (acc, r) =>
          acc +
          r.violations.closed +
          r.violations.staleVerified +
          r.violations.neighborhood +
          r.violations.radius,
        0,
      ),
      meanVibe: mean(rows.map((r) => r.top5MeanVibe)),
      meanMiles: mean(withCoords.map((r) => r.top5MeanMiles as number)),
      meanHoodCount: mean(rows.map((r) => r.top5HoodCount)),
      meanEntropy: mean(rows.map((r) => r.top5TagEntropy)),
      meanStaleHoursShare: mean(rows.map((r) => r.top5StaleHoursShare)),
      meanLovedAlignment: mean(
        withHistory.map((r) => r.top5LovedAlignment as number),
      ),
      meanAvoidHit: mean(withAvoid.map((r) => r.top5AvoidHit as number)),
    },
  };
}

/** Repeat-hand behavior: second deal excludes the first — must be
 * disjoint; relevance decays gracefully (measured, not gated hard). */
export function repeatHandProbe(variant: VariantId): {
  disjoint: boolean;
  firstMeanVibe: number;
  secondMeanVibe: number;
} {
  const persona = PERSONAS[1]; // cocktail-date
  const history = personaHistory(persona);
  const profile = { tags: persona.tags, answers: {} } as unknown as VibeProfile;
  const common = {
    profile,
    coords: EV,
    preferredNeighborhoods: [] as ManhattanNeighborhood[],
    maxMiles: 1.5,
    bars: CATALOG as Bar[],
    maxResults: 5,
    now: EVAL_NOW,
    lovedTags: history.lovedFlat,
    lovedTagWeights:
      variant === 'weightedLoved' || variant === 'combined'
        ? history.lovedWeights
        : undefined,
    avoidTagWeights:
      variant === 'avoidTags' || variant === 'combined'
        ? history.avoidWeights
        : undefined,
  };
  const first = matches({ ...common, excludeIds: history.passedIds });
  const second = matches({
    ...common,
    excludeIds: [...history.passedIds, ...first.map((b) => b.id)],
  });
  const firstIds = new Set(first.map((b) => b.id));
  return {
    disjoint: second.every((b) => !firstIds.has(b.id)),
    firstMeanVibe: mean(first.map((b) => jaccard(persona.tags, b.tags))),
    secondMeanVibe: mean(second.map((b) => jaccard(persona.tags, b.tags))),
  };
}

/**
 * Exploration probe (santa: Fable — the corpus's 5-result scenarios
 * never trip the ≥10-result exploration branch): a 10-result deal must
 * reserve the last slot for a qualified long-tail pick, and the taste
 * signals must not remove the slot or change WHICH candidates qualify
 * (the nudges are post-selection score terms, never filters).
 */
export function explorationProbe(variant: VariantId): {
  slotPresent: boolean;
  slotOutsidePureTop: boolean;
  candidateSetMatchesBaseline: boolean;
} {
  const persona = PERSONAS[1]; // cocktail-date
  const history = personaHistory(persona);
  const profile = { tags: persona.tags, answers: {} } as unknown as VibeProfile;
  const run = (v: VariantId): Bar[] =>
    matches({
      profile,
      coords: EV,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: CATALOG as Bar[],
      excludeIds: history.passedIds,
      maxResults: 10,
      now: EVAL_NOW,
      lovedTags: history.lovedFlat,
      lovedTagWeights:
        v === 'weightedLoved' || v === 'combined'
          ? history.lovedWeights
          : undefined,
      avoidTagWeights:
        v === 'avoidTags' || v === 'combined'
          ? history.avoidWeights
          : undefined,
    });
  const results = run(variant);
  // Pure-score top-10 for THIS variant, without the exploration swap:
  // rank via a deep slice (sliceCap suppresses the exploration branch).
  const pure = matches({
    profile,
    coords: EV,
    preferredNeighborhoods: [],
    maxMiles: null,
    bars: CATALOG as Bar[],
    excludeIds: history.passedIds,
    maxResults: 10,
    sliceCap: 10,
    now: EVAL_NOW,
    lovedTags: history.lovedFlat,
    lovedTagWeights:
      variant === 'weightedLoved' || variant === 'combined'
        ? history.lovedWeights
        : undefined,
    avoidTagWeights:
      variant === 'avoidTags' || variant === 'combined'
        ? history.avoidWeights
        : undefined,
  });
  const pureIds = new Set(pure.map((b) => b.id));
  // "Never a filter" made executable: the DEEP candidate slice for this
  // variant must contain exactly the same bars as baseline's (order may
  // differ — membership may not).
  const deep = (v: VariantId): string[] =>
    matches({
      profile,
      coords: EV,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: CATALOG as Bar[],
      excludeIds: history.passedIds,
      maxResults: 10,
      sliceCap: CATALOG.length,
      now: EVAL_NOW,
      lovedTags: history.lovedFlat,
      lovedTagWeights:
        v === 'weightedLoved' || v === 'combined'
          ? history.lovedWeights
          : undefined,
      avoidTagWeights:
        v === 'avoidTags' || v === 'combined' ? history.avoidWeights : undefined,
    })
      .map((b) => b.id)
      .sort();
  return {
    slotPresent: results.length === 10,
    slotOutsidePureTop: !pureIds.has(results[9]?.id ?? ''),
    candidateSetMatchesBaseline:
      JSON.stringify(deep(variant)) === JSON.stringify(deep('baseline')),
  };
}

/**
 * Fresh-hand probe (santa: Fable): mirror ResultsView's widening call —
 * sliceCap over the pool with soft-seen relaxDiscountIds — and assert
 * the taste signals change neither candidate membership nor any hard
 * filter, exactly as on the normal path.
 */
export function freshHandProbe(variant: VariantId): {
  violations: number;
  /**
   * The documented sliceCap/relaxDiscountIds contract, made executable
   * PER VARIANT (santa: Codex round 2 — a variant-independent seen set
   * hid the real production trajectory): the widened deal's
   * NON-discounted candidate membership must equal the membership of
   * the equivalent run-it-again deal that HARD-excludes the same seen
   * bars — i.e. taste signals never move the relaxation threshold.
   */
  softSeenEquivalenceHolds: boolean;
  seenStillIncluded: boolean;
} {
  const persona = PERSONAS[0]; // divey-locals
  const history = personaHistory(persona);
  const profile = { tags: persona.tags, answers: {} } as unknown as VibeProfile;
  const signals = (v: VariantId) => ({
    lovedTags: history.lovedFlat,
    lovedTagWeights:
      v === 'weightedLoved' || v === 'combined'
        ? history.lovedWeights
        : undefined,
    avoidTagWeights:
      v === 'avoidTags' || v === 'combined' ? history.avoidWeights : undefined,
  });
  // First hand WITH this variant's signals — exactly what production
  // shows before the user widens.
  const firstHand = matches({
    profile,
    coords: EV,
    preferredNeighborhoods: [],
    maxMiles: 0.75,
    bars: CATALOG as Bar[],
    excludeIds: history.passedIds,
    maxResults: 5,
    now: EVAL_NOW,
    ...signals(variant),
  });
  const seenIds = firstHand.map((b) => b.id);
  const seen = new Set(seenIds);
  // Widened fresh-hand deal (ResultsView's exact call shape).
  const widened = matches({
    profile,
    coords: EV,
    preferredNeighborhoods: [],
    maxMiles: 1.5,
    bars: CATALOG as Bar[],
    excludeIds: history.passedIds,
    maxResults: 5,
    sliceCap: CATALOG.length,
    relaxDiscountIds: seenIds,
    now: EVAL_NOW,
    ...signals(variant),
  });
  // Equivalent run-it-again deal: hard-exclude the same seen bars.
  const hardExcluded = matches({
    profile,
    coords: EV,
    preferredNeighborhoods: [],
    maxMiles: 1.5,
    bars: CATALOG as Bar[],
    excludeIds: [...history.passedIds, ...seenIds],
    maxResults: 5,
    sliceCap: CATALOG.length,
    now: EVAL_NOW,
    ...signals(variant),
  });
  const widenedNonSeen = widened
    .map((b) => b.id)
    .filter((id) => !seen.has(id))
    .sort();
  const hardIds = hardExcluded.map((b) => b.id).sort();
  return {
    violations: widened.filter(
      (b) =>
        b.businessStatus === 'CLOSED_PERMANENTLY' ||
        haversineMiles(EV, b) > 1.5 + 1e-9,
    ).length,
    softSeenEquivalenceHolds:
      JSON.stringify(widenedNonSeen) === JSON.stringify(hardIds),
    seenStillIncluded: widened.some((b) => seen.has(b.id)),
  };
}

/** Sensitivity: swapping one profile tag should change the hand, and the
 * unchanged profile re-run must be identical (determinism). */
export function sensitivityProbe(variant: VariantId): {
  deterministic: boolean;
  swapOverlap: number;
} {
  const persona = PERSONAS[0];
  const profile = { tags: persona.tags, answers: {} } as unknown as VibeProfile;
  const swapped = {
    tags: ['cocktail', ...persona.tags.slice(1)] as VibeTag[],
    answers: {},
  } as unknown as VibeProfile;
  const run = (p: VibeProfile): string[] =>
    matches({
      profile: p,
      coords: EV,
      preferredNeighborhoods: [],
      maxMiles: 1.5,
      bars: CATALOG as Bar[],
      maxResults: 5,
      now: EVAL_NOW,
    }).map((b) => b.id);
  const a = run(profile);
  const b = run(profile);
  const c = run(swapped);
  const setA = new Set(a);
  const overlap = c.filter((id) => setA.has(id)).length / Math.max(1, a.length);
  return {
    deterministic: JSON.stringify(a) === JSON.stringify(b),
    swapOverlap: overlap,
  };
}
