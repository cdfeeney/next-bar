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

beforeEach(() => {
  window.localStorage.setItem(AGE_KEY, '1');
  window.sessionStorage.clear();
  authState.current = { status: 'signed-out' };
  setCapacitor(undefined);
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
