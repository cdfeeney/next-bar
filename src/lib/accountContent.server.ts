import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACCOUNT_CONTENT_KEYS,
  parseAccountContentData,
  type AccountContentKey,
  type LocalAccountContent,
} from '@/lib/accountContent.local';

/**
 * accountContent.server — Supabase half of account-content sync (v2.1).
 *
 * Every result is a discriminated union, because the DIFFERENCE between
 * failure shapes is load-bearing:
 *   unavailable   — the table does not exist in this deployment (42P01 from
 *                   Postgres, PGRST205 from PostgREST's schema cache). Not
 *                   retryable; retrying is a storm against a wall.
 *   auth-rejected — RLS or JWT said no (42501, PGRST301/302, HTTP 401/403).
 *                   Surfaced, never blindly retried: a rejected token does
 *                   not heal by repetition.
 *   too-large     — client-side 200,000-byte budget refused the payload
 *                   BEFORE any request. Visible failure, never retried.
 *   failed        — network/offline/unknown. Retryable.
 *
 * Both fetches filter by user_id explicitly. RLS already scopes rows to the
 * caller, but the client must not DEPEND on a server-side policy being
 * correct to avoid rendering someone else's rows — defense in depth on a
 * privacy boundary.
 */

export const ACCOUNT_CONTENT_PAYLOAD_BUDGET_BYTES = 200_000;

export type ServerContentErrorKind =
  | 'unavailable'
  | 'auth-rejected'
  | 'too-large'
  | 'failed';

export type ServerFetchAllResult =
  | { kind: 'ok'; content: ServerAccountContent }
  | { kind: ServerContentErrorKind };

export type ServerFetchKeyResult =
  | { kind: 'ok'; value: LocalAccountContent | 'absent' }
  | { kind: ServerContentErrorKind };

export type ServerUpsertResult = { kind: 'ok' } | { kind: ServerContentErrorKind };

type Row = {
  state_key: unknown;
  payload: unknown;
  client_updated_at: unknown;
};

export type ServerAccountContent = Map<AccountContentKey, LocalAccountContent>;

const UNAVAILABLE_CODES = new Set(['42P01', 'PGRST205']);
const AUTH_CODES = new Set(['42501', 'PGRST301', 'PGRST302']);

function classifyError(
  error: { code?: unknown; message?: unknown } | null,
  status?: number,
): ServerContentErrorKind {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (UNAVAILABLE_CODES.has(code)) return 'unavailable';
  if (AUTH_CODES.has(code) || status === 401 || status === 403) {
    return 'auth-rejected';
  }
  return 'failed';
}

function isKey(value: unknown): value is AccountContentKey {
  return (
    typeof value === 'string' &&
    (ACCOUNT_CONTENT_KEYS as readonly string[]).includes(value)
  );
}

function parseRow(row: Row): [AccountContentKey, LocalAccountContent] | null {
  if (!isKey(row.state_key)) return null;
  if (
    typeof row.client_updated_at !== 'string' ||
    Number.isNaN(Date.parse(row.client_updated_at)) ||
    row.payload === null ||
    typeof row.payload !== 'object' ||
    Array.isArray(row.payload) ||
    !Object.prototype.hasOwnProperty.call(row.payload, 'data')
  ) {
    return null;
  }
  const raw = (row.payload as Record<string, unknown>).data;
  const data = raw === null ? null : parseAccountContentData(row.state_key, raw);
  if (raw !== null && data === null) return null;
  return [
    row.state_key,
    { data, clientUpdatedAt: row.client_updated_at },
  ];
}

/**
 * Fetch every account-owned state domain in one request. A non-ok kind means
 * FAILED in that specific way, never "empty": rows that cannot be understood
 * must stay untouched rather than be overwritten by a local fallback.
 */
export async function fetchServerAccountContent(
  supabase: SupabaseClient,
  userId: string,
): Promise<ServerFetchAllResult> {
  let result;
  try {
    result = await supabase
      .from('account_content_state')
      .select('state_key,payload,client_updated_at')
      .eq('user_id', userId);
  } catch {
    return { kind: 'failed' };
  }
  const { data, error, status } = result;
  if (error || !Array.isArray(data)) {
    return { kind: classifyError(error, status) };
  }

  const out: ServerAccountContent = new Map();
  for (const raw of data as Row[]) {
    const parsed = parseRow(raw);
    if (!parsed || out.has(parsed[0])) return { kind: 'failed' };
    out.set(...parsed);
  }
  return { kind: 'ok', content: out };
}

export async function fetchServerAccountContentKey(
  supabase: SupabaseClient,
  userId: string,
  key: AccountContentKey,
): Promise<ServerFetchKeyResult> {
  let result;
  try {
    result = await supabase
      .from('account_content_state')
      .select('state_key,payload,client_updated_at')
      .eq('user_id', userId)
      .eq('state_key', key)
      .maybeSingle();
  } catch {
    return { kind: 'failed' };
  }
  const { data, error, status } = result;
  if (error) return { kind: classifyError(error, status) };
  if (!data) return { kind: 'ok', value: 'absent' };
  const parsed = parseRow(data as Row);
  return parsed ? { kind: 'ok', value: parsed[1] } : { kind: 'failed' };
}

/** UTF-8 byte length of the payload as it would be sent. */
export function accountContentPayloadBytes(value: LocalAccountContent): number {
  return new TextEncoder().encode(JSON.stringify({ data: value.data })).length;
}

export async function upsertServerAccountContent(
  supabase: SupabaseClient,
  userId: string,
  key: AccountContentKey,
  value: LocalAccountContent,
): Promise<ServerUpsertResult> {
  // 200 KB client budget, enforced BEFORE the request (the SQL constraint at
  // 262,144 stays the server's own backstop). Failure is visible and final —
  // retrying an oversized payload cannot shrink it.
  if (accountContentPayloadBytes(value) > ACCOUNT_CONTENT_PAYLOAD_BUDGET_BYTES) {
    return { kind: 'too-large' };
  }
  try {
    const { error, status } = await supabase.from('account_content_state').upsert(
      {
        user_id: userId,
        state_key: key,
        payload: { data: value.data },
        client_updated_at: value.clientUpdatedAt,
      },
      { onConflict: 'user_id,state_key' },
    );
    return error ? { kind: classifyError(error, status) } : { kind: 'ok' };
  } catch {
    return { kind: 'failed' };
  }
}
