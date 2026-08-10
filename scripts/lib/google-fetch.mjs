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
 *   was received; it is absent only for socket/parse failures, which genuinely
 *   have no HTTP status.
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
      lastError = error;
      if (attempt < ATTEMPTS - 1) {
        const delayMs = 250 * 3 ** attempt;
        console.warn(`${source} network failure; retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
      continue;
    }
    if (response.ok && !body?.error) return body;
    const detail = body?.error?.message ?? body?.message ?? response.statusText;
    // The status travels ON the error. A bare `new Error` left it undefined,
    // every `typeof status === 'number'` guard in `classifyError` was false,
    // and a permanent Google 400 fell through to the `network` default — a
    // BLOCKING class. The engine could not fix the cell and `ackEligibility`
    // refused to waive it because "resume handles that", so the cell was
    // unfinishable and unwaivable at once. The `http4xx` branch was dead code
    // in production and the runbook's documented behaviour was false.
    lastError = Object.assign(new Error(`${source} failed (${response.status}): ${detail}`), {
      status: response.status,
    });
    if (!RETRYABLE.has(response.status)) throw lastError;
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
