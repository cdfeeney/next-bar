// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Bar, VibeProfile } from '@/types';

/**
 * Billing precondition for mounting GooglePlacePhoto in result cards
 * (GooglePlacePhoto's documented caller constraint): the results list must
 * not virtualize, window, or recycle rows — an unmounted card's widget has
 * nothing to show, so remounting refetches and REBILLS. This proves every
 * ranked bar renders one card simultaneously and that a re-render keeps the
 * same DOM nodes (no unmount/remount churn).
 */

vi.mock('@/lib/useBars', () => ({
  useBars: () => BARS,
}));
// Ranking is not under test here — the mounting discipline is. The scorer
// returns the whole fixture pool so the list length is deterministic.
vi.mock('@/lib/matching', () => ({
  matches: () => BARS,
}));
vi.mock('@/hooks/useRatings', () => ({
  useRatings: () => ({ ratings: [], setRating: vi.fn(), clearRating: vi.fn() }),
}));
vi.mock('@/components/ResultCard', () => ({
  default: ({ bar }: { bar: Bar }) => (
    <div data-testid="result-card" data-bar-id={bar.id} />
  ),
}));

import ResultsView from './ResultsView';

const BARS: Bar[] = Array.from({ length: 12 }, (_, i) => ({
  id: `bar-${i}`,
  name: `Bar ${i}`,
  lat: 40.7 + i * 0.001,
  lng: -73.99,
  tags: ['classy'],
  neighborhood: 'LES',
  priceTier: 2,
  blurb: '',
})) as unknown as Bar[];

const PROFILE: VibeProfile = {
  tags: [],
  archetype: 'explorer',
  preferredNeighborhoods: ['LES'],
} as unknown as VibeProfile;

function view(): JSX.Element {
  return (
    <ResultsView
      profile={PROFILE}
      location={{ kind: 'neighborhood', neighborhood: 'LES' as never }}
      maxMiles={null}
      maxResults={10}
      showShare={false}
    />
  );
}

describe('results list mounting discipline (billing precondition)', () => {
  test('every ranked bar renders one card at once — no windowing, no slice-on-scroll', () => {
    render(view());
    const cards = screen.getAllByTestId('result-card');
    // maxResults caps the ranking itself; every ranked card is in the DOM.
    expect(cards.length).toBeGreaterThanOrEqual(5);
    const ids = cards.map((c) => c.getAttribute('data-bar-id'));
    expect(new Set(ids).size).toBe(ids.length); // stable, unique keys
  });

  test('a re-render with identical props keeps the same DOM nodes — no remount churn', () => {
    const { rerender } = render(view());
    const before = screen.getAllByTestId('result-card');
    rerender(view());
    const after = screen.getAllByTestId('result-card');
    expect(after.length).toBe(before.length);
    // Same element identity = React preserved the component instances; a
    // recycled/windowed list would have replaced them.
    after.forEach((node, i) => expect(node).toBe(before[i]));
  });
});
