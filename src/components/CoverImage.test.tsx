import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

/** S-06c: a media cover resolves through the boundary route; the hook is the seam. */
const mediaState = { current: { status: 'loading' } as { status: string; url?: string } };
const useMediaUrl = vi.fn((mediaId: string | null) =>
  mediaId === null ? { status: 'gone' } : mediaState.current,
);
vi.mock('@/lib/nightOutMedia/useMediaUrl', () => ({
  useMediaUrl: (id: string | null) => useMediaUrl(id),
}));

import CoverImage from './CoverImage';

const MEDIA_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('CoverImage (S-06c) — a library photo', () => {
  test('a template never asks the route; a media cover resolves through it and shows the signed URL', () => {
    mediaState.current = { status: 'ready', url: 'https://signed.example/cover.jpg' };
    const { rerender } = render(<CoverImage cover="template:rooftop" />);
    expect(useMediaUrl).toHaveBeenLastCalledWith(null);
    rerender(<CoverImage cover={`media:${MEDIA_ID}`} />);
    expect(useMediaUrl).toHaveBeenLastCalledWith(MEDIA_ID);
    const el = screen.getByTestId('cover-image');
    expect(el.getAttribute('data-cover')).toBe('media');
    expect(el.getAttribute('data-cover-state')).toBe('ok');
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://signed.example/cover.jpg');
    expect(el.textContent).toMatch(/your photo/i);
  });

  test("loading is not failed, and the route's 404 is failed — the label stays either way", () => {
    mediaState.current = { status: 'loading' };
    const { rerender } = render(<CoverImage cover={`media:${MEDIA_ID}`} />);
    expect(screen.getByTestId('cover-image').getAttribute('data-cover-state')).toBe('loading');
    expect(screen.queryByRole('img')).toBeNull();
    mediaState.current = { status: 'gone' };
    rerender(<CoverImage cover={`media:${MEDIA_ID}`} showLabel />);
    expect(screen.getByTestId('cover-image').getAttribute('data-cover-state')).toBe('failed');
    expect(screen.getByTestId('cover-image').textContent).toMatch(/your photo/i);
  });
});

describe('CoverImage (S-06b)', () => {
  test('nothing for no cover or an unrecognised value', () => {
    const { container, rerender } = render(<CoverImage cover={null} />);
    expect(container.firstChild).toBeNull();
    rerender(<CoverImage cover="media:0000" />);
    expect(container.firstChild).toBeNull();
  });

  test('a failed load keeps the label and is scoped to THAT cover — picking another one shows its picture', () => {
    const { rerender } = render(<CoverImage cover="template:rooftop" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByTestId('cover-image').getAttribute('data-cover-state')).toBe('failed');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('cover-image').textContent).toMatch(/rooftop/i);

    // Round-1 Codex MEDIUM: the same instance is reused for the next pick.
    rerender(<CoverImage cover="template:birthday" />);
    expect(screen.getByTestId('cover-image').getAttribute('data-cover-state')).toBe('ok');
    expect(screen.getByRole('img').getAttribute('src')).toBe('/covers/birthday.svg');
  });
});
