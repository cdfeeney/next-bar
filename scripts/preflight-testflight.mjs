#!/usr/bin/env node
/**
 * preflight-testflight.mjs — deterministic LOCAL pre-TestFlight verification
 * (g-39169b3b). One command, no network, no paid APIs, no mutation: every
 * check reads the working tree or runs local toolchain commands only.
 *
 * Usage:  node scripts/preflight-testflight.mjs [--quick]
 *   --quick  skip the two slow toolchain gates (typecheck, production build)
 *
 * Exit 0: all hard checks pass (known gaps are listed as WARN).
 * Exit 1: at least one hard FAIL.
 *
 * Design notes:
 * - Decoded 192/512 manifest icon dimensions are proven by the existing
 *   vitest/e2e suites (c77428d): the vitest half runs here; the e2e half
 *   needs a server and is deliberately out of scope for a no-network
 *   preflight — it runs with the normal Playwright matrix.
 * - The 1024×1024 App Store icon is decoded from PNG IHDR when present;
 *   while absent it is a WARN gap (known, tracked in the ADR §9.8).
 * - Env files are only pattern-TESTED; no env value is ever printed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const QUICK = process.argv.includes('--quick');

const results = [];
function record(status, name, detail = '') {
  results.push({ status, name, detail });
  const icon = status === 'PASS' ? 'ok  ' : status === 'WARN' ? 'WARN' : 'FAIL';
  console.log(`[${icon}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function run(name, cmd, args, timeoutMs) {
  try {
    execFileSync(cmd, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      shell: process.platform === 'win32',
    });
    record('PASS', name);
    return true;
  } catch (error) {
    const tail = String(error.stdout ?? '').split('\n').filter(Boolean).slice(-5).join(' | ');
    record('FAIL', name, tail || error.message.slice(0, 200));
    return false;
  }
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Minimal PNG IHDR reader: [width, height, colorType] or null. */
function pngHeader(absPath) {
  const buf = readFileSync(absPath);
  if (buf.length < 33 || buf.readUInt32BE(12) !== 0x49484452 /* IHDR */) return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
    // tRNS chunk would add transparency even to palette/truecolor images.
    hasTRNS: buf.includes(Buffer.from('tRNS')),
  };
}

// ---------------------------------------------------------------- 1+2. toolchain
if (QUICK) {
  record('WARN', 'typecheck + production build', 'skipped (--quick)');
} else {
  run('typecheck (tsc --noEmit)', 'npx', ['tsc', '--noEmit'], 300_000);
  run('production web build (npm run build)', 'npm', ['run', 'build'], 600_000);
}

// ------------------------------------------------- 3. manifest + icon entries
// The dedicated vitest file decodes the manifest object: name, start_url,
// display, and BOTH icon entries (192 + 512) — the exact defect class the
// 2026-08-02 readiness run caught.
run(
  'manifest correctness (vitest src/app/manifest.test.ts)',
  'npx',
  ['vitest', 'run', 'src/app/manifest.test.ts'],
  180_000,
);
{
  const iconSource = read('src/app/icon.tsx');
  const declares192 = /192/.test(iconSource);
  const declares512 = /512/.test(iconSource);
  if (declares192 && declares512 && /generateImageMetadata/.test(iconSource)) {
    record('PASS', 'icon route declares genuine 192 + 512 variants (decoded proof: e2e/manifest-icons.spec.ts)');
  } else {
    record('FAIL', 'icon route 192/512 declarations', 'src/app/icon.tsx no longer declares both sizes');
  }
}

// ------------------------------------------------------- 4. 1024 App Store icon
{
  const candidates = ['assets/appstore-icon-1024.png', 'public/appstore-icon-1024.png', 'assets/icon-1024.png'];
  const found = candidates.find((rel) => existsSync(path.join(ROOT, rel)));
  if (!found) {
    record('WARN', '1024×1024 App Store icon', 'not present (known gap — ADR §9.8; required before submission, not before internal preflight)');
  } else {
    const header = pngHeader(path.join(ROOT, found));
    if (!header) record('FAIL', '1024 icon decode', `${found} is not a valid PNG`);
    else if (header.width !== 1024 || header.height !== 1024) {
      record('FAIL', '1024 icon dimensions', `${found} is ${header.width}×${header.height}`);
    } else if (header.colorType === 4 || header.colorType === 6 || header.hasTRNS) {
      record('FAIL', '1024 icon alpha', `${found} carries an alpha channel/tRNS — Apple rejects transparency`);
    } else {
      record('PASS', `1024 App Store icon (${found}: 1024×1024, no alpha)`);
    }
  }
}

// --------------------------------------------------------- 5. legal/support routes
for (const [route, level] of [
  ['privacy', 'FAIL'],
  ['terms', 'FAIL'],
  ['support', 'WARN'],
]) {
  const exists = existsSync(path.join(ROOT, 'src/app', route, 'page.tsx'));
  if (exists) record('PASS', `/${route} route present`);
  else record(level, `/${route} route`, level === 'WARN' ? 'not built yet (metadata draft falls back to /install)' : 'MISSING — required by App Store listing');
}

// ------------------------------------------------------ 6. canonical identity
{
  // Any next-bar.app reference in runtime code must be one of the two known,
  // deliberate shapes: the hi@ mailto (pending the operator mailbox
  // decision) or a doc-comment explicitly calling the domain STALE.
  let bad = [];
  const files = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  for (const rel of files) {
    const content = readFileSync(path.join(ROOT, rel), 'utf8');
    if (!content.includes('next-bar.app')) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('next-bar.app')) continue;
      if (lines[i].includes('hi@next-bar.app')) continue;
      // Doc-comments calling the domain STALE wrap across lines — judge a
      // one-line neighborhood, not the single line.
      const window = lines.slice(Math.max(0, i - 1), i + 2).join(' ');
      if (/STALE/i.test(window)) continue;
      bad.push(`${rel}: ${lines[i].trim().slice(0, 80)}`);
    }
  }
  if (bad.length === 0) {
    record('PASS', 'canonical identity: no stray next-bar.app refs in src (mailtos pending operator decision are allowlisted)');
  } else {
    record('FAIL', 'stale next-bar.app references', bad.slice(0, 3).join(' | '));
  }
  if (existsSync(path.join(ROOT, 'src/lib/siteIdentity.test.ts'))) {
    run('siteIdentity resolution (vitest src/lib/siteIdentity.test.ts)', 'npx', ['vitest', 'run', 'src/lib/siteIdentity.test.ts'], 180_000);
  } else {
    record('WARN', 'siteIdentity unit tests', 'src/lib/siteIdentity.test.ts not found');
  }
}

// ------------------------------------------- 7. staging/production isolation
{
  const FORBIDDEN_PROD_REF = 'nuhqlvneokucxomguxhi';
  // COMMITTED surfaces: any hit is a hard failure — this is how the
  // production ref would leak into staging/preview builds.
  let leaked = [];
  for (const rel of ['.env.example', '.env.staging', '.env.production']) {
    const abs = path.join(ROOT, rel);
    if (existsSync(abs) && readFileSync(abs, 'utf8').includes(FORBIDDEN_PROD_REF)) leaked.push(rel);
  }
  let srcHits = '';
  try {
    srcHits = execFileSync('git', ['grep', '-l', FORBIDDEN_PROD_REF, '--', 'src', 'scripts'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // git grep exits 1 when nothing matches — that is the good outcome.
  }
  if (srcHits) leaked.push(...srcHits.split('\n'));
  if (leaked.length === 0) record('PASS', 'staging/production isolation: production project ref absent from committed files and code');
  else record('FAIL', 'PRODUCTION REF LEAK', `found in: ${leaked.join(', ')} (values not printed)`);

  // LOCAL, uncommitted .env.local: the operator's machine historically
  // points local tooling at production (the same file that carries B1's
  // invalid service-role key). Not this script's to change — but it is the
  // reason `npm run db:migrate` on this machine would target PRODUCTION, so
  // it must stay visible on every preflight, as a warning, until the
  // operator separates local dev from production.
  const envLocal = path.join(ROOT, '.env.local');
  if (existsSync(envLocal) && readFileSync(envLocal, 'utf8').includes(FORBIDDEN_PROD_REF)) {
    record('WARN', '.env.local carries the PRODUCTION project ref', 'known legacy posture — local db:migrate would hit production; never copy into staging/Vercel config (value not printed)');
  } else {
    record('PASS', '.env.local free of the production project ref');
  }
}

// --------------------------------------------------------- 8. analytics stays dark
{
  const pkg = JSON.parse(read('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const posthogDeps = Object.keys(deps).filter((d) => /posthog/i.test(d));
  if (posthogDeps.length > 0) {
    record('FAIL', 'analytics SDK present', posthogDeps.join(', '));
  } else {
    record('PASS', 'no analytics SDK dependency');
  }
  let enabled = [];
  for (const rel of ['.env.example', '.env.local']) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;
    for (const line of readFileSync(abs, 'utf8').split('\n')) {
      if (/^\s*(NEXT_PUBLIC_ANALYTICS|NEXT_PUBLIC_POSTHOG_ENABLED)\s*=\s*1\s*$/.test(line)) {
        enabled.push(`${rel}: ${line.split('=')[0].trim()}`);
      }
    }
  }
  if (enabled.length === 0) record('PASS', 'analytics flags dark in env files (names checked, values unprinted)');
  else record('FAIL', 'analytics enabled in env file', enabled.join(', '));
}

// -------------------------------------------------------- 9. committed secrets
// Reuse the repository's maintained scanner (scripts/secret-scan.mjs,
// production-readiness goal 10) rather than a duplicate pattern list that
// would drift from it.
run('committed-secret scan (scripts/secret-scan.mjs)', 'node', ['scripts/secret-scan.mjs'], 120_000);

// ------------------------------------------- 10. native config (when present)
{
  const configs = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json'].filter((rel) =>
    existsSync(path.join(ROOT, rel)),
  );
  if (configs.length === 0) {
    record('PASS', 'native config: none in this worktree', 'origin/main ebbcd55 wrapper (server.url design) is adjudicated in the ADR — not a release config');
  } else {
    for (const rel of configs) {
      const content = read(rel);
      const serverUrl = /server\s*:\s*{[^}]*url\s*:/s.test(content);
      const appIdMatch = content.match(/appId\s*:\s*['"]([^'"]+)['"]/);
      if (serverUrl) {
        record('FAIL', `native config ${rel}`, 'sets server.url — a live-reload/dev feature, "not intended for use in production" (Capacitor docs); forbidden as a release design');
      } else {
        record('PASS', `native config ${rel}: no server.url (locally packaged assets)`);
      }
      if (!appIdMatch || /example|placeholder|com\.company/.test(appIdMatch[1])) {
        record('FAIL', `native config ${rel} appId`, 'missing or placeholder');
      } else {
        record('PASS', `native config appId present (${appIdMatch[1]}) — operator must have explicitly approved it`);
      }
    }
  }
}

// ------------------------------------------------------------------- summary
const fails = results.filter((r) => r.status === 'FAIL');
const warns = results.filter((r) => r.status === 'WARN');
console.log(`\npreflight-testflight: ${results.length - fails.length - warns.length} pass, ${warns.length} warn (known gaps), ${fails.length} fail`);
process.exit(fails.length === 0 ? 0 : 1);
