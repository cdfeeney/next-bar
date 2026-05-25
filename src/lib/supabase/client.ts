'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Singleton browser Supabase client for use in Client Components and hooks.
 * Returns null when env vars are missing — callers should treat that as
 * "unauthenticated mode" rather than crashing.
 */
export function getBrowserSupabase(): SupabaseClient | null {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  cached = createBrowserClient(url, key);
  return cached;
}
