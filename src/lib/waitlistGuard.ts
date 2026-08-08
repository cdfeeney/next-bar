/**
 * Waitlist input validation and client-IP attribution (H1 hardening, audit
 * MED-23). Pure functions, unit-testable without a route context.
 *
 * The rate LIMITER that used to live here moved to `@/lib/rateLimiter` in
 * Item 10. Its old doc comment said "if this ever guards something valuable,
 * move it to a durable store" — it did (`/api/account/delete`), so it was.
 */

/**
 * Pragmatic email shape check: one @, no whitespace, a dot in the domain,
 * bounded length (RFC 5321 caps the address at 254 octets). Deliverability
 * is not provable by regex — this only rejects obvious garbage.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_MAX_LENGTH = 254;
const NEIGHBORHOOD_MAX_LENGTH = 40;

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

/**
 * `sanitizeVibeProfile` used to live here. It measured only the SERIALIZED
 * SIZE of the payload and then returned the caller's object by reference, so
 * any sub-2 KB object — arbitrary keys, arbitrary depth, arbitrary value
 * types — was written to the jsonb column verbatim. It has been replaced by
 * `parseVibeProfile` in `@/lib/vibeProfileSchema`, which validates against an
 * allowlisted shape and REBUILDS the stored value from validated fields.
 *
 * Deliberately not kept as a deprecated alias: the two have different
 * contracts (pass-through vs rebuild), and an alias would let a future caller
 * pick the unsafe semantics back up by accident.
 */

/**
 * First hop of x-forwarded-for (Vercel sets it; the first entry is the
 * client). 'unknown' lumps un-attributable traffic into one shared bucket —
 * strict for abusers behind stripped headers, harmless for the normal path.
 */
/** Bucket every request lands in, for the C2 F5 attribution counters. */
const attribution = { attributed: 0, unknown: 0 };
/**
 * At most one summary line per hour PER WARM INSTANCE — not fleet-wide, and
 * the first unattributable request an instance sees logs immediately, because
 * the timestamp starts at 0 (Codex + Kimi review; the earlier wording implied
 * a global once-per-hour and was imprecise). Instrumentation must not become
 * spam, but with N instances expect up to N lines per hour.
 */
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
 *
 * READ THE RATIO WITH CARE (DeepSeek review): `attributed` is incremented from
 * a client-supplied header, so anyone can inflate it by sending an arbitrary
 * `x-forwarded-for`. A small `unknown / large attributed` ratio therefore does
 * NOT prove unattributable traffic is negligible. The `unknown` count is the
 * trustworthy half; treat the denominator as attacker-influenceable. (The log
 * itself still fires on elapsed time, not on the ratio, so a flood cannot
 * suppress the signal — only make the ratio look reassuring.)
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

/**
 * `createRateLimiter` and its `RateLimiter` type MOVED to `@/lib/rateLimiter`
 * (Item 10). There it sits behind the `RateLimiter` interface as
 * `createInMemoryLimiter` — the L1 backstop beneath a shared, Postgres-backed
 * counter, so the cap is no longer `limit x warm instances`.
 *
 * Not left here as a re-export: two import paths for the same limiter is how
 * a future route ends up on the per-instance one by accident and quietly
 * loses the global bound.
 */
