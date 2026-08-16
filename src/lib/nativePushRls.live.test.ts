import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

/**
 * V8-4 BEHAVIORAL RLS/RPC negatives for 0051 and 0052 — criterion 2.
 *
 * nativePushMigration.test.ts proves the security SHAPE from the SQL text.
 * A reviewer of the previous goal correctly refused a text scan as
 * verification: it cannot tell you whether the database actually DENIES
 * anyone. This file is the other half, and it is a direct copy of the gating
 * that nightOutsRls.live.test.ts established — same staging-only allowlist,
 * same effective-connection check, same rolled-back transactions.
 *
 * TWO reasons it may not run, and they are NOT the same:
 *   - No DATABASE_URL: skip on CI (which has no credentials by design), throw
 *     anywhere else, because unverified denials must be loud.
 *   - DATABASE_URL present but 0051/0052 NOT APPLIED: throw. Applying these
 *     migrations to staging is an attended step, so this is the honest signal
 *     that the behavioural half of criterion 2 is still outstanding — never a
 *     silent green.
 */

function envValue(key: string): string | null {
  try {
    const env = readFileSync(path.join(__dirname, '..', '..', '.env.local'), 'utf8');
    return env.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

const URL = envValue('DATABASE_URL');

function effectiveConnection(connectionString: string): { user: string; host: string } {
  const probe = new Client({ connectionString }) as unknown as {
    connectionParameters?: { user?: string; host?: string };
  };
  return {
    user: probe.connectionParameters?.user ?? '',
    host: probe.connectionParameters?.host ?? '',
  };
}

/**
 * Identical gate to nightOutsRls.live.test.ts. This suite issues real DML and
 * advisory locks against whatever DATABASE_URL names; ROLLBACK stops rows from
 * committing, it is not an authorization. The target must be named explicitly
 * and the gate FAILS CLOSED.
 */
function assertStagingOnly(connectionString: string): void {
  const effective = effectiveConnection(connectionString);
  const ref = effective.user.split('.').pop() ?? '';
  const allowlist = (envValue('NEXT_BAR_STAGING_PROJECT_REFS') ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const productionRef = envValue('NEXT_BAR_PRODUCTION_PROJECT_REF');

  const authorityHost = new globalThis.URL(connectionString).hostname;
  if (authorityHost && effective.host && effective.host !== authorityHost) {
    throw new Error(
      'nativePushRls.live.test.ts refuses to run: the effective connection host does not match '
      + 'the connection string authority, so the target was overridden by a query parameter.',
    );
  }
  if (allowlist.length === 0) {
    throw new Error(
      'nativePushRls.live.test.ts refuses to run: NEXT_BAR_STAGING_PROJECT_REFS is not set in '
      + '.env.local. An unset allowlist is never treated as permission.',
    );
  }
  if (productionRef && ref === productionRef) {
    throw new Error(
      'nativePushRls.live.test.ts refuses to run: DATABASE_URL points at '
      + 'NEXT_BAR_PRODUCTION_PROJECT_REF. Production writes are an attended gate.',
    );
  }
  if (!allowlist.includes(ref)) {
    throw new Error(
      "nativePushRls.live.test.ts refuses to run: DATABASE_URL's project ref is not in "
      + 'NEXT_BAR_STAGING_PROJECT_REFS.',
    );
  }
}

if (URL) assertStagingOnly(URL);

const SKIP_ALLOWED = process.env.CI === 'true' || process.env.CI === '1';
if (!URL && !SKIP_ALLOWED) {
  throw new Error(
    'nativePushRls.live.test.ts: no DATABASE_URL in .env.local, so the behavioral '
    + 'RLS/RPC denials for 0051/0052 were NOT verified. Set it, or set CI=1 to '
    + 'acknowledge that this environment cannot run them.',
  );
}

const describeLive = URL ? describe : describe.skip;

const TABLES = [
  'native_device_tokens',
  'notification_preferences',
  'notification_outbox',
  'notification_deliveries',
];

describeLive('0051/0052 native push — live RLS/RPC denials', () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({
      connectionString: URL as string,
      ssl: { rejectUnauthorized: false },
      statement_timeout: 30000,
      application_name: 'v8-4-native-push-rls',
    });
    await db.connect();

    // Applied-migration precondition. Skipping here would make every assertion
    // below vacuous, which is exactly the failure mode this project has been
    // burned by before.
    const { rows } = await db.query(
      `select tablename from pg_tables where schemaname = 'public' and tablename = any($1)`,
      [TABLES],
    );
    const present = new Set(rows.map((row: { tablename: string }) => row.tablename));
    const missing = TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
      throw new Error(
        `nativePushRls.live.test.ts: ${missing.join(', ')} not present in the target database. `
        + 'Apply supabase/migrations/0051 and 0052 to staging (an ATTENDED step) before this '
        + 'suite can verify anything. A skip here would be a vacuous pass.',
      );
    }
  });

  afterAll(async () => {
    await db?.end().catch(() => {});
  });

  async function inRollback<T>(fn: () => Promise<T>): Promise<T> {
    await db.query('BEGIN');
    try {
      return await fn();
    } finally {
      await db.query('ROLLBACK');
    }
  }

  const asRole = async (role: string, uid?: string) => {
    await db.query(`SET LOCAL ROLE ${role}`);
    if (uid) {
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role }),
      ]);
    }
  };

  const denialOf = async (role: string, sql: string, uid?: string) =>
    inRollback(async () => {
      await asRole(role, uid);
      try {
        await db.query(sql);
        return null;
      } catch (error) {
        return (error as { message: string }).message;
      }
    });

  it('anon cannot read ANY of the four new tables', async () => {
    for (const table of TABLES) {
      const denied = await denialOf('anon', `select * from public.${table} limit 1`);
      expect(denied, `anon could read public.${table}`).toMatch(/permission denied/i);
    }
  });

  it('authenticated cannot read the two SERVER-ONLY tables', async () => {
    // The outbox knows who was told what and when. It is not a user surface.
    for (const table of ['notification_outbox', 'notification_deliveries']) {
      const denied = await denialOf(
        'authenticated',
        `select * from public.${table} limit 1`,
        randomUUID(),
      );
      expect(denied, `authenticated could read public.${table}`).toMatch(/permission denied/i);
    }
  });

  it('authenticated cannot WRITE any of the four tables directly', async () => {
    // Direct writes are what would bypass the per-user cap inside the RPC.
    const uid = randomUUID();
    for (const table of TABLES) {
      for (const sql of [
        `delete from public.${table}`,
        `update public.${table} set created_at = now()`,
      ]) {
        const denied = await denialOf('authenticated', sql, uid);
        expect(denied, `authenticated could run: ${sql}`).toMatch(/permission denied/i);
      }
    }
  });

  it('anon cannot execute any of the new RPCs', async () => {
    const calls: Array<[string, string]> = [
      ['save_native_device_token', `select public.save_native_device_token('${'a'.repeat(64)}', 'ios', '${randomUUID()}')`],
      ['revoke_native_device_token', `select public.revoke_native_device_token('${randomUUID()}')`],
      ['revoke_all_native_device_tokens', 'select public.revoke_all_native_device_tokens()'],
      ['set_notification_preferences', 'select public.set_notification_preferences(true, true, true, true)'],
      // Server-internal: revoked from EVERY client role, including authenticated.
      ['enqueue_notification', `select public.enqueue_notification('invited', '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, null, 'k')`],
    ];
    for (const [name, sql] of calls) {
      const denied = await denialOf('anon', sql);
      expect(denied, `anon could execute ${name}`).toMatch(/permission denied/i);
    }
  });

  it('authenticated cannot execute the server-internal enqueue helper', async () => {
    const denied = await denialOf(
      'authenticated',
      `select public.enqueue_notification('invited', '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, null, 'k')`,
      randomUUID(),
    );
    expect(denied, 'authenticated could enqueue a notification').toMatch(/permission denied/i);
  });

  it('the RPC list above is exhaustive against the database', async () => {
    // The claim "any of the new RPCs" must be proven, not trusted: adding a
    // sixth function later would otherwise leave it silently unchecked.
    const covered = new Set([
      'save_native_device_token',
      'revoke_native_device_token',
      'revoke_all_native_device_tokens',
      'set_notification_preferences',
      'enqueue_notification',
      // Trigger functions: reachable only as triggers, never by a client call.
      'night_out_members_notify',
      'night_out_suggestions_notify',
      'night_outs_notify',
      'night_outs_bump_plan_revision',
    ]);
    const { rows } = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and (p.proname like '%native_device_token%'
              or p.proname like '%notification%'
              or p.proname like '%_notify'
              or p.proname like '%plan_revision%')`);
    const found = rows.map((row: { proname: string }) => row.proname);
    const uncovered = found.filter((name: string) => !covered.has(name));
    expect(uncovered, `unchecked notification functions: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('a user can read only their OWN device tokens and preferences', async () => {
    for (const table of ['native_device_tokens', 'notification_preferences']) {
      const rowsSeen = await inRollback(async () => {
        await asRole('authenticated', randomUUID());
        const { rows } = await db.query(`select * from public.${table}`);
        return rows.length;
      });
      // A fresh random uid owns nothing, so an owner-scoped policy returns
      // zero. A non-zero count here means the policy is not owner-scoped.
      expect(rowsSeen, `${table} leaked rows to a stranger`).toBe(0);
    }
  });
});
