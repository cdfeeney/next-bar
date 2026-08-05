/**
 * Unit coverage for the parts of SignInGate that e2e cannot reach honestly:
 * the pure installed-app detection, and the signed-in -> signed-out
 * transition that re-arms a dismissed window (santa round-2).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { AuthState } from '@/hooks/useAuth';

const authState = { current: { status: 'signed-out' } as Partial<AuthState> };

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ ...authState.current, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import SignInGate, {
  isInstalledAppDisplay,
  SIGNIN_GATE_DISMISSED_KEY,
} from './SignInGate';

const AGE_KEY = 'next-bar:age-ack:v1';

function setCapacitor(value: unknown): void {
  Object.defineProperty(window, 'Capacitor', { configurable: true, value });
}

/** Control ONLY the `display-mode: standalone` signal. */
function setDisplayMode(standalone: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: standalone && /display-mode:\s*standalone/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** Control ONLY iOS Safari's non-standard home-screen flag. */
function setStandaloneFlag(value: boolean | undefined): void {
  Object.defineProperty(window.navigator, 'standalone', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  window.localStorage.setItem(AGE_KEY, '1');
  window.sessionStorage.clear();
  authState.current = { status: 'signed-out' };
  setCapacitor(undefined);
  // Neutral baseline: neither PWA signal on, so each test opts in to exactly
  // the one it means to exercise.
  setDisplayMode(false);
  setStandaloneFlag(undefined);
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('isInstalledAppDisplay', () => {
  it('detects Capacitor native even when both PWA signals are false', () => {
    // The real TestFlight shell: WKWebView on a remote server.url.
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    expect(isInstalledAppDisplay()).toBe(true);
  });

  it('detects a non-web Capacitor platform without isNativePlatform', () => {
    setCapacitor({ getPlatform: () => 'android' });
    expect(isInstalledAppDisplay()).toBe(true);
  });

  it('treats Capacitor reporting web as NOT installed', () => {
    setCapacitor({ isNativePlatform: () => false, getPlatform: () => 'web' });
    expect(isInstalledAppDisplay()).toBe(false);
  });

  it('survives a malformed Capacitor global rather than throwing', () => {
    setCapacitor({
      isNativePlatform: () => {
        throw new Error('boom');
      },
    });
    expect(isInstalledAppDisplay()).toBe(false);
  });

  it('is false in an ordinary browser', () => {
    expect(isInstalledAppDisplay()).toBe(false);
  });

  // The two PWA signals are checked INDEPENDENTLY here on purpose. The e2e
  // helper forces both at once, so deleting either production branch would
  // leave the browser suite green and Android/desktop-PWA or iOS-home-screen
  // detection could regress unnoticed (santa re-verdict, Codex).
  it('detects an installed PWA from display-mode alone', () => {
    setStandaloneFlag(undefined);
    setDisplayMode(true);
    expect(isInstalledAppDisplay()).toBe(true);
  });

  it('detects an iOS home-screen web app from navigator.standalone alone', () => {
    setDisplayMode(false);
    setStandaloneFlag(true);
    expect(isInstalledAppDisplay()).toBe(true);
  });

  it('is false when display-mode is browser and the iOS flag is absent', () => {
    setDisplayMode(false);
    setStandaloneFlag(undefined);
    expect(isInstalledAppDisplay()).toBe(false);
  });
});

describe('SignInGate sign-out re-arm', () => {
  it('clears a prior dismissal when auth goes signed-in -> signed-out', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    window.sessionStorage.setItem(SIGNIN_GATE_DISMISSED_KEY, '1');

    authState.current = { status: 'signed-in' };
    const { rerender } = render(<SignInGate />);
    // Signed in: nothing renders, and the dismissal is untouched so far.
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      authState.current = { status: 'signed-out' };
    });
    rerender(<SignInGate />);

    // The stale "I dismissed this" answer belonged to the person who just
    // signed out — it must not suppress the window for whoever is next.
    expect(window.sessionStorage.getItem(SIGNIN_GATE_DISMISSED_KEY)).toBeNull();
    expect(screen.getByRole('dialog', { name: /sign in to next bar/i })).toBeTruthy();
  });

  it('PRESERVES a dismissal when the user was never signed in', () => {
    // The re-arm must key off an actual signed-in -> signed-out transition,
    // not merely observing 'signed-out'. Otherwise "Not now" would be
    // undone on the next render and the window would nag forever.
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    window.sessionStorage.setItem(SIGNIN_GATE_DISMISSED_KEY, '1');
    authState.current = { status: 'signed-out' };
    const { rerender } = render(<SignInGate />);
    rerender(<SignInGate />);
    expect(window.sessionStorage.getItem(SIGNIN_GATE_DISMISSED_KEY)).toBe('1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('re-arms even when sessionStorage.removeItem throws', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    window.sessionStorage.setItem(SIGNIN_GATE_DISMISSED_KEY, '1');
    const removeItem = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('storage unavailable');
      });
    try {
      authState.current = { status: 'signed-in' };
      const { rerender } = render(<SignInGate />);
      act(() => {
        authState.current = { status: 'signed-out' };
      });
      rerender(<SignInGate />);
      // The throw must not prevent the window from re-arming in-memory.
      expect(screen.getByRole('dialog', { name: /sign in to next bar/i })).toBeTruthy();
    } finally {
      removeItem.mockRestore();
    }
  });

  it('does NOT render for a signed-in user in the installed app', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    authState.current = { status: 'signed-in' };
    render(<SignInGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT render while auth is still loading', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    authState.current = { status: 'loading' };
    render(<SignInGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT render in local mode (auth unavailable)', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    authState.current = { status: 'unavailable' };
    render(<SignInGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
