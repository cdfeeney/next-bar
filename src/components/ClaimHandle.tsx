'use client';

/**
 * ClaimHandle — Settings account-card control for claiming a username (B2).
 *
 * Live availability is a debounced probe against the public search RPC —
 * best-effort UX only. The claim button stays enabled for any valid input
 * because `claim_handle` is the authoritative check (a private user's
 * handle never shows in search, and search can fail transiently); a null
 * claim result surfaces as "taken — try another".
 *
 * No renames in v1: this component only renders when the profile's handle
 * is NULL (settings page gates it), and a successful claim swaps into a
 * terminal claimed state.
 */

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  checkHandleAvailability,
  claimHandle,
  isValidHandle,
} from '@/lib/profile.server';

const AVAILABILITY_DEBOUNCE_MS = 400;
const CHARSET_HINT = '3–20 characters: letters, numbers, underscores.';

type Availability = 'idle' | 'invalid' | 'checking' | 'available' | 'taken';

type ClaimStatus =
  | { kind: 'idle' }
  | { kind: 'claiming' }
  | { kind: 'claimed'; handle: string }
  | { kind: 'error'; message: string };

type Props = {
  /** Notifies the parent so it can swap to the @handle display. */
  onClaimed?: (handle: string) => void;
};

export default function ClaimHandle({ onClaimed }: Props): JSX.Element {
  const [desired, setDesired] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [status, setStatus] = useState<ClaimStatus>({ kind: 'idle' });

  // Debounced availability probe. Cancelled-flag guard keeps a slow older
  // response from overwriting the state for newer input.
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

  const claim = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = desired.trim();
    if (!isValidHandle(trimmed)) {
      setStatus({ kind: 'error', message: CHARSET_HINT });
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus({ kind: 'error', message: 'Sign-in is unavailable on this build.' });
      return;
    }
    setStatus({ kind: 'claiming' });
    const claimed = await claimHandle(supabase, trimmed);
    if (claimed === null) {
      setStatus({
        kind: 'error',
        message: 'That username is taken (or just got claimed) — try another.',
      });
      return;
    }
    setStatus({ kind: 'claimed', handle: claimed });
    onClaimed?.(claimed);
  };

  if (status.kind === 'claimed') {
    return (
      <p className="text-sm text-muted min-h-[44px] flex items-center">
        <span className="text-accent mr-1.5" aria-hidden="true">✓</span>
        You&apos;re{' '}
        <span className="text-accent font-display ml-1.5">@{status.handle}</span>
        <span className="ml-1.5">— friends can find you now.</span>
      </p>
    );
  }

  return (
    <form onSubmit={claim} className="space-y-3">
      <p className="font-display text-base">Claim your username</p>
      <label className="block">
        <span className="sr-only">Username</span>
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={desired}
          onChange={(e) => setDesired(e.target.value)}
          placeholder="username"
          className="w-full bg-bg border border-border focus:border-accent outline-none rounded-2xl px-4 py-3 text-base min-h-[44px]"
          disabled={status.kind === 'claiming'}
        />
      </label>
      {/* One line: the charset hint doubles as the invalid-input message
          (accent when the current input breaks it). */}
      <p className={availability === 'invalid' ? 'text-xs text-accent' : 'text-xs text-muted'}>
        {CHARSET_HINT}
      </p>
      {availability === 'checking' ? (
        <p className="text-xs text-muted" role="status">Checking availability…</p>
      ) : availability === 'available' ? (
        <p className="text-xs text-accent" role="status">
          @{desired.trim().toLowerCase()} looks available.
        </p>
      ) : availability === 'taken' ? (
        <p className="text-xs text-muted" role="status">
          That one&apos;s taken — try another.
        </p>
      ) : null}
      {status.kind === 'error' ? (
        <p className="text-accent text-sm" role="alert">
          {status.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={status.kind === 'claiming' || !isValidHandle(desired)}
        className="bg-accent text-bg font-display text-sm px-5 py-2.5 rounded-full min-h-[44px] touch-manipulation disabled:opacity-50"
      >
        {status.kind === 'claiming' ? 'Claiming…' : 'Claim username'}
      </button>
    </form>
  );
}
