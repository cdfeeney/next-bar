/**
 * Is a venue-website reading actually an INDEPENDENT source?
 *
 * `resolveHours` promotes to `verified` when two distinct sources agree. That
 * is only meaningful if the two sources are genuinely independent. Two ways
 * they are not:
 *
 *  1. The page's hours come from an embedded Google widget. Then "the venue's
 *     site" is Google wearing a hat — and Google-derived hours are precisely
 *     what we are not permitted to persist. This is a COMPLIANCE failure, not
 *     merely weak evidence, so the candidate is rejected outright.
 *
 *  2. The page's hours are character-identical to the venue's OSM
 *     `opening_hours`. We cannot tell whether reality made them agree or
 *     whether a mapper copied one into the other, so we decline to treat the
 *     agreement as corroboration.
 *
 * Rule 2 has a consequence worth stating plainly: since `verified` requires
 * two sources with IDENTICAL hours, treating identical site/OSM hours as
 * correlated means an OSM+site pair can never reach `verified` — it stays at
 * `reported`. `verified` then needs a third kind of source (a user or venue
 * report). That is the conservative reading of the corroboration rule and the
 * operator decision on it is still open, so the crawl REPORTS how many
 * promotions this rule suppresses instead of silently absorbing the cost.
 */
import { sameHours } from './hoursResolution';
import type { WeeklyHours } from '@/types';

/** Markers that the hours on a page are rendered from Google's data. */
const GOOGLE_MARKERS: Array<{ re: RegExp; why: string }> = [
  { re: /google\.com\/maps\/embed/i, why: 'Google Maps embed iframe' },
  { re: /maps\.google\.[a-z.]+\/maps\?/i, why: 'legacy Google Maps embed' },
  { re: /place_id[=:]\s*["']?ChIJ/i, why: 'Google place_id on the page' },
  { re: /maps\.googleapis\.com\/maps\/api/i, why: 'Google Maps JS/API call' },
  { re: /data-google-place/i, why: 'Google Places widget attribute' },
  { re: /powered by google/i, why: '"powered by Google" attribution' },
];

export type CorrelationVerdict =
  | { verdict: 'independent' }
  /** Usable, but must not count toward the distinct-source total. */
  | { verdict: 'correlated'; reason: string }
  /** Not usable at all — persisting it would be a compliance breach. */
  | { verdict: 'reject'; reason: string };

/**
 * Does this HTML show that its hours are Google-derived?
 * Exported so the crawl report can explain a rejection to a human.
 */
export function googleProvenanceMarker(html: string): string | null {
  for (const marker of GOOGLE_MARKERS) {
    if (marker.re.test(html)) return marker.why;
  }
  return null;
}

export function assessSiteCandidate(input: {
  html: string;
  siteHours: WeeklyHours;
  osmHours?: WeeklyHours;
}): CorrelationVerdict {
  const google = googleProvenanceMarker(input.html);
  if (google !== null) {
    return { verdict: 'reject', reason: `Google-derived hours (${google})` };
  }
  if (input.osmHours && sameHours(input.siteHours, input.osmHours)) {
    return {
      verdict: 'correlated',
      reason: 'identical to this venue’s OSM opening_hours — cannot show the two are independent',
    };
  }
  return { verdict: 'independent' };
}
