import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0042_account_content_state.sql'),
  'utf8',
);
const LIVE_SQL = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('migration 0042 — account content table', () => {
  test('uses a per-user, per-domain primary key with auth-user cascade', () => {
    expect(SQL).toMatch(/user_id\s+uuid\s+not null references auth\.users\(id\) on delete cascade/);
    expect(SQL).toMatch(/primary key \(user_id, state_key\)/);
  });

  test('allows exactly the four private state domains', () => {
    const keyCheck = SQL.match(/state_key in \(([^)]+)\)/)?.[1] ?? '';
    expect(keyCheck.match(/'[^']+'/g)).toEqual([
      "'lists'",
      "'night_log'",
      "'night_archive'",
      "'shared_nights'",
    ]);
  });

  test('requires a bounded object payload carrying an explicit data field', () => {
    expect(SQL).toMatch(/jsonb_typeof\(payload\) = 'object' and payload \? 'data'/);
    expect(SQL).toMatch(/octet_length\(payload::text\) <= 262144/);
  });
});

describe('migration 0042 — privacy boundary', () => {
  test('enables RLS and defines four owner-only policies', () => {
    expect(LIVE_SQL).toMatch(/alter table public\.account_content_state enable row level security/);
    const policies = [...LIVE_SQL.matchAll(/create policy "([^"]+)"[\s\S]*?;/g)].map(
      (match) => match[0],
    );
    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      expect(policy).toMatch(/\(select auth\.uid\(\)\) = user_id/);
    }
  });

  test('pins both the old and new row image on update', () => {
    const update = LIVE_SQL.match(
      /create policy "account_content_state: owner can update own"[\s\S]*?;/,
    )?.[0];
    expect(update).toMatch(/using \(\(select auth\.uid\(\)\) = user_id\)/);
    expect(update).toMatch(/with check \(\(select auth\.uid\(\)\) = user_id\)/);
  });

  test('revokes first, grants only authenticated, and never grants anon/public', () => {
    const revokeAt = LIVE_SQL.indexOf(
      'revoke all on table public.account_content_state from public, anon, authenticated',
    );
    const grantAt = LIVE_SQL.indexOf(
      'grant select, insert, update, delete',
    );
    expect(revokeAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeGreaterThan(revokeAt);
    expect(LIVE_SQL).not.toMatch(/grant[^;]*\bto\s+(?:anon|public)\b/i);
  });
});

describe('migration 0042 — conflict and blast-radius guards', () => {
  test('rejects stale writes and ties, and stamps accepted updates server-side', () => {
    expect(SQL).toMatch(/new\.client_updated_at <= old\.client_updated_at/);
    expect(SQL).toMatch(/return null;/);
    expect(SQL).toMatch(/new\.updated_at := now\(\)/);
  });

  test('pins the trigger function search path and recreates its trigger', () => {
    expect(SQL).toMatch(/set search_path = ''/);
    expect(SQL).toMatch(/drop trigger if exists account_content_state_lww/);
    expect(SQL).toMatch(/before update on public\.account_content_state/);
  });

  test('does not modify an existing application table', () => {
    const touchedTables = [...LIVE_SQL.matchAll(/(?:create|alter) table(?: if not exists)? public\.(\w+)/g)]
      .map((match) => match[1]);
    expect(new Set(touchedTables)).toEqual(new Set(['account_content_state']));
  });

  test('documents the data-destructive rollback without making it live SQL', () => {
    expect(SQL).toMatch(/Rollback \(data-destructive/);
    expect(LIVE_SQL).not.toMatch(/drop table/);
  });
});
