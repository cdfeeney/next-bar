import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Bar, VibeProfile } from '@/types';
import ResultsView from './ResultsView';
import { RADIUS_CAB, RADIUS_WALK } from '@/lib/constants';

const { bars, routing, ratings } = vi.hoisted(() => ({
  bars: Array.from({ length: 18 }, (_, i) => ({
    id: `bar-${i}`, name: `Bar ${i}`, neighborhood: 'Chelsea', address: '',
    lat: i === 16 ? 40.80 : i === 17 ? 40.84 : 40.75 + i / 1000, lng: -74, priceTier: 2,
    tags: i === 17 ? ['cocktail', 'rooftop', 'wine'] : i === 16 ? ['cocktail', 'rooftop'] : i === 5 ? ['cocktail'] : ['pub'],
    blurb: '', lastVerified: '2026-09-07',
  })),
  ratings: [],
  routing: vi.fn(() => ({ status: 'loading', calculate: vi.fn(), data: undefined })),
}));
vi.mock('@/lib/useBars', () => ({ useBars: () => bars }));
vi.mock('@/hooks/useRatings', () => ({ useRatings: () => ({ ratings }) }));
vi.mock('@/hooks/useTravelRoutes', () => ({ useTravelRoutes: routing }));
vi.mock('@/components/ResultCard', () => ({ default: ({ bar }: { bar: Bar }) => <article>{bar.name}</article> }));

const candidatesSentToRouting = (): Bar[] =>
  (routing.mock.lastCall as unknown as [unknown, Bar[]])[1];

const props = {
  location: { kind: 'coords' as const, coords: { lat: 40.75, lng: -74 }, band: 'precise' as const, snappedTo: null },
  maxMiles: RADIUS_WALK,
};

it('sends only the nearest 15 for street routing when no vibe is selected', () => {
  render(<ResultsView {...props} profile={{ tags: [], archetype: '', preferredNeighborhoods: [] }} />);
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  const candidates = candidatesSentToRouting();
  expect(candidates).toHaveLength(15);
  expect(candidates.map(b => b.id)).not.toContain('bar-17');
  expect(candidates.map(b => b.id).sort()).toEqual(bars.slice(0, 15).map(b => b.id).sort());
});

it('gates route candidates on vibe eligibility BEFORE the 15-candidate cut', () => {
  // D-C-41: with one vibe selected, N = 1 and a bar needs 1 match. Only three
  // of the eighteen carry 'cocktail', so the 15-slot candidate list is not
  // topped up with the fifteen nearest pubs — the cut operates on an
  // already-filtered pool, never the other way round.
  const { rerender } = render(<ResultsView {...props} profile={{ tags: [], archetype: '', preferredNeighborhoods: [] }} />);
  rerender(<ResultsView {...props} profile={{ tags: ['cocktail'], archetype: '', preferredNeighborhoods: [], isExplicitVibe: true }} />);
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(candidatesSentToRouting().map(b => b.id)).toEqual(['bar-5', 'bar-16']);
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});

it('clearing the selection restores the ungated nearest-15 pool', () => {
  const { rerender } = render(<ResultsView {...props} profile={{ tags: ['cocktail'], archetype: '', preferredNeighborhoods: [], isExplicitVibe: true }} />);
  expect(candidatesSentToRouting()).toHaveLength(2);
  // An APPLIED but EMPTY pick is a clear, not a selection of nothing.
  rerender(<ResultsView {...props} profile={{ tags: [], archetype: '', preferredNeighborhoods: [], isExplicitVibe: true }} />);
  expect(candidatesSentToRouting()).toHaveLength(15);
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});

/**
 * The radius contract (V8-R-NXT-008) on the QUIZ-PRIOR path, where nearby
 * nonmatching bars legitimately stay in the candidate pool. It used to carry
 * `isExplicitVibe: true`, but under D-C-41 an explicit selection rejects every
 * pub outright, so the same fixture could no longer say anything about what
 * the radius does — the vibe gate would be doing all the work. Eligibility
 * under an explicit selection is covered by the three tests above.
 */
it('selects bands before routing and never shows unconfirmed inner-band candidates', () => {
  const profile: VibeProfile = { tags: ['cocktail', 'rooftop', 'wine'], archetype: '', preferredNeighborhoods: [] };
  const location = { kind: 'coords' as const, coords: { lat: 40.75, lng: -74 }, band: 'precise' as const, snappedTo: null };
  const { rerender } = render(<ResultsView profile={profile} location={location} maxMiles={RADIUS_WALK} />);
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  rerender(<ResultsView profile={profile} location={location} maxMiles={RADIUS_CAB} />);
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(candidatesSentToRouting()[0].id).toBe('bar-16');
  const cab = (routing.mock.lastCall as unknown as [unknown, Bar[], string]);
  expect(cab[1].map(b => b.id)).toContain('bar-0');
  expect(cab[1].map(b => b.id)).not.toContain('bar-17');
  expect(cab[2]).toBe('driving');
  rerender(<ResultsView profile={profile} location={location} maxMiles={null} />);
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Bar 17');
  const anywhere = (routing.mock.lastCall as unknown as [unknown, Bar[]])[1];
  expect(anywhere.map(b => b.id)).toEqual(['bar-17']);
  rerender(<ResultsView profile={profile} location={location} maxMiles={null} nearbyFirst />);
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Bar 5');
});
