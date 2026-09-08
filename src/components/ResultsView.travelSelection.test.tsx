import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Bar, VibeProfile } from '@/types';
import ResultsView from './ResultsView';
import { RADIUS_CAB, RADIUS_WALK } from '@/lib/constants';

const { bars, routing, ratings } = vi.hoisted(() => {
  const at = (id: string, miles: number) => ({
    id, name: id, neighborhood: 'Chelsea', address: '', lat: 40.75 + miles / 69,
    lng: -74, priceTier: 2, tags: ['pub'], blurb: '', lastVerified: '2026-09-07',
  });
  return {
    bars: [
      ...Array.from({ length: 20 }, (_, i) => at(`near-${i}`, 0.05 + i * 0.05)),
      ...Array.from({ length: 5 }, (_, i) => at(`cab-${i}`, 2.5 + i * 0.1)),
      ...Array.from({ length: 5 }, (_, i) => at(`far-${i}`, 8 + i * 0.1)),
    ],
    ratings: [],
    routing: vi.fn(() => ({ status: 'loading', calculate: vi.fn(), data: undefined })),
  };
});
vi.mock('@/lib/useBars', () => ({ useBars: () => bars }));
vi.mock('@/hooks/useRatings', () => ({ useRatings: () => ({ ratings }) }));
vi.mock('@/hooks/useTravelRoutes', () => ({ useTravelRoutes: routing }));
vi.mock('@/components/ResultCard', () => ({ default: ({ bar }: { bar: Bar }) => <article>{bar.name}</article> }));

const untagged: VibeProfile = { tags: [], archetype: '', preferredNeighborhoods: [] };
const location = { kind: 'coords' as const, coords: { lat: 40.75, lng: -74 }, band: 'precise' as const, snappedTo: null };
const shown = (): string[] => screen.queryAllByRole('article').map((card) => card.textContent ?? '');
const sentIds = (): string[] =>
  (routing.mock.lastCall as unknown as [unknown, Bar[]])[1].map((candidate) => candidate.id);

it('requires route confirmation for inner bands and excludes nearer bars from Anywhere', () => {
  const view = (maxMiles: number | null) => (
    <ResultsView profile={untagged} location={location} maxMiles={maxMiles} maxResults={5} />
  );
  const { rerender } = render(view(RADIUS_WALK));
  const walkable = shown();
  expect(walkable).toEqual([]);

  rerender(view(RADIUS_CAB));
  const cab = shown();
  expect(cab).toEqual([]);
  expect(sentIds()).toContain('near-0');
  expect(sentIds().every((id) => !id.startsWith('far-'))).toBe(true);

  rerender(view(null));
  const anywhere = shown();
  expect(anywhere).toEqual(['far-0', 'far-1', 'far-2', 'far-3', 'far-4']);
  expect(sentIds().every(id => id.startsWith('far-'))).toBe(true);

  rerender(view(RADIUS_WALK));
  expect(shown()).toEqual(walkable);
});

it('never fills an unconfirmed cab band with nearer bars', () => {
  const beyondWalk = bars
    .filter((candidate) => !candidate.id.startsWith('near-'))
    .map((candidate) => candidate.id);
  render(
    <ResultsView
      profile={untagged}
      location={location}
      maxMiles={RADIUS_CAB}
      maxResults={5}
      excludeIds={beyondWalk}
    />,
  );
  expect(shown()).toEqual([]);
});
