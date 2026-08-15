import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumePendingInvite,
  peekPendingInvite,
  storePendingInvite,
} from './pendingInvite';

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';
const KEY = 'next-bar:pending-invite:v1';

describe('pendingInvite handoff (V8-3 criterion 7)', () => {
  beforeEach(() => window.sessionStorage.clear());

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
