import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  CANNOT_VERIFY_OFFLINE,
  EXPECTED_APP_ID,
  checkBundleIdentifier,
  checkFailClosedSeparation,
  checkHistoryContinuity,
  checkMigrationStatus,
  checkSupabaseProjectIdentity,
  checkOriginBehavior,
  defaultCapacitorConfigPaths,
  isTestFixture,
// '.mjs' on purpose: a './….mts' specifier needs allowImportingTsExtensions (which
// this tsconfig does not enable), and an extensionless one never reaches a .mts file.
// Both TypeScript and Vite map the .mjs specifier onto the .mts source.
} from './account-continuity-check.mjs';

// Vitest runs with cwd at the vitest.config.ts root — the repository root.
const ROOT = path.resolve(process.cwd());

/** The REAL nb-beta1-rc / nb-ios shell config, parsed as text — never executed,
 *  so no CAP_SERVER_URL value influences the assertions. */
function realCapacitorConfigs() {
  return defaultCapacitorConfigPaths(ROOT).map((p) => ({ path: p, source: readFileSync(p, 'utf8') }));
}

const ENV_DRIVEN_CLIENT = {
  path: 'src/lib/supabase.ts',
  source: [
    "import { createClient } from '@supabase/supabase-js';",
    'const url = process.env.NEXT_PUBLIC_SUPABASE_URL;',
    'const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;',
    'export const supabase = url && key ? createClient(url, key) : null;',
    'export const supabaseConfigured = !!supabase;',
  ].join('\n'),
};

describe('bundle identifier', () => {
  test('passes when both real shell configs declare com.nextbar.app', () => {
    // Arrange
    const configs = realCapacitorConfigs();

    // Act
    const outcome = checkBundleIdentifier(configs);

    // Assert
    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toContain(EXPECTED_APP_ID);
  });

  test('fails when two shells disagree on appId', () => {
    // Arrange — synthetic fixture: never a live config file.
    const configs = [
      { path: 'a/capacitor.config.ts', source: `const c = { appId: '${EXPECTED_APP_ID}' };` },
      { path: 'b/capacitor.config.ts', source: "const c = { appId: 'com.nextbar.app2' };" },
    ];

    // Act
    const outcome = checkBundleIdentifier(configs);

    // Assert
    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('com.nextbar.app2');
  });

  test('fails rather than silently passing when no config is supplied', () => {
    expect(checkBundleIdentifier([]).status).toBe('fail');
  });
});

describe('supabase project identity', () => {
  test('passes when the client is env-driven and no source hardcodes a Supabase host', () => {
    // Arrange
    const scanned = [{ path: 'src/lib/lists.ts', source: 'export const LISTS_KEY = "next-bar:lists:v1";' }];

    // Act
    const outcome = checkSupabaseProjectIdentity(ENV_DRIVEN_CLIENT, scanned);

    // Assert
    expect(outcome.status).toBe('pass');
  });

  test('fails when a literal Supabase host is hardcoded outside test fixtures', () => {
    // Arrange — synthetic fixture, the exact shape that would repoint beta users.
    const scanned = [
      { path: 'src/lib/leak.ts', source: "const fallback = 'https://otherproject.supabase.co';" },
    ];

    // Act
    const outcome = checkSupabaseProjectIdentity(ENV_DRIVEN_CLIENT, scanned);

    // Assert
    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('otherproject.supabase.co');
  });

  test('ignores the same literal inside a test fixture', () => {
    // Arrange
    const scanned = [
      { path: 'src/app/api/health/route.test.ts', source: "vi.stubEnv('X', 'https://example.supabase.co');" },
    ];

    // Act + Assert
    expect(isTestFixture(scanned[0].path)).toBe(true);
    expect(checkSupabaseProjectIdentity(ENV_DRIVEN_CLIENT, scanned).status).toBe('pass');
  });

  test('fails when the client stops reading the env vars', () => {
    // Arrange
    const client = { path: 'src/lib/supabase.ts', source: "export const supabase = createClient('a', 'b');" };

    // Act + Assert
    expect(checkSupabaseProjectIdentity(client, []).status).toBe('fail');
  });
});

describe('origin behavior', () => {
  test('passes against the real capacitor.config.ts content (parsed, not executed)', () => {
    // Arrange
    const configs = realCapacitorConfigs();

    // Act
    const outcome = checkOriginBehavior(configs);

    // Assert
    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toContain('next-bar.com');
  });

  test('fails when a canonical host is dropped from allowNavigation', () => {
    // Arrange — synthetic fixture derived from the real config text.
    const real = realCapacitorConfigs()[0];
    const stripped = {
      path: 'synthetic/capacitor.config.ts',
      source: real.source.replace(/'www\.next-bar\.com'/, "'example.com'"),
    };

    // Act
    const outcome = checkOriginBehavior([stripped]);

    // Assert
    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('www.next-bar.com');
  });

  test('fails when the fail-closed protocol guard is removed', () => {
    // Arrange
    const real = realCapacitorConfigs()[0];
    const stripped = {
      path: 'synthetic/capacitor.config.ts',
      source: real.source.replace(/parsed\.protocol\s*!==\s*'https:'/, 'false'),
    };

    // Act
    const outcome = checkOriginBehavior([stripped]);

    // Assert
    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('protocol');
  });
});

describe('fail-closed staging/production separation', () => {
  test('passes for the null-client guard', () => {
    expect(checkFailClosedSeparation(ENV_DRIVEN_CLIENT).status).toBe('pass');
  });

  test('fails when an absent env var falls back to a literal endpoint', () => {
    // Arrange — synthetic fixture.
    const client = {
      path: 'src/lib/supabase.ts',
      source: [
        'const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://prod.supabase.co";',
        'export const supabaseConfigured = true;',
      ].join('\n'),
    };

    // Act + Assert
    expect(checkFailClosedSeparation(client).status).toBe('fail');
  });
});

describe('migration status and history continuity', () => {
  test('fails when 0042 cannot be located at all', () => {
    const outcome = checkMigrationStatus({
      localMigrationNames: [],
      accountSyncMigrationPath: null,
      accountSyncMigrationSource: null,
    });
    expect(outcome.status).toBe('fail');
  });

  test('fails when code reads account_content_state while 0042 is unapplied', () => {
    // Arrange
    const localStores = Object.values({
      lists: 'src/lib/lists.ts',
      night_log: 'src/lib/nightLog.ts',
      night_archive: 'src/lib/nightArchive.ts',
      shared_nights: 'src/lib/sharedNightsLocal.ts',
    }).map((p) => ({ path: p, source: 'window.localStorage.getItem(k)' }));

    // Act
    const outcome = checkHistoryContinuity({
      localStores,
      serverStateReferences: ['src/lib/accountState.ts'],
      zeroZeroFourTwoAppliedLocally: false,
    });

    // Assert
    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('account_content_state');
  });
});

describe('attended gates', () => {
  test('every cannot-verify-offline entry is named, never a silent skip', () => {
    expect(CANNOT_VERIFY_OFFLINE.length).toBeGreaterThan(0);
    for (const gate of CANNOT_VERIFY_OFFLINE) {
      expect(gate.status).toBe('cannot-verify-offline');
      expect(gate.id).toBeTruthy();
      expect(gate.detail).toContain('attended gate');
    }
  });
});
