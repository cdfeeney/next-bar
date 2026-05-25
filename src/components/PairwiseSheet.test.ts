/**
 * PairwiseSheet.test.ts
 *
 * Uses React.createElement instead of JSX so the file lives at .ts —
 * vitest 4 / rolldown + this project's tsconfig "jsx": "preserve" don't
 * play together for .tsx test files without adding @vitejs/plugin-react
 * (which currently peer-conflicts with @types/node). createElement is a
 * couple more characters per render and otherwise identical coverage.
 */

import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bar } from '@/types';
import PairwiseSheet from '@/components/PairwiseSheet';

type SheetProps = ComponentProps<typeof PairwiseSheet>;

function bar(overrides: Partial<Bar> = {}): Bar {
  return {
    id: 'attaboy',
    name: 'Attaboy',
    neighborhood: 'LES',
    address: '134 Eldridge St',
    lat: 40.72,
    lng: -73.99,
    priceTier: 3,
    tags: ['cocktail', 'speakeasy'],
    blurb: 'Speakeasy with bespoke cocktails — tell them what you want.',
    lastVerified: '2026-05-01',
    ...overrides,
  };
}

function renderSheet(props: Partial<SheetProps> = {}) {
  const onPick = props.onPick ?? vi.fn();
  const onSkip = props.onSkip ?? vi.fn();
  const justRated = props.justRated ?? bar({ id: 'attaboy', name: 'Attaboy' });
  const peer =
    props.peer ??
    bar({
      id: 'death-and-co',
      name: 'Death & Co',
      neighborhood: 'East Village',
      blurb: 'Cocktail mecca — the menu reads like a novella.',
    });
  const tier = props.tier ?? 'loved';

  const result = render(
    createElement(PairwiseSheet, {
      justRated,
      peer,
      tier,
      onPick,
      onSkip,
    }),
  );
  return { ...result, onPick, onSkip, justRated, peer };
}

describe('PairwiseSheet', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders the tier-specific prompt and both bar names', () => {
    renderSheet({ tier: 'loved' });

    expect(
      screen.getByRole('heading', { name: /which did you love more\?/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Attaboy')).toBeInTheDocument();
    expect(screen.getByText('Death & Co')).toBeInTheDocument();
    expect(screen.getByText(/tier · loved/i)).toBeInTheDocument();
  });

  it('uses the "liked" prompt when tier is liked', () => {
    renderSheet({ tier: 'liked' });
    expect(
      screen.getByRole('heading', { name: /which did you like more\?/i }),
    ).toBeInTheDocument();
  });

  it('declares itself as a modal dialog with the prompt as label', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'pairwise-prompt');
    expect(document.getElementById('pairwise-prompt')).toHaveTextContent(
      /which did you love more\?/i,
    );
  });

  it('locks body scroll while open and restores it on unmount', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = renderSheet();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('moves focus to the just-rated option on mount', () => {
    renderSheet();
    const justRatedButton = screen
      .getByText('Attaboy')
      .closest('button') as HTMLButtonElement;
    expect(document.activeElement).toBe(justRatedButton);
  });

  it('calls onPick(justRated, peer) when the user picks the just-rated bar', async () => {
    const user = userEvent.setup();
    const { onPick, onSkip } = renderSheet();
    await user.click(screen.getByText('Attaboy'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('attaboy', 'death-and-co');
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('calls onPick(peer, justRated) when the user picks the peer', async () => {
    const user = userEvent.setup();
    const { onPick } = renderSheet();
    await user.click(screen.getByText('Death & Co'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('death-and-co', 'attaboy');
  });

  it('calls onSkip when the Skip button is clicked', async () => {
    const user = userEvent.setup();
    const { onPick, onSkip } = renderSheet();
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('calls onSkip when Escape is pressed', () => {
    const { onPick, onSkip } = renderSheet();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('ignores non-Escape keys', () => {
    const { onSkip } = renderSheet();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: ' ' });
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('calls onSkip when the backdrop is clicked', () => {
    const { onSkip, container } = renderSheet();
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
