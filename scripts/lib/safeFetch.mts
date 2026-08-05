/**
 * Guarded HTTP client for the venue-website crawl.
 *
 * Every URL here originates in an OpenStreetMap `website` tag, which anyone on
 * the internet can edit, and this runs on a machine whose environment holds
 * DATABASE_URL. So the threat model is SSRF against ourselves, and the two
 * controls that actually carry the weight are:
 *
 *  1. Redirects are followed MANUALLY, and every hop is re-validated. Letting
 *     the stack follow them means only the first URL was ever checked — a
 *     302 to http://169.254.169.254/ then walks straight through.
 *  2. The address check happens in the socket's `lookup`, i.e. against the
 *     address actually being connected to. Resolving a name, approving it,
 *     then connecting by name re-resolves and re-opens the DNS-rebinding hole.
 *
 * Everything else (byte cap, timeouts) is resource protection rather than
 * access control, but a crawler without them hangs the whole run on one
 * pathological host.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';
import { checkUrl, classifyAddress, nextRedirectTarget } from '../../src/lib/netGuard.ts';

export type FetchOutcome =
  | { ok: true; status: number; finalUrl: string; body: string; contentType: string }
  | { ok: false; reason: string; blockedBy?: 'guard'; status?: number };

export type FetchOptions = {
  maxBytes?: number;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
};

const DEFAULTS = {
  // Venue pages are small. 2 MB is generous and bounds a decompression bomb,
  // because the cap is applied to DECOMPRESSED output, not wire bytes.
  maxBytes: 2 * 1024 * 1024,
  connectTimeoutMs: 5_000,
  totalTimeoutMs: 15_000,
  maxRedirects: 5,
  userAgent:
    'NextBarHoursBot/0.1 (+https://nextbar.app/install; venue opening-hours; contact: hello@nextbar.app)',
};

/**
 * A `lookup` for net.connect that refuses blocked addresses AT CONNECT TIME.
 * This is the DNS-rebinding defence: whatever address the socket is about to
 * use is the address that gets classified.
 */
function guardedLookup(
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address?: string | never[], family?: number) => void,
): void {
  const opts = (typeof options === 'object' && options !== null ? options : {}) as {
    all?: boolean;
  };
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0) {
      return callback(Object.assign(new Error('no addresses'), { code: 'ENOTFOUND' }));
    }
    // ALL resolved addresses must be public. A host that answers with one
    // public and one private address is a rebinding attempt, not a fallback.
    for (const entry of list) {
      const verdict = classifyAddress(entry.address);
      if (verdict.blocked) {
        return callback(
          Object.assign(
            new Error(`blocked address ${entry.address} for ${hostname}: ${verdict.reason}`),
            { code: 'EBLOCKED' },
          ),
        );
      }
    }
    if (opts.all) return callback(null, list as never[]);
    return callback(null, list[0].address, list[0].family);
  });
}

function decompress(stream: Readable, encoding: string | undefined): Readable {
  switch ((encoding ?? '').toLowerCase()) {
    case 'gzip':
      return stream.pipe(createGunzip());
    case 'deflate':
      return stream.pipe(createInflate());
    case 'br':
      return stream.pipe(createBrotliDecompress());
    default:
      return stream;
  }
}

/** One hop. Does not follow redirects; reports them so the caller can re-check. */
function requestOnce(
  url: URL,
  opts: Required<FetchOptions>,
): Promise<
  | { kind: 'body'; status: number; body: string; contentType: string }
  | { kind: 'redirect'; status: number; location: string }
  | { kind: 'error'; reason: string; blockedBy?: 'guard'; status?: number }
> {
  return new Promise((resolve) => {
    const isHttps = url.protocol === 'https:';
    const send = isHttps ? httpsRequest : httpRequest;
    let settled = false;
    const done = (v: Awaited<ReturnType<typeof requestOnce>>): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const req = send(
      url,
      {
        method: 'GET',
        lookup: guardedLookup,
        headers: {
          'user-agent': opts.userAgent,
          accept: 'text/html,application/xhtml+xml',
          // Prefer no compression; if the server compresses anyway the cap
          // below still applies to decompressed output.
          'accept-encoding': 'identity',
        },
        timeout: opts.connectTimeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.destroy();
          return done({ kind: 'redirect', status, location });
        }
        const contentType = String(res.headers['content-type'] ?? '');
        if (status !== 200) {
          res.destroy();
          return done({ kind: 'error', reason: `HTTP ${status}`, status });
        }
        if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
          res.destroy();
          return done({ kind: 'error', reason: `non-HTML content-type ${contentType}`, status });
        }

        const out = decompress(res, res.headers['content-encoding'] as string | undefined);
        const chunks: Buffer[] = [];
        let size = 0;
        out.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            res.destroy();
            out.destroy?.();
            done({ kind: 'error', reason: `body exceeded ${opts.maxBytes} bytes`, status });
            return;
          }
          chunks.push(chunk);
        });
        out.on('end', () => {
          done({
            kind: 'body',
            status,
            body: Buffer.concat(chunks).toString('utf8'),
            contentType,
          });
        });
        out.on('error', (e: Error) => done({ kind: 'error', reason: `stream: ${e.message}` }));
      },
    );

    const totalTimer = setTimeout(() => {
      req.destroy();
      done({ kind: 'error', reason: `total timeout after ${opts.totalTimeoutMs}ms` });
    }, opts.totalTimeoutMs);
    totalTimer.unref?.();

    req.on('timeout', () => {
      req.destroy();
      done({ kind: 'error', reason: `connect timeout after ${opts.connectTimeoutMs}ms` });
    });
    req.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(totalTimer);
      done(
        e.code === 'EBLOCKED'
          ? { kind: 'error', reason: e.message, blockedBy: 'guard' }
          : { kind: 'error', reason: `${e.code ?? 'error'}: ${e.message}` },
      );
    });
    req.on('close', () => clearTimeout(totalTimer));
    req.end();
  });
}

export async function safeFetch(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<FetchOutcome> {
  const opts = { ...DEFAULTS, ...options } as Required<FetchOptions>;
  const first = checkUrl(rawUrl);
  if (!first.ok) return { ok: false, reason: first.reason, blockedBy: 'guard' };

  let url = first.url;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const res = await requestOnce(url, opts);
    if (res.kind === 'body') {
      return {
        ok: true,
        status: res.status,
        finalUrl: url.toString(),
        body: res.body,
        contentType: res.contentType,
      };
    }
    if (res.kind === 'error') {
      return { ok: false, reason: res.reason, blockedBy: res.blockedBy, status: res.status };
    }
    const next = nextRedirectTarget(url, res.location);
    if (!next.ok) {
      return { ok: false, reason: `redirect blocked: ${next.reason}`, blockedBy: 'guard' };
    }
    url = next.url;
  }
  return { ok: false, reason: `more than ${opts.maxRedirects} redirects` };
}
