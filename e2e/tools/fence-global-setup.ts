/**
 * Playwright globalSetup: guarantee the network fence is up AND authentic
 * before any spec runs.
 *
 * Failure modes closed (santa rounds 2–4):
 *  - nobody started the fence → spawn it (detached BY DESIGN: it outlives
 *    the run so back-to-back runs reuse it; it is stateless and loopback-only,
 *    so leaving it up is safe — kill port 39555 to retire it);
 *  - a STALE fence from before a behavior change → the banner carries
 *    FENCE_CONTRACT_VERSION, so an old proxy fails the probe loudly instead
 *    of silently masking the edit;
 *  - some OTHER process squats the port → the probe demands the fence's own
 *    403 status line AND versioned banner; anything else aborts the run;
 *  - a REUSED dev server started without the proxy env → the /api/health
 *    canary aborts on affirmative live egress (supabase:'ok').
 */

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';

// Single source of truth: the proxy module exports its own contract.
// Importing does NOT start the server (main-module guard in the .mjs).
// Loaded via dynamic import inside the setup function: Playwright transpiles
// this file to CJS, and a static `import` of an ESM .mjs sibling fails there.
async function loadContract(): Promise<{ BANNER: string; PORT: number }> {
  const mod = (await import(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — untyped .mjs sibling
    './fence-proxy.mjs'
  )) as { BANNER: string; DEFAULT_PORT: number };
  // Deliberately IGNORES the FENCE_PORT env var: playwright.config.ts pins
  // its browser/server proxy address to the default port, so honoring
  // FENCE_PORT here would authenticate a listener the actual test traffic
  // never uses (round-4 Codex HIGH). FENCE_PORT is a unit-test-only knob.
  return { BANNER: mod.BANNER, PORT: mod.DEFAULT_PORT };
}

type ProbeResult = 'fence' | 'other' | 'none';

function probe(PORT: number, BANNER: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const sock = createConnection(PORT, '127.0.0.1');
    let data = '';
    let connected = false;
    let settled = false;
    const done = (v: ProbeResult) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    const classify = (): ProbeResult => {
      // Authenticity = the fence's own exact 403 status line AND its
      // versioned banner (trailing space so 'HTTP/1.1 4030' can't prefix-
      // match). Threat model: accidental squatters and stale fences on
      // loopback — a deliberate local adversary replaying the banner is out
      // of scope. A connected socket that answered anything else — or
      // nothing — is an impostor ('other'), NOT absence: spawning over it
      // would just EADDRINUSE.
      if (data.startsWith('HTTP/1.1 403 ') && data.includes(BANNER)) return 'fence';
      return connected ? 'other' : 'none';
    };
    sock.on('connect', () => {
      connected = true;
      sock.write(
        'GET http://fence-canary.invalid/ HTTP/1.1\r\nHost: fence-canary.invalid\r\n\r\n',
      );
    });
    sock.on('data', (c) => {
      data += c.toString();
      if (classify() === 'fence') done('fence');
    });
    sock.on('close', () => done(classify()));
    sock.on('error', () => done(connected ? 'other' : 'none'));
    setTimeout(() => done(classify()), 3000);
  });
}

/**
 * Server-side canary (santa round-2, Fable HIGH): with reuseExistingServer,
 * a dev server started WITHOUT the proxy env is silently unfenced —
 * webServer.env is never applied to a reused server. If a server already
 * answers on :3000, hit /api/health: its handler performs a SERVER-SIDE fetch
 * to the Supabase auth health URL. supabase:'ok' is affirmative proof that a
 * live call left the box → abort. 'unreachable'/'unconfigured' pass — that IS
 * the fenced outcome (indistinguishable from Supabase-down, which also means
 * no egress). KNOWN RESIDUAL: /api/health caches its probe ~30s, so a server
 * unfenced within the last cache window can serve a stale non-'ok' — this
 * canary detects affirmative egress, it is not a fencedness proof.
 */
async function assertReusedServerFenced(attempt = 0): Promise<void> {
  let res: Response;
  try {
    res = await fetch('http://localhost:3000/api/health', {
      cache: 'no-store',
      redirect: 'manual', // a redirecting impostor must not steer this fetch
      // Generous: a reused dev server may cold-compile /api/health.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    // ONLY connection-refused means "no server" (Playwright will spawn one
    // WITH the env). A timeout/reset from a LIVE server is indeterminate and
    // must fail CLOSED, not silently pass (round-4 Codex MEDIUM) — but a
    // PREVIOUS run's webServer mid-teardown can also reset here, so one
    // short retry distinguishes "dying" (→ refused next probe) from
    // genuinely wedged (→ abort).
    const code = (e as { cause?: { code?: string } })?.cause?.code;
    if (code === 'ECONNREFUSED') return;
    // Up to 3 spaced retries (~6s total) — same rationale as the spawn
    // readiness loop above: teardown of a previous run's webServer under
    // Windows/AV load can exceed a single 2s window. A genuinely wedged
    // server still exhausts the retries and aborts fail-closed.
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000));
      return assertReusedServerFenced(attempt + 1);
    }
    throw new Error(
      `reused dev server on :3000 did not answer the fence canary (${code ?? String(e)}) — ` +
        'cannot verify it is fenced. Kill it and let Playwright spawn the fenced one.',
    );
  }
  let body: { supabase?: string };
  try {
    body = (await res.json()) as { supabase?: string };
  } catch (e) {
    // Headers arrived but the body stalled, reset, or wasn't JSON — a real
    // dev server always answers /api/health with JSON, so this is a wedged
    // or impostor server: fail CLOSED (round-5 Codex MEDIUM — fetch resolves
    // at headers, so body errors must not be swallowed).
    throw new Error(
      `reused server on :3000 answered the canary with an unreadable body (${String(e)}) — ` +
        'cannot verify it is fenced. Kill it and let Playwright spawn the fenced one.',
    );
  }
  if (body.supabase === 'ok') {
    throw new Error(
      'reused dev server on :3000 reached live Supabase server-side — it ' +
        'is NOT fenced (started without the proxy env). Kill it and let ' +
        'Playwright spawn the fenced one.',
    );
  }
}

export default async function fenceGlobalSetup(): Promise<void> {
  const { BANNER, PORT } = await loadContract();
  let state = await probe(PORT, BANNER);
  if (state === 'none') {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'fence-proxy.mjs')],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        // Pin the child to the contract port even if the parent env carries
        // FENCE_PORT (unit-test knob) — the config's proxy address is fixed.
        env: { ...process.env, FENCE_PORT: String(PORT) },
      },
    );
    // A spawn failure (ENOENT etc.) must abort via the probe loop below, not
    // crash globalSetup with an unhandled 'error' event.
    child.on('error', () => {});
    child.unref();
    // Readiness is a retry loop, not one fixed sleep: Windows AV scanning of
    // a fresh node.exe regularly exceeds a single 600ms window.
    for (let i = 0; i < 10 && state === 'none'; i++) {
      await new Promise((r) => setTimeout(r, 300));
      state = await probe(PORT, BANNER);
    }
  }
  if (state !== 'fence') {
    throw new Error(
      `network fence not authentic on 127.0.0.1:${PORT} (probe: ${state}) — ` +
        'refusing to run browser tests. ' +
        (state === 'other'
          ? 'Something else (or a STALE fence from before a contract change) holds the port — kill it. '
          : 'The fence failed to start — check `node e2e/tools/fence-proxy.mjs` manually. ') +
        'Expected banner: ' +
        BANNER,
    );
  }
  await assertReusedServerFenced();
}
