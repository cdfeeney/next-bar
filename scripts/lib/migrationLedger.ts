/**
 * The migration ledger lives in `public` because the runner predates a private
 * schema. Supabase default privileges can grant browser roles access to new
 * public tables, so creation and hardening must be one atomic SQL batch.
 *
 * No application client reads this table. The migration owner can still read
 * and write it; service_role is deliberately not named by the revoke; and RLS
 * has no browser-facing policies.
 */
export const MIGRATION_LEDGER_DDL = `
  create table if not exists public.schema_migrations (
    name       text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  );

  alter table public.schema_migrations enable row level security;
  revoke all on table public.schema_migrations from public, anon, authenticated;
`;

