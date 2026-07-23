import { describe, expect, it } from 'vitest';
import { buildPickPath, sharePickText } from '@/lib/share';
import type { Bar } from '@/types';

const bar: Bar = {
  id: 'death-and-co',
  name: 'Death & Co',
  neighborhood: 'East Village',
  address: '433 E 6th St, New York, NY',
  lat: 40.7264,
  lng: -73.9843,
  priceTier: 3,
  tags: ['cocktail'],
  blurb: 'Pioneering cocktail den.',
  lastVerified: '2026-04-01',
};

describe('buildPickPath', () => {
  it('builds the share path from the bar id', () => {
    expect(buildPickPath('death-and-co')).toBe('/share/death-and-co');
  });

  it('URL-encodes ids defensively', () => {
    expect(buildPickPath('weird id')).toBe('/share/weird%20id');
  });
});

describe('sharePickText', () => {
  it('names the bar and neighborhood', () => {
    const text = sharePickText(bar);
    expect(text).toContain('Death & Co');
    expect(text).toContain('East Village');
  });
});
