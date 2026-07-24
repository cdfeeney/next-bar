/**
 * Waitlist input validation + in-memory IP rate limiting (H1 hardening,
 * audit MED-23). Pure functions + a factory so everything is unit-testable
 * without a route context.
 *
 * The rate limiter is deliberately in-memory per the nightlog spec: on
 * serverless (Vercel) each warm instance keeps its own window, so the
 * effective global cap is limit × instances — fine for abuse-damping a
 * waitlist form (the goal is stopping dumb floods, not building a
 * distributed quota). If this ever guards something valuable, move it to a
 * durable store.
 */

/**
 * Pragmatic email shape check: one @, no whitespace, a dot in the domain,
 * bounded length (RFC 5321 caps the address at 254 octets). Deliverability
 * is not provable by regex — this only rejects obvious garbage.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_MAX_LENGTH = 254;
const NEIGHBORHOOD_MAX_LENGTH = 40;
/** Cap the serialized vibe_profile so the column can't be used as a dump. */
const VIBE_PROFILE_MAX_JSON_LENGTH = 2_000;

export function isValidWaitlistEmail(email: unknown): email is string {
  return (
    typeof email === 'string' &&
    email.length <= EMAIL_MAX_LENGTH &&
    EMAIL_RE.test(email)
  );
}

/**
 * Lowercased + trimmed — one canonical row per address. Gmail additionally
 * ignores dots in the local part (DeepSeek N2 review: `u.ser@gmail.com`
 * and `user@gmail.com` are one inbox — collapsing them stops trivial
 * duplicate-row griefing). Deliberately NOT stripping `+suffix`: users
 * choose plus-tags on purpose, and we should store the address they gave.
 */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const [local, domain] = normalized.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.replaceAll('.', '')}@${domain}`;
  }
  return normalized;
}

/** Empty/oversize/non-string neighborhood collapses to null, never an error. */
export function sanitizeNeighborhood(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > NEIGHBORHOOD_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

/** Oversize or non-object payloads are dropped (null), not rejected. */
export function sanitizeVibeProfile<T>(value: T | null | undefined): T | null {
  if (value === null || value === undefined || typeof value !== 'object') {
    return null;
  }
  try {
    if (JSON.stringify(value).length > VIBE_PROFILE_MAX_JSON_LENGTH) {
      return null;
    }
  } catch {
    return null;
  }
  return value;
}

/**
 * First hop of x-forwarded-for (Vercel sets it; the first entry is the
 * client). 'unknown' lumps un-attributable traffic into one shared bucket —
 * strict for abusers behind stripped headers, harmless for the normal path.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

export type RateLimiter = {
  /** True when this hit is within the per-IP budget; false = throttled. */
  allow: (ip: string, now?: number) => boolean;
};

/**
 * Fixed-window in-memory limiter. Windows reset `windowMs` after a
 * bucket's first hit. Memory is HARD-capped at MAX_BUCKETS (dual review):
 * when a prune of expired buckets can't make room — 10k+ distinct IPs all
 * inside the live window — new IPs are REJECTED rather than tracked. Under
 * that kind of spray the traffic is an attack by definition, so failing
 * closed both bounds memory and keeps limiting.
 */
export function createIpRateLimiter({
  limit,
  windowMs,
}: {
  limit: number;
  windowMs: number;
}): RateLimiter {
  const buckets = new Map<string, { count: number; windowStart: number }>();
  const MAX_BUCKETS = 10_000;

  function prune(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart >= windowMs) buckets.delete(key);
    }
  }

  return {
    allow(ip: string, now: number = Date.now()): boolean {
      const bucket = buckets.get(ip);
      if (!bucket || now - bucket.windowStart >= windowMs) {
        // Opportunistic prune on new-window creation keeps the hot path
        // (existing bucket increment) allocation-free.
        if (buckets.size >= MAX_BUCKETS) {
          prune(now);
          // Still full after pruning: every tracked bucket is live. Fail
          // closed — an untracked new IP must not become an untracked
          // unlimited IP, and the map must not grow unbounded.
          if (buckets.size >= MAX_BUCKETS && !buckets.has(ip)) return false;
        }
        buckets.set(ip, { count: 1, windowStart: now });
        return true;
      }
      bucket.count += 1;
      return bucket.count <= limit;
    },
  };
}
