import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StoryFrame from './StoryFrame';
import type { StoryPhoto } from './storyStore';

/**
 * Framing regression (operator report, iPhone 2026-09-03): the viewer's box is
 * portrait on a phone, a laptop-posted photo is landscape, and object-cover
 * cropped the top of the image — exactly where tagged people sit. The viewer
 * passes fit="contain" so the WHOLE photo is always shown; feed cards and
 * thumbnails keep the default cover crop.
 */

const PHOTO: StoryPhoto = {
  kind: 'single',
  main: 'data:image/jpeg;base64,AAAA',
  state: 'ok',
};

const DUAL: StoryPhoto = { ...PHOTO, kind: 'dual', inset: PHOTO.main };

function mainImg(): HTMLElement {
  const frame = screen.getByTestId('story-frame');
  const img = frame.querySelector('img');
  if (img === null) throw new Error('no img rendered');
  return img;
}

describe('StoryFrame photo fit', () => {
  it('shows the whole photo (object-contain) when the viewer asks for it', () => {
    render(<StoryFrame photo={PHOTO} barId={null} fit="contain" />);
    expect(mainImg().className).toContain('object-contain');
    expect(mainImg().className).not.toContain('object-cover');
  });

  it('keeps the cover crop by default for feed cards and thumbnails', () => {
    render(<StoryFrame photo={PHOTO} barId={null} />);
    expect(mainImg().className).toContain('object-cover');
  });

  it('never letterboxes the dual-shot inset — it is a thumbnail', () => {
    render(<StoryFrame photo={DUAL} barId={null} fit="contain" />);
    const inset = screen.getByTestId('story-frame-inset');
    const img = inset.querySelector('img');
    expect(img?.className).toContain('object-cover');
  });
});
