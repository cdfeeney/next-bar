import { describe, expect, it } from 'vitest';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import { isInServiceArea, snapToNeighborhoodCentroid } from '@/lib/geo';
import {
  buildExpansionPacket,
  correctNeighborhoods,
  explainValidationFailure,
  type GeoDeps,
} from './expansion-packet';
import type { BaselineBar } from './reconcile';
import type { NormalizedCandidate } from './types';

/**
 * Offline expansion packet (goal g-779223ab). Pure function, no I/O — see
 * scripts/census/expansion-packet.ts. Fixtures use the REAL offline geo
 * functions from src/lib/geo.ts (they make no network call), so the snap
 * results asserted here are the same ones the CLI would produce.
 */

const KNOWN_HOODS: ReadonlySet<string> = new Set(Object.keys(NEIGHBORHOOD_CENTROIDS));
const GEO: GeoDeps = { snapToNeighborhoodCentroid, isInServiceArea };
const REPORT_GENERATED_AT = '2026-08-05T00:29:55.406Z';

/** Chelsea centroid — snaps to "Chelsea" and passes boundary validation. */
const CHELSEA = { lat: 40.747, lng: -74.001 };
/** LES centroid. */
const LES = { lat: 40.717, lng: -73.987 };

function candidate(overrides: Partial<NormalizedCandidate> = {}): NormalizedCandidate {
  return {
    externalId: 'sla:12345',
    name: 'Test Bar',
    neighborhood: 'manhattan',
    lat: CHELSEA.lat,
    lng: CHELSEA.lng,
    signals: [],
    evidenceIds: [],
    verification: 'unverified',
    provider: 'sla',
    ...overrides,
  };
}

describe('correctNeighborhoods', () => {
  it('snaps a borough-labelled candidate to the nearest neighborhood centroid', () => {
    // Arrange
    const candidates = [candidate()];

    // Act
    const { corrected, corrections, snapFailed } = correctNeighborhoods(candidates, GEO, KNOWN_HOODS);

    // Assert
    expect(corrections).toHaveLength(1);
    expect(corrections[0].from).toBe('manhattan');
    expect(corrections[0].to).toBe('Chelsea');
    expect(corrected[0].neighborhood).toBe('Chelsea');
    expect(snapFailed).toHaveLength(0);
  });

  it('leaves a candidate that already carries a known neighborhood completely untouched', () => {
    // Arrange
    const original = candidate({ externalId: 'osm:node/7', neighborhood: 'LES', ...LES, provider: 'osm' });

    // Act
    const { corrected, corrections } = correctNeighborhoods([original], GEO, KNOWN_HOODS);

    // Assert
    expect(corrections).toHaveLength(0);
    expect(corrected[0]).toBe(original);
  });

  it('names an out-of-service-area candidate as a snap failure instead of dropping it', () => {
    // Arrange — Los Angeles, far outside SERVICE_AREA_BBOX.
    const candidates = [candidate({ externalId: 'sla:far', lat: 34.05, lng: -118.24 })];

    // Act
    const { corrected, corrections, snapFailed } = correctNeighborhoods(candidates, GEO, KNOWN_HOODS);

    // Assert
    expect(corrections).toHaveLength(0);
    expect(snapFailed).toHaveLength(1);
    expect(snapFailed[0].reason).toBe('outside service area');
    expect(snapFailed[0].externalId).toBe('sla:far');
    expect(corrected).toHaveLength(1);
    expect(corrected[0].neighborhood).toBe('manhattan');
  });

  it('distinguishes "no centroid within MAX_SNAP_MILES" from "outside service area"', () => {
    // Arrange — in the bbox but >2 miles from every centroid: an injected geo
    // whose snap declines while isInServiceArea still reports true.
    const stubbedGeo: GeoDeps = {
      snapToNeighborhoodCentroid: () => null,
      isInServiceArea: () => true,
    };

    // Act
    const { snapFailed } = correctNeighborhoods([candidate()], stubbedGeo, KNOWN_HOODS);

    // Assert
    expect(snapFailed).toHaveLength(1);
    expect(snapFailed[0].reason).toBe('no centroid within MAX_SNAP_MILES');
  });

  it('names a coordinate-less candidate rather than calling the snap with NaN', () => {
    // Arrange
    const candidates = [candidate({ lat: Number.NaN, lng: Number.NaN })];
    let snapCalls = 0;
    const countingGeo: GeoDeps = {
      snapToNeighborhoodCentroid: (c) => {
        snapCalls += 1;
        return snapToNeighborhoodCentroid(c);
      },
      isInServiceArea,
    };

    // Act
    const { snapFailed } = correctNeighborhoods(candidates, countingGeo, KNOWN_HOODS);

    // Assert
    expect(snapCalls).toBe(0);
    expect(snapFailed[0].reason).toBe('missing coordinates');
    expect(snapFailed[0].lat).toBeNull();
  });
});

describe('buildExpansionPacket', () => {
  it('turns a snap-corrected candidate into a new insert that the raw label would have rejected', () => {
    // Arrange
    const baseline: BaselineBar[] = [{ id: 'attaboy', name: 'Attaboy', neighborhood: 'LES' }];

    // Act
    const packet = buildExpansionPacket({
      candidates: [candidate({ name: 'Brand New Bar' })],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
      geo: GEO,
      knownNeighborhoods: KNOWN_HOODS,
    });

    // Assert
    expect(packet.neighborhoodCorrected).toBe(1);
    expect(packet.newInserts).toHaveLength(1);
    expect(packet.newInserts[0].neighborhood).toBe('Chelsea');
    expect(packet.validationRejects).toHaveLength(0);
    expect(packet.projectedTotal).toBe(baseline.length + 1);
  });

  it('preserves both identity ids across correction', () => {
    // Arrange — "sla:12345" slugifies to catalog row id "sla-12345".
    const original = candidate({ externalId: 'sla:12345', name: 'Identity Bar' });

    // Act
    const packet = buildExpansionPacket({
      candidates: [original],
      baseline: [],
      reportGeneratedAt: REPORT_GENERATED_AT,
      geo: GEO,
      knownNeighborhoods: KNOWN_HOODS,
    });

    // Assert — source externalId unchanged, and the derived row id an apply
    // would produce from it is unchanged too (it is a function of externalId
    // alone, which correction never touches).
    expect(packet.newInserts[0].externalId).toBe('sla:12345');
    expect(packet.corrections[0].externalId).toBe('sla:12345');
    expect(original.neighborhood).toBe('manhattan'); // input never mutated
    const packetWithCollidingId = buildExpansionPacket({
      candidates: [original],
      baseline: [{ id: 'sla-12345', name: 'Something Else', neighborhood: 'UES' }],
      reportGeneratedAt: REPORT_GENERATED_AT,
      geo: GEO,
      knownNeighborhoods: KNOWN_HOODS,
    });
    expect(packetWithCollidingId.idCollisions).toHaveLength(1);
    expect(packetWithCollidingId.idCollisions[0].reason).toContain('sla-12345');
  });

  it('reclassifies a validation reject as a name+neighborhood collision once corrected', () => {
    // Arrange — the baseline already holds "Attaboy" in Chelsea. Uncorrected
    // the candidate is a validation reject (neighborhood "manhattan" is not in
    // the vocabulary); corrected it becomes a Chelsea duplicate.
    const baseline: BaselineBar[] = [{ id: 'attaboy', name: 'Attaboy', neighborhood: 'Chelsea' }];
    const candidates = [candidate({ externalId: 'sla:dup', name: 'Attaboy' })];

    // Act
    const uncorrected = buildExpansionPacket({
      candidates,
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
      geo: GEO,
      // Empty vocabulary ⇒ nothing is "known", but the stubbed snap also
      // declines, so the candidate keeps its raw label: the pre-correction state.
      knownNeighborhoods: KNOWN_HOODS,
    });
    const withoutCorrection = buildExpansionPacket({
      candidates,
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
      geo: { snapToNeighborhoodCentroid: () => null, isInServiceArea: () => true },
      knownNeighborhoods: KNOWN_HOODS,
    });

    // Assert
    expect(withoutCorrection.validationRejects).toHaveLength(1);
    expect(withoutCorrection.nameHoodCollisions).toHaveLength(0);
    expect(uncorrected.nameHoodCollisions).toHaveLength(1);
    expect(uncorrected.validationRejects).toHaveLength(0);
    expect(uncorrected.projectedTotal).toBe(baseline.length);
  });

  it('accounts for every candidate in exactly one bucket', () => {
    // Arrange — one insert, one id collision, one post-correction duplicate,
    // one permanently invalid (out of area).
    const baseline: BaselineBar[] = [
      { id: 'attaboy', name: 'Attaboy', neighborhood: 'Chelsea' },
      { id: 'sla-collide', name: 'Unrelated', neighborhood: 'UES' },
    ];
    const candidates = [
      candidate({ externalId: 'sla:new', name: 'Brand New Bar' }),
      candidate({ externalId: 'sla:collide', name: 'Another Name' }),
      candidate({ externalId: 'sla:dup', name: 'Attaboy' }),
      candidate({ externalId: 'sla:far', name: 'Far Bar', lat: 34.05, lng: -118.24 }),
    ];

    // Act
    const packet = buildExpansionPacket({
      candidates,
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
      geo: GEO,
      knownNeighborhoods: KNOWN_HOODS,
    });

    // Assert
    expect(packet.accountedFor).toBe(candidates.length);
    expect(packet.newInserts).toHaveLength(1);
    expect(packet.idCollisions).toHaveLength(1);
    expect(packet.nameHoodCollisions).toHaveLength(1);
    expect(packet.validationRejects).toHaveLength(1);
    expect(packet.snapFailed).toHaveLength(1);
    expect(packet.validationRejects[0].failedCheck).toContain('outside the service-area bbox');
  });

  it('computes projectedTotal and reaches1200 from the corrected set', () => {
    // Arrange — 1,199 baseline rows plus one correctable candidate lands
    // exactly on the target; the same baseline with an uncorrectable one does not.
    const baseline: BaselineBar[] = Array.from({ length: 1199 }, (_, i) => ({
      id: `baseline-${i}`,
      name: `Baseline Bar ${i}`,
      neighborhood: 'LES',
    }));

    // Act
    const reached = buildExpansionPacket({
      candidates: [candidate({ externalId: 'sla:tips-it', name: 'Tips It Over' })],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
      geo: GEO,
      knownNeighborhoods: KNOWN_HOODS,
    });
    const shortByOne = buildExpansionPacket({
      candidates: [candidate({ externalId: 'sla:far', lat: 34.05, lng: -118.24 })],
      baseline,
      reportGeneratedAt: REPORT_GENERATED_AT,
      geo: GEO,
      knownNeighborhoods: KNOWN_HOODS,
    });

    // Assert
    expect(reached.projectedTotal).toBe(1200);
    expect(reached.reaches1200).toBe(true);
    expect(shortByOne.projectedTotal).toBe(1199);
    expect(shortByOne.reaches1200).toBe(false);
  });
});

describe('explainValidationFailure', () => {
  it('names the unknown-neighborhood check for an uncorrected borough label', () => {
    // Arrange / Act
    const reason = explainValidationFailure(candidate(), KNOWN_HOODS, isInServiceArea);

    // Assert
    expect(reason).toContain('"manhattan"');
    expect(reason).toContain('known-neighborhood vocabulary');
  });

  it('names the bbox check ahead of the neighborhood check for an out-of-area candidate', () => {
    // Arrange / Act
    const reason = explainValidationFailure(
      candidate({ lat: 34.05, lng: -118.24 }),
      KNOWN_HOODS,
      isInServiceArea,
    );

    // Assert
    expect(reason).toBe('coordinates outside the service-area bbox');
  });
});
