import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { FeedEntry } from '@/components/story/storyStore';

/**
 * FEEDSECTION OWNS ITS OWN EMPTINESS (round-10 directive (c), raised on wp5).
 *
 * `page.tsx` used to mount this component only when the feed was non-empty and
 * draw the empty copy itself. That put the Feed's reachability under a test the
 * Feed did not control: the moment the last entry dropped out, the component
 * that renders the Feed was not on the page at all. These two cases pin the
 * property the fix exists for — a FeedSection with nothing in it still RENDERS,
 * and it renders the honest empty state rather than a bare heading.
 */

vi.mock('@/lib/catalog', () => ({ getBarById: () => undefined }));
vi.mock('@/lib/hoodDisplay', () => ({ displayHood: (h: string) => h }));
vi.mock('@/components/story/StoryFrame', () => ({
  default: () => <div data-testid="story-frame" />,
}));
vi.mock('@/components/Avatar', () => ({ default: () => <div /> }));

import FeedSection from './FeedSection';

const ENTRY = {
  story: {
    id: 'story-1',
    barId: null,
    photo: null,
    caption: null,
    tagged: [],
    postedAt: new Date().toISOString(),
  },
  author: { id: 'author-1', name: 'Sam Ruiz', handle: 'sam', initials: 'SR' },
} as unknown as FeedEntry;

describe('FeedSection renders whether or not it has entries', () => {
  test('an empty feed still renders, as the empty state', () => {
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);
    expect(screen.getByTestId('feed-empty')).toBeTruthy();
    // The other half of the assertion: it is EMPTY, not the populated list.
    expect(screen.queryByTestId('friends-feed')).toBeNull();
    expect(screen.queryByTestId('feed-memory')).toBeNull();
  });

  test('a populated feed renders its cards, and not the empty state', () => {
    render(<FeedSection entries={[ENTRY]} onOpenStory={() => {}} />);
    expect(screen.getByTestId('friends-feed')).toBeTruthy();
    expect(screen.getAllByTestId('feed-memory')).toHaveLength(1);
    expect(screen.queryByTestId('feed-empty')).toBeNull();
  });
});
