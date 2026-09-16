import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

/** S-06c: a media cover resolves through the boundary route; the hook is the seam. */
type FakeState = { status: string; url?: string; retry?: () => void };
const mediaState = { current: { status: 'loading' } as FakeState };
const retry = vi.fn();
const useMediaUrl = vi.fn((mediaId: string | null): FakeState =>
  mediaId === null ? { status: 'gone' } : { ...mediaState.current, retry },
);
vi.mock('@/lib/nightOutMedia/useMediaUrl', () => ({
  useMediaUrl: (id: string | null) => useMediaUrl(id),
}));

import CoverImage from './CoverImage';

const MEDIA_ID = '123e4567-e89b-42d3-a456-426614174000';

afterEach(() => {
  retry.mockReset();
  vi.useRealTimers();
});

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

  test('a transient unavailable is retried, not failed, and resolves when the route answers', async () => {
    vi.useFakeTimers();
    // The route is briefly unavailable (a 503 while the media env warms), then answers.
    mediaState.current = { status: 'unavailable' };
    retry.mockImplementation(() => {
      mediaState.current = { status: 'ready', url: 'https://signed.example/late.jpg' };
    });
    const { rerender } = render(<CoverImage cover={`media:${MEDIA_ID}`} />);
    expect(screen.getByTestId('cover-image').getAttribute('data-cover-state')).toBe('loading');
    expect(retry).not.toHaveBeenCalled();
    // The backoff fires; the component re-reads the hook and paints the picture.
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<CoverImage cover={`media:${MEDIA_ID}`} />);
    expect(screen.getByTestId('cover-image').getAttribute('data-cover-state')).toBe('ok');
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://signed.example/late.jpg');
  });

  test('an unavailable route reads as loading (a retry is coming), never immediately failed', () => {
    mediaState.current = { status: 'unavailable' };
    render(<CoverImage cover={`media:${MEDIA_ID}`} />);
    // 'unavailable' is "we could not ask", which the cover retries — so it stays
    // loading rather than collapsing to the terminal failed state a 404 gets.
    expect(screen.getByTestId('cover-image').getAttribute('data-cover-state')).toBe('loading');
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
