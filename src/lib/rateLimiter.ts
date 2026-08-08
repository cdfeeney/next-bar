/**
 * Rate limiting: the interface, the key policy, and the tiering that turns a
 * per-instance limiter into a shared one (Item 10).
 *
 * THE PROBLEM THIS SOLVES. Every limiter in the app was a module-scoped
 * `Map` inside a serverless function. On Vercel each warm instance keeps its
 * own window, so the real global cap was `limit x instances`, and a cold
 * start reset it to zero. That is adequate for damping a dumb flood and
 * inadequate for anything that must actually be bounded — most obviously
 * `POST /api/account/delete`, where the quota guards an irreversible action.
 *
 * THE SHAPE. Two implementations behind one interface:
 *
 *   L1  in-memory   — fast, exact within one instance, no network. Retained
 *                     deliberately: it is both the test double AND the
 *                     backstop that keeps a limit in force when the shared
 *                     store is unreachable.
 *   L2  durable     — a Postgres row per (bucket, key, window). Shared across
 *                     every instance, so the cap is finally global.
 *
 * `createTieredLimiter` runs L1 first and only consults L2 if L1 allows. That
 * ordering matters: a key already over its LOCAL budget never reaches the
 * database, so a flood costs one map lookup rather than a round trip.
 *
 * WHY POSTGRES AND NOT REDIS. Supabase is already a hard dependency and is
 * already on the critical path of every route that limits, so L2 adds no new
 * outage domain and no new vendor, credential, or bill. A dedicated KV store
 * (Upstash/Vercel KV) has better latency and semantics and is the right
 * answer at a scale this app is nowhere near; adopting one is an ATTENDED
 * decision (new credentials, new billing) and is deliberately not made here.
 */

import { createHash } from 'node:crypto';

export type RateDecision = {
  /** False = throttle the caller. */
  allowed: boolean;
  /**
   * True when the shared store could not be consulted, so this verdict came
   * from the local backstop alone. Callers that must be exact (the
   * destructive route) treat a degraded verdict as a refusal; advisory
   * callers carry on. Surfacing this rather than hiding it inside the
   * boolean is what makes the per-consumer policy possible at all.
   */
  degraded: boolean;
};

export interface RateLimiter {
  consume(key: string, now?: number): Promise<RateDecision>;
  /** Clears the LOCAL tier only. Test seam — see InMemoryLimiter.reset. */
  resetLocal(): void;
}

/**
 * What a consumer does when the shared store is unreachable. There is no
 * single right answer, so there is no default — each call site states one.
 *
 * The rule, written down so the next route picks correctly:
 *   fail-closed when the quota protects an IRREVERSIBLE or externally
 *   visible action (deleting an account, sending mail, calling a partner);
 *   fail-open when it protects only data quality or advisory telemetry.
 *
 * Failing open on account deletion would let a store outage unbound the one
 * action that cannot be undone. Failing closed on an analytics beacon would
 * turn a database blip into user-visible errors for no benefit.
 */
export type DegradedPolicy = 'fail-closed' | 'fail-open';

/**
 * The durable half. Kept deliberately small so the Postgres implementation,
 * a future KV implementation, and the test fake are all trivially
 * substitutable.
 *
 * Implementations MUST be atomic: two concurrent calls for the same
 * (bucket, key, window) must not both read-then-write a stale count. The
 * Postgres implementation gets this from a single upsert-increment
 * statement, mirroring the existing `bump_analytics_event` pattern.
 *
 * A rejected promise means UNAVAILABLE, not "denied" — the tier layer maps it
 * through the consumer's DegradedPolicy.
 */
export interface DurableCounter {
  increment(args: {
    bucket: string;
    keyHash: string;
    windowMs: number;
    limit: number;
    now: number;
  }): Promise<{ allowed: boolean }>;
}

/* ------------------------------------------------------------------ keys */

/**
 * The sentinel `clientIpFromHeaders` returns when a request carries no usable
 * forwarding header. Declared here (not imported) so the limiter's key policy
 * does not depend on the waitlist module; the two must agree, and the test
 * suite pins that they do.
 */
export const UNATTRIBUTED_KEY = 'unknown';

/**
 * IPv6 is aggregated to its /64 prefix before it ever becomes a key.
 *
 * A single consumer is routinely handed a whole /64 (it is the standard
 * subnet a home or mobile connection receives), so limiting per full address
 * is not "precise" — it is broken: one abuser rotates through 2^64 addresses
 * and never hits a limit. /64 is the conventional "one household" boundary.
 * This is a POLICY choice with a real cost — genuine neighbours behind one
 * /64 share a bucket — and it is recorded here rather than buried.
 *
 * IPv4 is used whole. Aggregating it (say to /24) would lump unrelated
 * customers of the same ISP together for no comparable benefit.
 */
export function aggregateIp(ip: string): string {
  if (!ip.includes(':')) return ip;

  // A zone index (`fe80::1%eth0`) is stripped, but only when it is actually
  // well-formed. Discarding it unvalidated meant `2001:db8::1%` — malformed —
  // was silently accepted as a valid address and given a real bucket, when
  // the contract for anything unparseable is to pass it through untouched.
  const [address, zone, ...extraZones] = ip.split('%');
  if (extraZones.length > 0) return ip;
  if (zone !== undefined && zone.length === 0) return ip;

  const expanded = expandIpv6(address);
  // Not a parseable IPv6 address — including the 'unknown' sentinel — so it
  // passes through unchanged rather than being mangled into a fake prefix.
  if (!expanded) return ip;

  // IPv4-MAPPED (::ffff:0:0/96) COLLAPSES TO THE IPv4 ADDRESS ITSELF.
  //
  // Without this, `203.0.113.7` and `::ffff:203.0.113.7` — the same host,
  // two spellings — landed in two different buckets, so a caller got double
  // the intended quota just by switching notation. Worse in the other
  // direction: every IPv4-mapped address expanded to a prefix of all zeros,
  // so unrelated clients all shared the single `0:0:0:0::/64` bucket and
  // throttled each other. Mapping back to the IPv4 address fixes both, and
  // is what the address actually MEANS.
  const isIpv4Mapped =
    expanded[5] === 'ffff' &&
    expanded.slice(0, 5).every((group) => group === '0');
  if (isIpv4Mapped) {
    const high = parseInt(expanded[6], 16);
    const low = parseInt(expanded[7], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }

  return `${expanded.slice(0, 4).join(':')}::/64`;
}

/**
 * Expand an IPv6 address to exactly 8 normalized hextets, or null if it is
 * not one.
 *
 * THIS EXISTS BECAUSE NAIVE `split(':')` IS A SECURITY BUG, not a cosmetic
 * one. RFC 5952 says addresses are written compressed, so the real traffic
 * looks like `2001:db8::5`. Splitting that on ':' yields
 * ['2001','db8','','5'] — four groups — and slicing the first four produced
 * the key `2001:db8::5::/64`. `2001:db8::6` produced a DIFFERENT key. Both
 * live in `2001:db8::/64`, so an attacker holding one /64 got a fresh limit
 * for every interface identifier: precisely the 2^64-rotation bypass the /64
 * policy above exists to prevent. It also let one /64 mint unlimited distinct
 * keys, filling L1's bucket cap until it failed closed for new legitimate
 * clients on that instance.
 */
function expandIpv6(bare: string): string[] | null {
  if (!bare.includes(':')) return null;

  const halves = bare.split('::');
  if (halves.length > 2) return null;

  const split = (part: string): string[] => (part ? part.split(':') : []);
  let head = split(halves[0]);
  let tail = halves.length === 2 ? split(halves[1]) : [];

  // IPv4-mapped/compatible tail (`::ffff:192.0.2.1`): the dotted quad
  // occupies the final TWO hextets. Left unexpanded it would be treated as
  // one group and shift every prefix by a hextet.
  const last = (tail.length ? tail : head).at(-1);
  if (last && last.includes('.')) {
    const octets = last.split('.');
    if (octets.length !== 4) return null;
    // Grammar first, THEN range. `Number()` alone coerces '', '+1', ' 2',
    // and '1e2' into perfectly valid-looking octets, so `::ffff:1..2.3`
    // parsed as 1.0.2.3 and was handed a real bucket — colliding malformed
    // input with a genuine address instead of passing it through.
    if (!octets.every((o) => /^(0|[1-9][0-9]{0,2})$/.test(o))) return null;
    const nums = octets.map((o) => Number(o));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const mapped = [
      ((nums[0] << 8) | nums[1]).toString(16),
      ((nums[2] << 8) | nums[3]).toString(16),
    ];
    if (tail.length) tail = [...tail.slice(0, -1), ...mapped];
    else head = [...head.slice(0, -1), ...mapped];
  }

  const missing = 8 - (head.length + tail.length);
  // No '::' means the address must already be complete; with '::' there must
  // be at least one elided group.
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...'0'.repeat(Math.max(missing, 0)).split(''), ...tail]
    .map((g) => (g === '0' ? '0' : g));
  if (groups.length !== 8) return null;

  const normalized: string[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    // Strip leading zeros so 2001:0db8:… and 2001:db8:… share one bucket.
    normalized.push(parseInt(group, 16).toString(16));
  }
  return normalized;
}

/**
 * Keys are HASHED before they reach the database.
 *
 * The in-memory map was ephemeral, so holding a raw client IP in it was a
 * runtime detail. A durable table is different: raw IPs in Postgres is a
 * data-retention and privacy question the app should not take on for a
 * counter. Hashing with a server-side secret means a stored row cannot be
 * reversed to an address, while remaining perfectly stable for counting.
 *
 * The salt is a SECRET (see RATE_LIMIT_KEY_SALT). Rotating it invalidates
 * every live window — a brief, harmless reset — and is an operator decision.
 * Truncated to 128 bits: ample against collisions here, and smaller rows.
 *
 * The fields are joined with an ESCAPED NUL (`\0`, written as an escape
 * sequence and never as a literal byte). NUL is the right separator because
 * it cannot occur in a bucket name or an IP, so no two different field
 * triples can collide by shifting text across the boundary. Writing it as a
 * raw byte, however, makes this whole file BINARY to ripgrep — the module
 * then silently vanishes from every content search and review tool, which is
 * exactly how it was found here.
 */
export function hashKey(key: string, salt: string, bucket: string): string {
  return createHash('sha256')
    .update(`${salt}\0${bucket}\0${key}`)
    .digest('hex')
    .slice(0, 32);
}

/* ------------------------------------------------------- L1: in-memory */

export type InMemoryLimiter = {
  /** Consumes one unit. True when this hit is within budget. */
  allow: (key: string, now?: number) => boolean;
  /** Non-consuming read of the same predicate. Advisory only. */
  peek: (key: string, now?: number) => boolean;
  /**
   * Drop all windows. TEST SEAM ONLY, and it exists because these limiters
   * are module-scoped singletons: without it, one test's consumption silently
   * becomes the next test's starting budget, and a suite fails in a way that
   * looks like a limiter bug rather than shared state. The repo already
   * carries `__resetMediaMetricRateLimit` for exactly this reason.
   */
  reset: () => void;
};

/**
 * Fixed-window in-memory limiter. Windows reset `windowMs` after a bucket's
 * first hit. Memory is HARD-capped at MAX_BUCKETS: when pruning expired
 * buckets cannot make room — 10k+ distinct keys all inside the live window —
 * new keys are REJECTED rather than tracked. Under that kind of spray the
 * traffic is an attack by definition, so failing closed both bounds memory
 * and keeps limiting.
 *
 * `now` is injectable, which is the whole reason this implementation stays:
 * window behaviour is testable here without a database or a fake clock
 * library, and the same object doubles as the outage backstop.
 */
export function createInMemoryLimiter({
  limit,
  windowMs,
  maxBuckets = 10_000,
}: {
  limit: number;
  windowMs: number;
  maxBuckets?: number;
}): InMemoryLimiter {
  const buckets = new Map<string, { count: number; windowStart: number }>();

  function prune(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart >= windowMs) buckets.delete(key);
    }
  }

  return {
    allow(key: string, now: number = Date.now()): boolean {
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart >= windowMs) {
        if (buckets.size >= maxBuckets) {
          prune(now);
          if (buckets.size >= maxBuckets && !buckets.has(key)) return false;
        }
        buckets.set(key, { count: 1, windowStart: now });
        return true;
      }
      bucket.count += 1;
      return bucket.count <= limit;
    },

    peek(key: string, now: number = Date.now()): boolean {
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart >= windowMs) return true;
      return bucket.count < limit;
    },

    reset(): void {
      buckets.clear();
    },
  };
}

/* ----------------------------------------------------------- tiering */

/**
 * Compose the local backstop with the shared counter.
 *
 * Order of operations, and why:
 *  1. L1 first. A key already over its local budget is refused without
 *     touching the network — the hot path under abuse stays cheap.
 *  2. L2 only when L1 allows. The shared count is the authority on the
 *     global cap.
 *  3. If L2 is unreachable, apply the consumer's DegradedPolicy. The worst
 *     case is therefore never unbounded: it degrades to exactly the old
 *     `limit x instances` behaviour, which is what shipped before this
 *     change, and no worse.
 *
 * `durable: null` is a supported, non-exceptional state — it is what runs
 * locally and in preview environments where no salt or service role is
 * configured. It behaves as pure L1 and reports `degraded: false`, because
 * nothing failed: the deployment simply has no shared tier. (A missing
 * shared tier in PRODUCTION is a configuration problem the health check
 * should catch, not something for the request path to discover.)
 */
export function createTieredLimiter({
  bucket,
  limit,
  windowMs,
  durable,
  salt,
  onDegraded,
  maxBuckets,
  requireDurable = false,
}: {
  bucket: string;
  limit: number;
  windowMs: number;
  durable: DurableCounter | null;
  salt: string | null;
  onDegraded: DegradedPolicy;
  maxBuckets?: number;
  /**
   * Refuse rather than fall back to local-only when NO shared tier is
   * configured. Off by default so development and preview keep working; a
   * consumer guarding an irreversible action turns it on in production, so a
   * forgotten RATE_LIMIT_KEY_SALT cannot silently downgrade the bound.
   */
  requireDurable?: boolean;
}): RateLimiter {
  const local = createInMemoryLimiter({ limit, windowMs, maxBuckets });

  return {
    async consume(key: string, now: number = Date.now()): Promise<RateDecision> {
      const aggregated = aggregateIp(key);

      if (!local.allow(aggregated, now)) {
        return { allowed: false, degraded: false };
      }

      if (!durable || !salt) {
        // NO SHARED TIER CONFIGURED. Normally benign — a laptop or preview
        // deploy has no salt and limits purely in memory, exactly as the app
        // did before Item 10, so this is not an outage and is not reported as
        // degradation.
        //
        // But for a consumer that opted into `requireDurable`, silence here
        // is the real hazard: forgetting to set RATE_LIMIT_KEY_SALT in
        // production would leave the irreversible-action quota per-instance
        // forever, with nothing failing and nothing logged — precisely the
        // weakness Item 10 exists to remove, reintroduced by an unset
        // environment variable. Two review lanes converged on this. Such a
        // consumer refuses instead, loudly.
        if (requireDurable) {
          return { allowed: false, degraded: true };
        }
        return { allowed: true, degraded: false };
      }

      // AC6, decided explicitly rather than inherited: the unattributable
      // bucket is SPLIT OFF from the shared tier and stays local.
      //
      // `clientIpFromHeaders` collapses every request with no usable
      // forwarding header into one sentinel key. Per-instance that was
      // harmless. Centralized it would become ONE GLOBAL bucket — every
      // unattributable client on earth sharing ten waitlist signups an hour —
      // and nobody has measured how much real traffic lands there (the C2 F5
      // counters exist to answer exactly that and have not reported yet).
      // Capping unknown-but-legitimate users globally is a worse failure than
      // limiting an abuser per-instance, and an abuser can trivially present
      // a forged `x-forwarded-for` anyway, so this bucket is not where abuse
      // actually lives. Revisit once F5 has numbers.
      if (aggregated === UNATTRIBUTED_KEY) {
        return { allowed: true, degraded: false };
      }

      try {
        const { allowed } = await durable.increment({
          bucket,
          keyHash: hashKey(aggregated, salt, bucket),
          windowMs,
          limit,
          now,
        });
        return { allowed, degraded: false };
      } catch {
        // UNAVAILABLE, not "denied". The consumer's policy decides.
        return { allowed: onDegraded === 'fail-open', degraded: true };
      }
    },

    resetLocal(): void {
      local.reset();
    },
  };
}
