import { describe, expect, it } from 'vitest';
import {
  clientIpFromHeaders,
  createIpRateLimiter,
  isValidWaitlistEmail,
  normalizeEmail,
  sanitizeNeighborhood,
  sanitizeVibeProfile,
} from '@/lib/waitlistGuard';

describe('isValidWaitlistEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidWaitlistEmail('a@b.co')).toBe(true);
    expect(isValidWaitlistEmail('connor.f+tag@example.com')).toBe(true);
    expect(isValidWaitlistEmail('UPPER@EXAMPLE.COM')).toBe(true);
  });

  it('rejects garbage, whitespace, missing parts, and oversize', () => {
    expect(isValidWaitlistEmail('')).toBe(false);
    expect(isValidWaitlistEmail('not-an-email')).toBe(false);
    expect(isValidWaitlistEmail('a@b')).toBe(false); // no dot in domain
    expect(isValidWaitlistEmail('a b@c.com')).toBe(false);
    expect(isValidWaitlistEmail('a@b c.com')).toBe(false);
    expect(isValidWaitlistEmail('a@@b.com')).toBe(false);
    expect(isValidWaitlistEmail(`${'x'.repeat(250)}@example.com`)).toBe(false);
  });

  it('rejects non-strings without throwing', () => {
    expect(isValidWaitlistEmail(undefined)).toBe(false);
    expect(isValidWaitlistEmail(null)).toBe(false);
    expect(isValidWaitlistEmail(42)).toBe(false);
    expect(isValidWaitlistEmail({ email: 'a@b.co' })).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases to one canonical row per address', () => {
    expect(normalizeEmail('  Connor@Example.COM ')).toBe('connor@example.com');
  });

  it('collapses gmail dot-aliases (one inbox, one row) but keeps plus-tags', () => {
    expect(normalizeEmail('Con.nor.F@gmail.com')).toBe('connorf@gmail.com');
    expect(normalizeEmail('c.f@googlemail.com')).toBe('cf@googlemail.com');
    // Plus-tags are chosen deliberately — preserved.
    expect(normalizeEmail('connor+bars@gmail.com')).toBe('connor+bars@gmail.com');
    // Dots are meaningful on other providers — preserved.
    expect(normalizeEmail('con.nor@example.com')).toBe('con.nor@example.com');
  });
});

describe('sanitizeNeighborhood', () => {
  it('passes through reasonable strings, trimmed', () => {
    expect(sanitizeNeighborhood(' East Village ')).toBe('East Village');
  });

  it('collapses non-strings, empties, and oversize to null', () => {
    expect(sanitizeNeighborhood(undefined)).toBeNull();
    expect(sanitizeNeighborhood(123)).toBeNull();
    expect(sanitizeNeighborhood('   ')).toBeNull();
    expect(sanitizeNeighborhood('x'.repeat(41))).toBeNull();
  });
});

describe('sanitizeVibeProfile', () => {
  it('passes a normal profile object through untouched', () => {
    const profile = { vibe: 'dive', budget: 2 };
    expect(sanitizeVibeProfile(profile)).toBe(profile);
  });

  it('drops null/undefined/non-objects and oversize payloads to null', () => {
    expect(sanitizeVibeProfile(null)).toBeNull();
    expect(sanitizeVibeProfile(undefined)).toBeNull();
    expect(sanitizeVibeProfile('a-string' as never)).toBeNull();
    expect(
      sanitizeVibeProfile({ dump: 'x'.repeat(3000) }),
    ).toBeNull();
  });

  it('drops unserializable objects (circular) instead of throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sanitizeVibeProfile(circular)).toBeNull();
  });
});

describe('clientIpFromHeaders', () => {
  it('takes the first x-forwarded-for hop', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
    });
    expect(clientIpFromHeaders(headers)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then the shared unknown bucket', () => {
    expect(
      clientIpFromHeaders(new Headers({ 'x-real-ip': '198.51.100.2' })),
    ).toBe('198.51.100.2');
    expect(clientIpFromHeaders(new Headers())).toBe('unknown');
  });
});

describe('createIpRateLimiter', () => {
  it('allows up to the limit inside a window, then throttles', () => {
    const limiter = createIpRateLimiter({ limit: 3, windowMs: 1000 });
    const t = 1_000_000;
    expect(limiter.allow('ip-a', t)).toBe(true);
    expect(limiter.allow('ip-a', t + 1)).toBe(true);
    expect(limiter.allow('ip-a', t + 2)).toBe(true);
    expect(limiter.allow('ip-a', t + 3)).toBe(false);
    expect(limiter.allow('ip-a', t + 4)).toBe(false);
  });

  it('tracks IPs independently', () => {
    const limiter = createIpRateLimiter({ limit: 1, windowMs: 1000 });
    const t = 0;
    expect(limiter.allow('ip-a', t)).toBe(true);
    expect(limiter.allow('ip-b', t)).toBe(true);
    expect(limiter.allow('ip-a', t + 1)).toBe(false);
    expect(limiter.allow('ip-b', t + 1)).toBe(false);
  });

  it('resets the budget when the window elapses', () => {
    const limiter = createIpRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.allow('ip-a', 0)).toBe(true);
    expect(limiter.allow('ip-a', 500)).toBe(false);
    expect(limiter.allow('ip-a', 1000)).toBe(true); // fresh window
    expect(limiter.allow('ip-a', 1001)).toBe(false);
  });

  it('prunes expired buckets to admit new IPs (spray across windows)', () => {
    const limiter = createIpRateLimiter({ limit: 1, windowMs: 10 });
    // Buckets expire every 10ms; spacing hits 20ms apart keeps the live
    // set tiny no matter how many distinct IPs spray over time.
    for (let i = 0; i < 10_050; i++) {
      expect(limiter.allow(`spray-${i}`, i * 20)).toBe(true);
    }
    expect(limiter.allow('fresh-ip', 10_050 * 20 + 100_000)).toBe(true);
    expect(limiter.allow('fresh-ip', 10_050 * 20 + 100_001)).toBe(false);
  });

  it('fails CLOSED when 10k+ distinct IPs are all inside the live window (hard memory cap)', () => {
    const limiter = createIpRateLimiter({ limit: 5, windowMs: 60_000 });
    const t = 0;
    for (let i = 0; i < 10_000; i++) {
      expect(limiter.allow(`live-${i}`, t + i)).toBe(true);
    }
    // Map is full of LIVE buckets — a brand-new IP is rejected, not
    // silently tracked past the cap (dual-review fix).
    expect(limiter.allow('overflow-ip', t + 10_000)).toBe(false);
    // Already-tracked IPs keep their own budgets.
    expect(limiter.allow('live-0', t + 10_001)).toBe(true);
    // Once the window expires, pruning makes room again.
    expect(limiter.allow('overflow-ip', t + 61_000)).toBe(true);
  });
});
