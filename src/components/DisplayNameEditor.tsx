'use client';

/**
 * DisplayNameEditor — Settings account-card control for the account name
 * (TikTok-style identity: name + @handle are the visible pair; email is
 * login-only and never rendered).
 *
 * Plain save-on-submit (no optimistic write): the field keeps the typed
 * value on failure so nothing is lost, and the server response is
 * authoritative. Empty input clears the name (display name is optional —
 * the @handle is the required identity).
 */

import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  DISPLAY_NAME_MAX,
  isValidDisplayName,
  setOwnDisplayName,
} from '@/lib/profile.server';
import { getCacheEpoch } from '@/lib/accountCache';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type Props = {
  userId: string;
  /** Current server value — null when no name is set. */
  initialName: string | null;
  /** Notifies the parent so the identity header updates in place. */
  onSaved?: (name: string | null) => void;
};

export default function DisplayNameEditor({
  userId,
  initialName,
  onSaved,
}: Props): JSX.Element {
  const [value, setValue] = useState(initialName ?? '');
  const [savedValue, setSavedValue] = useState(initialName ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');

  const trimmed = value.trim();
  const isDirty = trimmed !== savedValue.trim();
  const isValid = isValidDisplayName(value);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!isDirty || !isValid || status === 'saving') return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    // Epoch guard (accountCache convention): an identity change while the
    // write is in flight must not report user A's result into user B's view.
    const epoch = getCacheEpoch();
    setStatus('saving');
    const ok = await setOwnDisplayName(supabase, userId, value);
    if (getCacheEpoch() !== epoch) {
      // Identity changed mid-flight: drop the result, but recover the
      // button from "Saving…" — status is UI state, not account data
      // (DeepSeek review).
      setStatus('idle');
      return;
    }
    if (!ok) {
      setStatus('error');
      return;
    }
    setSavedValue(trimmed);
    setStatus('saved');
    onSaved?.(trimmed === '' ? null : trimmed);
  };

  return (
    <form onSubmit={save} className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted uppercase tracking-widest block mb-1.5">
          Account name
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX + 1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (status !== 'idle') setStatus('idle');
            }}
            placeholder="Your name"
            className="w-full bg-bg border border-border focus:border-accent outline-none rounded-2xl px-4 py-3 text-base min-h-[44px]"
            disabled={status === 'saving'}
          />
          <button
            type="submit"
            disabled={!isDirty || !isValid || status === 'saving'}
            className="bg-accent text-bg font-display text-sm px-5 py-2.5 rounded-full min-h-[44px] touch-manipulation disabled:opacity-50 shrink-0"
          >
            {status === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </label>
      {!isValid ? (
        <p className="text-xs text-accent" role="alert">
          Keep it under {DISPLAY_NAME_MAX} characters.
        </p>
      ) : status === 'saved' && !isDirty ? (
        <p className="text-xs text-muted" role="status">
          <span className="text-accent mr-1" aria-hidden="true">✓</span>
          Saved.
        </p>
      ) : status === 'error' ? (
        <p className="text-accent text-xs" role="alert">
          Couldn&apos;t save your name — try again in a moment.
        </p>
      ) : null}
    </form>
  );
}
