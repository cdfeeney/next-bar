import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * V8-4 criterion 5 — "APNs credentials are server-only: absent from the client
 * bundle and never logged."
 *
 * scripts/check-client-apns-bundle.mjs proves the BUNDLE half against the
 * built output. This file proves the two halves a bundle scan cannot see:
 *
 *   1. No log statement in the sender path can print a credential or a device
 *      token. A bundle grep is blind to that — the leak would be in the server
 *      log, not the chunk.
 *   2. No APNs variable is read under a NEXT_PUBLIC_ name and no client
 *      component imports the sender, which is what makes the bundle clean in
 *      the first place rather than by luck.
 */

const SRC = path.join(__dirname, '..');

const SERVER_FILES = [
  path.join(SRC, 'lib', 'apnsSender.ts'),
  path.join(SRC, 'lib', 'notificationOutbox.ts'),
  path.join(SRC, 'app', 'api', 'notifications', 'drain', 'route.ts'),
];

/** Identifiers that must never be inside a console call's argument list. */
const SECRET_IDENTIFIERS = [
  'privateKey',
  'providerToken',
  'deviceToken',
  'device.token',
  'serviceKey',
  'presented',
  'APNS_PRIVATE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NOTIFICATIONS_DRAIN_SECRET',
];

function consoleCalls(source: string): string[] {
  return [...source.matchAll(/console\.\w+\([\s\S]*?\);/g)].map((match) => match[0]);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('APNs credential hygiene (criterion 5)', () => {
  it('logs nothing that could contain a credential or a device token', () => {
    for (const file of SERVER_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const call of consoleCalls(source)) {
        for (const identifier of SECRET_IDENTIFIERS) {
          expect(
            call.includes(identifier),
            `${path.basename(file)} logs ${identifier}: ${call}`,
          ).toBe(false);
        }
      }
    }
  });

  it('reads every APNs variable from a non-public env name', () => {
    // A NEXT_PUBLIC_ prefix is the ONE thing that would let Next.js inline a
    // credential into the browser bundle. It must not exist anywhere in src/.
    for (const file of walk(SRC)) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/NEXT_PUBLIC_APNS/);
    }
  });

  it('is never imported by a client component', () => {
    // `use client` + an import of the sender is how a server-only module ends
    // up in a chunk. Nothing else in this suite would catch it before build.
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      const isClient = /^\s*['"]use client['"]/m.test(source);
      if (!isClient) continue;
      expect(source, `${path.basename(file)} is a client component`).not.toMatch(
        /from ['"]@\/lib\/apnsSender['"]|from ['"]\.\/apnsSender['"]/,
      );
      expect(source, `${path.basename(file)} is a client component`).not.toMatch(
        /from ['"]@\/lib\/notificationOutbox['"]|from ['"]\.\/notificationOutbox['"]/,
      );
    }
  });

  it('keeps the drain endpoint closed when its shared secret is unset', () => {
    // An unset secret is a missing answer, never permission. This asserts the
    // guard is written that way rather than defaulting to open.
    const route = readFileSync(SERVER_FILES[2], 'utf8');
    expect(route).toMatch(/if \(!secret \|\| !timingSafeEqual\(secret, presented\)\)/);
  });
});
