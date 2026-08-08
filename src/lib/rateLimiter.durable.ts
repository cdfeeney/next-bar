/**
 * The Postgres-backed half of the tiered limiter (Item 10).
 *
 * Talks to `consume_rate_limit()` from migration 0043, which does the
 * increment and the verdict in one atomic statement. Nothing here holds
 * state: the shared counter IS the state, which is the entire point.
 *
 * The service role is the only principal granted EXECUTE on that function
 * (0043 revokes it from anon/authenticated), so this module is server-only —
 * hence the `.server`-shaped separation from `rateLimiter.ts`, which stays
 * import-safe anywhere.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DurableCounter } from '@/lib/rateLimiter';

/**
 * Wall-clock budget for one counter round trip. A rate limiter that hangs is
 * worse than one that is briefly unavailable: without this, a stalled
 * database connection would hold the request open until the platform's own
 * function timeout, turning a limiter outage into a full outage. On timeout
 * we throw, and the tier layer applies the consumer's DegradedPolicy.
 */
const DEFAULT_TIMEOUT_MS = 1_500;

export function createDurableCounter(
  client: SupabaseClient,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): DurableCounter {
  return {
    async increment({ bucket, keyHash, windowMs, limit }) {
      const rpc = client.rpc('consume_rate_limit', {
        p_bucket: bucket,
        p_key_hash: keyHash,
        p_window_ms: windowMs,
        p_limit: limit,
      });

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('consume_rate_limit timed out')),
          timeoutMs,
        ),
      );

      const { data, error } = await Promise.race([rpc, timeout]);

      // An error here is UNAVAILABLE, never "denied". Returning
      // `{ allowed: false }` would silently convert an unapplied migration or
      // a transport blip into a hard block on every consumer, including the
      // ones whose policy is explicitly fail-open.
      if (error) {
        throw new Error(`consume_rate_limit failed: ${error.code ?? 'unknown'}`);
      }
      if (typeof data !== 'boolean') {
        throw new Error('consume_rate_limit returned a non-boolean verdict');
      }
      return { allowed: data };
    },
  };
}

/**
 * Build the shared counter from the environment, or return null when this
 * deployment has no shared tier.
 *
 * Null is a normal state, not a failure: local development and preview
 * environments run without a service role or salt and limit purely in
 * memory, exactly as the app did before Item 10. The tier layer treats null
 * as "no shared tier configured" and reports `degraded: false`, so a laptop
 * does not look like a production outage.
 *
 * Deliberately NOT cached in a module-level singleton keyed on nothing: the
 * env can differ between preview and production instances of the same build,
 * and a stale client is a confusing failure. Client construction is cheap.
 */
export function durableCounterFromEnv(): DurableCounter | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const salt = process.env.RATE_LIMIT_KEY_SALT;

  // PARTIAL configuration is a misconfiguration; ABSENT configuration is a
  // choice. Distinguishing them turns a silent production degradation into
  // something an operator can actually see.
  //
  // The trap this closes (found in review): `degraded: true` is only ever set
  // when a CONFIGURED store throws. If the salt is simply missing, the shared
  // tier never engages, every limiter silently reverts to per-instance
  // counting, and monitoring that watches the degraded flag stays green while
  // the global cap does not exist at all. Nothing fails, so nobody looks.
  //
  // All three unset = a laptop or preview deploy: intentional, stay quiet.
  // Supabase configured but no salt = someone forgot: say so loudly.
  if (url && serviceKey && !salt) {
    console.error(
      '[rate-limit] RATE_LIMIT_KEY_SALT is NOT set while Supabase IS configured: ' +
        'the shared rate-limit tier is DISABLED and every limiter has silently ' +
        'reverted to per-instance counting. Set the salt (only AFTER migration ' +
        '0043 is applied) to enable it.',
    );
  }

  if (!url || !serviceKey || !salt) return null;

  return createDurableCounter(
    createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
}

/** The salt, or null when no shared tier is configured. Never logged. */
export function rateLimitSaltFromEnv(): string | null {
  return process.env.RATE_LIMIT_KEY_SALT || null;
}
