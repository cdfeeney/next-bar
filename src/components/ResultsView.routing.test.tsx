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

it('applies vibe priority inside the nearest 15 before sending the same order for street routing', () => {
  const props = {
    location: { kind: 'coords' as const, coords: { lat: 40.75, lng: -74 }, band: 'precise' as const, snappedTo: null },
    maxMiles: RADIUS_WALK,
  };
  const { rerender } = render(<ResultsView {...props} profile={{ tags: [], archetype: '', preferredNeighborhoods: [] }} />);
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Bar 0');
  rerender(<ResultsView {...props} profile={{ tags: ['cocktail'], archetype: '', preferredNeighborhoods: [], isExplicitVibe: true }} />);
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Bar 5');
  const candidates = (routing.mock.lastCall as unknown as [unknown, Bar[]])[1];
  expect(candidates).toHaveLength(15);
  expect(candidates[0].id).toBe('bar-5');
  expect(candidates.map(b => b.id)).not.toContain('bar-17');
  expect(candidates.map(b => b.id).sort()).toEqual(bars.slice(0, 15).map(b => b.id).sort());
});

it('widens cab and anywhere matching while retaining nearby candidates and the cab boundary', () => {
  const profile: VibeProfile = { tags: ['cocktail', 'rooftop', 'wine'], archetype: '', preferredNeighborhoods: [], isExplicitVibe: true };
  const location = { kind: 'coords' as const, coords: { lat: 40.75, lng: -74 }, band: 'precise' as const, snappedTo: null };
  const { rerender } = render(<ResultsView profile={profile} location={location} maxMiles={RADIUS_WALK} />);
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Bar 5');
  rerender(<ResultsView profile={profile} location={location} maxMiles={RADIUS_CAB} />);
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Bar 16');
  const cab = (routing.mock.lastCall as unknown as [unknown, Bar[], string]);
  expect(cab[1].map(b => b.id)).toContain('bar-0');
  expect(cab[1].map(b => b.id)).not.toContain('bar-17');
  expect(cab[2]).toBe('driving');
  rerender(<ResultsView profile={profile} location={location} maxMiles={null} />);
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Bar 17');
  const anywhere = (routing.mock.lastCall as unknown as [unknown, Bar[]])[1];
  expect(anywhere.map(b => b.id)).toContain('bar-0');
  expect(anywhere).toHaveLength(15);
  rerender(<ResultsView profile={profile} location={location} maxMiles={null} nearbyFirst />);
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Bar 5');
});
