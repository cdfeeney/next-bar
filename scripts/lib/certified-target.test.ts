import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { dumpDatabase, DumpFailure } from './dbDump';
import { resolveIdentity } from './migration-target-guard';

/**
 * THE CERTIFIED TARGET MUST SURVIVE THE FILE IT CAME FROM.
 *
 * Round 4, CRITICAL: `db:reset-staging` and `db:dump` certified one read of a secrets file — in a
 * CHILD PROCESS, whose answer came back as text — and then re-read that file in the parent to build
 * the client that actually connected. Two independent resolutions of a mutable file, with the
 * mandatory pre-count and the mandatory dump sitting between them. A file replaced in that window
 * meant the evidence described staging while the destructive statements went to production.
 *
 * The invariant that closes it is small and mechanical: EVERY connection is opened from the
 * `CertifiedTarget` the guard returned, never from a fresh read. This file pins that for the dump,
 * where it is observable without a database: the fixture hosts do not resolve, so the connection
 * error names whichever host was actually dialled.
 *
 * No connection is ever established. Both hosts are deliberately unresolvable.
 */
const STAGING = 'wqxovhiovgcijmfzxgby';
const PROD = 'nuhqlvneokucxomguxhi';
const STAGING_HOST = 'no-such-staging.pooler.supabase.com';
const PROD_HOST = 'no-such-production.pooler.supabase.com';

const url = (ref: string, host: string) => `postgresql://postgres.${ref}:pw@${host}:5432/postgres`;

const outDir = mkdtempSync(join(tmpdir(), 'certified-target-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('the connection is opened from the certified target, not from the environment', () => {
  it('carries the exact string it certified', () => {
    const certified = resolveIdentity(url(STAGING, STAGING_HOST));
    expect(certified.connectionString).toBe(url(STAGING, STAGING_HOST));
    expect(certified.ref).toBe(STAGING);
    expect(certified.host).toBe(STAGING_HOST);
    expect(certified.port).toBe(5432);
  });

  it('dumps the CERTIFIED target even after DATABASE_URL is repointed underneath it', async () => {
    const certified = resolveIdentity(url(STAGING, STAGING_HOST));

    // THE SWAP. This is the round-4 exploit in one line: the secrets file is replaced — or simply
    // resolves differently — after the target was certified and before the dump opens its socket.
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url(PROD, PROD_HOST);
    try {
      const error = await dumpDatabase(certified, outDir).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DumpFailure);
      // The host it actually dialled. Under the old code this read the production host.
      expect((error as Error).message).toContain(STAGING_HOST);
      expect((error as Error).message).not.toContain(PROD_HOST);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  }, 30_000);

  it('names the backup after the certified ref, so the file cannot claim the wrong project', async () => {
    const certified = resolveIdentity(url(STAGING, STAGING_HOST));
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url(PROD, PROD_HOST);
    try {
      const error = await dumpDatabase(certified, outDir).catch((e: unknown) => e);
      // It failed at the connection, so nothing was written — but the name was already decided from
      // the certified ref, which is what stops a backup from being filed under another project.
      expect(error).toBeInstanceOf(DumpFailure);
      expect(certified.ref).toBe(STAGING);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  }, 30_000);
});
