/**
 * E2E network fence (overnight scope 2026-08-05): a refuse-everything HTTP
 * proxy for test runs.
 *
 * SCOPE — what is and is not fenced (be honest about this):
 *  - Browser-side egress: fenced by `use.proxy` in playwright.config.ts
 *    (bypass localhost,127.0.0.1). Covers HTTP, HTTPS CONNECT, and wss://.
 *  - Dev-server-side egress: fenced ONLY via the env the Playwright
 *    `webServer` block injects (HTTP(S)_PROXY + NODE_USE_ENV_PROXY=1, Node
 *    ≥24 undici). A dev server started by hand without that env — possible
 *    because reuseExistingServer is true — is NOT fenced server-side. Raw
 *    TCP (e.g. pg) is never proxy-fenced; no app route uses it.
 *  - Specs must still stub app API routes whose handlers call outward
 *    (e.g. /api/account/delete, /api/event); the fence turns a missed stub
 *    into a refused request, not into correct behavior.
 * Loopback traffic never reaches this proxy, so ANY request arriving here is
 * an application request trying to leave the box during a test run. It is
 * refused (403 / refused CONNECT / destroyed upgrade) and recorded by
 * HOSTNAME ONLY — never the path, query string, or headers, which could
 * carry tokens.
 *
 * Fail-closed property: if this proxy is not running, proxied requests fail
 * at connect time (ERR_PROXY_CONNECTION_FAILED) — the fence never falls open.
 *
 * Usage:  node e2e/tools/fence-proxy.mjs
 * Env:    FENCE_LOG  — append-only log path (default: OS temp dir).
 */

import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.FENCE_PORT) || 39555;
const LOG =
  process.env.FENCE_LOG || path.join(tmpdir(), 'nb-e2e-fence-log.txt');

/**
 * Reduce whatever arrived in a request line / Host header to something that
 * can only be a hostname: strip ports, then drop every character outside the
 * hostname alphabet and cap the length. Malformed/hostile input must not be
 * able to smuggle paths, queries, or tokens into the log.
 */
function sanitizeHost(raw) {
  const first = String(raw || 'unparseable-host').split(/[/?#\s]/)[0];
  const noPort = first.replace(/:\d+$/, '');
  const clean = noPort.replace(/[^a-zA-Z0-9.\-\[\]:]/g, '');
  return (clean || 'unparseable-host').slice(0, 253);
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

const server = http.createServer((req, res) => {
  // Absolute-form request line (plain-HTTP proxying).
  let host = 'unparseable-host';
  try {
    host = new URL(req.url).hostname;
  } catch {
    host = String(req.headers.host || 'unparseable-host').split(':')[0];
  }
  record('HTTP', host);
  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('fenced: non-loopback application traffic is refused during tests\n');
});

// HTTPS CONNECT tunneling — refuse before any bytes are relayed.
server.on('connect', (req, clientSocket) => {
  const host = String(req.url || 'unparseable-host').split(':')[0];
  record('CONNECT', host);
  // Browsers reset refused tunnels abruptly; an unhandled 'error' on this
  // socket would crash the whole fence (observed ECONNRESET, 2026-08-05).
  clientSocket.on('error', () => {});
  clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
});

// Plain ws:// upgrades (non-CONNECT) would otherwise be closed silently by
// Node without firing 'request' — log them too, then refuse.
server.on('upgrade', (req, socket) => {
  const host = String(req.headers.host || 'unparseable-host').split(':')[0];
  record('UPGRADE', host);
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

server.listen(PORT, '127.0.0.1', () => {
  // Single stdout line so a runner can await readiness.
  console.log(`fence-proxy listening on 127.0.0.1:${PORT} log=${LOG}`);
});
