import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OperationalState } from './OperationalState';

/**
 * V8-R-OPS-001 — the four rules every operational state in the app owes, held
 * in the one component every surface renders them through.
 *
 * These are behavioural, not cosmetic: each test names the specific way this
 * requirement is broken in practice — a blanked screen, a vague message, a
 * second competing recovery, a stolen focus.
 */

describe('an operational state retains its surrounding context', () => {
  it('renders the content it was given, rather than replacing it', () => {
    render(
      <OperationalState kind="stale" message="Last updated a few minutes ago.">
        <p>Saved list the user was reading</p>
      </OperationalState>,
    );

    expect(
      screen.getByText('Saved list the user was reading'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('operational-state')).toHaveAttribute(
      'data-state',
      'stale',
    );
  });
});

describe('an operational state offers at most ONE recovery', () => {
  it('renders exactly one action when a recovery is given', () => {
    render(
      <OperationalState
        kind="failed"
        message="Your blocked list could not be loaded."
        recovery={{ label: 'Retry', onAction: vi.fn() }}
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders no action at all when there is nothing to recover to', () => {
    render(<OperationalState kind="empty" message="You haven't blocked anyone." />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('an operational state names what specifically went wrong', () => {
  it('refuses the vague "an error occurred" the requirement excludes', () => {
    // Rendering is what throws, so the assertion has to wrap the render.
    expect(() =>
      render(<OperationalState kind="failed" message="An error occurred" />),
    ).toThrow(/V8-R-OPS-007/);
  });

  it('accepts a message that says what broke', () => {
    render(
      <OperationalState
        kind="failed"
        message="Your blocked list could not be loaded."
      />,
    );

    expect(
      screen.getByText('Your blocked list could not be loaded.'),
    ).toBeInTheDocument();
  });
});

describe('focus follows the recovery action, and only on a real change', () => {
  it('does not steal focus on first paint', () => {
    render(
      <OperationalState
        kind="failed"
        message="Your blocked list could not be loaded."
        recovery={{ label: 'Retry', onAction: vi.fn() }}
      />,
    );

    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the recovery when the state changes under the user', () => {
    const view = render(
      <OperationalState
        kind="loading"
        message="Loading your blocked list."
        recovery={{ label: 'Retry', onAction: vi.fn() }}
      />,
    );

    view.rerender(
      <OperationalState
        kind="failed"
        message="Your blocked list could not be loaded."
        recovery={{ label: 'Retry', onAction: vi.fn() }}
      />,
    );

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Retry' }),
    );
  });
});
