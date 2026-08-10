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

/**
 * Client errors worth another attempt. Everything else in the 4xx range is the
 * server telling us the request itself is wrong, which a retry cannot fix.
 *
 * While every non-member was treated as permanent, these were handed to the
 * operator as permanently-failed cells even though the very next attempt would
 * likely have succeeded — a waiver over geography that was still reachable.
 */
const RETRYABLE_4XX = Object.freeze(new Set([408, 425, 429]));

/**
 * The 5xx statuses a retry genuinely cannot fix.
 *
 * 5xx is treated as retryable BY DEFAULT, with this as the exception list,
 * rather than the other way round. A closed allowlist of {500,502,503,504} was
 * the wrong shape: every other 5xx — including the whole Cloudflare 520-530
 * family, which is emitted for exactly the transient origin/gateway trouble a
 * retry is for, plus 507 Insufficient Storage — was marked non-retryable and
 * offered to the operator as a permanently-failed cell. That is silent data
 * loss: waiving geography a resume would have collected. Four review lanes
 * found it independently.
 *
 * These six really are permanent: the server does not implement the method
 * (501), refuses the protocol version (505), is misconfigured for content
 * negotiation (506), detected a loop (508), demands an extension (510), or
 * requires network authentication we are not going to satisfy mid-sweep (511).
 */
const PERMANENT_5XX = Object.freeze(new Set([501, 505, 506, 508, 510, 511]));

/** Whether another attempt at this status could plausibly succeed. */
function isRetryableStatus(status) {
  if (typeof status !== 'number') return false;
  if (status >= 500) return !PERMANENT_5XX.has(status);
  return RETRYABLE_4XX.has(status);
}

/**
 * The smallest value we will accept from `body.error.code` as an HTTP status.
 *
 * Google's REST error model puts the HTTP status in `error.code`, but its gRPC
 * canonical codes are small integers in the same field name (8 =
 * RESOURCE_EXHAUSTED, 14 = UNAVAILABLE), and both of those are TRANSIENT.
 * Taking them as statuses made `14` a "status" below every guard, which then
 * classified a temporary outage as a permanently-failed cell the operator was
 * invited to waive. Anything under 100 is not an HTTP status.
 */
const MIN_HTTP_STATUS = 100;

/**
 * gRPC canonical codes that mean "try again later".
 *
 * Ignoring a canonical code was only half the fix. A transient code wrapped in a
 * healthy 200 envelope still resolved to status 200, which is not retryable, so
 * a temporary backend outage was handed to the operator as a permanently-failed
 * cell. The code has to inform retryability, not merely be refused as a status.
 * 2 UNKNOWN, 4 DEADLINE_EXCEEDED, 8 RESOURCE_EXHAUSTED, 10 ABORTED,
 * 13 INTERNAL, 14 UNAVAILABLE. Deliberately NOT 16 UNAUTHENTICATED or 7
 * PERMISSION_DENIED, which no retry fixes and which must stay waivable.
 */
const RETRYABLE_CANONICAL = Object.freeze(new Set([2, 4, 8, 10, 13, 14]));

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
 *   `permanent` is set whenever a response WAS received and the transport
 *   declined to retry it. `classifyError` reads it only as a last resort, so a
 *   rejection whose envelope status matches none of its numeric guards -- an
 *   HTTP 200 wrapping an error body with no numeric `code` -- classifies as
 *   `api_rejected` (non-blocking, waivable) instead of falling through to
 *   `network` (blocking) and stranding the cell with no lever.
 */
export async function fetchJson(
  url,
  init,
  source,
  { fetchImpl = fetch, sleep = defaultSleep, onRequest = null } = {},
) {
  let lastError;
  // Counted so the torn-body downgrade below can tell "every read was torn" from
  // "the last one happened to be". Without that distinction, three real 503s
  // followed by one torn 200 threw an error carrying status 200 and
  // retryable:false -- the 503s erased, a live outage reported as a permanently
  // rejected cell, and the operator invited to waive it.
  let tornAttempts = 0;
  let attemptsMade = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    attemptsMade += 1;
    let response;
    let body;
    try {
      // Fired per HTTP REQUEST, not per fetchJson call. `--max-calls` is
      // documented as a hard Google call budget, but the caller counted one
      // "call" per invocation while this loop can issue ATTEMPTS of them, so a
      // run could spend up to 4x the operator's stated ceiling on a retried
      // transient. The meter has to be incremented where the request actually
      // happens.
      if (onRequest) onRequest();
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
        // A body that fails to read on an OTHERWISE GOOD response is a truncated
        // or interrupted read, which is exactly the transient case: retry it.
        // Marking it permanent on the first try and throwing at once offered the
        // operator a waiver over a cell a single retry would have collected.
        // `torn` marks the specific optimism being taken on credit: the response
        // looked healthy, so the read is presumed truncated rather than refused.
        // Only that optimism gets withdrawn on exhaustion below -- a genuinely
        // transient status keeps its promise.
        const torn = response.ok;
        if (torn) tornAttempts += 1;
        const retryable = torn || isRetryableStatus(response.status);
        lastError = Object.assign(error, { status: response.status, retryable, torn });
        if (!retryable) throw lastError;
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
    // Only when it is plausibly an HTTP status: see MIN_HTTP_STATUS. A gRPC
    // canonical code in the same field (8, 14) is transient, and taking it as a
    // status turned a temporary outage into a permanently-failed cell.
    const apiCode = body?.error?.code;
    const isCanonical = typeof apiCode === 'number' && apiCode < MIN_HTTP_STATUS;
    const status =
      typeof apiCode === 'number' && !isCanonical ? apiCode : response.status;
    // The status travels ON the error. A bare `new Error` left it undefined,
    // every `typeof status === 'number'` guard in `classifyError` was false,
    // and a permanent Google 400 fell through to the `network` default — a
    // BLOCKING class. The engine could not fix the cell and `ackEligibility`
    // refused to waive it because "resume handles that", so the cell was
    // unfinishable and unwaivable at once.
    //
    // `retryable` is the transport stating its OWN judgement rather than making
    // the classifier re-derive it from a status number. RETRYABLE already IS the
    // decision about whether another attempt is worth making, so saying it
    // directly is both truthful and exactly what `classifyError` needs.
    const retryable =
      isRetryableStatus(status) || (isCanonical && RETRYABLE_CANONICAL.has(apiCode));
    lastError = Object.assign(new Error(`${source} failed (${status}): ${detail}`), {
      status,
      retryable,
    });
    if (!retryable) throw lastError;
    if (attempt === ATTEMPTS - 1) break;
    const delayMs = 250 * 3 ** attempt;
    console.warn(`${source} transient failure; retrying in ${delayMs}ms`);
    await sleep(delayMs);
  }
  // Every attempt is spent. A response-backed failure we were willing to retry
  // ONLY because the response looked healthy -- a 2xx whose body never once
  // parsed -- has now disproved that optimism, so stop promising a resume will
  // clear it and let the operator waive the cell. A status that is genuinely in
  // RETRYABLE (a 503) keeps its promise: four fast attempts say nothing about a
  // resume minutes later, and treating it as permanent would waive geography a
  // retry could still reach.
  // Only when EVERY attempt was torn. A run whose last read happened to tear,
  // after real 5xx responses on the attempts before it, has seen a live server
  // problem -- and downgrading on the strength of the final attempt alone threw
  // an error carrying status 200 and `retryable:false`, erasing those 5xx and
  // offering the operator a waiver over an outage a resume would have cleared.
  if (lastError?.torn === true && tornAttempts === attemptsMade) {
    lastError.retryable = false;
  }
  throw lastError;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
