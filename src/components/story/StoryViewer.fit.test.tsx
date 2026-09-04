import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StoryViewer from './StoryViewer';
import type { StoryGroup, StoryItem, StoryPhoto } from './storyStore';

/**
 * THE WIRING, NOT THE MECHANISM.
 *
 * `StoryFrame.test.tsx` proves StoryFrame letterboxes when it is TOLD to —
 * `fit="contain"` renders object-contain, the default renders object-cover, the
 * dual-shot inset always covers. Every one of those tests passes the prop
 * itself, so all three stay green if StoryViewer stops passing it and the
 * full-screen viewer silently goes back to cropping the top off a landscape
 * photo — which is the operator-reported defect that started this, tagged
 * people cut off on iPhone.
 *
 * That gap was recorded rather than closed when the e2e version of this
 * assertion could not resolve an <img> under the story stub and timed out; a
 * redundant flaky test is worse than none, but the gap was real. This closes it
 * at the level where it is deterministic: render the real viewer and read what
 * the real frame actually did.
 *
 * Asserted on the COMPUTED class of the rendered image rather than by spying on
 * StoryFrame's props, so it is a statement about what the user sees and it
 * survives the two components being refactored into each other.
 */

const PHOTO: StoryPhoto = {
  kind: 'single',
  main: 'data:image/jpeg;base64,AAAA',
  state: 'ok',
};

const ITEM: StoryItem = {
  id: 'item-1',
  authorId: 'author-1',
  postedAt: '2026-09-04T10:00:00.000Z',
  expiresAt: '2026-09-05T10:00:00.000Z',
  barId: null,
  caption: null,
  tagged: [],
  photo: PHOTO,
  audience: 'friends',
};

const GROUP: StoryGroup = {
  id: 'author-1',
  handle: 'someone',
  name: 'Someone',
  initials: 'SO',
  isYou: false,
  items: [ITEM],
  hasUnseen: true,
};

function renderViewer(): void {
  render(
    <StoryViewer
      groups={[GROUP]}
      startId={GROUP.id}
      youId="viewer-1"
      onClose={() => undefined}
      onExhausted={() => undefined}
      onMarkSeen={() => undefined}
      onUntagMe={async () => ({ ok: true })}
    />,
  );
}

describe('StoryViewer photo fit', () => {
  it('letterboxes the full-screen photo — it does not crop it to fill', () => {
    renderViewer();
    const frame = screen.getByTestId('story-frame');
    const img = frame.querySelector('img');
    if (img === null) throw new Error('the viewer rendered no photo');
    expect(img.className).toContain('object-contain');
    // Stated as its own assertion because that is the actual defect: cover is
    // what cropped the tagged people off the top of a landscape shot.
    expect(img.className).not.toContain('object-cover');
  });
});
