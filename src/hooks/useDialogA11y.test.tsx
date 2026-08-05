// @vitest-environment jsdom
import { StrictMode, useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { useDialogA11y } from '@/hooks/useDialogA11y';

function Dialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children?: React.ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
  return (
    <div ref={ref} role="dialog" aria-label={label}>
      <button type="button">first-{label}</button>
      <button type="button">last-{label}</button>
      {children}
    </div>
  );
}

/** Outer dialog that can stack an inner one on top. */
function Stack(): JSX.Element {
  const [outerOpen, setOuterOpen] = useState(true);
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setInnerOpen(true)}>
        open-inner
      </button>
      {outerOpen ? (
        <Dialog label="outer" onClose={() => setOuterOpen(false)}>
          {innerOpen ? (
            <Dialog label="inner" onClose={() => setInnerOpen(false)} />
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('useDialogA11y', () => {
  test('Escape closes ONLY the topmost dialog in the stack', () => {
    render(<Stack />);
    fireEvent.click(screen.getByText('open-inner'));
    expect(screen.getByRole('dialog', { name: 'inner' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'inner' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'outer' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'outer' })).toBeNull();
  });

  test('scroll lock is refcounted: held while ANY dialog is open, restored after all close', () => {
    render(<Stack />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByText('open-inner'));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' }); // inner closes
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' }); // outer closes
    expect(document.body.style.overflow).toBe('');
  });

  test('focus lands on the first focusable on open', () => {
    render(
      <Dialog label="solo" onClose={() => {}} />,
    );
    expect(document.activeElement?.textContent).toBe('first-solo');
  });

  test('Tab wraps from last to first; Shift+Tab wraps from first to last', () => {
    render(<Dialog label="solo" onClose={() => {}} />);
    const first = screen.getByText('first-solo');
    const last = screen.getByText('last-solo');

    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test('StrictMode double-mount does not corrupt the stack or the scroll lock', () => {
    const { unmount } = render(
      <StrictMode>
        <Stack />
      </StrictMode>,
    );
    // After the mount→cleanup→mount cycle the dialog must still be top:
    // Escape works exactly once per layer.
    fireEvent.click(screen.getByText('open-inner'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'inner' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'outer' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    // Every lock released — the page scrolls again.
    expect(document.body.style.overflow).toBe('');
  });
});
