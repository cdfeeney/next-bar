/**
 * Shared HTTP request-boundary primitives for every mutating API route
 * (Item 9 hardening).
 *
 * These started life inside `mediaMetric.server.ts`, which was the only route
 * that got them right. `/api/waitlist` and `/api/event` both called
 * `request.json()` with no cap at all, so a single request could buffer an
 * arbitrary body into a serverless function's memory. Rather than copy the
 * good implementation twice, it moved here and `mediaMetric.server.ts` now
 * delegates — one implementation, one set of tests, three callers.
 *
 * SCOPE: this is a gate for BROWSER-ORIGINATED requests. A third-party
 * webhook has a foreign or absent Origin by design and authenticates by
 * signature instead; such a route should skip `guardOrigin` entirely and
 * verify its signature. That is correct layering, not a workaround — recorded
 * here so the first webhook does not either bypass the gate silently (making
 * it look optional) or bolt an `allowForeign` escape hatch onto
 * `classifyOrigin`, which would turn a pure classification into a dumping
 * ground for per-route policy.
 *
 * THE CHECK ORDER MATTERS AND IS NOT ARBITRARY. Every mutating route runs:
 *
 *   1. origin  →  2. rate limit  →  3. Content-Length  →  4. bounded read  →  5. parse
 *
 * Origin comes FIRST, before the limiter. Reversing 1 and 2 creates a real
 * attack: an attacker-controlled page makes a victim's browser POST here
 * repeatedly; each forged request is eventually rejected, but if the limiter
 * ran first it would already have consumed the victim's per-IP budget, and
 * the victim's own signup then fails with 429. Rejecting cross-origin
 * requests before charging quota makes that attack free of consequence.
 * Content-Length before the bounded read is just cost: an honest oversized
 * header is refusable without reading a byte.
 */

/**
 * Origins the NATIVE SHELL can legitimately present. The iOS app is a
 * Capacitor wrapper whose `server.url` points at the live site, so its
 * WebView documents normally carry the ordinary https origin and match the
 * host check below. These custom schemes are the documented fallback shape
 * when a Capacitor WebView serves from its own scheme instead.
 *
 * Allowing them does NOT open a web CSRF hole: a page on the open web cannot
 * cause a browser to send `Origin: capacitor://localhost`. The origin header
 * is set by the user agent, not by script.
 *
 * NOT YET VERIFIED ON DEVICE — the remote-origin assumption is inferred from
 * `capacitor.config.ts`, not observed in a TestFlight build. That check is an
 * attended step; this allowlist is what makes a wrong inference non-fatal.
 *
 * ON SPOOFING, since a reviewer raised it and the answer is not obvious:
 * yes, any non-browser client can send `Origin: capacitor://localhost`. That
 * grants it nothing it did not already have — the same client can just as
 * easily send `Origin: https://<our-host>` and match the host check outright.
 * The origin gate was never a defense against clients that choose their own
 * headers; against those, the rate limiter is the control. What it does buy
 * is a cheap filter on naive scripted abuse and, in a browser, a real
 * cross-origin block that script cannot forge. Removing these two entries
 * would therefore raise no attacker's cost while risking a silent 403 for the
 * native shell.
 */
const NATIVE_SHELL_ORIGINS: readonly string[] = [
  'capacitor://localhost',
  'ionic://localhost',
];

/**
 * The public host this request was addressed to. On Vercel the edge sets
 * x-forwarded-host to the public hostname while Host may be an internal
 * routing value, so the forwarded header wins when present. A forwarding
 * CHAIN (comma-separated) contributes its FIRST entry — the client-facing
 * hop. Normalized to lower case; empty/malformed values return null and the
 * caller rejects.
 */
export function requestPublicHost(
  forwardedHost: string | null,
  host: string | null,
): string | null {
  const candidate = forwardedHost
    ? forwardedHost.split(',')[0]?.trim()
    : host?.trim();
  if (!candidate) return null;
  return candidate.toLowerCase();
}

/**
 * `absent` is reported rather than folded into one of the other two because
 * the routes genuinely disagree about it, and that disagreement is a policy
 * decision each route should state for itself:
 *  - /api/media-metric and /api/waitlist reject it (browser callers only).
 *  - /api/event accepts it, because `navigator.sendBeacon` and other
 *    origin-less clients are indistinguishable from curl and the counter
 *    model bounds the damage.
 */
export type OriginVerdict = 'same-origin' | 'absent' | 'cross-origin';

export function classifyOrigin(headers: Headers): OriginVerdict {
  const origin = headers.get('origin')?.trim();
  if (!origin) return 'absent';

  if (NATIVE_SHELL_ORIGINS.includes(origin.toLowerCase())) return 'same-origin';

  const publicHost = requestPublicHost(
    headers.get('x-forwarded-host'),
    headers.get('host'),
  );
  // Un-attributable host: we cannot prove same-origin, so we do not claim it.
  if (!publicHost) return 'cross-origin';

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return 'cross-origin';
  }
  return parsed.host.toLowerCase() === publicHost ? 'same-origin' : 'cross-origin';
}

/**
 * True when an HONEST Content-Length already exceeds the cap — reject before
 * reading a single byte. A missing, malformed, or dishonest header returns
 * false and the caller falls through to the bounded stream read, which is the
 * enforcement that cannot be lied to.
 */
export function contentLengthExceeds(
  header: string | null,
  maxBytes: number,
): boolean {
  if (header === null) return false;
  const n = Number(header);
  return Number.isFinite(n) && n > maxBytes;
}

export type BoundedRead =
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'too-large' }
  | { kind: 'stream-error' };

/**
 * Read a request stream incrementally, counting actual UTF-8 BYTES (never JS
 * string length — one '€' is three bytes). The moment cumulative bytes exceed
 * `maxBytes` the reader is cancelled and the caller returns 413: a chunked or
 * dishonestly-labelled body cannot buffer past the cap. Decoding happens only
 * AFTER the bounded read.
 *
 * A FAILING STREAM IS AN OUTCOME, NOT AN EXCEPTION. `reader.read()` rejects
 * when the client disconnects or resets mid-body, and `reader.cancel()` can
 * itself reject on an already-errored stream. Both used to escape this
 * function, past callers that only guarded `JSON.parse`, and surface as an
 * unhandled 500 — turning an ordinary dropped connection into a server error
 * and, worse, losing the 413 we had already decided on. Both are now caught
 * and reported (independently flagged by two review lanes).
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<BoundedRead> {
  if (!body) return { kind: 'ok', bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return { kind: 'stream-error' };
      }
      if (chunk.done) break;
      const value = chunk.value;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Best-effort: the decision is already made, so a cancel that
        // rejects must not turn a 413 into a 500.
        await reader.cancel().catch(() => {});
        return { kind: 'too-large' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', bytes };
}

export type BoundedJson =
  | { kind: 'ok'; value: unknown }
  | { kind: 'too-large' }
  | { kind: 'invalid-json' }
  | { kind: 'stream-error' };

/**
 * The whole boundary in one call: honest-header check, bounded stream read,
 * then parse. Callers get a closed set of outcomes to map onto status codes
 * and never touch `request.json()`, which is what made the cap bypassable.
 */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<BoundedJson> {
  if (contentLengthExceeds(request.headers.get('content-length'), maxBytes)) {
    return { kind: 'too-large' };
  }
  const read = await readBoundedBody(request.body, maxBytes);
  if (read.kind !== 'ok') return { kind: read.kind };

  try {
    return { kind: 'ok', value: JSON.parse(new TextDecoder().decode(read.bytes)) };
  } catch {
    return { kind: 'invalid-json' };
  }
}

/**
 * The POLICY gate every mutating route should call — as opposed to
 * `classifyOrigin`, which only reports the FACT.
 *
 * Splitting them this way came out of review: a three-valued verdict is the
 * right classification, but letting each route re-decide what to do about
 * `absent` guarantees the posture drifts apart as routes are added. So the
 * decision lives here, strict by default:
 *
 *   - `cross-origin` is ALWAYS rejected.
 *   - `absent` is rejected UNLESS the caller passes `allowAbsent` naming the
 *     origin-less client it exists for. The reason is a required string, not
 *     a boolean, so every exception documents itself at the call site and
 *     `grep allowAbsent` enumerates the complete set of lenient routes.
 *
 * Returns `null` when the request may proceed, so callers read as:
 * `const blocked = guardOrigin(...); if (blocked) return blocked;`
 *
 * `build` receives the verdict so a caller can LOG which check failed. Do not
 * put that verdict in the response body — telling a caller whether it failed
 * on `absent` or `cross-origin` is free reconnaissance. Every current call
 * site returns a fixed, opaque body.
 */
export function guardOrigin<R>(
  headers: Headers,
  build: (verdict: Exclude<OriginVerdict, 'same-origin'>) => R,
  options?: { allowAbsent: string },
): R | null {
  const verdict = classifyOrigin(headers);
  if (verdict === 'same-origin') return null;
  // A JUSTIFICATION, not a flag. Plain truthiness would let `allowAbsent: true`
  // or `allowAbsent: ' '` buy leniency with no stated reason — which defeats
  // the entire point of demanding a reason. TypeScript already rejects the
  // boolean; this makes the guarantee hold for JS callers and tests too.
  const reason = options?.allowAbsent;
  const justified = typeof reason === 'string' && reason.trim().length > 0;
  if (verdict === 'absent' && justified) return null;
  return build(verdict);
}
