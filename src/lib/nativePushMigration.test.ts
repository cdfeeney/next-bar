import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * V8-4 migration guard — static assertions over the device-token and outbox
 * migrations. Their NUMBERS moved once already (both collided with migrations the
 * trunk added while this branch was in flight), so the filenames live in exactly
 * two constants below and nowhere else.
 *
 * This proves the security SHAPE from the SQL text, exactly as
 * nightOutsMigration.test.ts does for 0044. It is deliberately NOT presented
 * as behavioural proof: a text scan cannot tell you the database actually
 * denies anyone. nativePushRls.live.test.ts is the other half, and it can only
 * run once these migrations are applied to staging — an attended step this
 * goal is not allowed to perform.
 *
 * Line endings are normalised at the read for the same reason 0044's guard
 * does it: git checks these files out CRLF on Windows and every assertion here
 * is a text pattern, so a `;\n`-terminated regex would silently match nothing
 * and pass vacuously.
 */

function migration(name: string): string {
  return readFileSync(
    path.join(__dirname, '..', '..', 'supabase', 'migrations', name),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

const TOKENS_SQL = migration('0060_native_device_tokens.sql');
const OUTBOX_SQL = migration('0061_notification_outbox.sql');

const EVENT_TYPES = ['invited', 'accepted', 'bar_suggested', 'plan_changed'];

describe('native_device_tokens security shape (criterion 2)', () => {
  const tables = ['native_device_tokens', 'notification_preferences'];

  it('enables RLS and revokes every direct grant on both tables', () => {
    for (const table of tables) {
      expect(TOKENS_SQL).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`),
      );
      expect(TOKENS_SQL).toMatch(
        new RegExp(
          `revoke all on table public\\.${table} from public, anon, authenticated`,
        ),
      );
    }
  });

  it('re-grants exactly two table privileges, both owner-scoped SELECT', () => {
    // The revokes above are necessary but not sufficient: a later commit could
    // add `grant insert on table ... to authenticated` and they would all still
    // pass. Pin the exact grant set instead.
    const grants = [...TOKENS_SQL.matchAll(/^grant ([^;]+?) on table ([^;]+);$/gm)].map(
      (match) => `${match[1]} on ${match[2]}`.replace(/\s+/g, ' '),
    );
    expect(grants).toEqual([
      'select on public.native_device_tokens to authenticated',
      'select on public.notification_preferences to authenticated',
    ]);
  });

  it('gives each table an owner-only read policy and no write policy at all', () => {
    for (const table of tables) {
      expect(TOKENS_SQL).toMatch(
        new RegExp(`create policy "${table}: owner can read"[\\s\\S]*?using \\(auth\\.uid\\(\\) = user_id\\)`),
      );
    }
    // Writes are the RPCs' job. Any insert/update/delete policy would be a
    // second, unreviewed write path around the per-user cap.
    expect(TOKENS_SQL).not.toMatch(/for (insert|update|delete)/);
  });

  it('makes every RPC a definer function with a pinned search_path', () => {
    const functions = [...TOKENS_SQL.matchAll(/create or replace function public\.(\w+)/g)]
      .map((match) => match[1]);
    expect(functions.sort()).toEqual([
      'revoke_all_native_device_tokens',
      'revoke_native_device_token',
      'save_native_device_token',
      'set_notification_preferences',
    ]);
    const definers = TOKENS_SQL.match(/security definer\n\s*set search_path = public/g) ?? [];
    expect(definers).toHaveLength(functions.length);
  });

  it('grants no function to anon — every write path requires a session', () => {
    expect(TOKENS_SQL).not.toMatch(/grant execute on function[^;]*to[^;]*anon/);
    const executeGrants = [...TOKENS_SQL.matchAll(/grant execute on function[\s\S]*?to (\w+);/g)]
      .map((match) => match[1]);
    expect(new Set(executeGrants)).toEqual(new Set(['authenticated']));
  });

  it('enforces the per-user device cap INSIDE the RPC, under an advisory lock', () => {
    // A cap enforced only in client code is not a cap. The advisory lock is
    // what stops two concurrent registrations both reading count = cap-1.
    expect(TOKENS_SQL).toMatch(/device_cap constant integer := 10/);
    expect(TOKENS_SQL).toMatch(/pg_advisory_xact_lock\(hashtext\('native_device_token:'/);
    expect(TOKENS_SQL).toMatch(/if existing >= device_cap then\n\s*return false;/);
  });

  it('keeps one owner per physical device token (the shared-device case)', () => {
    expect(TOKENS_SQL).toMatch(
      /create unique index if not exists native_device_tokens_token_key\s*\n\s*on public\.native_device_tokens \(token\)/,
    );
    // ...and transfers ownership explicitly rather than failing the insert.
    expect(TOKENS_SQL).toMatch(/delete from public\.native_device_tokens t\s*\n\s*where t\.token = p_token/);
  });

  it('validates the token and installation id inside the RPC, not only in a check', () => {
    expect(TOKENS_SQL).toMatch(/p_token !~ '\^\[0-9a-fA-F\]\{32,512\}\$'/);
    expect(TOKENS_SQL).toMatch(/p_installation !~ '\^\[0-9a-zA-Z-\]\{8,64\}\$'/);
  });

  it('models revocation as a flag, so re-registering un-revokes', () => {
    expect(TOKENS_SQL).toMatch(/revoked_at\s+timestamptz null/);
    expect(TOKENS_SQL).toMatch(/set revoked_at = now\(\), updated_at = now\(\)/);
    expect(TOKENS_SQL).toMatch(/revoked_at = null,/);
  });

  it('uses idempotent DDL throughout', () => {
    expect(TOKENS_SQL).not.toMatch(/create table (?!if not exists)/);
    expect(TOKENS_SQL).not.toMatch(/create unique index (?!if not exists)/);
    expect(TOKENS_SQL).toMatch(/drop policy if exists/);
  });
});

describe('notification_outbox (criteria 3, 4)', () => {
  const tables = ['notification_outbox', 'notification_deliveries'];

  it('keeps both tables entirely server-side — RLS on, revoked, and NO grant', () => {
    for (const table of tables) {
      expect(OUTBOX_SQL).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`),
      );
      expect(OUTBOX_SQL).toMatch(
        new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`),
      );
    }
    // Not one table grant anywhere: the only reader is the service role.
    expect(OUTBOX_SQL).not.toMatch(/^grant .* on table/m);
  });

  it('lets no client role execute the enqueue helper', () => {
    expect(OUTBOX_SQL).toMatch(
      /revoke all on function public\.enqueue_notification\([^)]*\)\s*\n\s*from public, anon, authenticated/,
    );
    expect(OUTBOX_SQL).not.toMatch(/grant execute on function public\.enqueue_notification/);
  });

  it('constrains the outbox to EXACTLY the four PRD event types (criterion 3)', () => {
    const check = OUTBOX_SQL.match(/check \(event_type in \(([^)]*)\)\)/)?.[1] ?? '';
    const listed = [...check.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(listed.sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('makes a duplicate occurrence a silent no-op via a unique dedupe key (criterion 3)', () => {
    expect(OUTBOX_SQL).toMatch(/constraint notification_outbox_dedupe_key unique \(dedupe_key\)/);
    expect(OUTBOX_SQL).toMatch(
      /on conflict on constraint notification_outbox_dedupe_key do nothing/,
    );
  });

  it('makes every dedupe key carry a per-OCCURRENCE discriminator (criterion 3)', () => {
    // This is what stops a duplicate from suppressing a LEGITIMATE later event
    // of the same type to the same person: the key changes when the occurrence
    // changes. invited/accepted key on the member row's timestamp,
    // bar_suggested on the bar, plan_changed on a monotone revision counter.
    expect(OUTBOX_SQL).toMatch(/'invited:'[\s\S]{0,200}extract\(epoch from new\.created_at\)/);
    expect(OUTBOX_SQL).toMatch(
      /'accepted:'[\s\S]{0,200}extract\(epoch from coalesce\(new\.responded_at, new\.created_at\)\)/,
    );
    expect(OUTBOX_SQL).toMatch(/'bar_suggested:'[\s\S]{0,200}new\.bar_id/);
    expect(OUTBOX_SQL).toMatch(/'plan_changed:'[\s\S]{0,200}new\.plan_revision/);
  });

  it('can never deliver the same event to the same device twice (criterion 3)', () => {
    expect(OUTBOX_SQL).toMatch(
      /constraint notification_deliveries_once unique \(outbox_id, device_token_id\)/,
    );
  });

  it('claims work atomically, charges an attempt, and stamps an owner', () => {
    // Three separate defects live in this one statement. `for update skip
    // locked` is what stops two drains taking the same rows. Incrementing
    // attempts AT CLAIM is what bounds a worker that dies before it can defer.
    // claim_token is what stops a drain whose lease expired from writing over
    // the claim that replaced it.
    const claim = OUTBOX_SQL.slice(
      OUTBOX_SQL.indexOf('create or replace function public.claim_notification_outbox'),
    );
    expect(claim).toMatch(/for update skip locked/);
    // The ceiling has to live in SQL too: a worker killed between the claim
    // committing and the caller reading `attempts` never runs the caller's
    // check, and the row was handed out again forever.
    expect(claim).toMatch(/attempts >= p_max_attempts/);
    expect(claim).toMatch(/attempts < p_max_attempts/);
    expect(claim).toMatch(/set status\s*= 'failed'/);
    // `create or replace` with an extra defaulted parameter OVERLOADS, so the
    // unbounded two-argument version must be dropped or it stays callable.
    expect(OUTBOX_SQL).toMatch(
      /drop function if exists public\.claim_notification_outbox\(integer, integer\);/,
    );
    expect(claim).toMatch(/claim_token = gen_random_uuid\(\)/);
    expect(claim).toMatch(/attempts\s*= o\.attempts \+ 1/);
    expect(OUTBOX_SQL).toMatch(
      /revoke all on function public\.claim_notification_outbox\(integer, integer, integer\)\s*\n\s*from public, anon, authenticated/,
    );
  });

  it('records when an event first reached a phone, independent of row status', () => {
    // The budget counts buzzes, not statuses: a row left pending for a second
    // device's retry has already reached the first one.
    expect(OUTBOX_SQL).toMatch(/delivered_at\s+timestamptz null,/);
    expect(OUTBOX_SQL).toMatch(
      /add column if not exists delivered_at timestamptz null;/,
    );
  });

  it('indexes the read the rate limiter actually issues', () => {
    // The only outbox index used to be partial on status = 'pending', which is
    // the one status the rate-limit query excludes - so every drained row
    // scanned the settled portion of the table.
    expect(OUTBOX_SQL).toMatch(
      /create index if not exists notification_outbox_recent_sends_idx\s*\n\s*on public\.notification_outbox \(recipient_user_id, delivered_at\)\s*\n\s*where delivered_at is not null/,
    );
    // Recreated, not merely added: the first version keyed on the status that
    // missed partially-delivered rows.
    expect(OUTBOX_SQL).toMatch(
      /drop index if exists public\.notification_outbox_recent_sends_idx;/,
    );
  });

  it('records which claim reserved a delivery, so the write can be fenced too', () => {
    // The outbox claim fence covers the row's status; without this column a
    // sender that stalled past its lease could still overwrite a delivery a
    // later drain had already settled.
    expect(OUTBOX_SQL).toMatch(/claim_token\s+uuid\s+null,/);
    expect(OUTBOX_SQL).toMatch(
      /alter table public\.notification_deliveries\s*\n\s*add column if not exists claim_token uuid null;/,
    );
  });

  it('lets a delivery be RESERVED before APNs is called (criterion 3)', () => {
    // The unique key alone only deduplicates the audit row, which is written
    // after Apple already has the push. A non-terminal 'pending' status is
    // what lets the sender take the pair first and make the send at-most-once.
    expect(OUTBOX_SQL).toMatch(
      /check \(status in \('pending', 'sent', 'failed', 'invalid_token'\)\)/,
    );
  });

  it('bumps plan_revision only when a field a guest would notice changes', () => {
    expect(OUTBOX_SQL).toMatch(/add column if not exists plan_revision integer not null default 0/);
    for (const field of ['night', 'title', 'status', 'decided_bar_id']) {
      expect(OUTBOX_SQL).toMatch(new RegExp(`new\\.${field} is distinct from old\\.${field}`));
    }
  });

  it('installs a trigger on each of the three source tables', () => {
    for (const [trigger, table] of [
      ['night_out_members_notify', 'night_out_members'],
      ['night_out_suggestions_notify', 'night_out_suggestions'],
      ['night_outs_notify', 'night_outs'],
    ]) {
      expect(OUTBOX_SQL).toMatch(new RegExp(`drop trigger if exists ${trigger} on public\\.${table}`));
      expect(OUTBOX_SQL).toMatch(new RegExp(`create trigger ${trigger}[\\s\\S]{0,120}on public\\.${table}`));
    }
  });

  it('never notifies someone about their own action', () => {
    expect(OUTBOX_SQL).toMatch(/if p_recipient is null or p_recipient = p_actor then\n\s*return;/);
  });

  it('does not rewrite any hardened 0045-0050 RPC', () => {
    // Re-declaring invite_to_night_out or respond_night_out here would mean
    // restating bodies that four review rounds hardened, and silently reverting
    // whichever fix was missed. Triggers are additive on purpose.
    for (const rpc of [
      'invite_to_night_out',
      'respond_night_out',
      'join_night_out_by_token',
      'suggest_night_out_bar',
      'decide_night_out',
      'cancel_night_out',
    ]) {
      expect(OUTBOX_SQL).not.toMatch(new RegExp(`create or replace function public\\.${rpc}\\b`));
    }
  });

  it('uses idempotent DDL throughout', () => {
    expect(OUTBOX_SQL).not.toMatch(/create table (?!if not exists)/);
    expect(OUTBOX_SQL).not.toMatch(/create index (?!if not exists)/);
    expect(OUTBOX_SQL).toMatch(/add column if not exists/);
  });
});

describe('structural sanity', () => {
  /**
   * NOT a SQL syntax check — there is no Postgres on this machine and these
   * migrations are committed UNAPPLIED (applying them is attended). What this
   * does catch is the fat-finger class that a text-pattern suite would
   * otherwise sail past and only a failed attended apply would find: an
   * unbalanced dollar-quote or paren silently swallowing the rest of the file.
   */
  it.each([
    ['native_device_tokens', TOKENS_SQL],
    ['notification_outbox', OUTBOX_SQL],
  ])('%s has balanced dollar-quotes and parentheses', (_name, sql) => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    // Every `as $$ ... $$;` body opens and closes.
    expect((statements.match(/\$\$/g) ?? []).length % 2).toBe(0);

    const opens = (statements.match(/\(/g) ?? []).length;
    const closes = (statements.match(/\)/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it.each([
    ['native_device_tokens', TOKENS_SQL],
    ['notification_outbox', OUTBOX_SQL],
  ])('%s terminates every function body with $$;', (_name, sql) => {
    const bodies = (sql.match(/^as \$\$$/gm) ?? []).length;
    const ends = (sql.match(/^\$\$;$/gm) ?? []).length;
    expect(ends).toBe(bodies);
  });
});

describe('web push stays dark (criterion 11)', () => {
  /**
   * Assert over the EXECUTABLE SQL, not the prose. Both migrations name
   * `0009_push_subscriptions` and VAPID in their header comments, precisely to
   * record that web push is being left dark — a scan that cannot tell an
   * explanation from a statement would fail on the comment that proves the
   * point.
   */
  const statementsOnly = (sql: string): string =>
    sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

  it('introduces no VAPID key and no web-push dependency', () => {
    for (const sql of [TOKENS_SQL, OUTBOX_SQL]) {
      expect(statementsOnly(sql).toLowerCase()).not.toMatch(/vapid/);
    }
    const packageJson = readFileSync(
      path.join(__dirname, '..', '..', 'package.json'),
      'utf8',
    );
    expect(packageJson.toLowerCase()).not.toMatch(/"web-push"|vapid/);
  });

  it('does not read or write the dark 0009 web-push subscription table', () => {
    for (const sql of [TOKENS_SQL, OUTBOX_SQL]) {
      expect(statementsOnly(sql)).not.toMatch(/push_subscriptions/);
    }
  });

  it('leaves the 0009 web-push migration itself untouched', () => {
    // The native path is a SEPARATE store. If this ever fails, someone
    // repurposed the dark web-push table instead of adding to the device-token migration.
    const webPush = migration('0009_push_subscriptions.sql');
    expect(webPush).not.toMatch(/native_device_tokens|notification_outbox/);
  });
});
