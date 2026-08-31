import { reconcile, type BaselineBar, type ReconcileResult } from './reconcile';
import type { NormalizedCandidate } from './types';

/**
 * Offline staging catalog EXPANSION PACKET (goal g-779223ab), built on top of
 * the reconciliation preflight (goal g-25eaf18d).
 *
 * Pure — no I/O, no client, no `@supabase/*` import, no network call. The
 * preflight found that 865 of 1,382 candidates (every SLA-provider row) fail
 * boundary validation for one reason: they carry the BOROUGH label
 * "manhattan" in `neighborhood`, which `rowToBar` rejects because it is not a
 * key of NEIGHBORHOOD_CENTROIDS. All 865 carry real lat/lng, so an offline
 * nearest-centroid snap can recover a real neighborhood without a geocoding
 * call.
 *
 * This module performs that correction and re-runs the SAME pure `reconcile`
 * over the corrected set. It composes reconcile.ts — it does not edit or
 * re-implement its dedupe semantics. It writes nothing; the CLI
 * (scripts/expansion-packet-cli.mts) owns file output, and NOTHING here or
 * there touches a live table.
 */

export interface Coords {
  lat: number;
  lng: number;
}

/** Structural shape of `src/lib/geo.ts`'s CentroidSnap — injected, not imported. */
export interface CentroidSnapLike {
  neighborhood: string;
  centroid: Coords;
  miles: number;
}

/**
 * Injected geo dependency. `snapToNeighborhoodCentroid` alone cannot satisfy
 * acceptance criterion 3: it returns `null` BOTH for "outside the service
 * area" and for "no centroid within MAX_SNAP_MILES", and the packet must name
 * which one. `isInServiceArea` is the same pure function the snap consults
 * internally, so asking it separately distinguishes the two without
 * duplicating any geometry.
 */
export interface GeoDeps {
  snapToNeighborhoodCentroid: (c: Coords) => CentroidSnapLike | null;
  isInServiceArea: (c: Coords) => boolean;
}

export type SnapFailureReason =
  | 'missing coordinates'
  | 'outside service area'
  | 'no centroid within MAX_SNAP_MILES';

export interface SnapFailure {
  externalId: string;
  name: string;
  /** The uncorrectable neighborhood label the candidate still carries. */
  neighborhood: string;
  lat: number | null;
  lng: number | null;
  reason: SnapFailureReason;
}

export interface Correction {
  externalId: string;
  name: string;
  from: string;
  to: string;
  miles: number;
}

/** A rejected candidate annotated with the specific check that failed. */
export interface ExplainedReject {
  externalId: string;
  name: string;
  neighborhood: string;
  /** reconcile.ts's own bucket reason. */
  reason: string;
  /** The first specific `rowToBar` predicate that fails, for readability. */
  failedCheck?: string;
}

export interface ExpansionPacketInput {
  candidates: NormalizedCandidate[];
  baseline: BaselineBar[];
  reportGeneratedAt: string;
  geo: GeoDeps;
  /**
   * The neighborhood vocabulary `rowToBar` accepts (KNOWN_HOODS). A candidate
   * already carrying one of these is left EXACTLY as-is: correcting an
   * already-valid neighborhood would move rows the preflight already accepted
   * and silently change results the prior goal recorded.
   */
  knownNeighborhoods: ReadonlySet<string>;
}

export interface ExpansionPacketResult extends ReconcileResult {
  /** Candidates whose neighborhood the snap replaced. */
  neighborhoodCorrected: number;
  corrections: Correction[];
  /** Candidates that needed correction but could not be corrected — never dropped. */
  snapFailed: SnapFailure[];
  /** The corrected candidate set actually fed to `reconcile`. */
  correctedCandidates: NormalizedCandidate[];
  idCollisions: ExplainedReject[];
  nameHoodCollisions: ExplainedReject[];
  validationRejects: ExplainedReject[];
  /**
   * newInserts + idCollisions + nameHoodCollisions + validationRejects.
   * Must equal candidateCount — the deterministic proof that no candidate was
   * silently dropped (acceptance criterion 3).
   */
  accountedFor: number;
}

const MIN_PRICE_TIER = 1;
const MAX_PRICE_TIER = 4;
/** Mirrors rowToBar's id shape check against the slug reconcile.ts derives. */
const ID_RE = /^[a-z0-9-]{1,60}$/;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Name the first `rowToBar` predicate a candidate fails. DIAGNOSTIC ONLY —
 * `rowToBar` (via reconcile.ts) remains the authoritative gate; this exists
 * because reconcile.ts reports one flat "boundary validation failed" reason
 * and criterion 3 requires the specific failed check. Kept deliberately
 * narrow: only the predicates whose inputs a census candidate actually
 * controls.
 */
export function explainValidationFailure(
  candidate: NormalizedCandidate,
  knownNeighborhoods: ReadonlySet<string>,
  isInServiceArea: (c: Coords) => boolean,
): string {
  const derivedId = idFromExternalId(candidate.externalId);
  if (!ID_RE.test(derivedId)) return `derived id "${derivedId}" is not a valid row id`;
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) return 'name is empty';
  if (!isFiniteNumber(candidate.lat) || !isFiniteNumber(candidate.lng)) return 'lat/lng missing or non-numeric';
  if (!isInServiceArea({ lat: candidate.lat, lng: candidate.lng })) return 'coordinates outside the service-area bbox';
  if (!knownNeighborhoods.has(candidate.neighborhood)) {
    return `neighborhood "${candidate.neighborhood}" is not in the known-neighborhood vocabulary`;
  }
  const tier = candidate.priceTier ?? 2;
  if (tier < MIN_PRICE_TIER || tier > MAX_PRICE_TIER) return `price tier ${tier} out of range`;
  return 'boundary validation failed for a reason outside the candidate-controlled fields';
}

/**
 * Reproduces reconcile.ts's (unexported, local) id derivation so a rejection
 * can be explained by the id it would have produced. Reads only — nothing
 * here feeds back into reconcile's own derivation.
 */
function idFromExternalId(externalId: string): string {
  const slug = String(externalId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'x';
}

interface CorrectionPass {
  corrected: NormalizedCandidate[];
  corrections: Correction[];
  snapFailed: SnapFailure[];
}

/**
 * Replace a borough-level (or otherwise unknown) neighborhood label with the
 * nearest in-vocabulary neighborhood, offline. Identity is never touched:
 * `externalId` is carried through unchanged and no field but `neighborhood`
 * is rewritten. Candidates are copied, never mutated.
 */
export function correctNeighborhoods(
  candidates: readonly NormalizedCandidate[],
  geo: GeoDeps,
  knownNeighborhoods: ReadonlySet<string>,
): CorrectionPass {
  const corrected: NormalizedCandidate[] = [];
  const corrections: Correction[] = [];
  const snapFailed: SnapFailure[] = [];

  for (const c of candidates) {
    if (knownNeighborhoods.has(c.neighborhood)) {
      corrected.push(c);
      continue;
    }

    if (!isFiniteNumber(c.lat) || !isFiniteNumber(c.lng)) {
      snapFailed.push({
        externalId: c.externalId,
        name: c.name,
        neighborhood: c.neighborhood,
        lat: isFiniteNumber(c.lat) ? c.lat : null,
        lng: isFiniteNumber(c.lng) ? c.lng : null,
        reason: 'missing coordinates',
      });
      corrected.push(c);
      continue;
    }

    const coords: Coords = { lat: c.lat, lng: c.lng };
    const snap = geo.snapToNeighborhoodCentroid(coords);
    if (snap === null) {
      snapFailed.push({
        externalId: c.externalId,
        name: c.name,
        neighborhood: c.neighborhood,
        lat: c.lat,
        lng: c.lng,
        reason: geo.isInServiceArea(coords)
          ? 'no centroid within MAX_SNAP_MILES'
          : 'outside service area',
      });
      corrected.push(c);
      continue;
    }

    corrections.push({
      externalId: c.externalId,
      name: c.name,
      from: c.neighborhood,
      to: snap.neighborhood,
      miles: snap.miles,
    });
    corrected.push({ ...c, neighborhood: snap.neighborhood });
  }

  return { corrected, corrections, snapFailed };
}

export function buildExpansionPacket(input: ExpansionPacketInput): ExpansionPacketResult {
  const { candidates, baseline, reportGeneratedAt, geo, knownNeighborhoods } = input;

  const { corrected, corrections, snapFailed } = correctNeighborhoods(
    candidates,
    geo,
    knownNeighborhoods,
  );

  const result = reconcile({ candidates: corrected, baseline, reportGeneratedAt });

  const byExternalId = new Map(corrected.map((c) => [c.externalId, c]));
  const explain = (rejects: ReconcileResult['validationRejects'], withCheck: boolean): ExplainedReject[] =>
    rejects.map((r) => {
      const source = byExternalId.get(r.externalId);
      return withCheck && source
        ? {
            ...r,
            failedCheck: explainValidationFailure(source, knownNeighborhoods, geo.isInServiceArea),
          }
        : { ...r };
    });

  const idCollisions = explain(result.idCollisions, false);
  const nameHoodCollisions = explain(result.nameHoodCollisions, false);
  const validationRejects = explain(result.validationRejects, true);

  return {
    ...result,
    idCollisions,
    nameHoodCollisions,
    validationRejects,
    neighborhoodCorrected: corrections.length,
    corrections,
    snapFailed,
    correctedCandidates: corrected,
    accountedFor:
      result.newInserts.length +
      idCollisions.length +
      nameHoodCollisions.length +
      validationRejects.length,
  };
}
