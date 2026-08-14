import { afterEach, describe, expect, it } from 'vitest';
import { cycleFocusWithin } from './focusTrap';

function buildDialog(): { dialog: HTMLDivElement; first: HTMLButtonElement; last: HTMLButtonElement } {
  const dialog = document.createElement('div');
  const first = document.createElement('button');
  first.textContent = 'first';
  const middle = document.createElement('a');
  middle.setAttribute('href', '#x');
  const last = document.createElement('button');
  last.textContent = 'last';
  dialog.append(first, middle, last);
  document.body.append(dialog);
  return { dialog, first, last };
}

function tab(shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
}

describe('cycleFocusWithin', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('wraps forward from the last focusable to the first', () => {
    const { dialog, first, last } = buildDialog();
    last.focus();

    const event = tab();
    expect(cycleFocusWithin(dialog, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('wraps backward from the first focusable to the last', () => {
    const { dialog, first, last } = buildDialog();
    first.focus();

    const event = tab(true);
    expect(cycleFocusWithin(dialog, event)).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('pulls focus back in when it has escaped the dialog', () => {
    const { dialog, first } = buildDialog();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    const event = tab();
    expect(cycleFocusWithin(dialog, event)).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('leaves interior Tab moves to the browser', () => {
    const { dialog, first } = buildDialog();
    first.focus();

    // Forward from the FIRST element is an ordinary move, not a wrap.
    const event = tab();
    expect(cycleFocusWithin(dialog, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores non-Tab keys and a null container', () => {
    const { dialog } = buildDialog();
    expect(cycleFocusWithin(dialog, new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(false);
    expect(cycleFocusWithin(null, tab())).toBe(false);
  });
});
