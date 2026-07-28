import { describe, it, expect } from 'vitest';
import { barStatus } from '@/components/OpenNowBadge';
import type { Bar } from '@/types';

const base: Bar = {
  id: 'x',
  name: 'X',
  neighborhood: 'LES',
  address: '1 Main St',
  lat: 40.72,
  lng: -73.99,
  priceTier: 2,
  tags: ['cocktail'],
  blurb: 'A bar.',
  lastVerified: '2026-04-01',
};

// 2026-01-15 is a Thursday (day 4); January = EST (UTC-5).
const thuEvening = new Date('2026-01-16T00:00:00Z'); // NYC Thu 19:00
const thuAfternoon = new Date('2026-01-15T20:00:00Z'); // NYC Thu 15:00
const TRUSTED_THU = { 4: [{ open: '17:00', close: '02:00' }] } as unknown as Bar['hours'];

describe('barStatus', () => {
  it('is unknown when the bar has no hours and no status', () => {
    expect(barStatus(base, thuEvening)).toBe('unknown');
  });

  it('is permanently-closed regardless of hours when businessStatus says so', () => {
    expect(barStatus({ ...base, businessStatus: 'CLOSED_PERMANENTLY', hours: { 4: [{ open: '17:00', close: '02:00' }] } }, thuEvening)).toBe('permanently-closed');
  });

  it('is open inside the current window', () => {
    expect(barStatus({ ...base, hours: TRUSTED_THU, hoursConfidence: 'verified' }, thuEvening)).toBe('open');
  });

  it('is closed outside the current window', () => {
    expect(barStatus({ ...base, hours: TRUSTED_THU, hoursConfidence: 'verified' }, thuAfternoon)).toBe('closed');
  });

  // Provenance gate (2026-07-27): hours we are not entitled to rely on must
  // not produce a confident badge. If they cannot exclude a bar from the
  // results, they cannot tell a user it is shut either.
  it('shows NOTHING when hours are Google-derived (unverified)', () => {
    const unverified = { ...base, hours: TRUSTED_THU, hoursConfidence: 'unverified' as const };
    expect(barStatus(unverified, thuAfternoon)).toBe('unknown');
    expect(barStatus(unverified, thuEvening)).toBe('unknown');
  });

  it('treats missing provenance as unverified', () => {
    expect(barStatus({ ...base, hours: TRUSTED_THU }, thuEvening)).toBe('unknown');
  });

  it('venue-reported hours are good enough to badge', () => {
    expect(
      barStatus({ ...base, hours: TRUSTED_THU, hoursConfidence: 'reported' }, thuEvening),
    ).toBe('open');
  });

  it('permanently-closed still wins over unverified hours', () => {
    expect(
      barStatus(
        { ...base, businessStatus: 'CLOSED_PERMANENTLY', hours: TRUSTED_THU, hoursConfidence: 'unverified' },
        thuEvening,
      ),
    ).toBe('permanently-closed');
  });
});
