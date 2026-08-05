import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACCOUNT_CONTENT_KEYS,
  parseAccountContentData,
  type AccountContentKey,
  type LocalAccountContent,
} from '@/lib/accountContent.local';

type Row = {
  state_key: unknown;
  payload: unknown;
  client_updated_at: unknown;
};

export type ServerAccountContent = Map<AccountContentKey, LocalAccountContent>;

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
 * Fetch every account-owned state domain in one request.
 *
 * null means FAILED or INVALID, never "empty". A newer/older client row that
 * cannot be understood must stay untouched rather than being overwritten by a
 * local fallback.
 */
export async function fetchServerAccountContent(
  supabase: SupabaseClient,
): Promise<ServerAccountContent | null> {
  let result;
  try {
    result = await supabase
      .from('account_content_state')
      .select('state_key,payload,client_updated_at');
  } catch {
    return null;
  }
  const { data, error } = result;
  if (error || !Array.isArray(data)) return null;

  const out: ServerAccountContent = new Map();
  for (const raw of data as Row[]) {
    const parsed = parseRow(raw);
    if (!parsed || out.has(parsed[0])) return null;
    out.set(...parsed);
  }
  return out;
}

export async function fetchServerAccountContentKey(
  supabase: SupabaseClient,
  key: AccountContentKey,
): Promise<LocalAccountContent | 'absent' | null> {
  let result;
  try {
    result = await supabase
      .from('account_content_state')
      .select('state_key,payload,client_updated_at')
      .eq('state_key', key)
      .maybeSingle();
  } catch {
    return null;
  }
  const { data, error } = result;
  if (error) return null;
  if (!data) return 'absent';
  const parsed = parseRow(data as Row);
  return parsed?.[1] ?? null;
}

export async function upsertServerAccountContent(
  supabase: SupabaseClient,
  userId: string,
  key: AccountContentKey,
  value: LocalAccountContent,
): Promise<boolean> {
  try {
    const { error } = await supabase.from('account_content_state').upsert(
      {
        user_id: userId,
        state_key: key,
        payload: { data: value.data },
        client_updated_at: value.clientUpdatedAt,
      },
      { onConflict: 'user_id,state_key' },
    );
    return !error;
  } catch {
    return false;
  }
}
