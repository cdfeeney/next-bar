import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import CoverImage from './CoverImage';

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
