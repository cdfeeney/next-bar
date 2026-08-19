import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumePendingInvite,
  peekPendingInvite,
  storePendingInvite,
} from './pendingInvite';

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';
const KEY = 'next-bar:pending-invite:v1';

describe('pendingInvite handoff (V8-3 criterion 7)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('stores and consumes exactly once', () => {
    storePendingInvite(TOKEN);
    expect(window.sessionStorage.getItem(KEY)).toBe(TOKEN);
    expect(consumePendingInvite()).toBe(TOKEN);
    // Consumed: the redirect must never fire twice.
    expect(consumePendingInvite()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('peek is non-destructive', () => {
    storePendingInvite(TOKEN);
    expect(peekPendingInvite()).toBe(TOKEN);
    expect(peekPendingInvite()).toBe(TOKEN);
  });

  it('refuses to store or return a non-uuid token (nothing attacker-shaped rides the handoff)', () => {
    storePendingInvite('javascript:alert(1)');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    window.sessionStorage.setItem(KEY, '../../../etc');
    expect(consumePendingInvite()).toBeNull();
  });
});

describe('cross-tab handoff (cold panel HIGH: email confirmation opens a new tab)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('survives a tab change — the confirmation link opens where sessionStorage does not exist', () => {
    storePendingInvite(TOKEN);
    // A new tab has its own sessionStorage. localStorage is what crosses.
    window.sessionStorage.clear();
    expect(peekPendingInvite(), 'the handoff did not survive the tab change').toBe(TOKEN);
    expect(consumePendingInvite()).toBe(TOKEN);
    expect(peekPendingInvite(), 'consume left a replayable copy behind').toBeNull();
  });

  it('expires rather than lingering as durable state', () => {
    storePendingInvite(TOKEN);
    window.sessionStorage.clear();
    const raw = JSON.parse(window.localStorage.getItem(KEY) as string) as { token: string };
    // Rewind past the TTL: a stale invite must not resurface days later.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ token: raw.token, expiresAt: Date.now() - 1 }),
    );
    expect(peekPendingInvite(), 'an expired handoff was still honoured').toBeNull();
    expect(window.localStorage.getItem(KEY), 'the expired entry was not cleaned up').toBeNull();
  });

  it('a PRESENT same-tab value wins, valid or not — no silent substitution', () => {
    storePendingInvite(TOKEN);
    // Poison the same-tab store while a valid cross-tab handoff exists.
    window.sessionStorage.setItem(KEY, '../../../etc');
    expect(
      peekPendingInvite(),
      'a tampered same-tab value fell through to a different token',
    ).toBeNull();
  });

  it('ignores a malformed cross-tab entry', () => {
    window.localStorage.setItem(KEY, 'not json');
    expect(peekPendingInvite()).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify({ token: 'nope', expiresAt: Date.now() + 1000 }));
    expect(peekPendingInvite()).toBeNull();
  });
});
