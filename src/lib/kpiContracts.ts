import { ANALYTICS_EVENTS, type AnalyticsEvent } from '@/lib/analyticsAdapters';

/**
 * kpiContracts — the privacy-minimized KPI event CONTRACTS
 * (g-7de10fce). SPECIFICATION ONLY tonight: nothing here dispatches,
 * PostHog and every external sink stay disabled, and the live envelope
 * remains name-only ({ v, name } — see analyticsAdapters.ts). This
 * module exists so that when measurement is attended-enabled later, the
 * shape of every event is already reviewed, typed, and fenced.
 *
 * PRIVACY INVARIANTS (structural, tested in kpiContracts.test.ts):
 *   - No event may EVER carry raw search text, coordinates, accuracy,
 *     friend identities, user identifiers, or free-form strings.
 *   - Every payload field is allowlisted per event; unknown keys reject
 *     the whole payload (fail closed, never strip-and-send).
 *   - Field values are structurally validated (catalog slug shape,
 *     small enums, night keys) so a smuggled value cannot ride an
 *     allowlisted key.
 */

/** The eight product KPIs and the analytics NAME each maps onto. */
export const KPI_CONTRACTS = {
  /** A recommendation hand was shown (per deal, not per card). */
  recommendation_impression: { name: 'impression' },
  /** A bar's detail surface (lightbox) was opened. */
  bar_detail_view: { name: 'bar_detail' },
  /** A search result was selected. NOTE: the QUERY is never carried —
   * only the selected catalog id. */
  search_selection: { name: 'search' },
  /** Save / Want-to-Go toggled ON. */
  save_want_to_go: { name: 'save' },
  /** Share sheet invoked for a bar or night. */
  share: { name: 'share' },
  /** External directions link opened. */
  directions_opened: { name: 'directions' },
  /** Explicit venue pin / check-in confirmed (never background). */
  pin_checkin: { name: 'checkin' },
  /** Post-night rating or outcome recorded. */
  post_night_rating: { name: 'night_rating' },
} as const satisfies Record<string, { name: AnalyticsEvent }>;

export type KpiKey = keyof typeof KPI_CONTRACTS;

/** Catalog bar slug — the ONLY entity reference any KPI may carry. */
const BAR_ID_RE = /^[a-z0-9-]{1,60}$/;
/** Social-night key (YYYY-MM-DD). */
const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;

const RATING_TIERS = new Set(['loved', 'liked', 'pass']);
const SURFACES = new Set(['home', 'map', 'search', 'friends', 'rankings']);

/**
 * Per-event allowlisted fields with structural validators. A field
 * absent from its event's table rejects the payload outright.
 */
const FIELD_VALIDATORS: Record<KpiKey, Record<string, (v: unknown) => boolean>> = {
  recommendation_impression: {
    surface: (v) => typeof v === 'string' && SURFACES.has(v),
    resultCount: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 30,
  },
  bar_detail_view: {
    barId: (v) => typeof v === 'string' && BAR_ID_RE.test(v),
    surface: (v) => typeof v === 'string' && SURFACES.has(v),
  },
  search_selection: {
    barId: (v) => typeof v === 'string' && BAR_ID_RE.test(v),
  },
  save_want_to_go: {
    barId: (v) => typeof v === 'string' && BAR_ID_RE.test(v),
  },
  share: {
    barId: (v) => typeof v === 'string' && BAR_ID_RE.test(v),
  },
  directions_opened: {
    barId: (v) => typeof v === 'string' && BAR_ID_RE.test(v),
  },
  pin_checkin: {
    barId: (v) => typeof v === 'string' && BAR_ID_RE.test(v),
    night: (v) => typeof v === 'string' && NIGHT_RE.test(v),
  },
  post_night_rating: {
    barId: (v) => typeof v === 'string' && BAR_ID_RE.test(v),
    tier: (v) => typeof v === 'string' && RATING_TIERS.has(v),
    night: (v) => typeof v === 'string' && NIGHT_RE.test(v),
  },
};

/** Key names that must never appear in ANY payload, even if someone
 * extends a field table carelessly — belt on top of the allowlist. */
const FORBIDDEN_KEY_RE =
  /lat|lng|lon|accuracy|coord|position|geo|query|text|term|handle|user|friend|email|name|id_token|token/i;

export type KpiValidation =
  | { ok: true; key: KpiKey; name: AnalyticsEvent; payload: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Validate a prospective KPI payload against its contract. FAIL CLOSED:
 * any unknown key, forbidden key, or structurally invalid value rejects
 * the whole event — nothing is stripped and forwarded.
 */
export function validateKpiPayload(
  key: KpiKey,
  payload: Record<string, unknown>,
): KpiValidation {
  const contract = KPI_CONTRACTS[key];
  if (!contract) return { ok: false, reason: 'unknown-kpi' };
  const fields = FIELD_VALIDATORS[key];
  for (const [field, value] of Object.entries(payload)) {
    // UNCONDITIONAL forbidden-key belt (santa: Fable — the original
    // `&& !(field in fields)` guard disabled the belt in exactly the
    // "someone extends a field table carelessly" case it exists for).
    // Runs BEFORE the allowlist lookup: a forbidden-shaped key is
    // rejected even if a future edit allowlists it.
    if (FORBIDDEN_KEY_RE.test(field)) {
      return { ok: false, reason: `forbidden-key:${field}` };
    }
    const validator = fields[field];
    if (validator === undefined) {
      return { ok: false, reason: `unknown-key:${field}` };
    }
    if (!validator(value)) {
      return { ok: false, reason: `invalid-value:${field}` };
    }
  }
  return { ok: true, key, name: contract.name, payload };
}

/** Every contract must target an allowlisted analytics name — checked
 * here so a typo cannot silently orphan a KPI (also unit-tested). */
export function contractsAreAllowlisted(): boolean {
  return Object.values(KPI_CONTRACTS).every((c) =>
    (ANALYTICS_EVENTS as readonly string[]).includes(c.name),
  );
}

/**
 * TEST-ONLY window into the field tables so the forbidden-key belt can
 * be proven to hold even against a carelessly-extended allowlist
 * (mutate → assert reject → restore). Never import outside tests.
 */
export function __fieldValidatorsForTests(): typeof FIELD_VALIDATORS {
  return FIELD_VALIDATORS;
}
