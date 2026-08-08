import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregateIp,
  createInMemoryLimiter,
  createTieredLimiter,
  hashKey,
  UNATTRIBUTED_KEY,
  type DurableCounter,
} from '@/lib/rateLimiter';

/** A shared counter that actually counts, so global caps can be asserted. */
function fakeCounter(): DurableCounter & { calls: number } {
  const counts = new Map<string, number>();
  const counter = {
    calls: 0,
    async increment({
      bucket,
      keyHash,
      limit,
    }: {
      bucket: string;
      keyHash: string;
      windowMs: number;
      limit: number;
      now: number;
    }) {
      counter.calls += 1;
      const k = `${bucket}:${keyHash}`;
      const next = (counts.get(k) ?? 0) + 1;
      counts.set(k, next);
      return { allowed: next <= limit };
    },
  };
  return counter;
}

const unavailableCounter: DurableCounter = {
  async increment() {
    throw new Error('store unreachable');
  },
};

describe('aggregateIp', () => {
  it('leaves IPv4 whole', () => {
    expect(aggregateIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('collapses IPv6 to its /64 prefix', () => {
    // The whole point: one abuser is routinely handed an entire /64, so
    // per-address limiting lets them rotate 2^64 times and never be capped.
    const a = aggregateIp('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd');
    const b = aggregateIp('2001:db8:1234:5678:9999:8888:7777:6666');
    expect(a).toBe(b);
    expect(a).toBe('2001:db8:1234:5678::/64');
  });

  it('does not collapse different /64s together', () => {
    expect(aggregateIp('2001:db8:1234:5678::1')).not.toBe(
      aggregateIp('2001:db8:1234:9999::1'),
    );
  });

  it('passes the shared unknown sentinel through untouched', () => {
    expect(aggregateIp('unknown')).toBe('unknown');
  });

  // --- RFC 5952 compressed forms -------------------------------------
  // Review found the original implementation split on ':' and sliced four
  // groups, so '2001:db8::5' and '2001:db8::6' produced DIFFERENT keys
  // despite sharing a /64 — reopening the exact 2^64-rotation bypass the
  // policy exists to close. Real traffic is written compressed, so these
  // are the NORMAL cases, not edge cases.

  it('collapses COMPRESSED addresses in one /64 to a single bucket', () => {
    expect(aggregateIp('2001:db8::5')).toBe(aggregateIp('2001:db8::6'));
  });

  it('treats a compressed address the same as its expanded form', () => {
    expect(aggregateIp('2001:db8::5')).toBe(
      aggregateIp('2001:db8:0:0:0:0:0:5'),
    );
  });

  it('ignores leading zeros, so 0db8 and db8 share a bucket', () => {
    expect(aggregateIp('2001:0db8:0000:0001::9')).toBe(
      aggregateIp('2001:db8:0:1::9'),
    );
  });

  it('still separates genuinely different /64s written compressed', () => {
    expect(aggregateIp('2001:db8:0:1::9')).not.toBe(
      aggregateIp('2001:db8:0:2::9'),
    );
  });

  it('does not let a whole /64 mint unlimited distinct keys', () => {
    // The DoS half of the same bug: distinct keys per interface id would
    // fill L1's bucket cap until it failed closed for new legitimate clients.
    const keys = new Set(
      Array.from({ length: 50 }, (_, i) => aggregateIp(`2001:db8:abcd:ef01::${i}`)),
    );
    expect(keys.size).toBe(1);
  });

  it('handles IPv4-mapped addresses without shifting the prefix', () => {
    // The dotted quad occupies the final TWO hextets; treating it as one
    // group would shift every prefix by a hextet.
    expect(aggregateIp('::ffff:192.0.2.1')).toBe(aggregateIp('::ffff:c000:201'));
  });

  it('collapses an IPv4-MAPPED address onto the plain IPv4 bucket', () => {
    // Two spellings of one host must not be two quotas. Before this, an
    // attacker doubled their budget just by switching notation.
    expect(aggregateIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(aggregateIp('::ffff:203.0.113.7')).toBe(aggregateIp('203.0.113.7'));
  });

  it('does not lump unrelated IPv4-mapped clients into one bucket', () => {
    // The other half of the same bug: every mapped address used to expand to
    // an all-zero prefix, so strangers throttled each other.
    expect(aggregateIp('::ffff:203.0.113.7')).not.toBe(
      aggregateIp('::ffff:198.51.100.9'),
    );
  });

  it('keeps real all-zero-prefix addresses distinct from mapped ones', () => {
    // ::1 genuinely lives in 0:0:0:0::/64 and must not be mistaken for an
    // IPv4-mapped address (hextet 6 is not ffff).
    expect(aggregateIp('::1')).toBe('0:0:0:0::/64');
    expect(aggregateIp('::1')).not.toBe(aggregateIp('::ffff:0.0.0.1'));
  });

  it('passes malformed pseudo-IPv6 through rather than inventing a prefix', () => {
    expect(aggregateIp('2001:db8::5::9')).toBe('2001:db8::5::9');
    expect(aggregateIp('2001:zzzz::1')).toBe('2001:zzzz::1');
    expect(aggregateIp('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9');
    expect(aggregateIp('1:2:3:4:')).toBe('1:2:3:4:');
  });

  it('rejects a malformed dotted quad instead of coercing it into a bucket', () => {
    // Number('') is 0, so a grammar-free check turned '1..2.3' into 1.0.2.3
    // and collided malformed input with a REAL address's bucket.
    expect(aggregateIp('::ffff:1..2.3')).toBe('::ffff:1..2.3');
    expect(aggregateIp('::ffff:1.2.3.4.5')).toBe('::ffff:1.2.3.4.5');
    expect(aggregateIp('::ffff:1e2.2.3.4')).toBe('::ffff:1e2.2.3.4');
    expect(aggregateIp('::ffff:256.1.1.1')).toBe('::ffff:256.1.1.1');
  });

  it('accepts a WELL-FORMED zone index but rejects an empty one', () => {
    expect(aggregateIp('fe80::1%eth0')).toBe(aggregateIp('fe80::2%eth0'));
    // Discarding the zone unvalidated let a malformed address look valid.
    expect(aggregateIp('2001:db8::1%')).toBe('2001:db8::1%');
    expect(aggregateIp('2001:db8::1%a%b')).toBe('2001:db8::1%a%b');
  });

  it('handles the loopback and unspecified addresses', () => {
    expect(aggregateIp('::1')).toBe('0:0:0:0::/64');
    expect(aggregateIp('::')).toBe('0:0:0:0::/64');
  });
});

describe('hashKey', () => {
  it('never returns the raw key', () => {
    const hashed = hashKey('203.0.113.7', 'salt', 'waitlist');
    expect(hashed).not.toContain('203.0.113.7');
    expect(hashed).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for the same inputs', () => {
    expect(hashKey('a', 's', 'b')).toBe(hashKey('a', 's', 'b'));
  });

  it('separates buckets, so two consumers cannot share a counter', () => {
    expect(hashKey('a', 's', 'waitlist')).not.toBe(hashKey('a', 's', 'event'));
  });

  it('changes completely when the salt rotates', () => {
    expect(hashKey('a', 'salt-1', 'b')).not.toBe(hashKey('a', 'salt-2', 'b'));
  });
});

describe('createInMemoryLimiter', () => {
  it('allows up to the limit and refuses past it', () => {
    const l = createInMemoryLimiter({ limit: 3, windowMs: 1000 });
    expect([1, 2, 3].map(() => l.allow('k', 0))).toEqual([true, true, true]);
    expect(l.allow('k', 0)).toBe(false);
  });

  it('resets after the window elapses', () => {
    const l = createInMemoryLimiter({ limit: 1, windowMs: 1000 });
    expect(l.allow('k', 0)).toBe(true);
    expect(l.allow('k', 500)).toBe(false);
    expect(l.allow('k', 1000)).toBe(true);
  });

  it('fails CLOSED when every tracked bucket is live and memory is full', () => {
    const l = createInMemoryLimiter({ limit: 5, windowMs: 10_000, maxBuckets: 2 });
    expect(l.allow('a', 0)).toBe(true);
    expect(l.allow('b', 0)).toBe(true);
    // A third distinct key cannot be tracked; an untracked key must not
    // become an untracked UNLIMITED key.
    expect(l.allow('c', 0)).toBe(false);
  });

  it('peek does not consume', () => {
    const l = createInMemoryLimiter({ limit: 1, windowMs: 1000 });
    expect(l.peek('k', 0)).toBe(true);
    expect(l.peek('k', 0)).toBe(true);
    expect(l.allow('k', 0)).toBe(true);
    expect(l.peek('k', 0)).toBe(false);
  });
});

describe('createTieredLimiter', () => {
  const base = {
    bucket: 'waitlist',
    limit: 2,
    windowMs: 60_000,
    salt: 'test-salt',
    onDegraded: 'fail-closed' as const,
  };

  it('enforces a GLOBAL cap across instances sharing one counter', async () => {
    // The entire reason this change exists: two "instances" each with their
    // own local map, one shared counter. Before Item 10 this scenario
    // allowed limit x instances.
    const durable = fakeCounter();
    const instanceA = createTieredLimiter({ ...base, durable });
    const instanceB = createTieredLimiter({ ...base, durable });

    expect((await instanceA.consume('1.2.3.4')).allowed).toBe(true);
    expect((await instanceB.consume('1.2.3.4')).allowed).toBe(true);
    // Third hit overall — over the global limit of 2 even though each
    // instance has only seen one or two locally.
    expect((await instanceB.consume('1.2.3.4')).allowed).toBe(false);
  });

  it('refuses locally WITHOUT touching the shared store', async () => {
    const durable = fakeCounter();
    const limiter = createTieredLimiter({ ...base, limit: 1, durable });

    expect((await limiter.consume('1.2.3.4', 0)).allowed).toBe(true);
    expect(durable.calls).toBe(1);

    // Already over the LOCAL budget: the shared store must not be consulted,
    // so a flood costs a map lookup rather than a round trip.
    expect((await limiter.consume('1.2.3.4', 0)).allowed).toBe(false);
    expect(durable.calls).toBe(1);
  });

  it('FAILS CLOSED when the store is unreachable and the action is irreversible', async () => {
    const limiter = createTieredLimiter({
      ...base,
      durable: unavailableCounter,
      onDegraded: 'fail-closed',
    });
    const decision = await limiter.consume('1.2.3.4');
    expect(decision).toEqual({ allowed: false, degraded: true });
  });

  it('FAILS OPEN when the store is unreachable and the quota is advisory', async () => {
    const limiter = createTieredLimiter({
      ...base,
      durable: unavailableCounter,
      onDegraded: 'fail-open',
    });
    const decision = await limiter.consume('1.2.3.4');
    expect(decision).toEqual({ allowed: true, degraded: true });
  });

  it('degrades no worse than the OLD behaviour: the local cap still binds', async () => {
    // Fail-open must not mean unlimited. With the store down, the local
    // window is still enforced, so the worst case is exactly the previous
    // `limit x instances`, never unbounded.
    const limiter = createTieredLimiter({
      ...base,
      limit: 2,
      durable: unavailableCounter,
      onDegraded: 'fail-open',
    });
    expect((await limiter.consume('1.2.3.4', 0)).allowed).toBe(true);
    expect((await limiter.consume('1.2.3.4', 0)).allowed).toBe(true);
    const third = await limiter.consume('1.2.3.4', 0);
    expect(third.allowed).toBe(false);
    // Refused by L1, so this verdict is exact, not degraded.
    expect(third.degraded).toBe(false);
  });

  it('REFUSES when the shared tier is unconfigured and requireDurable is set', async () => {
    // The convergent finding from two review lanes: forgetting
    // RATE_LIMIT_KEY_SALT in production would otherwise leave the
    // irreversible-action quota per-instance forever, silently. A consumer
    // that opted in refuses instead.
    const limiter = createTieredLimiter({
      ...base,
      durable: null,
      salt: null,
      requireDurable: true,
    });
    expect(await limiter.consume('1.2.3.4', 0)).toEqual({
      allowed: false,
      degraded: true,
    });
  });

  it('treats an unconfigured shared tier as normal, not as degradation', async () => {
    // A laptop or preview deploy has no salt/service role. That is not an
    // outage and must not be reported as one.
    const limiter = createTieredLimiter({ ...base, durable: null, salt: null });
    expect(await limiter.consume('1.2.3.4', 0)).toEqual({
      allowed: true,
      degraded: false,
    });
  });

  it('keeps the UNATTRIBUTABLE bucket out of the shared tier entirely', async () => {
    // Centralizing it would make one global bucket for every client on earth
    // with no usable forwarding header — ten signups an hour, worldwide.
    const durable = fakeCounter();
    const limiter = createTieredLimiter({ ...base, durable, limit: 99 });

    const decision = await limiter.consume(UNATTRIBUTED_KEY);

    expect(decision).toEqual({ allowed: true, degraded: false });
    expect(durable.calls).toBe(0);
  });

  it('still bounds unattributable traffic LOCALLY', async () => {
    // Split off from the shared tier is not the same as unlimited.
    const durable = fakeCounter();
    const limiter = createTieredLimiter({ ...base, durable, limit: 2 });
    expect((await limiter.consume(UNATTRIBUTED_KEY, 0)).allowed).toBe(true);
    expect((await limiter.consume(UNATTRIBUTED_KEY, 0)).allowed).toBe(true);
    expect((await limiter.consume(UNATTRIBUTED_KEY, 0)).allowed).toBe(false);
  });

  it('agrees with the sentinel clientIpFromHeaders actually returns', async () => {
    // The two modules must not drift: a rename on either side would silently
    // push all unattributable traffic back into the shared bucket.
    const { clientIpFromHeaders } = await import('@/lib/waitlistGuard');
    expect(clientIpFromHeaders(new Headers())).toBe(UNATTRIBUTED_KEY);
  });

  it('sends a HASHED key to the store, never the raw address', async () => {
    const seen: string[] = [];
    const spy: DurableCounter = {
      async increment({ keyHash }) {
        seen.push(keyHash);
        return { allowed: true };
      },
    };
    const limiter = createTieredLimiter({ ...base, durable: spy });
    await limiter.consume('203.0.113.7');

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain('203.0.113.7');
    expect(seen[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('aggregates IPv6 BEFORE hashing, so one /64 shares a counter', async () => {
    const seen: string[] = [];
    const spy: DurableCounter = {
      async increment({ keyHash }) {
        seen.push(keyHash);
        return { allowed: true };
      },
    };
    const limiter = createTieredLimiter({ ...base, durable: spy, limit: 99 });
    await limiter.consume('2001:db8:1:2:3:4:5:6');
    await limiter.consume('2001:db8:1:2:ffff:ffff:ffff:ffff');
    expect(seen[0]).toBe(seen[1]);
  });

  it('does not let a rejected store surface as an exception to the caller', async () => {
    const limiter = createTieredLimiter({
      ...base,
      durable: unavailableCounter,
      onDegraded: 'fail-open',
    });
    // A route must never have to wrap this in try/catch.
    await expect(limiter.consume('1.2.3.4')).resolves.toBeDefined();
  });
});

describe('createDurableCounter contract', () => {
  it('treats an RPC error as UNAVAILABLE (throws), never as a denial', async () => {
    const { createDurableCounter } = await import('@/lib/rateLimiter.durable');
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42883' } }),
    };
    const counter = createDurableCounter(client as never);
    // Returning {allowed:false} here would convert an unapplied migration
    // into a hard block on every consumer, including fail-open ones.
    await expect(
      counter.increment({
        bucket: 'b',
        keyHash: 'h',
        windowMs: 1000,
        limit: 1,
        now: 0,
      }),
    ).rejects.toThrow(/consume_rate_limit failed/);
  });

  it('rejects a non-boolean verdict rather than coercing it', async () => {
    const { createDurableCounter } = await import('@/lib/rateLimiter.durable');
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    const counter = createDurableCounter(client as never);
    await expect(
      counter.increment({
        bucket: 'b',
        keyHash: 'h',
        windowMs: 1000,
        limit: 1,
        now: 0,
      }),
    ).rejects.toThrow(/non-boolean/);
  });

  it('passes a boolean verdict straight through', async () => {
    const { createDurableCounter } = await import('@/lib/rateLimiter.durable');
    const client = { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) };
    const counter = createDurableCounter(client as never);
    await expect(
      counter.increment({
        bucket: 'b',
        keyHash: 'h',
        windowMs: 1000,
        limit: 1,
        now: 0,
      }),
    ).resolves.toEqual({ allowed: false });
  });
});

describe('durableCounterFromEnv configuration signalling', () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    vi.restoreAllMocks();
  });

  async function load() {
    vi.resetModules();
    return import('@/lib/rateLimiter.durable');
  }

  it('stays SILENT when nothing is configured — a laptop is not an outage', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.RATE_LIMIT_KEY_SALT;
    const { durableCounterFromEnv } = await load();

    expect(durableCounterFromEnv()).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it('is LOUD when Supabase is configured but the salt was forgotten', async () => {
    // Otherwise the shared tier silently never engages and monitoring that
    // watches the `degraded` flag stays green — the flag only fires when a
    // CONFIGURED store throws.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
    delete process.env.RATE_LIMIT_KEY_SALT;
    const { durableCounterFromEnv } = await load();

    expect(durableCounterFromEnv()).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('RATE_LIMIT_KEY_SALT');
  });

  it('builds the counter and stays silent when fully configured', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
    process.env.RATE_LIMIT_KEY_SALT = 'stub-salt';
    const { durableCounterFromEnv } = await load();

    expect(durableCounterFromEnv()).not.toBeNull();
    expect(err).not.toHaveBeenCalled();
  });
});
