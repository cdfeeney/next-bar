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

/**
 * Rejection of a PADDED address is deliberate, not an accident of the regex.
 *
 * EMAIL_RE forbids whitespace, so ' user@example.com ' has always been
 * rejected — while normalizeEmail() trims. Those two disagreed, and the
 * disagreement was undocumented, so it was impossible to tell whether the
 * rejection was intended or a latent bug. It is intended: the address stored
 * is the address given, and silently repairing input at the boundary hides
 * malformed callers. The explicit check below states that, so a future reader
 * changing normalizeEmail cannot conclude the trim was meant to apply here.
 *
 * Tradeoff, recorded rather than hidden: a mobile keyboard that appends a
 * trailing space produces `invalid_email` on the signup form. If that ever
 * shows up in funnel data, the fix is a client-side trim BEFORE submit, not a
 * looser validator.
 */
export function isValidWaitlistEmail(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  if (email.length > EMAIL_MAX_LENGTH) return false;
  // Explicit: padded input is rejected, it is not trimmed into validity.
  if (email !== email.trim()) return false;
  return EMAIL_RE.test(email);
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
/** Bucket every request lands in, for the C2 F5 attribution counters. */
const attribution = { attributed: 0, unknown: 0 };
/** One summary line per hour at most — instrumentation must not become spam. */
const ATTRIBUTION_LOG_INTERVAL_MS = 60 * 60 * 1000;
let attributionLoggedAt = 0;

/**
 * Non-resetting counts of how traffic was attributed since this instance
 * started. C2 audit F5: all traffic with no `x-forwarded-for` and no
 * `x-real-ip` collapses into ONE shared `'unknown'` bucket, which is strict
 * for abusers and harmless for the normal path — but nobody had ever measured
 * how much traffic actually lands there. The audit's own remediation order
 * says "measure before fixing", so this is the measurement, not the fix.
 *
 * Exported for a future observability sink; the hourly log line below is what
 * makes it visible today without needing one.
 */
export function ipAttributionStats(): { attributed: number; unknown: number } {
  return { ...attribution };
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      attribution.attributed += 1;
      return first;
    }
  }
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) {
    attribution.attributed += 1;
    return realIp;
  }

  attribution.unknown += 1;
  // Counts only — never the header values, which would put client IPs in the
  // logs and turn an instrumentation line into a privacy problem.
  const now = Date.now();
  if (now - attributionLoggedAt >= ATTRIBUTION_LOG_INTERVAL_MS) {
    attributionLoggedAt = now;
    console.warn(
      `[rate-limit] unattributable-IP bucket in use: ${attribution.unknown} unknown / ` +
        `${attribution.attributed} attributed since instance start (C2 F5 measurement)`,
    );
  }
  return 'unknown';
}

export type RateLimiter = {
  /**
   * True when this hit is within the key's budget; false = throttled.
   * CONSUMES one unit of the budget.
   */
  allow: (key: string, now?: number) => boolean;
  /**
   * Non-consuming read of the same predicate: true when the next `allow`
   * would be within budget. Lets a caller reject an already-exhausted key
   * before doing expensive work WITHOUT charging the key for that
   * rejection — see the two-stage guard in `api/account/delete`.
   *
   * Optimistic by design: it does not model the MAX_BUCKETS fail-closed
   * path below, so a brand-new key can peek true and still be denied by
   * `allow`. `allow` is the authoritative decision; `peek` is only ever a
   * cheap early-out.
   */
  peek: (key: string, now?: number) => boolean;
};

/**
 * Fixed-window in-memory limiter. Windows reset `windowMs` after a
 * bucket's first hit. Memory is HARD-capped at MAX_BUCKETS (dual review):
 * when a prune of expired buckets can't make room — 10k+ distinct keys all
 * inside the live window — new keys are REJECTED rather than tracked. Under
 * that kind of spray the traffic is an attack by definition, so failing
 * closed both bounds memory and keeps limiting.
 *
 * The key is an arbitrary string. Client IP is the common case, but
 * `api/account/delete` keys its real quota on the VERIFIED user id — an
 * identity the caller cannot rotate or spoof (C2 audit F3).
 */
export function createRateLimiter({
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
    allow(key: string, now: number = Date.now()): boolean {
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart >= windowMs) {
        // Opportunistic prune on new-window creation keeps the hot path
        // (existing bucket increment) allocation-free.
        if (buckets.size >= MAX_BUCKETS) {
          prune(now);
          // Still full after pruning: every tracked bucket is live. Fail
          // closed — an untracked new key must not become an untracked
          // unlimited key, and the map must not grow unbounded.
          if (buckets.size >= MAX_BUCKETS && !buckets.has(key)) return false;
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
  };
}
