import { describe, expect, it } from 'vitest';
import { parseFivePm, reconcilePlaces, selectPlace } from './manhattan-curation';

const source = {
  name: 'Example Cocktail Bar',
  neighborhood: 'NoMad',
  address: '10 W 26th St, New York, NY 10010',
  category: 'Cocktail Bar',
  website: 'https://example.test/',
  verifiedHappyHour: true,
};
const place = {
  id: 'ChIJ-valid',
  displayName: { text: 'Example Cocktail Bar' },
  formattedAddress: '10 W 26th St, New York, NY 10010, USA',
  location: { latitude: 40.744, longitude: -73.99 },
  addressComponents: [
    { longText: '10', types: ['street_number'] },
    { longText: 'West 26th Street', shortText: 'W 26th St', types: ['route'] },
    { longText: 'New York County', types: ['administrative_area_level_2'] },
  ],
  primaryType: 'bar',
  types: ['bar'],
  businessStatus: 'OPERATIONAL',
};

describe('5PM + Google Places Manhattan curation', () => {
  it('parses the public 5PM card contract', () => {
    const html = `<div class="nb-card" data-imp-ver="1">
      <div><div><div style="margin-top:2px">Cocktail Bar · ★ 4.7 · NoMad</div></div></div>
      <a href="https://www.google.com/maps/search/?api=1">Maps</a>
      <a href="https://example.test">Website</a>
      <button data-share='{"name":"Example Cocktail Bar","neighborhood":"NoMad","address":"10 W 26th St"}'></button>
    </div>`;
    expect(parseFivePm(html)).toEqual([{ ...source, address: '10 W 26th St' }]);
  });

  it('accepts an operational Manhattan Google match without requiring SLA', () => {
    expect(selectPlace(source, [place])).toEqual({ place, reason: null });
    expect(selectPlace(source, [{ ...place, businessStatus: 'CLOSED_PERMANENTLY' }]).reason)
      .toContain('operational');
  });

  it('requires the street, not only the house number, and permits customer-facing types', () => {
    const restaurant = { ...place, primaryType: 'restaurant', types: ['restaurant'] };
    expect(selectPlace(source, [restaurant])).toEqual({ place: restaurant, reason: null });
    expect(selectPlace(source, [{
      ...place,
      formattedAddress: '10 W 27th St, New York, NY 10001, USA',
      addressComponents: [
        { longText: '10', types: ['street_number'] },
        { longText: 'West 27th Street', shortText: 'W 27th St', types: ['route'] },
        { longText: 'New York County', types: ['administrative_area_level_2'] },
      ],
    }]).reason).toContain('ambiguous');
  });

  it('dedupes by Google place ID and retains it in the insert payload', () => {
    const first = reconcilePlaces({
      validated: [{ source, place }], rejected: [], staging: [], verifiedDate: '2026-08-13',
    });
    expect(first.curated[0]).toMatchObject({
      neighborhood: 'Flatiron', placeId: 'ChIJ-valid', businessStatus: 'OPERATIONAL',
    });
    const existing = {
      id: 'existing', name: 'Example', neighborhood: 'Flatiron', address: '10 W 26th St',
      lat: 40.744, lng: -73.99, place_id: 'ChIJ-valid',
    };
    expect(reconcilePlaces({
      validated: [{ source, place }], rejected: [], staging: [existing], verifiedDate: '2026-08-13',
    })).toMatchObject({ curated: [], unchanged: [existing] });
  });
});
