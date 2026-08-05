/**
 * Unit tests for the e2e network fence (e2e/tools/fence-proxy.mjs).
 *
 * The fence is load-bearing for the overnight loop's no-egress guarantee, so
 * its three contract points get pinned here:
 *  1. any HTTP request reaching it is refused (403) and logged HOSTNAME-ONLY;
 *  2. any HTTPS CONNECT tunnel is refused before bytes are relayed;
 *  3. an abrupt client socket reset must NOT kill the proxy — the observed
 *     2026-08-05 failure mode was an unhandled ECONNRESET on a refused
 *     CONNECT socket crashing the whole fence mid-run.
 *
 * The proxy under test runs as a real child process (it is a standalone
 * script, not a library), on a per-run port via FENCE_PORT. Set FENCE_UNDER_TEST
 * to point the suite at an alternate copy (used once to prove these tests fail
 * against the pre-hardening version).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';

const PROXY_PATH =
  process.env.FENCE_UNDER_TEST ??
  path.join(__dirname, 'fence-proxy.mjs');
const PORT = 39615; // test-only port, distinct from the runtime default
const LOG = path.join(mkdtempSync(path.join(tmpdir(), 'fence-test-')), 'log.txt');

let proxy: ChildProcess;

function proxyAlive(): boolean {
  return proxy.exitCode === null && proxy.signalCode === null;
}

/** Raw HTTP through the proxy (absolute-form request line). */
function rawRequest(payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(PORT, '127.0.0.1', () => sock.write(payload));
    let data = '';
    sock.on('data', (c) => (data += c.toString()));
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
    setTimeout(() => {
      sock.destroy();
      resolve(data);
    }, 3000);
  });
}

beforeAll(async () => {
  proxy = spawn(process.execPath, [PROXY_PATH], {
    env: { ...process.env, FENCE_PORT: String(PORT), FENCE_LOG: LOG },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    proxy.stdout!.once('data', () => resolve());
    proxy.once('exit', () => reject(new Error('fence proxy exited at startup')));
    setTimeout(() => reject(new Error('fence proxy startup timeout')), 5000);
  });
});

afterAll(() => {
  proxy.kill();
});

describe('fence-proxy contract', () => {
  it('refuses plain-HTTP proxying with 403 and logs hostname only', async () => {
    const res = await rawRequest(
      'GET http://fence-test-host.example/secret/path?token=SHOULD_NOT_LOG HTTP/1.1\r\n' +
        'Host: fence-test-host.example\r\n\r\n',
    );
    expect(res).toContain('403');
    expect(res).toContain('fenced');
    const log = readFileSync(LOG, 'utf8');
    expect(log).toContain('HTTP fence-test-host.example');
    // Hostname ONLY: no path, no query, no token may reach the log.
    expect(log).not.toContain('secret');
    expect(log).not.toContain('token');
    expect(log).not.toContain('SHOULD_NOT_LOG');
  });

  it('refuses HTTPS CONNECT tunnels and logs the host', async () => {
    const res = await rawRequest(
      'CONNECT fence-tls-host.example:443 HTTP/1.1\r\n' +
        'Host: fence-tls-host.example:443\r\n\r\n',
    );
    expect(res).toContain('403');
    expect(readFileSync(LOG, 'utf8')).toContain('CONNECT fence-tls-host.example');
    expect(proxyAlive()).toBe(true);
  });

  it('survives an abrupt client reset on a refused CONNECT (2026-08-05 crash regression)', async () => {
    await new Promise<void>((resolve) => {
      const sock = createConnection(PORT, '127.0.0.1', () => {
        sock.write('CONNECT reset-me.example:443 HTTP/1.1\r\n\r\n');
        // RST instead of FIN: destroy with pending data, no graceful close.
        setTimeout(() => {
          sock.resetAndDestroy();
          resolve();
        }, 150);
      });
      sock.on('error', () => resolve());
    });
    // Give the proxy a beat to crash if it is going to.
    await new Promise((r) => setTimeout(r, 400));
    expect(proxyAlive()).toBe(true);
    // And it still serves after the reset:
    const res = await rawRequest(
      'GET http://after-reset.example/ HTTP/1.1\r\nHost: after-reset.example\r\n\r\n',
    );
    expect(res).toContain('403');
  });

  it('survives raw garbage bytes without dying', async () => {
    await rawRequest('\x00\x01garbage\r\n\r\n');
    await new Promise((r) => setTimeout(r, 200));
    expect(proxyAlive()).toBe(true);
  });
});

// http import is used to document intent only if extended; keep referenced.
void http;
