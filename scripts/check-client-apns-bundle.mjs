import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * V8-4 criteria 5 and 11 — prove against the BUILT output that no APNs
 * credential and no VAPID key reaches the browser.
 *
 * Same shape as check-client-catalog-bundle.mjs: walk the emitted client
 * chunks and look for markers that must not be there. Reasoning about which
 * imports are server-only is not evidence; reading the shipped JavaScript is.
 *
 * Run after `npm run build`:  node scripts/check-client-apns-bundle.mjs
 */

const CHUNKS = '.next/static/chunks';

if (!existsSync(CHUNKS)) {
  throw new Error(
    `apns bundle check: ${CHUNKS} not found — run \`npm run build\` first. ` +
      'A missing build is an unrun check, never a passing one.',
  );
}

const files = [];
const visit = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) visit(path);
    else if (name.endsWith('.js')) files.push(path);
  }
};
visit(CHUNKS);

if (files.length === 0) {
  throw new Error('apns bundle check: no client chunks found — the build produced nothing to check.');
}

/**
 * Two kinds of marker.
 *
 * 1. LITERAL VALUES from the current environment. This is the real check: if a
 *    credential is set at build time and Next.js inlined it, the value itself
 *    is in the chunk. Only checked for variables that are actually set.
 * 2. STRUCTURAL markers that must never appear whatever the environment: a PEM
 *    private-key header, the env-var names themselves (their presence in
 *    client code means someone read them from a client component), and
 *    anything VAPID — web push must stay dark.
 */
const secretEnvVars = [
  'APNS_PRIVATE_KEY',
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'NOTIFICATIONS_DRAIN_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const valueMarkers = secretEnvVars
  .map((name) => ({ name: `value of ${name}`, needle: process.env[name] }))
  // Short values would produce nonsense matches; a real credential is long.
  .filter((marker) => typeof marker.needle === 'string' && marker.needle.length >= 16);

const structuralMarkers = [
  ...secretEnvVars.map((name) => ({ name: `env name ${name}`, needle: name })),
  { name: 'PEM private key header', needle: '-----BEGIN PRIVATE KEY-----' },
  { name: 'PEM EC private key header', needle: '-----BEGIN EC PRIVATE KEY-----' },
  { name: 'APNs provider host', needle: 'api.sandbox.push.apple.com' },
  { name: 'APNs production host', needle: 'api.push.apple.com' },
  { name: 'VAPID key (web push must stay dark)', needle: 'VAPID' },
];

const markers = [...valueMarkers, ...structuralMarkers];

const leaked = [];
for (const path of files) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (content.includes(marker.needle)) leaked.push({ path, marker: marker.name });
  }
}

// A NEXT_PUBLIC_APNS_* variable would defeat the whole model by design, so
// catch it at its source rather than waiting for it to show up in a chunk.
const publicApns = Object.keys(process.env).filter((key) =>
  key.startsWith('NEXT_PUBLIC_APNS'),
);
if (publicApns.length > 0) {
  leaked.push({ path: '(environment)', marker: `NEXT_PUBLIC_ APNs vars: ${publicApns.join(', ')}` });
}

console.log(
  JSON.stringify({
    client_js_files: files.length,
    value_markers_checked: valueMarkers.length,
    structural_markers_checked: structuralMarkers.length,
    leaked,
  }),
);

if (leaked.length > 0) process.exit(1);
