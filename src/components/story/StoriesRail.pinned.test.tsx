import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import StoriesRail from './StoriesRail';
import type { StoryGroup } from './storyStore';

vi.mock('@/components/Avatar', () => ({
  default: ({ initials }: { initials: string }) => <span>{initials}</span>,
}));

/**
 * T-01b (owner, 2026-09-17): a pinned person reads "Pinned" as small muted
 * text UNDER the name — no corner square on the avatar.
 */
const group = (over: Partial<StoryGroup>): StoryGroup =>
  ({
    id: 'p1',
    handle: 'claire',
    name: 'Claire Park',
    initials: 'CP',
    isYou: false,
    hasUnseen: true,
    items: [{ id: 's1' }],
    ...over,
  }) as unknown as StoryGroup;

describe('StoriesRail pin (T-01b)', () => {
  test('a pinned friend shows "Pinned" under the name, muted, and no corner badge', () => {
    render(
      <StoriesRail
        groups={[group({ id: 'you', name: 'You', initials: 'ME', isYou: true, items: [] }), group({})]}
        pinnedIds={['p1']}
        onOpen={() => {}}
        onAddStory={() => {}}
      />,
    );
    const pins = screen.getAllByTestId('story-pin-badge');
    expect(pins).toHaveLength(1);
    // No bar map → the honest fallback.
    expect(pins[0]).toHaveTextContent(/^Pinned/);
    expect(pins[0].className).toContain('text-muted');
    // It is the sibling AFTER the name label inside the same cell.
    const cell = pins[0].closest('li')!;
    const labels = Array.from(cell.querySelectorAll('span')).map((s) => s.textContent);
    expect(labels.indexOf('Claire')).toBeLessThan(labels.findIndex((t) => /^Pinned/.test(t ?? '')));
    // No positioned square anywhere in the rail.
    expect(document.querySelector('.rounded-\\[3px\\]')).toBeNull();
  });

  test('with the bar known, the line reads "at <Bar>" (T-01e, owner)', () => {
    render(
      <StoriesRail
        groups={[group({})]}
        pinnedIds={['p1']}
        pinnedBars={new Map([['p1', 'Attaboy']])}
        onOpen={() => {}}
        onAddStory={() => {}}
      />,
    );
    expect(screen.getByTestId('story-pin-badge')).toHaveTextContent(/^at Attaboy/);
  });

  test('an unpinned rail renders no pin text at all', () => {
    render(<StoriesRail groups={[group({})]} pinnedIds={[]} onOpen={() => {}} onAddStory={() => {}} />);
    expect(screen.queryByTestId('story-pin-badge')).toBeNull();
  });
});
