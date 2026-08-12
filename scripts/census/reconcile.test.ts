import { describe, expect, it } from 'vitest';
import { reconcile, type BaselineBar } from './reconcile';
import type { NormalizedCandidate } from './types';

/**
 * Offline preflight reconciler (goal g-25eaf18d). Pure function, no I/O — see
 * scripts/census/reconcile.ts. Fixture coordinates/neighborhoods below are
 * drawn from src/lib/constants.ts (SERVICE_AREA_BBOX, NEIGHBORHOOD_CENTROIDS)
 * so boundary validation (rowToBar) actually passes for the "should insert"
 * cases and fails for the deliberately-invalid one.
 */

function candidate(overrides: Partial<NormalizedCandidate> = {}): NormalizedCandidate {
  return {
    externalId: 'osm:node/1',
    name: 'Test Bar',
    neighborhood: 'Chelsea',
    lat: 40.747,
    lng: -74.001,
    signals: [],
    evidenceIds: [],
    verification: 'unverified',
    provider: 'osm',
    ...overrides,
  };
}

const REPORT_GENERATED_AT = '2026-08-05T00:29:55.406Z';

describe('reconcile', () => {
  it('classifies a genuinely new candidate as newInserts and grows projectedTotal', () => {
    const baseline: BaselineBar[] = [{ id: 'attaboy', name: 'Attaboy', neighborhood: 'LES' }];
    const result = reconcile({
      candidates: [candidate({ externalId: 'osm:node/2', name: 'Brand New Bar' })],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
    });
    expect(result.newInserts).toHaveLength(1);
    expect(result.idCollisions).toHaveLength(0);
    expect(result.nameHoodCollisions).toHaveLength(0);
    expect(result.validationRejects).toHaveLength(0);
    expect(result.projectedTotal).toBe(baseline.length + 1);
  });

  it('rejects a candidate whose derived id collides with the baseline', () => {
    // externalId "osm:node/attaboy" slugifies to id "osm-node-attaboy", so
    // this deliberately reuses a baseline id via the collision path below —
    // exercised more directly by the intra-batch case; here we confirm the
    // id-collision counter fires when the derived id equals an existing one.
    const baseline: BaselineBar[] = [{ id: 'osm-node-2', name: 'Some Other Bar', neighborhood: 'Chelsea' }];
    const result = reconcile({
      candidates: [candidate({ externalId: 'osm:node/2', name: 'Totally Different Name' })],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
    });
    expect(result.idCollisions).toHaveLength(1);
    expect(result.idCollisions[0].reason).toContain('osm-node-2');
    expect(result.newInserts).toHaveLength(0);
    expect(result.projectedTotal).toBe(baseline.length);
  });

  it('rejects a candidate whose apply-side name+neighborhood key matches the baseline', () => {
    const baseline: BaselineBar[] = [{ id: 'existing-bar', name: 'Existing Bar', neighborhood: 'Chelsea' }];
    const result = reconcile({
      candidates: [candidate({ externalId: 'osm:node/3', name: 'Existing Bar', neighborhood: 'Chelsea' })],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
    });
    expect(result.nameHoodCollisions).toHaveLength(1);
    expect(result.newInserts).toHaveLength(0);
  });

  it('rejects a candidate that fails boundary validation (out of service-area bbox)', () => {
    const baseline: BaselineBar[] = [];
    const result = reconcile({
      candidates: [candidate({ externalId: 'osm:node/4', lat: 41.5, lng: -73.5 })],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
    });
    expect(result.validationRejects).toHaveLength(1);
    expect(result.validationRejects[0].reason).toBe('boundary validation failed');
    expect(result.newInserts).toHaveLength(0);
  });

  it('computes projectedTotal as baseline.length + newInserts.length and flags reaches1200', () => {
    const baseline: BaselineBar[] = Array.from({ length: 1199 }, (_, i) => ({
      id: `bar-${i}`,
      name: `Bar ${i}`,
      neighborhood: 'Chelsea',
    }));
    const short = reconcile({ candidates: [], baseline, reportGeneratedAt: REPORT_GENERATED_AT });
    expect(short.projectedTotal).toBe(1199);
    expect(short.reaches1200).toBe(false);

    const withOneNew = reconcile({
      candidates: [candidate({ externalId: 'osm:node/5', name: 'The Nudge Over Line' })],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
    });
    expect(withOneNew.projectedTotal).toBe(1200);
    expect(withOneNew.reaches1200).toBe(true);
  });

  it('handles an empty baseline: every valid candidate is a fresh insert', () => {
    const result = reconcile({
      candidates: [candidate({ externalId: 'osm:node/6' }), candidate({ externalId: 'osm:node/7', name: 'Second Bar' })],
      baseline: [],
      reportGeneratedAt: REPORT_GENERATED_AT,
    });
    expect(result.baselineCount).toBe(0);
    expect(result.newInserts).toHaveLength(2);
    expect(result.projectedTotal).toBe(2);
  });

  it('detects key divergence between the census dedupeKey and the apply normalizeLegacy key', () => {
    // "The Dead Rabbit": census normalizeName keeps the word "the"; apply's
    // normalizeLegacy strips whole words "and"/"the". Baseline holds the
    // apply-normalized form ("Dead Rabbit") without "The", so the apply key
    // matches (not fresh) while the census key does not (fresh) — a real
    // divergence between the two guards on the same table.
    const baseline: BaselineBar[] = [{ id: 'dead-rabbit', name: 'Dead Rabbit', neighborhood: 'FiDi' }];
    const result = reconcile({
      candidates: [
        candidate({ externalId: 'osm:node/8', name: 'The Dead Rabbit', neighborhood: 'FiDi' }),
      ],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
    });
    expect(result.keyDivergence).toBe(1);
    expect(result.keyDivergenceExamples[0].name).toBe('The Dead Rabbit');
    expect(result.keyDivergenceExamples[0].censusKeyFresh).toBe(true);
    expect(result.keyDivergenceExamples[0].applyKeyFresh).toBe(false);
  });

  it('detects key divergence via diacritics (Tír na nÓg vs an ASCII baseline form)', () => {
    // census normalizeName NFKD-strips diacritics ("tir na nog"); apply's
    // normalizeLegacy does not touch diacritics at all. Baseline holds the
    // stripped ASCII form, so census matches it (not fresh) while apply does
    // not (fresh) — divergence in the opposite direction from the case above.
    const baseline: BaselineBar[] = [{ id: 'tir-na-nog', name: 'Tir na Nog', neighborhood: 'Chelsea' }];
    const result = reconcile({
      candidates: [
        candidate({ externalId: 'osm:node/663102624', name: 'Tír na nÓg', neighborhood: 'Chelsea' }),
      ],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
    });
    expect(result.keyDivergence).toBe(1);
    expect(result.keyDivergenceExamples[0].censusKeyFresh).toBe(false);
    expect(result.keyDivergenceExamples[0].applyKeyFresh).toBe(true);
  });

  it('does not count agreement as divergence', () => {
    const baseline: BaselineBar[] = [];
    const result = reconcile({
      candidates: [candidate({ externalId: 'osm:node/9', name: 'Nobody Has This One' })],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
    });
    expect(result.keyDivergence).toBe(0);
    expect(result.keyDivergenceExamples).toHaveLength(0);
  });
});
