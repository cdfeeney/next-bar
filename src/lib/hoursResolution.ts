import type { HoursConfidence, HoursSource, WeeklyHours } from '@/types';

/**
 * The trust rules for opening hours — H3's core, deliberately pure and
 * network-free.
 *
 * Every hours source (a venue's own site, OpenStreetMap, a user report, a phone
 * call) feeds candidates in here, and this module alone decides what may be
 * written and with what confidence. Keeping the decision in one testable place
 * is what stops a scraper publishing a plausible-but-wrong window: the parser's
 * job is to produce candidates, not to decide whether they are trustworthy.
 *
 * Two invariants it exists to enforce:
 *
 *  1. `verified` must be EARNED. The database constraint
 *     `bars_google_hours_never_trusted` only proves a trust claim did not come
 *     from Google; nothing stopped a single scrape from asserting `verified`.
 *     Here, one source is at most `reported`; `verified` requires two
 *     INDEPENDENT sources that agree.
 *  2. Google can never contribute. Places hours may be displayed live, never
 *     persisted and relied upon, so `google` is excluded at the type level and
 *     again at runtime — scrapers are fed from JSON that TypeScript cannot police.
 */

/** Sources that may contribute to a trust claim. Google is excluded by design. */
export type TrustedHoursSource = Exclude<HoursSource, 'google'>;

export type HoursCandidate = {
  source: TrustedHoursSource;
  hours: WeeklyHours;
  /** ISO timestamp of when this was observed, for auditability. */
  observedAt: string;
  /** Where it came from, so a human can re-check a disputed value. */
  evidenceUrl?: string;
};

export type HoursResolution =
  | {
      outcome: 'verified';
      hours: WeeklyHours;
      source: TrustedHoursSource;
      confidence: Extract<HoursConfidence, 'verified'>;
      /** The independent sources that agreed, in first-appearance order. */
      corroboratedBy: TrustedHoursSource[];
      rejected: string[];
    }
  | {
      outcome: 'reported';
      hours: WeeklyHours;
      source: TrustedHoursSource;
      confidence: Extract<HoursConfidence, 'reported'>;
      rejected: string[];
    }
  | {
      /** Sources disagree. Goes to human review; never auto-published. */
      outcome: 'conflict';
      candidates: HoursCandidate[];
      rejected: string[];
      reason: string;
    }
  | { outcome: 'none'; rejected: string[]; reason: string };

/**
 * How long a trust claim survives without being re-checked.
 *
 * Staleness must demote automatically, or the strict filter slowly fills with
 * hours nobody has looked at in a year — which is the same failure as trusting
 * Google's, just slower. 30 days is a starting value; the operator decision on
 * the exact window is still open (goal g-3eedd7a1 H3).
 */
export const HOURS_STALE_AFTER_DAYS = 30;

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Structural validation. This is the "plausible but wrong" filter: a parser that
 * reads "5-2" as 05:00-02:00 rather than 17:00-02:00 produces a well-formed
 * object with a wrong meaning, so shape alone is not enough — but shape is where
 * the cheap wins are, and an impossible clock value is always a parser bug.
 *
 * Overnight windows (close < open) are VALID and common for bars; isOpenNow
 * already treats them as crossing midnight. `00:00-00:00` is how a 24-hour venue
 * is expressed.
 */
export function isValidWeeklyHours(hours: WeeklyHours | undefined): boolean {
  if (hours === null || typeof hours !== 'object') return false;
  const entries = Object.entries(hours as Record<string, unknown>);
  if (entries.length === 0) return false;

  for (const [day, intervals] of entries) {
    if (!/^[0-6]$/.test(day)) return false;
    if (!Array.isArray(intervals) || intervals.length === 0) return false;
    for (const interval of intervals) {
      if (interval === null || typeof interval !== 'object') return false;
      const { open, close } = interval as { open?: unknown; close?: unknown };
      if (typeof open !== 'string' || typeof close !== 'string') return false;
      if (!CLOCK_RE.test(open) || !CLOCK_RE.test(close)) return false;
    }
  }
  return true;
}

/**
 * Canonical form for comparison: days ascending, intervals sorted. Two sources
 * that describe the same week must compare equal regardless of the order they
 * happened to list things in, or corroboration would never fire.
 */
function canonical(hours: WeeklyHours): string {
  const obj = hours as unknown as Record<string, { open: string; close: string }[]>;
  const days = Object.keys(obj).sort((a, b) => Number(a) - Number(b));
  return JSON.stringify(
    days.map((d) => [
      d,
      [...obj[d]]
        .map((i) => `${i.open}-${i.close}`)
        .sort(),
    ]),
  );
}

/** Do two candidate weeks describe the same opening hours? */
export function sameHours(a: WeeklyHours, b: WeeklyHours): boolean {
  return canonical(a) === canonical(b);
}

/**
 * Apply the confidence ladder to a set of candidates.
 *
 * verified  — the largest agreeing group contains 2+ INDEPENDENT sources.
 * reported  — exactly one distinct source's worth of agreeing evidence.
 * conflict  — sources disagree and none has corroboration; a human decides.
 * none      — nothing usable survived validation.
 *
 * Note that two candidates from the SAME source are not corroboration. Scraping
 * one site twice, or one user submitting twice, proves only that the source is
 * consistent — not that it is right.
 */
export function resolveHours(candidates: readonly HoursCandidate[]): HoursResolution {
  const rejected: string[] = [];
  const valid: HoursCandidate[] = [];

  for (const c of candidates) {
    // Runtime guard, not just the type: candidates arrive as parsed JSON.
    if ((c?.source as string) === 'google') {
      rejected.push('google');
      continue;
    }
    if (!c || !isValidWeeklyHours(c.hours)) {
      rejected.push(String(c?.source ?? 'unknown'));
      continue;
    }
    valid.push(c);
  }

  if (valid.length === 0) {
    return { outcome: 'none', rejected, reason: 'no candidate survived validation' };
  }

  // Group by identical hours, preserving first-appearance order.
  const groups: { key: string; members: HoursCandidate[] }[] = [];
  for (const c of valid) {
    const key = canonical(c.hours);
    const existing = groups.find((g) => g.key === key);
    if (existing) existing.members.push(c);
    else groups.push({ key, members: [c] });
  }

  const distinct = (g: { members: HoursCandidate[] }): TrustedHoursSource[] => {
    const out: TrustedHoursSource[] = [];
    for (const m of g.members) if (!out.includes(m.source)) out.push(m.source);
    return out;
  };

  // Strongest group wins; ties fall to whichever appeared first.
  const best = groups.reduce((a, b) =>
    distinct(b).length > distinct(a).length ? b : a,
  );
  const bestSources = distinct(best);

  if (bestSources.length >= 2) {
    return {
      outcome: 'verified',
      hours: best.members[0].hours,
      source: bestSources[0],
      confidence: 'verified',
      corroboratedBy: bestSources,
      rejected,
    };
  }

  // No group has independent corroboration. One group is a single report; more
  // than one means the sources contradict each other.
  if (groups.length > 1) {
    return {
      outcome: 'conflict',
      candidates: valid,
      rejected,
      reason: `${groups.length} sources disagree and none is corroborated`,
    };
  }

  return {
    outcome: 'reported',
    hours: best.members[0].hours,
    source: bestSources[0],
    confidence: 'reported',
    rejected,
  };
}

/**
 * Decay a stored claim that has not been re-checked recently.
 *
 * Applied on read as well as on write, so a row cannot keep asserting `verified`
 * simply because no job has visited it. Absent `hoursVerifiedAt` counts as stale:
 * an unknown last-checked date is not evidence of freshness.
 */
export function demoteIfStale(
  confidence: HoursConfidence,
  verifiedAt: string | undefined,
  now: Date,
  maxAgeDays: number = HOURS_STALE_AFTER_DAYS,
): HoursConfidence {
  if (confidence === 'unverified') return 'unverified';
  if (!verifiedAt) return 'unverified';
  const then = Date.parse(verifiedAt);
  if (Number.isNaN(then)) return 'unverified';
  const ageDays = (now.getTime() - then) / 86_400_000;
  return ageDays > maxAgeDays ? 'unverified' : confidence;
}
