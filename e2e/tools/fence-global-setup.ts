/**
 * Playwright globalSetup: guarantee the network fence is up AND authentic
 * before any spec runs.
 *
 * Two failure modes this closes (santa round-2, Codex):
 *  - nobody started the fence → non-loopback requests would fail closed but
 *    unlogged, and a later accidental removal of use.proxy would fall open;
 *  - some OTHER process squats 127.0.0.1:39555 → it could be a real relay,
 *    silently forwarding "fenced" traffic outward. We probe with an
 *    absolute-form request to a canary host and demand the fence's own 403
 *    banner; anything else aborts the run.
 */

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';

const PORT = 39555;
const BANNER = 'fenced: non-loopback application traffic is refused during tests';

function probe(): Promise<'fence' | 'other' | 'none'> {
  return new Promise((resolve) => {
    const sock = createConnection(PORT, '127.0.0.1');
    let data = '';
    const done = (v: 'fence' | 'other' | 'none') => {
      sock.destroy();
      resolve(v);
    };
    sock.on('connect', () =>
      sock.write(
        'GET http://fence-canary.invalid/ HTTP/1.1\r\nHost: fence-canary.invalid\r\n\r\n',
      ),
    );
    sock.on('data', (c) => {
      data += c.toString();
      if (data.includes(BANNER)) done('fence');
      else if (data.length > 4096 || data.includes('\r\n\r\n')) {
        if (!data.includes(BANNER)) {
          // Wait a beat for the body; some stacks split header/body packets.
          setTimeout(() => done(data.includes(BANNER) ? 'fence' : 'other'), 250);
        }
      }
    });
    sock.on('error', () => done('none'));
    setTimeout(() => done(data.includes(BANNER) ? 'fence' : data ? 'other' : 'none'), 3000);
  });
}

/**
 * Server-side canary (santa round-2, Fable HIGH): with reuseExistingServer,
 * a dev server started WITHOUT the proxy env is silently unfenced —
 * webServer.env is never applied to a reused server. If a server already
 * answers on :3000, hit /api/health: its handler performs a SERVER-SIDE fetch
 * to the Supabase auth health URL. supabase:'ok' is affirmative proof that a
 * live call left the box → abort. 'unreachable'/'unconfigured' pass (fenced,
 * dark, or Supabase itself down — no egress either way). This proves
 * non-egress for the supabase path specifically; it is a canary, not a full
 * server-side guarantee.
 */
async function assertReusedServerFenced(): Promise<void> {
  let res: Response;
  try {
    res = await fetch('http://localhost:3000/api/health', { cache: 'no-store' });
  } catch {
    return; // No server running — Playwright will spawn one WITH the env.
  }
  try {
    const body = (await res.json()) as { supabase?: string };
    if (body.supabase === 'ok') {
      throw new Error(
        'reused dev server on :3000 reached live Supabase server-side — it ' +
          'is NOT fenced (started without the proxy env). Kill it and let ' +
          'Playwright spawn the fenced one.',
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('NOT fenced')) throw e;
    // Non-JSON health response: leave it to the suite to fail honestly.
  }
}

export default async function fenceGlobalSetup(): Promise<void> {
  let state = await probe();
  if (state === 'none') {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'fence-proxy.mjs')],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    // Give it a moment, then re-probe.
    await new Promise((r) => setTimeout(r, 600));
    state = await probe();
  }
  if (state !== 'fence') {
    throw new Error(
      `network fence not authentic on 127.0.0.1:${PORT} (probe: ${state}) — ` +
        'refusing to run browser tests. Kill whatever holds the port or start ' +
        'e2e/tools/fence-proxy.mjs manually.',
    );
  }
  await assertReusedServerFenced();
}
