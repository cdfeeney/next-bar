/**
 * E2E network fence (overnight scope 2026-08-05): a refuse-everything HTTP
 * proxy for test runs.
 *
 * SCOPE — what is and is not fenced (be honest about this):
 *  - Browser-side egress: fenced by `use.proxy` in playwright.config.ts
 *    (bypass localhost,127.0.0.1). Covers HTTP, HTTPS CONNECT, wss://, and
 *    plain ws:// (upgrade).
 *  - Dev-server-side egress: fenced ONLY via the env the Playwright
 *    `webServer` block injects (HTTP(S)_PROXY + NODE_USE_ENV_PROXY=1, Node
 *    ≥24 undici). A dev server started by hand without that env — possible
 *    because reuseExistingServer is true — is NOT fenced server-side (the
 *    globalSetup canary detects the affirmative-egress case). Raw TCP
 *    (e.g. pg) is never proxy-fenced; no app route uses it.
 *  - Specs must still stub app API routes whose handlers call outward
 *    (e.g. /api/account/delete, /api/event); the fence turns a missed stub
 *    into a refused request, not into correct behavior.
 * Loopback traffic never reaches this proxy, so ANY request arriving here is
 * an application request trying to leave the box during a test run. It is
 * refused (403 / refused CONNECT / refused upgrade) and recorded by
 * HOSTNAME ONLY — never the path, query string, or headers, which could
 * carry tokens.
 *
 * Fail-closed property: if this proxy is not running, proxied requests fail
 * at connect time (ERR_PROXY_CONNECTION_FAILED) — the fence never falls open.
 *
 * This module EXPORTS its contract (PORT default, BANNER) so
 * fence-global-setup.ts imports one source of truth; importing does NOT start
 * the server (main-module guard below). Bump FENCE_CONTRACT_VERSION whenever
 * refusal/logging behavior changes: the version travels in the banner, so a
 * stale detached proxy from a previous session fails the authenticity probe
 * instead of silently masking the edit.
 *
 * Usage:  node e2e/tools/fence-proxy.mjs
 * Env:    FENCE_PORT — listen port (default 39555)
 *         FENCE_LOG  — append-only log path (default: OS temp dir).
 */

import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FENCE_CONTRACT_VERSION = 2;
export const DEFAULT_PORT = 39555;
export const BANNER = `fenced[v${FENCE_CONTRACT_VERSION}]: non-loopback application traffic is refused during tests`;

const PORT = Number(process.env.FENCE_PORT) || DEFAULT_PORT;
const LOG =
  process.env.FENCE_LOG || path.join(tmpdir(), 'nb-e2e-fence-log.txt');

/**
 * Extract the host portion of a proxy authority (CONNECT target or Host
 * header): bracketed IPv6 literals survive intact; otherwise the value up to
 * the first ':' (port). Never returns path/query content — that is
 * sanitizeHost's job, applied afterwards.
 */
export function extractAuthorityHost(raw) {
  const value = String(raw || '');
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end !== -1) return value.slice(0, end + 1);
    return '';
  }
  return value.split(':')[0];
}

/**
 * Reduce whatever arrived in a request line / Host header to something that
 * can only be a hostname. Reject-the-tail, never delete-in-place: the value
 * is CUT at the first character outside the hostname alphabet, so an
 * embedded token can never be "cleaned into" the log (e.g.
 * `evil.example%2FSECRET` records as `evil.example`, never
 * `evil.example2FSECRET`).
 */
export function sanitizeHost(raw) {
  const first = String(raw || '').split(/[/?#\s]/)[0];
  const noPort = first.startsWith('[') ? first : first.replace(/:\d+$/, '');
  const match = noPort.match(/^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.\-]+)/);
  return (match ? match[1] : 'unparseable-host').slice(0, 253) || 'unparseable-host';
}

function record(kind, host) {
  // Hostname only — deliberately no path/query/header capture.
  const line = `${new Date().toISOString()} ${kind} ${sanitizeHost(host)}\n`;
  try {
    appendFileSync(LOG, line);
  } catch {
    // Logging must never turn the fence off; refusal below still happens.
  }
}

function createFenceServer() {
  const server = http.createServer((req, res) => {
    // Absolute-form request line (plain-HTTP proxying).
    let host = 'unparseable-host';
    try {
      host = new URL(req.url).hostname;
    } catch {
      host = extractAuthorityHost(req.headers.host) || 'unparseable-host';
    }
    record('HTTP', host);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end(`${BANNER}\n`);
  });

  // HTTPS CONNECT tunneling — refuse before any bytes are relayed.
  server.on('connect', (req, clientSocket) => {
    record('CONNECT', extractAuthorityHost(req.url) || 'unparseable-host');
    // Browsers reset refused tunnels abruptly; an unhandled 'error' on this
    // socket would crash the whole fence (observed ECONNRESET, 2026-08-05).
    clientSocket.on('error', () => {});
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });

  // Plain ws:// upgrades (non-CONNECT) would otherwise be closed silently by
  // Node without firing 'request' — log them too, then refuse.
  server.on('upgrade', (req, socket) => {
    record('UPGRADE', extractAuthorityHost(req.headers.host) || 'unparseable-host');
    socket.on('error', () => {});
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });

  // A raw client reset between accept and request must never kill the fence.
  server.on('connection', (socket) => socket.on('error', () => {}));
  server.on('clientError', (_err, socket) => {
    try {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    } catch {
      /* already gone */
    }
  });

  // EADDRINUSE etc. must be a clear one-line exit, not an unhandled crash —
  // fence-global-setup treats a failed spawn as a hard abort with its own
  // message, and a stack trace here just obscures the real cause.
  server.on('error', (err) => {
    console.error(`fence-proxy failed to listen on 127.0.0.1:${PORT}: ${err.code || err.message}`);
    process.exit(1);
  });

  return server;
}

// Main-module guard: `import`ing this file (fence-global-setup.ts, unit
// tests) must never bind the port — only direct `node fence-proxy.mjs` does.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  createFenceServer().listen(PORT, '127.0.0.1', () => {
    // Single stdout line so a runner can await readiness.
    console.log(`fence-proxy listening on 127.0.0.1:${PORT} log=${LOG}`);
  });
}
