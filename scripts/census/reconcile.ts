import { rowToBar, type BarsTableRow } from '@/lib/catalogServer';
import { dedupeKey } from './dedupe';
import type { NormalizedCandidate } from './types';

/**
 * Offline staging catalog reconciliation preflight (goal g-25eaf18d). Pure —
 * no I/O, no client, no @supabase/* import. Simulates what an ATTENDED
 * `applyCurated` run (scripts/census/apply.ts) would do against a baseline
 * catalog, without writing anything. See reconcile-preflight.mts for the CLI
 * that binds this to the frozen census report and the static catalog.
 */

export interface BaselineBar {
  id: string;
  name: string;
  neighborhood: string;
}

export interface RejectedCandidate {
  externalId: string;
  name: string;
  neighborhood: string;
  reason: string;
}

export interface KeyDivergenceEntry {
  externalId: string;
  name: string;
  neighborhood: string;
  /** true = the census-side dedupeKey (scripts/census/dedupe.ts) treats this as new. */
  censusKeyFresh: boolean;
  /** true = the apply-side normalizeLegacy key (scripts/census/apply.ts) treats this as new. */
  applyKeyFresh: boolean;
}

export interface ReconcileInput {
  candidates: NormalizedCandidate[];
  baseline: BaselineBar[];
  /** ISO timestamp of the census report this reconciliation binds to (report.generatedAt). */
  reportGeneratedAt: string;
}

export interface ReconcileResult {
  baselineCount: number;
  candidateCount: number;
  newInserts: NormalizedCandidate[];
  idCollisions: RejectedCandidate[];
  nameHoodCollisions: RejectedCandidate[];
  validationRejects: RejectedCandidate[];
  projectedTotal: number;
  reaches1200: boolean;
  keyDivergence: number;
  keyDivergenceExamples: KeyDivergenceEntry[];
}

// Reproduced verbatim from scripts/census/apply.ts's (unexported, local)
// normalizeLegacy — the goal forbids editing apply.ts's dedupe semantics, so
// the apply-side key is duplicated here to compute divergence against it.
// Keep in sync by hand if apply.ts's normalizer ever changes.
function normalizeLegacy(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’.&]/g, '')
    .replace(/\band\b|\bthe\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mirrors applyCurated's `${normalizeLegacy(name)}|${neighborhood}` exactly,
// including the apply-side quirk that neighborhood is compared RAW (no
// trim/lowercase) — that quirk is itself part of what this preflight
// quantifies as divergence risk, not something to "fix" here.
function nameHoodKeyLegacy(name: string, neighborhood: string): string {
  return `${normalizeLegacy(name)}|${neighborhood}`;
}

function idFromExternalId(externalId: string): string {
  const slug = externalId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'x';
}

function toRow(
  candidate: NormalizedCandidate,
  id: string,
  lastVerified: string,
): Record<string, unknown> {
  return {
    id,
    name: candidate.name,
    lat: candidate.lat,
    lng: candidate.lng,
    tags: candidate.signals,
    neighborhood: candidate.neighborhood,
    // ponytail: census candidates carry no price tier — that is an attended-
    // curation input this preflight cannot know. 2 is a neutral placeholder
    // so boundary validation isn't rejecting purely on a field real curation
    // would fill in; upgrade if a candidate ever carries a real priceTier.
    price_tier: candidate.priceTier ?? 2,
    hours: null,
    blurb: '',
    address: candidate.address ?? '',
    place_id: null,
    business_status: null,
    photo_count: 0,
    photo_attributions: null,
    reviews: null,
    last_verified: lastVerified,
    source: 'census',
  };
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { candidates, baseline } = input;
  const lastVerified = input.reportGeneratedAt.slice(0, 10);

  // Key divergence: classify every candidate against the baseline under both
  // normalizers independently of the sequential bucketing below, so a
  // divergence is reported even when the candidate would be rejected for an
  // unrelated reason (e.g. id collision) first.
  const censusBaselineKeys = new Set(baseline.map((b) => dedupeKey(b.name, b.neighborhood)));
  const applyBaselineKeys = new Set(baseline.map((b) => nameHoodKeyLegacy(b.name, b.neighborhood)));
  const keyDivergenceExamples: KeyDivergenceEntry[] = [];
  for (const c of candidates) {
    const censusKeyFresh = !censusBaselineKeys.has(dedupeKey(c.name, c.neighborhood));
    const applyKeyFresh = !applyBaselineKeys.has(nameHoodKeyLegacy(c.name, c.neighborhood));
    if (censusKeyFresh !== applyKeyFresh) {
      keyDivergenceExamples.push({
        externalId: c.externalId,
        name: c.name,
        neighborhood: c.neighborhood,
        censusKeyFresh,
        applyKeyFresh,
      });
    }
  }

  // Sequential fold mirroring applyCurated's real order — validation, then
  // id collision, then name+neighborhood collision — with each accepted
  // candidate updating the running "existing" set so intra-batch collisions
  // are caught exactly as a real apply run would catch them.
  const existingIds = new Set(baseline.map((b) => b.id));
  const existingNameHood = new Set(baseline.map((b) => nameHoodKeyLegacy(b.name, b.neighborhood)));

  const newInserts: NormalizedCandidate[] = [];
  const idCollisions: RejectedCandidate[] = [];
  const nameHoodCollisions: RejectedCandidate[] = [];
  const validationRejects: RejectedCandidate[] = [];

  for (const c of candidates) {
    const id = idFromExternalId(c.externalId);
    const row = toRow(c, id, lastVerified);
    const reject = (bucket: RejectedCandidate[], reason: string) =>
      bucket.push({ externalId: c.externalId, name: c.name, neighborhood: c.neighborhood, reason });

    if (rowToBar(row as BarsTableRow) === null) {
      reject(validationRejects, 'boundary validation failed');
      continue;
    }
    if (existingIds.has(id)) {
      reject(idCollisions, `id collision: ${id}`);
      continue;
    }
    const nh = nameHoodKeyLegacy(c.name, c.neighborhood);
    if (existingNameHood.has(nh)) {
      reject(nameHoodCollisions, 'name+neighborhood duplicate (apply-side key)');
      continue;
    }
    existingIds.add(id);
    existingNameHood.add(nh);
    newInserts.push(c);
  }

  const projectedTotal = baseline.length + newInserts.length;
  return {
    baselineCount: baseline.length,
    candidateCount: candidates.length,
    newInserts,
    idCollisions,
    nameHoodCollisions,
    validationRejects,
    projectedTotal,
    reaches1200: projectedTotal >= 1200,
    keyDivergence: keyDivergenceExamples.length,
    keyDivergenceExamples,
  };
}
