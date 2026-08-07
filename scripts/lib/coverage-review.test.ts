import { describe, expect, it } from 'vitest';
// @ts-ignore -- the operator script intentionally remains native ESM.
import { BOROUGH_SCOPES, adversarialReview, resolveScope, reviewNameSimilarity } from './coverage-review.mjs';

describe('coverage candidate adversarial review', () => {
  it('accepts an established public Google bar', () => {
    expect(
      adversarialReview({
        name: 'Tavern On Reade',
        placeId: 'google-1',
        primaryType: 'bar_and_grill',
        ratings: 243,
        licenseMatches: [],
      }).decision,
    ).toBe('accept');
    expect(
      adversarialReview({
        name: 'Little Sister Lounge',
        placeId: 'google-2',
        primaryType: 'lounge_bar',
        ratings: 515,
        licenseMatches: [{ description: 'Temporary retail', city: 'New York' }],
      }).decision,
    ).toBe('accept');
  });

  it('rejects semantic and license false positives', () => {
    expect(
      adversarialReview({
        name: 'Noho Juice Bar',
        placeId: 'google-2',
        primaryType: 'deli',
        ratings: 78,
        licenseMatches: [],
      }).decision,
    ).toBe('reject');
    expect(
      adversarialReview({
        name: 'Healthy Deli Salad Bar Inc.',
        placeId: null,
        licenseMatches: [{ description: 'Temporary retail', city: 'New York' }],
      }).decision,
    ).toBe('reject');
  });

  it('does not promote license-only bar-like names without a public identity', () => {
    expect(
      adversarialReview({
        name: 'ATTABOY COCKTAILS LLC',
        placeId: null,
        licenseMatches: [{ description: 'Food & Beverage Business', city: 'New York' }],
      }).decision,
    ).toBe('lookup');
  });

  it('uses secondary Google bar types when the primary type is misleading', () => {
    expect(
      adversarialReview({
        name: 'Book Club Bar',
        placeId: 'google-4',
        primaryType: 'book_store',
        googleTypes: ['book_store', 'coffee_shop', 'bar'],
        ratings: 100,
        licenseMatches: [{ description: 'Food & Beverage Business', city: 'New York' }],
      }).decision,
    ).toBe('accept');
  });

  it('holds public nightlife hybrids for review without any Google bar type', () => {
    expect(
      adversarialReview({
        name: 'Amsterdam Billiards',
        sourceNames: ['AMSTERDAM BILLIARDS & BAR'],
        placeId: 'google-5',
        primaryType: 'sports_complex',
        ratings: 100,
        licenseMatches: [{ description: 'Food & Beverage Business', city: 'New York' }],
      }).decision,
    ).toBe('lookup');
  });

  it('preserves an explicit external bar seed when Google uses a restaurant type', () => {
    expect(
      adversarialReview({
        name: 'Gran Torino',
        requestedNames: ['Gran Torino'],
        placeId: 'google-6',
        primaryType: 'restaurant',
        googleTypes: ['restaurant', 'food'],
        ratings: 100,
        licenseMatches: [],
      }).decision,
    ).toBe('lookup');
  });

  it('accepts an explicit seed with a Google bar type even without ratings', () => {
    expect(
      adversarialReview({
        name: 'Ontario Bar',
        requestedNames: ['Ontario Bar'],
        placeId: 'google-7',
        primaryType: 'bar',
        googleTypes: ['bar'],
        ratings: 0,
        licenseMatches: [],
      }).decision,
    ).toBe('accept');
  });

  it('identifies probable nearby production aliases', () => {
    expect(
      adversarialReview(
        { name: 'Allure Cocktail Lounge', placeId: 'google-3', primaryType: 'bar', ratings: 50 },
        [{ name: 'Allure Lounge', distanceMeters: 4, nameSimilarity: 0.5 }],
      ).decision,
    ).toBe('duplicate');
    expect(reviewNameSimilarity('ATTABOY COCKTAILS LLC', 'Attaboy')).toBe(0.5);
  });
});

describe('borough-parameterized review', () => {
  const brooklynLicenseLead = {
    name: 'Gadfly Bar',
    placeId: null,
    licenseMatches: [{ description: 'Food & Beverage Business', city: 'Brooklyn', county: 'Kings' }],
  };
  const manhattanLicenseLead = {
    name: 'Gadfly Bar',
    placeId: null,
    licenseMatches: [{ description: 'Food & Beverage Business', city: 'New York', county: 'New York' }],
  };

  it('resolves a scope from either a borough or an NY county name', () => {
    expect(resolveScope({ borough: 'Brooklyn' })).toBe(BOROUGH_SCOPES.brooklyn);
    expect(resolveScope({ county: 'Kings' })).toBe(BOROUGH_SCOPES.brooklyn);
    expect(resolveScope({ county: 'New York' })).toBe(BOROUGH_SCOPES.manhattan);
    expect(resolveScope({})).toBeNull();
  });

  it('keeps a Brooklyn lead when reviewing Brooklyn / Kings County', () => {
    // Pre-fix this returned reject via the hardcoded Manhattan city list, which
    // is how 75 confirmed Brooklyn gaps could be rejected on sight.
    expect(adversarialReview(brooklynLicenseLead, [], { borough: 'brooklyn' }).decision).toBe('lookup');
    expect(adversarialReview(brooklynLicenseLead, [], { county: 'Kings' }).decision).toBe('lookup');
  });

  it('keeps a Manhattan lead when reviewing Manhattan / New York County', () => {
    expect(adversarialReview(manhattanLicenseLead, [], { borough: 'manhattan' }).decision).toBe('lookup');
    expect(adversarialReview(manhattanLicenseLead, [], { county: 'New York' }).decision).toBe('lookup');
  });

  it('keeps a lead whose county matches even when its locality is not listed', () => {
    // NYC has far more postal localities than boroughs. Rejecting on an
    // unlisted city name would throw away every valid Bayside / Elmhurst /
    // Jackson Heights lead as "outside Queens County".
    const bayside = {
      name: 'Gadfly Bar',
      placeId: null,
      licenseMatches: [{ description: 'Food & Beverage Business', city: 'Bayside', county: 'Queens' }],
    };
    expect(adversarialReview(bayside, [], { borough: 'queens' }).decision).toBe('lookup');
  });

  it('does not treat a same-named venue with a different Place ID as a duplicate', () => {
    // The multi-location rule has to hold in the review driver too, not only in
    // the sweep: nameExact alone used to force a duplicate verdict here.
    const review = adversarialReview(
      { name: 'The Canuck', placeId: 'place-brooklyn', primaryType: 'bar', ratings: 90 },
      [{ name: 'The Canuck', placeId: 'place-manhattan', distanceMeters: 40, nameSimilarity: 1, nameExact: true }],
      { borough: 'brooklyn' },
    );
    expect(review.decision).not.toBe('duplicate');
  });

  it('routes a reissued Place ID to lookup, agreeing with resolveIdentity', () => {
    // Both identity paths must reach the same verdict on this input, and that
    // verdict is "ask a human": a differing Place ID is uninformative, and
    // guessing duplicate would silently drop a real bar.
    const review = adversarialReview(
      {
        name: 'Keg & Lantern',
        placeId: 'place-new',
        address: '97 Nassau Ave, Brooklyn, NY',
        primaryType: 'bar',
        ratings: 200,
      },
      [
        {
          name: 'Keg & Lantern',
          placeId: 'place-old',
          address: '97 Nassau Avenue, Brooklyn, NY',
          distanceMeters: 3,
          nameSimilarity: 1,
          nameExact: true,
        },
      ],
      { borough: 'brooklyn' },
    );
    expect(review.decision).toBe('lookup');
  });

  it('does not suppress a candidate that has no address against a row that does', () => {
    // Asymmetric address availability: nothing is comparable, so distance alone
    // must not decide. resolveIdentity returns distinct here; this path used to
    // return duplicate and silently drop the venue.
    const review = adversarialReview(
      { name: 'The Anchor Bar', placeId: null, address: '', primaryType: 'bar', ratings: 90 },
      [
        {
          name: 'The Anchor Bar',
          placeId: 'prod-1',
          address: '123 Main St, New York, NY',
          distanceMeters: 7,
          nameSimilarity: 1,
          nameExact: true,
        },
      ],
      { borough: 'manhattan' },
    );
    expect(review.decision).not.toBe('duplicate');
  });

  it('does not suppress a fuzzy name match at a different street address', () => {
    const review = adversarialReview(
      { name: 'Allure Cocktail Lounge', placeId: 'google-new', address: '10 Main St, New York, NY', primaryType: 'bar', ratings: 90 },
      [
        {
          name: 'Allure Lounge',
          placeId: null,
          address: '12 Main St, New York, NY',
          distanceMeters: 4,
          nameSimilarity: 0.667,
          nameExact: false,
        },
      ],
      { borough: 'manhattan' },
    );
    expect(review.decision).not.toBe('duplicate');
  });

  it('does not call an exact name a duplicate across a different address', () => {
    // catalogMatches admits rows up to 60m away — a whole block. An exact name
    // alone used to force duplicate there, disagreeing with resolveIdentity
    // and silently deleting a real second location.
    const review = adversarialReview(
      { name: 'Acme', placeId: 'new', address: '10 Main St, Brooklyn, NY', primaryType: 'bar', ratings: 90 },
      [
        {
          name: 'Acme',
          placeId: null,
          address: '58 Main St, Brooklyn, NY',
          distanceMeters: 55,
          nameSimilarity: 1,
          nameExact: true,
        },
      ],
      { borough: 'brooklyn' },
    );
    expect(review.decision).not.toBe('duplicate');
  });

  it('still calls an exact name a duplicate at the same address', () => {
    expect(
      adversarialReview(
        { name: 'Acme', placeId: null, address: '10 Main St, Brooklyn, NY', primaryType: 'bar', ratings: 90 },
        [
          {
            name: 'Acme',
            placeId: null,
            address: '10 Main Street, Brooklyn, NY',
            distanceMeters: 40,
            nameSimilarity: 1,
            nameExact: true,
          },
        ],
        { borough: 'brooklyn' },
      ).decision,
    ).toBe('duplicate');
  });

  it('still calls it a duplicate when the Place IDs actually match', () => {
    expect(
      adversarialReview(
        { name: 'The Canuck', placeId: 'place-x', primaryType: 'bar', ratings: 90 },
        [{ name: 'The Canuck', placeId: 'place-x', distanceMeters: 3, nameSimilarity: 1, nameExact: true, placeIdMatch: true }],
        { borough: 'brooklyn' },
      ).decision,
    ).toBe('duplicate');
  });

  it('rejects a lead that is outside the borough actually being reviewed', () => {
    const review = adversarialReview(brooklynLicenseLead, [], { borough: 'manhattan' });
    expect(review.decision).toBe('reject');
    expect(review.reasons[0]).toMatch(/outside New York County/);
  });

  it('does not reject on geography at all when no scope is supplied', () => {
    expect(adversarialReview(brooklynLicenseLead, []).decision).toBe('lookup');
  });
});

describe('SLA licenses are supporting evidence, never an independent accept', () => {
  const noPublicEvidence = {
    name: 'Quiet Room',
    placeId: 'google-sla-1',
    primaryType: 'bar',
    googleTypes: ['bar'],
    ratings: 0,
    website: null,
    licenseMatches: [{ description: 'On-Premises Liquor', city: 'New York', county: 'New York' }],
  };

  it('holds a Google bar type whose ONLY corroboration is a liquor license', () => {
    const review = adversarialReview(noPublicEvidence, [], { borough: 'manhattan' });
    expect(review.decision).toBe('lookup');
  });

  it('accepts once real public evidence exists, and credits the license as support', () => {
    const review = adversarialReview({ ...noPublicEvidence, ratings: 240 }, [], {
      borough: 'manhattan',
    });
    expect(review.decision).toBe('accept');
    expect(review.reasons).toContain('supporting SLA on-premises license');
  });

  it('still refuses to promote a license-only lead with no public identity', () => {
    expect(
      adversarialReview(
        { name: 'ATTABOY COCKTAILS LLC', placeId: null, licenseMatches: [{ description: 'On-Premises Liquor', city: 'New York' }] },
        [],
        { borough: 'manhattan' },
      ).decision,
    ).toBe('lookup');
  });
});
