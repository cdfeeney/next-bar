/**
 * The HTTP transport behind every Google Places call the sweep makes.
 *
 * It lives here, rather than inside `nearby-sweep.mjs`, for one reason: that
 * file is a CLI that runs a sweep at import time, so nothing could ever import
 * its transport to test it. The only exercised transport was the fixture
 * double — which set `.status` on its thrown errors by hand while the real one
 * never did. Twenty offline checks passed over a production path that was
 * broken, because the double was more capable than the thing it stood in for.
 *
 * The contract this module owes the rest of the system is exactly one property:
 * **an HTTP failure must carry its status on the thrown error.** `classifyError`
 * is the single place that decides transient-vs-permanent, it reads
 * `error.status`, and a missing status silently means `network` — the blocking
 * class that tells an operator to resume forever over a cell no resume can fix.
 */

/** Statuses worth another attempt; everything else is permanent and throws at once. */
const RETRYABLE = Object.freeze(new Set([429, 500, 502, 503, 504]));

const ATTEMPTS = 4;

/**
 * Fetch JSON, retrying transient HTTP and socket failures with backoff.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} source human label used in error messages and warnings
 * @returns {Promise<any>} the parsed body
 * @throws {Error & {status?: number}} `status` is present whenever a response
 *   was received -- including when the body failed to parse, because the status
 *   is known in that case too. It is absent ONLY for a socket failure, where no
 *   response ever arrived and no status exists. Where the body carries Google's
 *   own `error.code`, that code is preferred over the envelope status.
 *
 *   Known residual: a 200 whose error body has no numeric `code` still resolves
 *   to status 200, which no `classifyError` guard matches, so it classifies as
 *   `network`. Closing that needs a taxonomy change (a non-blocking permanent
 *   class, as `manifest_corrupt` and `types_exhausted` already are) rather than
 *   a transport change.
 */
export async function fetchJson(url, init, source, { fetchImpl = fetch, sleep = defaultSleep } = {}) {
  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let response;
    let body;
    try {
      response = await fetchImpl(url, init);
      body = await response.json();
    } catch (error) {
      // Two different failures land here and they are NOT interchangeable.
      //
      // If `response` is set, the request reached Google and came back; only
      // parsing failed. The status is therefore KNOWN, and discarding it put us
      // straight back in the hole the status attachment below exists to fill: a
      // permanent 403 or 404 whose body is an HTML error page (WAF, proxy
      // interception, blocked key) throws a SyntaxError out of `.json()`, and a
      // status-less SyntaxError classifies as `network` -- a BLOCKING class --
      // so the cell is unfixable by resume and unwaivable by the operator at
      // once. It also burned all four attempts retrying a failure that could
      // never succeed.
      //
      // If `response` is undefined the socket genuinely failed and there is no
      // status to attach. That is the one case `network` is actually about.
      if (response) {
        lastError = Object.assign(error, { status: response.status });
        if (!RETRYABLE.has(response.status)) throw lastError;
      } else {
        lastError = error;
      }
      if (attempt < ATTEMPTS - 1) {
        const delayMs = 250 * 3 ** attempt;
        console.warn(`${source} network failure; retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
      continue;
    }
    if (response.ok && !body?.error) return body;
    const detail = body?.error?.message ?? body?.message ?? response.statusText;
    // Google's REST errors carry their own `error.code`, and it is the truthful
    // one: a proxy or a misconfigured gateway can hand back HTTP 200 wrapping
    // `{"error":{"code":403,...}}`. Classifying by the 200 envelope satisfied no
    // numeric guard in `classifyError`, fell through to `network` (BLOCKING),
    // and -- because 200 is not retryable -- threw at once, leaving the cell
    // permanently stuck with no waiver lever. Prefer the API's own code.
    const status = typeof body?.error?.code === 'number' ? body.error.code : response.status;
    // The status travels ON the error. A bare `new Error` left it undefined,
    // every `typeof status === 'number'` guard in `classifyError` was false,
    // and a permanent Google 400 fell through to the `network` default — a
    // BLOCKING class. The engine could not fix the cell and `ackEligibility`
    // refused to waive it because "resume handles that", so the cell was
    // unfinishable and unwaivable at once. The `http4xx` branch was dead code
    // in production and the runbook's documented behaviour was false.
    lastError = Object.assign(new Error(`${source} failed (${status}): ${detail}`), { status });
    if (!RETRYABLE.has(status)) throw lastError;
    if (attempt === ATTEMPTS - 1) break;
    const delayMs = 250 * 3 ** attempt;
    console.warn(`${source} transient failure; retrying in ${delayMs}ms`);
    await sleep(delayMs);
  }
  throw lastError;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
