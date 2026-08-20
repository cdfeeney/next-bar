import { describe, expect, it } from 'vitest';

import {
  checkDatabaseName,
  checkConnectionEndpoint, checkMigrationTarget, resolveProjectRef,
} from './apply-migration-target-guard';

const PROD = 'prodrefaaaaaaaaaaaaa';
const STAGING = 'stagingrefbbbbbbbbbb';

describe('checkMigrationTarget', () => {
  it('refuses a non-production env when NEXT_BAR_PRODUCTION_PROJECT_REF is unset', () => {
    const refusal = checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: PROD, productionRef: '', stagingRefs: [STAGING],
    });
    expect(refusal).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
    expect(refusal).toContain('staging');
  });

  // The headline fail-open: both variables unset and DATABASE_URL pointed at
  // production. The pre-fix guard returned no refusal at all here.
  it('refuses a non-production env when BOTH ref variables are unset', () => {
    const refusal = checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: PROD, productionRef: '', stagingRefs: [],
    });
    expect(refusal).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
  });

  it('refuses --env production when NEXT_BAR_PRODUCTION_PROJECT_REF is unset', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'production', ref: PROD, productionRef: '', stagingRefs: [],
    })).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
  });

  it('refuses a non-production env when NEXT_BAR_STAGING_PROJECT_REFS is unset', () => {
    const refusal = checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: 'someotherrefcccccccc', productionRef: PROD, stagingRefs: [],
    });
    expect(refusal).toContain('NEXT_BAR_STAGING_PROJECT_REFS is not set');
  });

  it('refuses a configured ref that is not in the staging list', () => {
    const refusal = checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: 'someotherrefcccccccc', productionRef: PROD, stagingRefs: [STAGING],
    });
    expect(refusal).toContain('not in NEXT_BAR_STAGING_PROJECT_REFS');
  });

  it('refuses a non-production env pointed at the production ref', () => {
    const refusal = checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: PROD, productionRef: PROD, stagingRefs: [STAGING],
    });
    expect(refusal).toContain('PRODUCTION project ref');
  });

  it('refuses --env production pointed at a ref that is not production', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'production', ref: STAGING, productionRef: PROD, stagingRefs: [STAGING],
    })).toContain('does not point at the production project ref');
  });

  it('refuses when the ref could not be resolved from DATABASE_URL', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: '', productionRef: PROD, stagingRefs: [STAGING],
    })).toContain('could not determine the Supabase project ref');
  });

  // Round-2 panel finding: a whitespace-only NEXT_BAR_PRODUCTION_PROJECT_REF is
  // truthy, so it passed the missing-ref check and then never equalled a real
  // ref. With the staging list naming the production ref, the guard accepted
  // production under --env staging.
  it('refuses a whitespace-only production ref instead of treating it as configured', () => {
    const refusal = checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: PROD, productionRef: '   ', stagingRefs: [PROD],
    });
    expect(refusal).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
  });

  it('refuses a whitespace-only staging list instead of treating it as configured', () => {
    const refusal = checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: STAGING, productionRef: PROD, stagingRefs: ['  ', ''],
    });
    expect(refusal).toContain('NEXT_BAR_STAGING_PROJECT_REFS is not set');
  });

  it('still matches the production ref when the configured value is padded', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: PROD, productionRef: ` ${PROD} `, stagingRefs: [STAGING],
    })).toContain('PRODUCTION project ref');
  });

  it('accepts the configured staging target when both variables are set', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: STAGING, productionRef: PROD, stagingRefs: [STAGING],
    })).toBeNull();
  });

  it('accepts the configured production target when both variables are set', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'production', ref: PROD, productionRef: PROD, stagingRefs: [STAGING],
    })).toBeNull();
  });
});

// Round-2 panel: the ref check answers "which project", this one answers
// "which server". pg gives query parameters precedence over the URL authority,
// so ?host= / ?port= redirected a connection whose username still looked
// allowlisted, and the operator's banner showed the authority.
// Round-3 panel, Codex, HIGH. checkConnectionEndpoint proves pg resolved the
// database the URL's PATH names - self-consistency, which is necessary and not
// sufficient. A URL whose path simply says /shadow agrees with itself, and the
// ref, host and port are all still the allowlisted ones. If that database
// carries the pinned migration row, --execute would downgrade and unrecord an
// unintended database. Naming which database is expected is the only thing that
// tells two databases on one cluster apart.
describe('checkDatabaseName', () => {
  it('accepts the expected database', () => {
    expect(checkDatabaseName('postgres', 'postgres', 'staging')).toBeNull();
  });

  it('refuses a second database on the same allowlisted project', () => {
    const refusal = checkDatabaseName('shadow', 'postgres', 'staging');
    expect(refusal).toContain('shadow');
    expect(refusal).toContain('postgres');
  });

  it('refuses when the database could not be resolved', () => {
    expect(checkDatabaseName('   ', 'postgres', 'staging')).toContain('could not determine');
  });

  it('refuses an empty override rather than falling back to a default', () => {
    expect(checkDatabaseName('postgres', '   ', 'staging')).toContain('NEXT_BAR_DATABASE_NAME');
  });
});

// The same check reached through checkMigrationTarget, which is what both the
// applier and the live-suite guard actually call.
describe('checkMigrationTarget with a database', () => {
  it('checks the database on the PRODUCTION path too', () => {
    // Round-4 panel, Codex, HIGH. The production branch returned as soon as the
    // ref matched, so a production ref reaching a second database inside the
    // production project was accepted - the hole sat on the most dangerous route.
    expect(checkMigrationTarget({
      env: 'production',
      ref: PROD,
      productionRef: PROD,
      stagingRefs: [STAGING],
      database: 'shadow',
      expectedDatabase: 'postgres',
    })).toContain('rather than the expected');
  });

  it('still accepts a correct production target', () => {
    expect(checkMigrationTarget({
      env: 'production',
      ref: PROD,
      productionRef: PROD,
      stagingRefs: [STAGING],
      database: 'postgres',
      expectedDatabase: 'postgres',
    })).toBeNull();
  });

  it('refuses an otherwise-perfect staging target on the wrong database', () => {
    expect(checkMigrationTarget({
      env: 'staging',
      ref: STAGING,
      productionRef: PROD,
      stagingRefs: [STAGING],
      database: 'shadow',
      expectedDatabase: 'postgres',
    })).toContain('rather than the expected');
  });
});

describe('checkConnectionEndpoint', () => {
  const HOST = 'aws-0-us-east-1.pooler.supabase.com';
  // `database` defaults to the ordinary Supabase database so the existing cases
  // keep testing exactly what they tested before the database dimension was added.
  const at = (host: string, port: string, options = '', database = 'postgres') => (
    { host, port, options, database }
  );

  it('refuses when pg resolves a different host than the URL authority', () => {
    expect(checkConnectionEndpoint(at('somewhere-else.pooler.supabase.com', '5432'), at(HOST, '5432')))
      .toContain('host does not match');
  });

  it('refuses when pg resolves a different port than the URL authority', () => {
    expect(checkConnectionEndpoint(at(HOST, '6543'), at(HOST, '5432')))
      .toContain('port does not match');
  });

  // A host-less authority parses cleanly, so a check that skips empty sides
  // skips itself: `postgres:///postgres?host=elsewhere`.
  it('refuses when the authority names no host', () => {
    expect(checkConnectionEndpoint(at('db.other.pooler.supabase.com', '5432'), at('', '')))
      .toContain('DATABASE_URL has no host');
  });

  it('refuses when the effective host could not be resolved', () => {
    expect(checkConnectionEndpoint(at('   ', '5432'), at(HOST, '5432')))
      .toContain('effective connection host could not be resolved');
  });

  it('refuses when the effective port could not be resolved', () => {
    expect(checkConnectionEndpoint(at(HOST, ''), at(HOST, '5432')))
      .toContain('effective connection port could not be resolved');
  });

  it('accepts an omitted authority port when pg resolves the libpq default', () => {
    expect(checkConnectionEndpoint(at(HOST, '5432'), at(HOST, ''))).toBeNull();
  });

  it('refuses an omitted authority port when pg resolves something else', () => {
    expect(checkConnectionEndpoint(at(HOST, '6543'), at(HOST, ''))).toContain('port does not match');
  });

  // Round-1 panel of the fresh cycle, Codex, HIGH, raised against the revert
  // runner: the ref answers "which project" and the endpoint answers "which
  // server", but a cluster serves many databases and Supabase supports more than
  // one per project. `?dbname=` and PGDATABASE override the URL path the same way
  // `?host=` overrides the authority, and no in-SQL precondition can close it —
  // a second database carrying the same migration row answers every question the
  // SQL can ask.
  it('refuses when pg resolves a different database than the URL path', () => {
    expect(checkConnectionEndpoint(at(HOST, '5432', '', 'another_database'), at(HOST, '5432')))
      .toContain('effective database does not match');
  });

  it('refuses when the URL names no database at all', () => {
    expect(checkConnectionEndpoint(at(HOST, '5432'), at(HOST, '5432', '', '')))
      .toContain('names no database');
  });

  it('refuses when the effective database could not be resolved', () => {
    expect(checkConnectionEndpoint(at(HOST, '5432', '', '   '), at(HOST, '5432')))
      .toContain('effective database could not be resolved');
  });

  it('accepts a matching non-default database name', () => {
    expect(checkConnectionEndpoint(at(HOST, '5432', '', 'shadow'), at(HOST, '5432', '', 'shadow')))
      .toBeNull();
  });

  it('accepts the connection when pg resolves the authority endpoint', () => {
    expect(checkConnectionEndpoint(at(HOST, '6543'), at(HOST, '6543'))).toBeNull();
  });
});

// Round-2 panel: taking the last dot-separated piece of ANY username invented a
// ref for connection strings that carry none, and an allowlist could then match
// the invention.
describe('resolveProjectRef', () => {
  it('resolves the ref from a Supabase pooler username', () => {
    expect(resolveProjectRef('postgres.' + STAGING)).toBe(STAGING);
  });

  it('resolves nothing from a direct connection username', () => {
    expect(resolveProjectRef('postgres')).toBe('');
  });

  // The whole username became the "ref", so an arbitrary server reached with
  // the staging ref as its username resolved to the allowlisted value.
  it('resolves nothing from a username that is just the ref', () => {
    expect(resolveProjectRef(STAGING)).toBe('');
  });

  it('resolves nothing from a username with more than one dot', () => {
    expect(resolveProjectRef('postgres.' + STAGING + '.extra')).toBe('');
  });

  it('resolves nothing when the ref piece is not a project ref', () => {
    expect(resolveProjectRef('postgres.not-a-ref')).toBe('');
  });

  it('feeds the guard an unresolved ref that the guard then refuses', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: resolveProjectRef('postgres'), productionRef: PROD, stagingRefs: ['postgres'],
    })).toContain('could not determine the Supabase project ref');
  });
});

// Round-2 panel: a malformed configured value is truthy, so it passed the
// missing-variable check and then never equalled a real ref.
describe('checkMigrationTarget with malformed configuration', () => {
  it('refuses a production ref carrying a stray separator', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: PROD, productionRef: PROD + ',', stagingRefs: [PROD],
    })).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not a valid project ref');
  });

  it('refuses a staging list entry that is not a project ref', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: STAGING, productionRef: PROD, stagingRefs: [STAGING, 'not a ref'],
    })).toContain('not a project ref');
  });
});

// Round-3 panel, both lanes, the highest-severity finding: the endpoint check
// only proved pg agreed with the URL the operator wrote. A username is a
// project ref ONLY on the shared pooler; anywhere else it is just a role name.
describe('checkConnectionEndpoint outside the Supabase pooler', () => {
  it('refuses an allowlisted-looking username sent to an unrelated server', () => {
    expect(checkConnectionEndpoint(
      { host: 'production-proxy.example.com', port: '5432', options: '', database: 'postgres' },
      { host: 'production-proxy.example.com', port: '5432', database: 'postgres' },
    )).toContain('not a Supabase pooler host');
  });

  it('refuses a host that merely contains the pooler domain', () => {
    expect(checkConnectionEndpoint(
      { host: 'pooler.supabase.com.evil.example', port: '5432', options: '', database: 'postgres' },
      { host: 'pooler.supabase.com.evil.example', port: '5432', database: 'postgres' },
    )).toContain('not a Supabase pooler host');
  });
});

// Round-3 panel: /^[a-z0-9]+$/i accepted placeholders, so a stand-in value in
// the production variable passed validation and then never equalled a real ref.
describe('project ref shape', () => {
  it('refuses a placeholder production ref that is alphanumeric but not a ref', () => {
    expect(checkMigrationTarget({
      database: 'postgres', expectedDatabase: 'postgres',
      env: 'staging', ref: PROD, productionRef: 'production', stagingRefs: [PROD],
    })).toContain('not a valid project ref');
  });

  it('resolves nothing from an uppercase ref, which no Supabase project uses', () => {
    expect(resolveProjectRef('postgres.' + PROD.toUpperCase())).toBe('');
  });

  it('resolves nothing from a ref of the wrong length', () => {
    expect(resolveProjectRef('postgres.tooshort')).toBe('');
  });
});

// Round-4 panel: libpq `options` reaches the server in the startup packet, and
// Supabase's pooler documents `options=reference=<ref>` as a tenant selector -
// a second target-naming input the ref check never saw, suppliable through
// PGOPTIONS without touching DATABASE_URL.
describe('checkConnectionEndpoint with startup options', () => {
  const HOST = 'aws-0-us-east-1.pooler.supabase.com';

  it('refuses a connection carrying a pooler tenant selector', () => {
    expect(checkConnectionEndpoint(
      { host: HOST, port: '6543', options: 'reference=' + PROD, database: 'postgres' },
      { host: HOST, port: '6543', database: 'postgres' },
    )).toContain('startup options');
  });

  it('refuses any startup options, not only the ones it recognises', () => {
    expect(checkConnectionEndpoint(
      { host: HOST, port: '6543', options: '-c statement_timeout=0', database: 'postgres' },
      { host: HOST, port: '6543', database: 'postgres' },
    )).toContain('startup options');
  });

  it('accepts a connection with no startup options', () => {
    expect(checkConnectionEndpoint(
      { host: HOST, port: '6543', options: '  ', database: 'postgres' }, { host: HOST, port: '6543', database: 'postgres' },
    )).toBeNull();
  });
});
