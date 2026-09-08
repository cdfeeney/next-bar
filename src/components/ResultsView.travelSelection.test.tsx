import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Bar, VibeProfile } from '@/types';
import ResultsView from './ResultsView';
import { RADIUS_CAB, RADIUS_WALK } from '@/lib/constants';

// D-C-40 / V8-R-NXT-008. The home surface ranks with NO tags and no rating
// history (WhereNextFlow's autoProfile), so every bar scores identically and
// the cascade falls through to its last tie-breaker, exact miles. An
// inclusive wider pool then re-derives the same nearest five, and Walkable,
// Worth a cab and Anywhere all answer with the same bars. The catalog below
// puts real candidates in each band so a selection that does recompute has
// something different to return.
const { bars, routing, ratings } = vi.hoisted(() => {
  // 1 degree of latitude is ~69 miles, so the offset names the band directly.
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
const shown = (): string[] => screen.getAllByRole('article').map((card) => card.textContent ?? '');
const sentIds = (): string[] =>
  (routing.mock.lastCall as unknown as [unknown, Bar[]])[1].map((candidate) => candidate.id);

it('gives each travel selection its own band without dropping nearer bars from the pool', () => {
  const view = (maxMiles: number | null) => (
    <ResultsView profile={untagged} location={location} maxMiles={maxMiles} maxResults={5} />
  );
  const { rerender } = render(view(RADIUS_WALK));
  const walkable = shown();
  expect(walkable).toEqual(['near-0', 'near-1', 'near-2', 'near-3', 'near-4']);

  rerender(view(RADIUS_CAB));
  const cab = shown();
  expect(cab).toEqual(['cab-0', 'cab-1', 'cab-2', 'cab-3', 'cab-4']);
  // Wider is not exclusive: the walkable bars stay eligible behind the band
  // the chip names, so an empty cab band still answers with something.
  expect(sentIds()).toContain('near-0');
  expect(sentIds().every((id) => !id.startsWith('far-'))).toBe(true);

  rerender(view(null));
  const anywhere = shown();
  expect(anywhere).toEqual(['far-0', 'far-1', 'far-2', 'far-3', 'far-4']);
  expect(sentIds()).toContain('near-0');

  rerender(view(RADIUS_WALK));
  expect(shown()).toEqual(walkable);
});

it('falls back to nearer bars rather than emptying a selection whose own band has none', () => {
  // Nothing left beyond the walk band: the chip must still answer, because a
  // wider selection admits nearer bars as supplements rather than excluding
  // them. (Fewer results is honest; an empty page here would not be.)
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
  expect(shown()).toEqual(['near-0', 'near-1', 'near-2', 'near-3', 'near-4']);
});
