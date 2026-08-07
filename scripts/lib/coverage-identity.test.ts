import { describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import { boroughOf, physicalLocationKey, resolveIdentity, streetKey } from './coverage-identity.mjs';
// @ts-ignore
import { candidateKey, normalizeName } from './coverage-search.mjs';

/**
 * The Canuck is the regression this module exists for. Two real locations, two
 * Place IDs, two addresses, two boroughs. The old global
 * `haveName.has(normalizeName(name))` gate deleted the second one on sight.
 */
const canuckManhattan = {
  id: 'prod-1',
  name: 'The Canuck',
  place_id: 'place-canuck-manhattan',
  address: '331 W 4th St, New York, NY 10014, USA',
  lat: 40.7345,
  lng: -74.0021,
};
const canuckBrooklyn = {
  name: 'The Canuck',
  placeId: 'place-canuck-brooklyn',
  address: '605 Manhattan Ave, Brooklyn, NY 11222, USA',
  lat: 40.7275,
  lng: -73.9515,
};

describe('multi-location identity regression', () => {
  it('is the exact case the old global-name rule got wrong', () => {
    // The rule the sweep used to apply, verbatim in behaviour:
    //   haveName = new Set(catalog.map((bar) => normalizeName(bar.name)))
    //   if (haveName.has(normalizeName(name))) continue;   // <- drops it
    const haveName = new Set([normalizeName(canuckManhattan.name)]);
    const droppedByLegacyRule = haveName.has(normalizeName(canuckBrooklyn.name));
    expect(droppedByLegacyRule).toBe(true);

    // The per-location rule keeps it — a real Brooklyn bar with its own Place
    // ID that production does not have.
    expect(resolveIdentity(canuckBrooklyn, [canuckManhattan]).verdict).toBe('distinct');
  });

  it('keeps a second location of a brand already in production', () => {
    const identity = resolveIdentity(canuckBrooklyn, [canuckManhattan]);
    expect(identity.verdict).toBe('distinct');
    expect(identity.reason).toMatch(/distinct location/);
  });

  it('still catches the same storefront by Place ID', () => {
    const identity = resolveIdentity(
      { ...canuckBrooklyn, placeId: canuckManhattan.place_id },
      [canuckManhattan],
    );
    expect(identity.verdict).toBe('duplicate');
    expect(identity.reason).toMatch(/same Google Place ID/);
  });

  it('gives the two locations different candidate keys', () => {
    expect(candidateKey({ ...canuckBrooklyn, county: 'Kings' })).not.toBe(
      candidateKey({ name: 'The Canuck', lat: 40.7345, lng: -74.0021, county: 'New York' }),
    );
  });

  it('separates same-named venues in different boroughs even at identical coordinates', () => {
    const shared = { name: 'The Canuck', lat: 40.73, lng: -73.95 };
    expect(candidateKey({ ...shared, county: 'Kings' })).not.toBe(
      candidateKey({ ...shared, county: 'Queens' }),
    );
  });
});

describe('identity precedence', () => {
  it('keeps two Place-ID-bearing rows distinct when they are at different addresses', () => {
    const identity = resolveIdentity(
      { name: 'Sister Bar', placeId: 'place-a', address: '12 Berry St, Brooklyn, NY', lat: 40.7, lng: -73.9 },
      [
        {
          name: 'Sister Bar',
          place_id: 'place-b',
          address: '400 Union Ave, Brooklyn, NY',
          lat: 40.70003,
          lng: -73.9,
        },
      ],
    );
    expect(identity.verdict).not.toBe('duplicate');
  });

  it('catches one storefront listed twice after Google reissued its Place ID', () => {
    // Google reissues a Place ID on owner re-claims and listing merges, so
    // differing ids alone do not prove two venues. Same name at the same street
    // number, metres apart, is one bar with two listings.
    const identity = resolveIdentity(
      { name: 'Keg & Lantern', placeId: 'place-new', address: '97 Nassau Ave, Brooklyn, NY', lat: 40.7, lng: -73.9 },
      [
        {
          name: 'Keg & Lantern',
          place_id: 'place-old',
          address: '97 Nassau Avenue, Brooklyn, NY',
          lat: 40.70003,
          lng: -73.9,
        },
      ],
    );
    expect(identity.verdict).toBe('duplicate');
    expect(identity.reason).toMatch(/reissues/);
  });

  it('matches a license-only row to production by name and street address', () => {
    const identity = resolveIdentity(
      { name: 'Attaboy', placeId: null, address: '134 Eldridge St, New York, NY 10002', lat: 40.7189, lng: -73.9906 },
      [
        {
          name: 'Attaboy',
          place_id: 'place-attaboy',
          address: '134 Eldridge Street, New York, NY 10002',
          lat: 40.71891,
          lng: -73.99061,
        },
      ],
    );
    expect(identity.verdict).toBe('duplicate');
    expect(identity.reason).toMatch(/same name and street address/);
  });

  it('routes an unlocatable name collision to review rather than guessing', () => {
    const identity = resolveIdentity({ name: 'The Canuck', placeId: null }, [canuckManhattan]);
    expect(identity.verdict).toBe('ambiguous');
  });

  it('keeps a distinct venue that production has never seen', () => {
    expect(resolveIdentity({ name: 'Brand New Bar', placeId: 'p1', lat: 40.7, lng: -73.9 }, []).verdict).toBe(
      'distinct',
    );
  });
});

describe('address and borough normalization', () => {
  it('agrees across abbreviated and spelled-out street names', () => {
    expect(streetKey('331 W 4th St, New York, NY')).toBe(streetKey('331 West 4th Street, New York, NY'));
  });

  it('returns null when there is no house number to anchor on', () => {
    expect(streetKey('Pier 6, Brooklyn Bridge Park')).toBeNull();
  });

  it('reads a borough from an address, an SLA county, or an explicit field', () => {
    expect(boroughOf({ address: '605 Manhattan Ave, Brooklyn, NY 11222, USA' })).toBe('brooklyn');
    expect(boroughOf({ address: '938 Amsterdam Ave, New York, NY 10025, USA' })).toBe('manhattan');
    expect(boroughOf({ licenseMatches: [{ county: 'Kings' }] })).toBe('brooklyn');
    expect(boroughOf({ borough: 'Queens' })).toBe('queens');
  });

  it('keys a license row by name, street, and borough', () => {
    expect(physicalLocationKey({ name: 'Gadfly Bar', address: '10 Front St, Brooklyn, NY' })).toBe(
      'loc:gadflybar:10:front:brooklyn',
    );
  });
});
