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

  // ASYMMETRIC PROVENANCE GATE (operator decision 2026-07-28). The first cut of
  // this gate suppressed the badge entirely for unverified hours, which silently
  // removed the open/closed signal from every card in the app — all 1,265 venues
  // are Google-sourced. That was an unapproved UX regression, and it was also
  // incoherent: the lightbox happily shows a full weekly hours table from the
  // same data.
  //
  // So the gate is now asymmetric, matching excludeClosedBars:
  //   hours say OPEN   -> say so, whatever the provenance. Useful, and the worst
  //                       case is sending someone to a bar that just shut.
  //   hours say CLOSED -> only assert it if we can stand behind the data.
  //                       Talking a user out of a bar that is probably open is
  //                       the one error worse than saying nothing.
  it('badges OPEN even on Google-derived (unverified) hours', () => {
    const unverified = { ...base, hours: TRUSTED_THU, hoursConfidence: 'unverified' as const };
    expect(barStatus(unverified, thuEvening)).toBe('open');
  });

  it('refuses to say CLOSED on unverified hours', () => {
    const unverified = { ...base, hours: TRUSTED_THU, hoursConfidence: 'unverified' as const };
    expect(barStatus(unverified, thuAfternoon)).toBe('unknown');
  });

  it('treats missing provenance the same as unverified, in both directions', () => {
    const noProvenance = { ...base, hours: TRUSTED_THU };
    expect(barStatus(noProvenance, thuEvening)).toBe('open');
    expect(barStatus(noProvenance, thuAfternoon)).toBe('unknown');
  });

  it('verified hours CAN say closed — that is the point of verifying them', () => {
    expect(
      barStatus({ ...base, hours: TRUSTED_THU, hoursConfidence: 'verified' }, thuAfternoon),
    ).toBe('closed');
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
