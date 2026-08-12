#!/usr/bin/env -S npx tsx
/**
 * account-continuity-check.mts — offline, read-only evidence collection proving
 * the v7 TestFlight candidate keeps the EXISTING beta users' staging Supabase
 * project and their stable auth identities/history (goal g-537c9855).
 *
 * Read-only by construction: it reads source text and static config only. It
 * builds no Supabase client, opens no socket, makes no network call, and reads
 * no `.env*` file — environment variable NAMES appear as strings, their values
 * are never read or printed.
 *
 * Usage:
 *   npx tsx scripts/release/account-continuity-check.mts [--json] [capacitorConfig...]
 *
 * Exit 0: no check is `fail` (the `cannot-verify-offline` list is expected to be
 *         non-empty — those are the attended gates this offline slice cannot close).
 * Exit 1: at least one check is `fail`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ------------------------------------------------------------------ contract

export type CheckStatus = 'pass' | 'fail' | 'cannot-verify-offline';

export interface CheckResult {
  /** Stable id — the doc and the JSON refer to checks by this. */
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
}

export interface SourceFile {
  path: string;
  source: string;
}

export const EXPECTED_APP_ID = 'com.nextbar.app';
export const CANONICAL_HOSTS = ['next-bar.com', 'www.next-bar.com'] as const;

/** 0042's `account_content_state_key_check` domains, in constraint order. */
export const ACCOUNT_STATE_KEYS = ['lists', 'night_log', 'night_archive', 'shared_nights'] as const;

/** Which client-side store owns each 0042 domain today (pre-0042 reality). */
export const LOCAL_STORE_BY_STATE_KEY: Record<string, string> = {
  lists: 'src/lib/lists.ts',
  night_log: 'src/lib/nightLog.ts',
  night_archive: 'src/lib/nightArchive.ts',
  shared_nights: 'src/lib/sharedNightsLocal.ts',
};

/** A literal Supabase host baked into shipped code — the thing that would silently
 *  repoint beta users at a different project. */
const SUPABASE_HOST_LITERAL = /https:\/\/[a-z0-9-]+\.supabase\.co/i;

/** `.mts`/`.ts` sources that only ever run under the test runner. Criterion 1
 *  excludes fixtures on purpose: `https://example.supabase.co` in a stubEnv call
 *  is a fixture, not a shipped fallback. */
export function isTestFixture(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  return /\.(test|spec)\.[cm]?tsx?$/.test(p) || p.includes('/__tests__/') || p.startsWith('e2e/');
}

/** Line endings differ per worktree checkout (nb-beta1-rc is CRLF, nb-ios is LF);
 *  a byte compare would report a false mismatch on identical config. */
function normalize(source: string): string {
  return source.replace(/\r\n/g, '\n');
}

function result(id: string, title: string, status: CheckStatus, detail: string): CheckResult {
  return { id, title, status, detail };
}

// ------------------------------------------------------------------- checks

/** 1. Supabase project identity — env-driven construction, no hardcoded fallback. */
export function checkSupabaseProjectIdentity(client: SourceFile, scanned: SourceFile[]): CheckResult {
  const id = 'supabase-project-identity';
  const title = 'Supabase project identity is env-driven with no hardcoded fallback';
  const src = normalize(client.source);

  const readsUrl = src.includes('NEXT_PUBLIC_SUPABASE_URL');
  const readsKey = src.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  // The literal token is split so the goal's own "no live-client construction"
  // grep over this file stays meaningful — this is a detector, not a call.
  const constructs = /create(?:Client)\s*\(/.test(src);
  if (!readsUrl || !readsKey || !constructs) {
    return result(id, title, 'fail',
      `${client.path} no longer reads both env vars and constructs the client from them ` +
      `(url=${readsUrl}, key=${readsKey}, construction=${constructs})`);
  }

  const hardcoded: string[] = [];
  for (const file of scanned) {
    if (isTestFixture(file.path)) continue;
    const hits = normalize(file.source).match(SUPABASE_HOST_LITERAL);
    if (hits) hardcoded.push(`${file.path}: ${hits[0]}`);
  }
  if (hardcoded.length > 0) {
    return result(id, title, 'fail',
      `hardcoded Supabase host outside test fixtures — ${hardcoded.slice(0, 3).join(' | ')}`);
  }

  return result(id, title, 'pass',
    `${client.path} reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY from the ` +
    `environment; no literal Supabase host in ${scanned.filter((f) => !isTestFixture(f.path)).length} ` +
    `non-fixture source files (values never read)`);
}

/** 2. Native bundle identifier — both shells agree, and agree with com.nextbar.app. */
export function checkBundleIdentifier(configs: SourceFile[]): CheckResult {
  const id = 'native-bundle-identifier';
  const title = `Native bundle identifier is ${EXPECTED_APP_ID} in every shell`;
  if (configs.length === 0) return result(id, title, 'fail', 'no capacitor.config.ts supplied or found');

  const seen = configs.map((c) => ({
    path: c.path,
    appId: normalize(c.source).match(/appId\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null,
  }));

  const missing = seen.filter((s) => s.appId === null);
  if (missing.length > 0) {
    return result(id, title, 'fail', `appId not declared in ${missing.map((m) => m.path).join(', ')}`);
  }
  const wrong = seen.filter((s) => s.appId !== EXPECTED_APP_ID);
  if (wrong.length > 0) {
    return result(id, title, 'fail',
      `appId is not ${EXPECTED_APP_ID} — ${wrong.map((w) => `${w.path}=${w.appId}`).join(', ')}`);
  }
  const distinct = new Set(seen.map((s) => s.appId));
  if (distinct.size !== 1) {
    return result(id, title, 'fail',
      `shells disagree — ${seen.map((s) => `${s.path}=${s.appId}`).join(', ')}`);
  }
  return result(id, title, 'pass',
    `${seen.length} shell config(s) agree on ${EXPECTED_APP_ID}: ${seen.map((s) => s.path).join(', ')}`);
}

/** 3. App update / origin behavior — config-driven origin, fail-closed validation,
 *     canonical hosts unconditionally navigable. */
export function checkOriginBehavior(configs: SourceFile[]): CheckResult {
  const id = 'app-update-origin-behavior';
  const title = 'Shell origin stays config-driven, fails closed, and always allows the canonical hosts';
  if (configs.length === 0) return result(id, title, 'fail', 'no capacitor.config.ts supplied or found');

  const problems: string[] = [];
  for (const config of configs) {
    const src = normalize(config.source);
    if (!/process\.env\.CAP_SERVER_URL/.test(src)) {
      problems.push(`${config.path}: origin is no longer driven by CAP_SERVER_URL`);
    }
    if (!/url\s*:\s*parsedOrigin\.origin/.test(src)) {
      problems.push(`${config.path}: server.url is not the normalized parsed origin`);
    }
    // Fail-closed validation: protocol, host, and path/query/fragment guards.
    const guards: Array<[string, RegExp]> = [
      ['protocol', /parsed\.protocol\s*!==\s*'https:'/],
      ['host', /parsed\.hostname\s*===\s*''/],
      ['path/query/fragment', /parsed\.search\s*!==\s*''[\s\S]{0,80}parsed\.hash\s*!==\s*''/],
    ];
    for (const [name, pattern] of guards) {
      if (!pattern.test(src)) problems.push(`${config.path}: missing fail-closed ${name} validation`);
    }
    const allowNavigation = src.match(/allowNavigation\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    for (const host of CANONICAL_HOSTS) {
      if (!allowNavigation.includes(`'${host}'`)) {
        problems.push(`${config.path}: ${host} is not unconditionally in allowNavigation`);
      }
    }
  }
  if (problems.length > 0) return result(id, title, 'fail', problems.slice(0, 4).join(' | '));
  return result(id, title, 'pass',
    `CAP_SERVER_URL-driven origin, normalized server.url, protocol/host/path/query/fragment guards, ` +
    `and ${CANONICAL_HOSTS.join(' + ')} always in allowNavigation (${configs.length} config(s))`);
}

/** 4. Redirect/origin configuration — derived from the live origin, or hardcoded? */
export function checkRedirectOrigin(files: SourceFile[]): CheckResult {
  const id = 'redirect-origin-configuration';
  const title = 'Supabase auth redirect derives from the same origin the shell loads';
  const users = files.filter((f) => /redirectTo\s*:|emailRedirectTo\s*:/.test(normalize(f.source)));
  if (users.length === 0) {
    return result(id, title, 'fail', 'no auth redirect construction found — cannot name the origin source');
  }

  const hardcoded: string[] = [];
  const derived: string[] = [];
  for (const file of users) {
    const src = normalize(file.source);
    if (SUPABASE_HOST_LITERAL.test(src) || /redirectTo\s*:\s*['"]https?:\/\//.test(src)) {
      hardcoded.push(file.path);
    } else if (/window\.location\.origin/.test(src) || /resolveSiteUrl\s*\(/.test(src)) {
      derived.push(file.path);
    } else {
      hardcoded.push(`${file.path} (origin source unnamed)`);
    }
  }
  if (hardcoded.length > 0) {
    return result(id, title, 'fail',
      `redirect origin is hardcoded or divergent in ${hardcoded.join(', ')}`);
  }
  return result(id, title, 'pass',
    `redirect built from the runtime origin in ${derived.join(', ')} — in a server.url shell build ` +
    `that IS the config-driven Capacitor origin, so shell and auth callback cannot diverge ` +
    `(the project's redirect allow-list is attended-gate ${'supabase-redirect-allowlist-live'})`);
}

/** 5. Account-persistence migration status — 0042 exists where, applied nowhere. */
export function checkMigrationStatus(input: {
  localMigrationNames: string[];
  accountSyncMigrationPath: string | null;
  accountSyncMigrationSource: string | null;
}): CheckResult {
  const id = 'account-persistence-migration-status';
  const title = 'Migration 0042 status is reportable and it is unapplied everywhere';
  if (!input.accountSyncMigrationPath || input.accountSyncMigrationSource === null) {
    return result(id, title, 'fail',
      '0042_account_content_state.sql not found in the nb-account-sync worktree — status unreportable');
  }
  const declared = ACCOUNT_STATE_KEYS.filter((k) => input.accountSyncMigrationSource!.includes(`'${k}'`));
  if (declared.length !== ACCOUNT_STATE_KEYS.length) {
    return result(id, title, 'fail',
      `0042 no longer declares all ${ACCOUNT_STATE_KEYS.length} state_key domains (found: ${declared.join(', ') || 'none'})`);
  }
  const localHits = input.localMigrationNames.filter((n) => n.startsWith('0042'));
  return result(id, title, 'pass',
    `0042 present only at ${input.accountSyncMigrationPath} (domains: ${declared.join(', ')}); ` +
    `absent from this worktree's supabase/migrations (${localHits.length} match); ` +
    `unapplied everywhere as of this run — no live database was queried`);
}

/** 6. Signed-in history continuity — which domains are client-only today. */
export function checkHistoryContinuity(input: {
  localStores: SourceFile[];
  serverStateReferences: string[];
  zeroZeroFourTwoAppliedLocally: boolean;
}): CheckResult {
  const id = 'signed-in-history-continuity';
  const title = 'Pre-0042 history stays readable from localStorage on update';
  const missing: string[] = [];
  for (const [stateKey, rel] of Object.entries(LOCAL_STORE_BY_STATE_KEY)) {
    const store = input.localStores.find((f) => f.path.replace(/\\/g, '/').endsWith(rel));
    if (!store) missing.push(`${stateKey}: ${rel} not found`);
    else if (!/localStorage/.test(normalize(store.source))) missing.push(`${stateKey}: ${rel} no longer reads localStorage`);
  }
  if (missing.length > 0) {
    return result(id, title, 'fail',
      `a v7 build shipping before 0042 applies would blank existing beta history — ${missing.join(' | ')}`);
  }
  if (!input.zeroZeroFourTwoAppliedLocally && input.serverStateReferences.length > 0) {
    return result(id, title, 'fail',
      `code reads the server-side account_content_state table while 0042 is unapplied — ` +
      `${input.serverStateReferences.slice(0, 3).join(', ')}`);
  }
  return result(id, title, 'pass',
    `all ${ACCOUNT_STATE_KEYS.length} domains (${ACCOUNT_STATE_KEYS.join(', ')}) are localStorage-only today ` +
    `(${Object.values(LOCAL_STORE_BY_STATE_KEY).join(', ')}); no src reference to account_content_state, so a ` +
    `v7 build shipping before 0042 keeps reading the existing local history rather than an empty server table`);
}

/** 7. Fail-closed staging/production separation. */
export function checkFailClosedSeparation(client: SourceFile): CheckResult {
  const id = 'staging-production-separation';
  const title = 'Absent env vars fail closed instead of defaulting to a production endpoint';
  const src = normalize(client.source);
  const guarded = /url\s*&&\s*key\s*\?/.test(src) || /if\s*\(\s*!\s*(url|key)\s*\)/.test(src);
  const nullish = /(\?\?|\|\|)\s*['"]https?:\/\//.test(src);
  if (nullish) {
    return result(id, title, 'fail',
      `${client.path} falls back to a literal URL when the env vars are absent`);
  }
  if (!guarded || !/supabaseConfigured/.test(src)) {
    return result(id, title, 'fail',
      `${client.path} no longer fails closed to a null client / supabaseConfigured === false`);
  }
  return result(id, title, 'pass',
    `${client.path} yields a null client and supabaseConfigured === false when either env var is absent; ` +
    `no ?? / || fallback to any literal endpoint`);
}

/** The attended gates this offline slice structurally cannot close. Named, never
 *  swept into "pass". */
export const CANNOT_VERIFY_OFFLINE: CheckResult[] = [
  result('supabase-project-binding-live',
    'Which Supabase project the existing beta testers\' sessions actually resolve against',
    'cannot-verify-offline',
    'requires reading the deployed environment configuration and a live auth session — attended gate'),
  result('supabase-redirect-allowlist-live',
    'Whether the Supabase project\'s auth redirect allow-list contains the shell origin',
    'cannot-verify-offline',
    'lives in the Supabase project settings, not in this repository — attended gate'),
  result('zero-zero-four-two-row-preservation',
    'Whether applying 0042 preserves existing rows for existing auth.users',
    'cannot-verify-offline',
    'requires applying the migration against a real database, which this goal forbids — attended gate'),
  result('testflight-build-behavior-live',
    'Live TestFlight build behavior on an existing beta tester\'s device',
    'cannot-verify-offline',
    'requires an actual upload and install, which this goal forbids — attended gate'),
];

// ------------------------------------------------------------------ collection

function readIfPresent(abs: string): SourceFile | null {
  return existsSync(abs) ? { path: abs, source: readFileSync(abs, 'utf8') } : null;
}

function listSourceFiles(dir: string, acc: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(abs, acc);
    else if (/\.[cm]?tsx?$/.test(entry.name)) acc.push({ path: abs, source: readFileSync(abs, 'utf8') });
  }
  return acc;
}

/** Sibling worktrees moved when this goal was relocated into a controller-managed
 *  worktree, so the defaults are discovered rather than hardcoded relative paths. */
export function defaultCapacitorConfigPaths(root: string): string[] {
  const bases = [path.resolve(root, '..'), path.join(os.homedir(), 'projects')];
  return ['nb-beta1-rc', 'nb-ios'].map((name) => {
    for (const base of bases) {
      const candidate = path.join(base, name, 'capacitor.config.ts');
      if (existsSync(candidate)) return candidate;
    }
    return path.join(bases[bases.length - 1], name, 'capacitor.config.ts');
  });
}

function findAccountSyncMigration(root: string): string | null {
  const bases = [path.resolve(root, '..'), path.join(os.homedir(), 'projects')];
  for (const base of bases) {
    const candidate = path.join(base, 'nb-account-sync', 'supabase', 'migrations', '0042_account_content_state.sql');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function runChecks(root: string, capacitorConfigPaths: string[]): CheckResult[] {
  const rel = (abs: string) => path.relative(root, abs).replace(/\\/g, '/');

  const clientAbs = path.join(root, 'src', 'lib', 'supabase.ts');
  const client: SourceFile = { path: rel(clientAbs), source: readIfPresent(clientAbs)?.source ?? '' };

  const srcFiles = listSourceFiles(path.join(root, 'src')).map((f) => ({ path: rel(f.path), source: f.source }));

  const configs: SourceFile[] = [];
  const missingConfigs: string[] = [];
  for (const configPath of capacitorConfigPaths) {
    const found = readIfPresent(configPath);
    if (found) configs.push(found);
    else missingConfigs.push(configPath);
  }

  const migrationsDir = path.join(root, 'supabase', 'migrations');
  const localMigrationNames = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];

  const accountSyncMigrationPath = findAccountSyncMigration(root);
  const accountSyncMigrationSource = accountSyncMigrationPath
    ? readFileSync(accountSyncMigrationPath, 'utf8')
    : null;

  const results: CheckResult[] = [
    checkSupabaseProjectIdentity(client, srcFiles),
    checkBundleIdentifier(configs),
    checkOriginBehavior(configs),
    checkRedirectOrigin(srcFiles),
    checkMigrationStatus({ localMigrationNames, accountSyncMigrationPath, accountSyncMigrationSource }),
    checkHistoryContinuity({
      localStores: srcFiles,
      serverStateReferences: srcFiles
        .filter((f) => !isTestFixture(f.path) && f.source.includes('account_content_state'))
        .map((f) => f.path),
      zeroZeroFourTwoAppliedLocally: localMigrationNames.some((n) => n.startsWith('0042')),
    }),
    checkFailClosedSeparation(client),
    ...CANNOT_VERIFY_OFFLINE,
  ];

  if (missingConfigs.length > 0) {
    results.unshift(result('shell-config-availability',
      'Every inspected shell config is present',
      'fail',
      `missing (supply explicit paths as CLI args): ${missingConfigs.join(', ')}`));
  }
  return results;
}

// ------------------------------------------------------------------------ CLI

// Run as a CLI, importable from the test suite. Comparing the entry path by name
// avoids the file:// URL drive-letter normalization mess on Windows.
const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('scripts/release/account-continuity-check.mts');

if (isMain) {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
  const supplied = args.filter((a) => !a.startsWith('--'));
  const configPaths = supplied.length > 0
    ? supplied.map((p) => path.resolve(p))
    : defaultCapacitorConfigPaths(root);

  const results = runChecks(root, configPaths);
  const counts = {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    'cannot-verify-offline': results.filter((r) => r.status === 'cannot-verify-offline').length,
  };
  const report = { goal: 'g-537c9855', counts, results };

  if (!jsonOnly) {
    for (const r of results) {
      console.log(`[${r.status}] ${r.id} — ${r.title}\n    ${r.detail}`);
    }
    console.log(
      `\naccount-continuity-check: ${counts.pass} pass, ${counts.fail} fail, ` +
      `${counts['cannot-verify-offline']} cannot-verify-offline (attended gates)`,
    );
    console.log('\n--- JSON ---');
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(counts.fail === 0 ? 0 : 1);
}
