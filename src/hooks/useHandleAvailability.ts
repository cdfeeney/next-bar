'use client';

/**
 * Debounced live availability probe for a desired username, shared by
 * ClaimHandle (Settings) and the onboarding identity form.
 *
 * Best-effort UX only: `claim_handle` is the authoritative check (a
 * private user's handle never shows in search, and search can fail
 * transiently) — callers keep their submit enabled for any valid input.
 * Cancelled-flag guard keeps a slow older response from overwriting the
 * state for newer input.
 */

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { checkHandleAvailability, isValidHandle } from '@/lib/profile.server';

const AVAILABILITY_DEBOUNCE_MS = 400;

export type HandleAvailability =
  | 'idle'
  | 'invalid'
  | 'checking'
  | 'available'
  | 'taken';

export function useHandleAvailability(desired: string): HandleAvailability {
  const [availability, setAvailability] = useState<HandleAvailability>('idle');

  useEffect(() => {
    const trimmed = desired.trim();
    if (trimmed === '') {
      setAvailability('idle');
      return;
    }
    if (!isValidHandle(trimmed)) {
      setAvailability('invalid');
      return;
    }

    let cancelled = false;
    setAvailability('checking');
    const timer = setTimeout(async () => {
      const supabase = getBrowserSupabase();
      if (!supabase) return;
      const available = await checkHandleAvailability(supabase, trimmed);
      if (cancelled) return;
      setAvailability(available ? 'available' : 'taken');
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [desired]);

  return availability;
}
